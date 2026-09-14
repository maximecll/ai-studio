/** Mises à jour : compare le dépôt local à son dépôt distant, et l'applique. */
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Le lanceur relance le serveur quand il sort avec ce code. */
export const RESTART = 75

/** npm est un script `.cmd` sous Windows : execFile refuse de l'ouvrir seul. */
const NPM = platform() === 'win32' ? 'npm.cmd' : 'npm'
const SHELL = platform() === 'win32'

const git = (args, timeout = 30000) =>
  run('git', ['-C', ROOT, ...args], { timeout, maxBuffer: 8 << 20 })

const supervised = () => process.env.AI_STUDIO_SUPERVISED === '1'

const TELECHARGEMENT = {
  darwin: 'https://git-scm.com/download/mac',
  win32: 'https://git-scm.com/download/win',
  linux: 'https://git-scm.com/download/linux',
}

let present = null

/** git n'est livré ni avec Windows ni avec toutes les distributions : sans
    lui, aucune mise à jour n'est possible. Le résultat positif est gardé ;
    l'absence est resondée, l'utilisateur pouvant l'installer entre-temps. */
async function gitVersion() {
  if (present) return present
  try {
    const { stdout } = await run('git', ['--version'], { timeout: 8000 })
    present = { ok: true, version: stdout.trim().replace(/^git version /, '') }
  } catch {
    return { ok: false, version: null }
  }
  return present
}

/* ── État ─────────────────────────────────────────────────────────── */

let cache = { at: 0, body: null }

async function upstreamOf() {
  try {
    return (await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).stdout.trim()
  } catch {
    return null
  }
}

async function status() {
  const outil = await gitVersion()
  const socle = {
    git: outil.ok,
    gitVersion: outil.version,
    gitInstall: TELECHARGEMENT[platform()] ?? 'https://git-scm.com/downloads',
    behind: 0,
  }

  if (!outil.ok) {
    return { ...socle, repo: false, reason: "git n'est pas installé sur cette machine : sans lui, aucune mise à jour ne peut être récupérée." }
  }
  if (!existsSync(join(ROOT, '.git'))) {
    return { ...socle, repo: false, reason: 'Dossier téléchargé en ZIP : les mises à jour passent par un clone git.' }
  }
  try {
    await git(['rev-parse', '--is-inside-work-tree'], 8000)
  } catch {
    return { ...socle, repo: false, reason: "Ce dossier n'est pas un dépôt git." }
  }

  const upstream = await upstreamOf()
  if (!upstream) return { ...socle, repo: true, upstream: null, reason: 'Branche locale sans dépôt distant.' }

  // Un dépôt injoignable ne doit pas bloquer la réponse : on garde l'état connu.
  try { await git(['fetch', '--quiet', '--no-tags'], 25000) } catch { /* hors ligne */ }

  const [behind, dirty, log, head] = await Promise.all([
    git(['rev-list', '--count', `HEAD..${upstream}`]),
    // Les fichiers non suivis n'empêchent pas une avance rapide : les ignorer
    // évite de bloquer sur une capture d'écran déposée dans le dossier.
    git(['status', '--porcelain', '--untracked-files=no']),
    git(['log', '--format=%h %s', `HEAD..${upstream}`, '-20']),
    git(['rev-parse', '--short', 'HEAD']),
  ])

  return {
    ...socle,
    repo: true,
    upstream,
    head: head.stdout.trim(),
    behind: Number(behind.stdout.trim()) || 0,
    dirty: dirty.stdout.trim().length > 0,
    supervised: supervised(),
    commits: log.stdout.trim().split('\n').filter(Boolean).map((line) => {
      const space = line.indexOf(' ')
      return { sha: line.slice(0, space), subject: line.slice(space + 1) }
    }),
  }
}

/* ── Application ──────────────────────────────────────────────────── */

function exec(cmd, args, onLine) {
  return new Promise((ok, ko) => {
    const child = spawn(cmd, args, { cwd: ROOT, shell: SHELL })
    let tail = ''
    const feed = (chunk) => {
      const lines = (tail + chunk).split('\n')
      tail = lines.pop() ?? ''
      for (const l of lines) if (l.trim()) onLine(l.trim())
    }
    child.stdout.on('data', feed)
    child.stderr.on('data', feed)
    child.on('error', ko)
    child.on('close', (code) => (code === 0 ? ok() : ko(new Error(`${cmd} ${args[0]} a échoué (code ${code}).`))))
  })
}

async function apply(res) {
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  })
  const send = (e) => { if (!res.writableEnded) res.write(JSON.stringify(e) + '\n') }
  const phase = (label) => send({ type: 'phase', label })

  try {
    const before = await status()
    if (!before.repo || !before.upstream) throw new Error(before.reason)
    if (before.behind === 0) { send({ type: 'done', restart: false }); return res.end() }
    if (before.dirty) throw new Error('Des fichiers ont été modifiés localement : la mise à jour les écraserait.')

    const lockBefore = await git(['rev-parse', 'HEAD:package-lock.json']).then((r) => r.stdout.trim(), () => '')

    phase('Récupération des fichiers')
    await exec('git', ['-C', ROOT, 'merge', '--ff-only', before.upstream], (line) => send({ type: 'log', line }))

    const lockAfter = await git(['rev-parse', 'HEAD:package-lock.json']).then((r) => r.stdout.trim(), () => '')
    if (lockBefore !== lockAfter) {
      phase('Mise à jour des dépendances')
      await exec(NPM, ['install', '--no-audit', '--no-fund'], (line) => send({ type: 'log', line }))
    }

    phase('Reconstruction de l’interface')
    await exec(NPM, ['run', 'build'], (line) => send({ type: 'log', line }))

    cache = { at: 0, body: null }
    const restart = supervised()
    send({ type: 'done', restart, head: (await git(['rev-parse', '--short', 'HEAD'])).stdout.trim() })
    res.end()

    // Laisser la réponse partir avant de rendre la main au lanceur.
    if (restart) setTimeout(() => process.exit(RESTART), 400)
  } catch (e) {
    send({ type: 'error', message: e.message })
    res.end()
  }
}

/* ── Routes ───────────────────────────────────────────────────────── */

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
  res.end(JSON.stringify(body))
}

export async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost')
  const path = url.pathname.replace(/^\/update/, '') || '/'

  try {
    if (path === '/status' && req.method === 'GET') {
      // Un `git fetch` à chaque sondage userait le réseau pour rien.
      const fresh = url.searchParams.get('force') === '1'
      if (!fresh && cache.body && Date.now() - cache.at < 120_000) return json(res, 200, cache.body)
      const body = await status()
      cache = { at: Date.now(), body }
      return json(res, 200, body)
    }
    if (path === '/apply' && req.method === 'POST') return await apply(res)
    return json(res, 404, { error: 'Route inconnue.' })
  } catch (e) {
    if (!res.headersSent) return json(res, 500, { error: e.message })
    res.end()
  }
}
