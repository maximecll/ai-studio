/** Amorçage Python partagé — génération d'images comme recherche web.
 *
 * Déposer un interpréteur, créer un environnement, l'utiliser : la même
 * mécanique sert à plusieurs outils. Elle vit ici, une seule fois. */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { arch, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { download } from './setup.mjs'

const execute = promisify(execFile)

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/* Python embarqué, quand la machine n'en a pas. Les archives
   `python-build-standalone` sont relogeables et se déplient sans installateur :
   même principe que Node.js et Ollama. */
export const RUNTIME = join(ROOT, '.runtime')
const PY_DIR = join(RUNTIME, 'python')
const PY_TAG = '20260901'
const PY_VERSION = '3.12.14'

/** Sous Windows, les outils suivent la page de codes héritée s'ils ne sont pas
    forcés : les accents ressortent alors illisibles. */
export const ENV_UTF8 = {
  ...process.env,
  PYTHONUNBUFFERED: '1',
  PYTHONIOENCODING: 'utf-8',
  // Mode UTF-8 complet : couvre aussi les chemins de fichiers accentués.
  PYTHONUTF8: '1',
}

/** Chemin de l'interpréteur au sein d'un environnement virtuel. */
export function venvPython(venv) {
  return platform() === 'win32' ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python')
}

function pythonCible() {
  const a = arch() === 'arm64' ? 'aarch64' : 'x86_64'
  switch (platform()) {
    case 'win32': return `${a}-pc-windows-msvc`
    case 'darwin': return `${a}-apple-darwin`
    case 'linux': return `${a}-unknown-linux-gnu`
    default: return null
  }
}

function pythonEmbarque() {
  const p = platform() === 'win32' ? join(PY_DIR, 'python.exe') : join(PY_DIR, 'bin', 'python3')
  return existsSync(p) ? p : null
}

/** Interpréteur hôte : celui qu'on a déposé d'abord, celui du système ensuite. */
export async function hostPython() {
  const embarque = pythonEmbarque()
  if (embarque) return { cmd: embarque, prefixe: [], version: PY_VERSION }

  const essais = platform() === 'win32'
    ? [['py', ['-3']], ['python', []], ['python3', []]]
    : [['python3', []], ['python', []]]
  for (const [cmd, prefixe] of essais) {
    try {
      const { stdout } = await execute(cmd, [...prefixe, '-c', 'import sys;print("%d.%d"%sys.version_info[:2])'], { timeout: 10000 })
      const [majeure, mineure] = stdout.trim().split('.').map(Number)
      if (majeure === 3 && mineure >= 10) return { cmd, prefixe, version: stdout.trim() }
    } catch { /* on essaie le suivant */ }
  }
  return null
}

/** Dépose un interpréteur complet dans `.runtime/python`, sans installateur
    ni droit administrateur : c'est le seul moyen d'aller au bout sur une
    machine qui n'a pas Python — le cas courant sous Windows. */
export async function installPython(send, log) {
  const cible = pythonCible()
  if (!cible) throw new Error(`Système non pris en charge pour Python : ${platform()} ${arch()}.`)

  const nom = `cpython-${PY_VERSION}+${PY_TAG}-${cible}-install_only.tar.gz`
  const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${PY_TAG}/${nom}`
  await mkdir(RUNTIME, { recursive: true })
  const archive = join(RUNTIME, nom)

  send({ type: 'phase', phase: 'install', label: `Téléchargement de Python ${PY_VERSION}` })
  const t0 = Date.now()
  await download(url, archive, (completed, total) => {
    const speed = completed / Math.max(0.001, (Date.now() - t0) / 1000)
    send({
      type: 'progress',
      phase: 'downloading',
      completed,
      total,
      speed,
      eta: speed > 1 && total ? (total - completed) / speed : null,
    })
  })

  send({ type: 'phase', phase: 'install', label: 'Installation de Python' })
  await rm(PY_DIR, { recursive: true, force: true })
  // L'archive contient un dossier `python/` : on la déplie dans `.runtime`.
  await execute('tar', ['-xzf', archive, '-C', RUNTIME], { timeout: 900000, maxBuffer: 8 << 20 })
  await rm(archive, { force: true })

  if (!pythonEmbarque()) throw new Error("L'archive Python ne contient pas l'interpréteur attendu.")
  log(`Python ${PY_VERSION} déposé dans .runtime/python`)
}
