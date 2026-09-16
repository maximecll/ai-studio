/** Recherche web, instance SearXNG locale, auto-hébergée.
 *
 * SearXNG est un métamoteur respectueux de la vie privée : il interroge
 * plusieurs moteurs et n'expose ni compte, ni clé, ni traçage. On l'installe
 * dans son propre environnement Python, on le lance en service local, et on
 * l'interroge en JSON. Les résultats sont glissés en tête du prompt, comme les
 * connaissances (RAG). Rien ne sort de la machine que les requêtes de recherche
 * elles-mêmes, et elles partent chez SearXNG, pas chez nous. */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { platform } from 'node:os'
import { join } from 'node:path'
import { get as getHttp, request as httpRequest } from 'node:http'
import { randomBytes } from 'node:crypto'
import { gitBin } from './setup.mjs'
import { attach, start } from './tasks.mjs'
import { ENV_UTF8, hostPython, installPython, ROOT, venvPython } from './python.mjs'

const VENV = process.env.STUDIO_SEARX_VENV ?? join(ROOT, '.venv-searx')
const PYTHON = venvPython(VENV)
const RUNTIME = join(ROOT, '.runtime')
const SRC = join(RUNTIME, 'searxng')
const DATA = join(RUNTIME, 'searxng-data')
const SETTINGS = join(DATA, 'settings.yml')
const SHIMS = join(DATA, 'shims')
const READY = join(DATA, 'ready')

/** SearXNG ne publie pas de versions : on suit master, comme le recommande le
    projet, les moteurs de recherche changent, les correctifs suivent. */
const REPO = 'https://github.com/searxng/searxng.git'
const PORT = Number(process.env.STUDIO_SEARX_PORT ?? 8888)
const BASE = `http://127.0.0.1:${PORT}`

/* ── État ─────────────────────────────────────────────────────────── */

export function searxInstalled() {
  return existsSync(PYTHON) && existsSync(SETTINGS) && existsSync(READY)
}

function reachable() {
  return new Promise((ok) => {
    const req = getHttp(`${BASE}/`, { timeout: 2500 }, (res) => {
      res.resume()
      ok((res.statusCode ?? 0) < 500)
    })
    req.on('error', () => ok(false))
    req.on('timeout', () => { req.destroy(); ok(false) })
  }).catch(() => false)
}

/* ── Service ──────────────────────────────────────────────────────── */

let started = null

function env() {
  return {
    ...ENV_UTF8,
    SEARXNG_SETTINGS_PATH: SETTINGS,
    // Le shim `pwd` (Windows) doit être trouvable avant tout le reste.
    ...(platform() === 'win32' ? { PYTHONPATH: SHIMS + (process.env.PYTHONPATH ? `;${process.env.PYTHONPATH}` : '') } : {}),
  }
}

function startSearx() {
  if (started && started.exitCode === null) return started
  // Comme Ollama : détaché hors Windows pour tenir un groupe de processus qu'on
  // pourra tuer d'un bloc ; rattaché sous Windows, où taskkill /t fait le ménage.
  const detached = platform() !== 'win32'
  started = spawn(PYTHON, ['-m', 'searx.webapp'], {
    cwd: DATA,
    env: env(),
    stdio: 'ignore',
    detached,
    windowsHide: true,
  })
  if (detached) started.unref()
  return started
}

async function waitUp(tries = 80) {
  for (let i = 0; i < tries; i++) {
    if (await reachable()) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

/** Démarre l'instance si elle est installée mais éteinte. */
export async function ensureSearx() {
  if (!searxInstalled()) return 'absent'
  if (await reachable()) return 'deja-lance'
  startSearx()
  return (await waitUp()) ? 'lance' : 'muet'
}

/** N'arrête que le processus qu'on a nous-mêmes lancé. */
export function stopSearx() {
  if (!started || started.exitCode !== null) return
  try {
    if (platform() === 'win32') spawnSync('taskkill', ['/f', '/t', '/pid', String(started.pid)], { windowsHide: true })
    else process.kill(-started.pid)
  } catch { /* déjà parti */ }
  started = null
}

/* ── Requête ──────────────────────────────────────────────────────── */

/** Interroge l'instance en JSON et renvoie les meilleurs résultats. */
async function query(q, count) {
  const etat = await ensureSearx()
  if (etat === 'absent') throw new Error("La recherche web n'est pas installée.")
  if (etat === 'muet') throw new Error("SearXNG a été lancé mais ne répond pas.")

  const url = `${BASE}/search?q=${encodeURIComponent(q)}&format=json&safesearch=0&language=auto`
  const brut = await new Promise((ok, ko) => {
    const req = httpRequest(url, { method: 'GET', timeout: 20000, headers: { accept: 'application/json' } }, (res) => {
      const morceaux = []
      res.on('data', (c) => morceaux.push(c))
      res.on('end', () => {
        if (res.statusCode !== 200) return ko(new Error(`SearXNG a répondu ${res.statusCode}.`))
        try { ok(JSON.parse(Buffer.concat(morceaux).toString('utf8'))) }
        catch { ko(new Error('Réponse SearXNG illisible.')) }
      })
    })
    req.on('error', ko)
    req.on('timeout', () => { req.destroy(); ko(new Error('SearXNG a mis trop de temps à répondre.')) })
    req.end()
  })

  const vus = new Set()
  const resultats = []
  for (const r of brut.results ?? []) {
    if (!r?.url || !r?.title || vus.has(r.url)) continue
    vus.add(r.url)
    resultats.push({
      title: String(r.title).trim(),
      url: String(r.url),
      content: String(r.content ?? '').trim(),
      engine: r.engine ?? null,
    })
    if (resultats.length >= count) break
  }
  return resultats
}

/* ── Installation ─────────────────────────────────────────────────── */

/** SearXNG importe `pwd` (Unix) au chargement d'un module, même sans redis
    configuré : sous Windows ce module n'existe pas. Un stub suffit. */
const PWD_SHIM = `"""Stub Windows du module Unix pwd, requis par SearXNG."""
from collections import namedtuple
import getpass, os

struct_passwd = namedtuple("struct_passwd",
    ["pw_name","pw_passwd","pw_uid","pw_gid","pw_gecos","pw_dir","pw_shell"])

def _e(uid=0):
    return struct_passwd(getpass.getuser(), "x", uid, uid, "", os.path.expanduser("~"), "")
def getpwuid(uid): return _e(uid)
def getpwnam(name): return _e()
def getpwall(): return [_e()]
`

function settingsYaml(secret) {
  return `# Généré par AI Studio, ne pas modifier à la main.
use_default_settings: true

general:
  instance_name: "AI Studio"
  debug: false
  enable_metrics: false

server:
  secret_key: "${secret}"
  bind_address: "127.0.0.1"
  port: ${PORT}
  limiter: false
  public_instance: false
  image_proxy: false
  # L'API est interrogée en GET : le formulaire par défaut est en POST.
  method: "GET"

search:
  safe_search: 0
  autocomplete: ""
  formats:
    - html
    - json

outgoing:
  request_timeout: 6.0
  max_request_timeout: 12.0
`
}

/** Émet un runner de tâche : Python, clone, environnement, pip, réglages. */
function installer() {
  return (send) =>
    new Promise((done) => {
      const step = (label) => send({ type: 'phase', phase: 'install', label })

      const run = (cmd, args, label, opts = {}) =>
        new Promise((next) => {
          if (label) step(label)
          const child = spawn(cmd, args, { cwd: ROOT, env: ENV_UTF8, ...opts })
          let tail = ''
          const watch = (s) => {
            s.setEncoding('utf8')
            s.on('data', (c) => {
              tail = (tail + c).slice(-4000)
              const line = String(c).trim().split('\n').filter(Boolean).at(-1)
              if (line) send({ type: 'log', line: line.slice(0, 200) })
            })
          }
          watch(child.stdout)
          watch(child.stderr)
          child.on('close', (code) => next({ code, tail }))
          child.on('error', (err) => next({ code: -1, tail: err.message }))
        })

      ;(async () => {
        try {
          // 1. Python : celui du système, sinon on en dépose un.
          let hote = await hostPython()
          if (!hote) {
            await installPython(send, (line) => send({ type: 'log', line }))
            hote = await hostPython()
            if (!hote) return done(send({ type: 'error', message: 'Python reste introuvable après installation.' }))
          }

          // 2. Environnement dédié.
          if (!existsSync(PYTHON)) {
            const venv = await run(hote.cmd, [...hote.prefixe, '-m', 'venv', VENV], "Création de l'environnement Python")
            if (venv.code !== 0) return done(send({ type: 'error', message: `Environnement impossible à créer : ${venv.tail.slice(-300)}` }))
          }

          // 3. Sources de SearXNG (clone superficiel de master).
          const git = gitBin()
          await rm(SRC, { recursive: true, force: true })
          await mkdir(RUNTIME, { recursive: true })
          const clone = await run(git, ['clone', '--depth', '1', REPO, SRC], 'Téléchargement de SearXNG')
          if (clone.code !== 0) return done(send({ type: 'error', message: `Clone de SearXNG échoué : ${clone.tail.slice(-300)}` }))

          // 4. pip à jour, puis les dépendances, puis SearXNG lui-même.
          //    Ses dépendances passent d'abord : le backend de compilation
          //    importe `searx` (donc msgspec…) pour lire la version, et
          //    `--no-build-isolation` le laisse alors puiser dans l'environnement.
          await run(PYTHON, ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel'], 'Mise à jour de pip')
          const deps = await run(PYTHON, ['-m', 'pip', 'install', '-r', join(SRC, 'requirements.txt')], 'Installation des dépendances')
          if (deps.code !== 0) return done(send({ type: 'error', message: `Dépendances de SearXNG échouées : ${deps.tail.slice(-400)}` }))
          const pip = await run(PYTHON, ['-m', 'pip', 'install', '--use-pep517', '--no-build-isolation', SRC], 'Installation de SearXNG')
          if (pip.code !== 0) return done(send({ type: 'error', message: `Installation de SearXNG échouée : ${pip.tail.slice(-400)}` }))

          // 5. Réglages : JSON activé, limiteur désactivé, secret aléatoire.
          step("Configuration de l'instance")
          await mkdir(DATA, { recursive: true })
          await writeFile(SETTINGS, settingsYaml(randomBytes(32).toString('hex')), 'utf8')
          if (platform() === 'win32') {
            await mkdir(SHIMS, { recursive: true })
            await writeFile(join(SHIMS, 'pwd.py'), PWD_SHIM, 'utf8')
          }
          // Le clone n'est plus utile : le paquet est copié dans l'environnement.
          await rm(SRC, { recursive: true, force: true })

          // 6. Démarrage de vérification.
          step('Démarrage de SearXNG')
          await writeFile(READY, new Date().toISOString(), 'utf8')
          const up = await ensureSearx()
          if (up === 'lance' || up === 'deja-lance') send({ type: 'done' })
          else send({ type: 'error', message: 'SearXNG est installé mais ne répond pas.' })
        } catch (e) {
          send({ type: 'error', message: e?.message ?? String(e) })
        }
        done()
      })()
    })
}

/* ── Routes ───────────────────────────────────────────────────────── */

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
  res.end(JSON.stringify(body))
}

async function body(req) {
  const morceaux = []
  for await (const m of req) morceaux.push(m)
  try { return JSON.parse(Buffer.concat(morceaux).toString('utf8') || '{}') } catch { return {} }
}

export async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost')
  const path = url.pathname.replace(/^\/search/, '') || '/'

  try {
    if (path === '/status' && req.method === 'GET') {
      return json(res, 200, {
        installed: searxInstalled(),
        running: searxInstalled() ? await reachable() : false,
        partial: existsSync(VENV) && !searxInstalled(),
        port: PORT,
      })
    }

    if (path === '/install' && req.method === 'POST') {
      const job = start('searx', 'searx', 'Recherche web', installer())
      return attach(job, res)
    }

    if (path === '/query' && req.method === 'POST') {
      const { q, count } = await body(req)
      if (!q || !String(q).trim()) return json(res, 400, { error: 'Requête vide.' })
      const results = await query(String(q).trim(), Math.min(Math.max(Number(count) || 5, 1), 10))
      return json(res, 200, { results })
    }

    if (path === '/reset' && req.method === 'POST') {
      stopSearx()
      await rm(VENV, { recursive: true, force: true })
      await rm(DATA, { recursive: true, force: true })
      await rm(SRC, { recursive: true, force: true })
      return json(res, 200, { ok: true })
    }

    return json(res, 404, { error: 'Route inconnue.' })
  } catch (e) {
    if (!res.headersSent) return json(res, 500, { error: e.message })
    res.end()
  }
}
