/** Génération d'images. */
import { execFile, spawn } from 'node:child_process'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, open, readdir, rm, stat } from 'node:fs/promises'
import { arch, homedir, platform, totalmem } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { download, PS_UTF8 } from './setup.mjs'
import { attach, isRunning, start } from './tasks.mjs'
import { promisify } from 'node:util'

const execute = promisify(execFile)

/** mflux repose sur MLX : puce Apple uniquement. Partout ailleurs, diffusers. */
const APPLE = platform() === 'darwin' && arch() === 'arm64'
export const RUNNER = APPLE ? 'mflux' : 'diffusers'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WORKER = join(ROOT, 'scripts', 'flux_worker.py')

/** Environnement Python dédié : le moteur d'images n'a rien à faire ailleurs. */
const VENV = process.env.STUDIO_IMAGES_VENV ?? join(ROOT, '.venv-images')

/* Python embarqué, quand la machine n'en a pas. Les archives
   `python-build-standalone` sont relogeables et se déplient sans installateur :
   même principe que Node.js et Ollama. */
const RUNTIME = join(ROOT, '.runtime')
const PY_DIR = join(RUNTIME, 'python')
const PY_TAG = '20260901'
const PY_VERSION = '3.12.14'
const PYTHON = platform() === 'win32'
  ? join(VENV, 'Scripts', 'python.exe')
  : join(VENV, 'bin', 'python')

/** Les images fraîches attendent ici que l'interface vienne les chercher. */
const STAGING = join(homedir(), '.studio', 'images')

/** Bibliothèque de LoRAs — un simple dossier où l'on dépose des fichiers. */
const LORAS = process.env.STUDIO_LORAS ?? join(homedir(), '.studio', 'loras')
/** Au-delà, une image non récupérée est un déchet : l'onglet a été fermé. */
const STALE_MS = 6 * 60 * 60 * 1000

// ── Catalogue ──────────────────────────────────────────────────────── `repo` est ce qu'on télécharge, `base` l'architecture que mflux doit…
const MODELS = [
  {
    id: 'flux-dev-4bit',
    platforms: ['darwin'],
    /* Pic mesuré sur cette machine. */
    needsRam: 8_200_000_000,
    family: 'flux',
    runner: 'mflux',
    // Largeur du transformeur FLUX.1 : un LoRA d'une autre largeur ne s'applique pas.
    loraTarget: 'flux',
    loraWidth: 3072,
    name: 'FLUX.1 dev',
    variant: '4 bits',
    repo: 'dhairyashil/FLUX.1-dev-mflux-4bit',
    base: 'dev',
    quantize: null,
    bytes: 9_620_000_000,
    steps: { default: 20, min: 8, max: 50 },
    guidance: { default: 3.5, min: 1, max: 10 },
    msPerStep768: 27_000,
    loadMs: 20_000,
    measured: true,
    note: "La référence en qualité, quantifiée pour tenir sur 16 Go. Le plus lent du lot : comptez le temps annoncé ci-dessous.",
    recommended: true,
  },
  {
    id: 'flux-schnell-4bit',
    platforms: ['darwin'],
    /* Pic mesuré sur cette machine. */
    needsRam: 8_200_000_000,
    family: 'flux',
    runner: 'mflux',
    // Largeur du transformeur FLUX.1 : un LoRA d'une autre largeur ne s'applique pas.
    loraTarget: 'flux',
    loraWidth: 3072,
    name: 'FLUX.1 schnell',
    variant: '4 bits',
    repo: 'dhairyashil/FLUX.1-schnell-mflux-4bit',
    base: 'schnell',
    quantize: null,
    bytes: 9_620_000_000,
    steps: { default: 4, min: 1, max: 8 },
    // schnell est distillé sans branche de guidage : le réglage n'a aucun effet.
    guidance: null,
    msPerStep768: 27_000,
    loadMs: 20_000,
    measured: true,
    note: "Version distillée : quatre pas au lieu de vingt. Cinq fois plus rapide que dev, un cran en dessous en finesse.",
  },
  {
    id: 'z-image-turbo',
    platforms: ['darwin'],
    /* Déduit du poids des fichiers. */
    needsRam: 6_500_000_000,
    family: 'z-image',
    runner: 'mflux',
    loraTarget: 'z-image',
    loraWidth: null,
    name: 'Z-Image Turbo',
    variant: '4 bits',
    repo: 'filipstrand/Z-Image-Turbo-mflux-4bit',
    base: 'z-image-turbo',
    quantize: null,
    bytes: 5_910_000_000,
    steps: { default: 8, min: 4, max: 16 },
    guidance: null,
    // Six milliards de paramètres contre douze : estimation, pas mesure.
    msPerStep768: 14_000,
    loadMs: 20_000,
    measured: false,
    note: "Deux fois plus petit que FLUX et distillé. Le meilleur rapport vitesse/qualité pour cette machine.",
  },
  {
    id: 'flux2-klein-4b',
    platforms: ['darwin'],
    /* Déduit du poids des fichiers. */
    needsRam: 5_200_000_000,
    family: 'flux2',
    runner: 'mflux',
    loraTarget: 'flux2',
    loraWidth: null,
    name: 'FLUX.2 Klein',
    variant: '4 B · 4 bits',
    repo: 'Runpod/FLUX.2-klein-4B-mflux-4bit',
    base: 'flux2-klein-4b',
    quantize: null,
    bytes: 4_620_000_000,
    steps: { default: 4, min: 2, max: 16 },
    guidance: { default: 1, min: 0.5, max: 5 },
    // Quatre milliards de paramètres : estimation, pas mesure.
    msPerStep768: 10_000,
    loadMs: 20_000,
    measured: false,
    note: "Le plus léger et le plus rapide. Génération la plus récente de Black Forest Labs, en version compacte.",
  },
  {
    id: 'krea-2-turbo',
    platforms: ['darwin'],
    /* Déduit du poids des fichiers. */
    needsRam: 14_000_000_000,
    family: 'krea2',
    runner: 'mflux',
    loraTarget: 'krea2',
    loraWidth: null,
    name: 'Krea 2 Turbo',
    variant: '4 bits',
    repo: 'mflux-community/krea-2-turbo-mflux-q4',
    base: 'krea-2',
    quantize: null,
    bytes: 15_780_000_000,
    steps: { default: 8, min: 4, max: 24 },
    guidance: { default: 1, min: 0.5, max: 5 },
    msPerStep768: 27_000,
    loadMs: 20_000,
    measured: false,
    note: "Rendu photographique très travaillé, mais 16 Go de poids : la mémoire sera juste.",
    heavy: true,
  },
  {
    id: 'wan22-ti2v-5b',
    platforms: ['darwin'],
    /* L'encodeur de texte de 11 Go est le poste le plus lourd ; il est libéré ensuite. */
    needsRam: 11_500_000_000,
    family: 'wan',
    // Wan est un modèle vidéo ; réglé sur une seule image, il rend une image fixe.
    runner: 'mlx-video',
    // Wan A14B porte les mêmes noms de couches que le 5 B : seule la largeur les distingue.
    loraTarget: 'wan',
    loraWidth: 3072,
    name: 'Wan2.2 TI2V',
    variant: '5 B · 8 bits',
    repo: 'Anes1032/Wan2.2-TI2V-5B-mlx-q8',
    base: null,
    quantize: null,
    bytes: 19_600_000_000,
    steps: { default: 20, min: 4, max: 40 },
    guidance: { default: 5, min: 1, max: 10 },
    // Mesuré : 4,5 s par pas à 768². Le débruitage est six fois plus rapide
    // que FLUX — la séquence latente ne fait que 576 jetons contre 2 304.
    msPerStep768: 4_500,
    // Mais l'encodeur UMT5-XXL coûte 124 s à charger, et le VAE 19 s à décoder :
    // un coût fixe bien plus lourd que celui de mflux, indépendant du nombre de pas.
    loadMs: 143_000,
    measured: true,
    note: "Modèle vidéo employé sur une seule image. Débruitage très rapide, mais un encodeur de texte lourd à charger à chaque fois.",
  },
  {
    id: 'wan22-t2v-a14b',
    platforms: ['darwin'],
    /* Les deux experts de 7,8 Go restent chargés ensemble pendant tout le débruitage. */
    needsRam: 15_600_000_000,
    family: 'wan',
    runner: 'mlx-video',
    // Deux transformeurs experts : bruit élevé pour la composition, bruit faible pour les détails.
    dual: true,
    loraTarget: 'wan',
    loraWidth: 5120,
    name: 'Wan2.2 T2V',
    variant: '14 B · 4 bits',
    repo: 'SceneWorks/wan2.2-t2v-a14b-mlx',
    /* Seul le sous-dossier q4 est récupéré : le dépôt complet pèse 209 Go. */
    subfolder: 'q4',
    base: null,
    quantize: null,
    bytes: 28_630_000_000,
    steps: { default: 20, min: 4, max: 40 },
    guidance: { default: 5, min: 1, max: 10 },
    /* Non mesuré, et volontairement : deux experts de 8,4 Go sur 16 Go de
       mémoire, c'est au-delà de ce que cette machine peut tenir. */
    msPerStep768: 14_000,
    loadMs: 200_000,
    measured: false,
    note: "Le grand modèle Wan, celui des LoRAs courants. Deux experts de 8,4 Go : au-delà de ce que 16 Go de mémoire peuvent tenir — à essayer, sans garantie.",
    heavy: true,
  },
  {
    id: 'flux-dev-8bit',
    platforms: ['darwin'],
    /* Déduit du poids des fichiers. */
    needsRam: 14_000_000_000,
    family: 'flux',
    runner: 'mflux',
    // Largeur du transformeur FLUX.1 : un LoRA d'une autre largeur ne s'applique pas.
    loraTarget: 'flux',
    loraWidth: 3072,
    name: 'FLUX.1 dev',
    variant: '8 bits',
    repo: 'dhairyashil/FLUX.1-dev-mflux-8bit',
    base: 'dev',
    quantize: null,
    bytes: 18_010_000_000,
    steps: { default: 20, min: 8, max: 50 },
    guidance: { default: 3.5, min: 1, max: 10 },
    msPerStep768: 30_000,
    loadMs: 20_000,
    measured: false,
    note: "Quantification plus fine, donc plus fidèle — mais 18 Go de poids et un recours probable au disque sur 16 Go de mémoire.",
    heavy: true,
  },
  {
    id: 'sdxl-turbo',
    platforms: ['win32', 'linux', 'darwin'],
    /* Estimation : poids fp16 plus les tampons de débruitage. */
    needsRam: 8_000_000_000,
    family: 'sdxl',
    runner: 'diffusers',
    name: 'SDXL Turbo',
    variant: 'fp16',
    repo: 'stabilityai/sdxl-turbo',
    weightsVariant: 'fp16',
    /* Le dépôt publie les mêmes poids en plusieurs formats : 56 Go au total,
       6,9 Go une fois filtré. */
    allow: ['*.json', '*.txt', '**/*.fp16.safetensors'],
    base: null,
    quantize: null,
    bytes: 6_940_000_000,
    steps: { default: 4, min: 1, max: 8 },
    // Distillé sans branche de guidage, comme schnell.
    guidance: null,
    /* Recalé sur un relevé utilisateur : SDXL, 1024², 30 pas, 6 min 30 sur une
       carte de 8 Go qui décharge vers le processeur. Mieux vaut annoncer trop
       que trop peu ; la première génération corrigera. */
    msPerStep768: 6_500,
    loadMs: 40_000,
    measured: false,
    note: 'Quelques pas suffisent. Le plus rapide sur carte NVIDIA, et le seul tenable sans carte du tout.',
    recommended: true,
  },
  {
    id: 'sdxl-base',
    platforms: ['win32', 'linux', 'darwin'],
    /* Estimation : poids fp16 plus les tampons de débruitage. */
    needsRam: 8_000_000_000,
    family: 'sdxl',
    runner: 'diffusers',
    name: 'SDXL 1.0',
    variant: 'fp16',
    repo: 'stabilityai/stable-diffusion-xl-base-1.0',
    weightsVariant: 'fp16',
    allow: ['*.json', '*.txt', '**/*.fp16.safetensors'],
    base: null,
    quantize: null,
    /* Mesuré sur l'API Hugging Face, filtres appliqués : le dépôt entier
       pèse 77 Go, tous formats confondus. */
    bytes: 7_110_000_000,
    steps: { default: 30, min: 10, max: 50 },
    guidance: { default: 5, min: 1, max: 12 },
    msPerStep768: 6_500,
    loadMs: 40_000,
    measured: false,
    note: 'La version complète : trente pas, nettement plus fine que Turbo. Demande une carte graphique.',
  },
  {
    id: 'sd15',
    platforms: ['win32', 'linux', 'darwin'],
    /* Estimation : poids fp16 plus les tampons de débruitage. */
    needsRam: 4_000_000_000,
    family: 'sd15',
    runner: 'diffusers',
    name: 'Stable Diffusion 1.5',
    variant: 'fp16',
    repo: 'stable-diffusion-v1-5/stable-diffusion-v1-5',
    weightsVariant: 'fp16',
    allow: ['*.json', '*.txt', '**/*.fp16.safetensors'],
    base: null,
    quantize: null,
    bytes: 2_740_000_000,
    steps: { default: 25, min: 10, max: 50 },
    guidance: { default: 7.5, min: 1, max: 15 },
    // Trois fois plus léger que SDXL, à l'échelle du même relevé.
    msPerStep768: 2_200,
    loadMs: 20_000,
    measured: false,
    note: 'Le plus léger : deux gigaoctets, quelques minutes sur processeur. Qualité d’une génération d’avant SDXL.',
  },
]

/** Un modèle n'est proposé que si son système figure dans sa liste et que le
    moteur de cette machine sait le charger : mflux sur puce Apple, diffusers
    ailleurs, les mêmes trois modèles servant Windows et Linux. */
export const CATALOG = MODELS.filter((m) => m.runner === RUNNER && m.platforms.includes(platform()))

export const byId = (id) => CATALOG.find((m) => m.id === id)

/* ── Lecture des LoRAs ───────────────────────────────────────────── */

/** Au-delà, l'en-tête n'est plus un en-tête : on refuse plutôt que de ramer. */
const HEADER_CAP = 32 * 1024 * 1024

/** En-tête d'un fichier safetensors : huit octets de longueur, puis du JSON. */
async function readHeader(file) {
  const handle = await open(file, 'r')
  try {
    const size = new Uint8Array(8)
    const { bytesRead } = await handle.read(size, 0, 8, 0)
    if (bytesRead < 8) return null
    const length = Number(new DataView(size.buffer).getBigUint64(0, true))
    if (!length || length > HEADER_CAP) return null

    const body = Buffer.alloc(length)
    await handle.read(body, 0, length, 8)
    return JSON.parse(body.toString('utf8'))
  } catch {
    return null
  } finally {
    await handle.close()
  }
}

/** Architecture réellement visée, déduite des noms de tenseurs. */
const KEY_SIGNATURES = [
  [/^diffusion_model\.blocks\.|^blocks\.\d+\.(self_attn|cross_attn|ffn)/, 'wan'],
  /* Convention kohya, très répandue pour les LoRAs Wan entraînés à la main.
     Son absence ici laissait ces fichiers sans famille reconnue. */
  [/^lora_unet_blocks_\d+_(self_attn|cross_attn|ffn)/, 'wan'],
  [/^lora_unet_(double|single)_blocks/, 'flux'],
  [/^transformer\.transformer_blocks\./, 'flux'],
  [/^lora_unet_(input|down|mid|output|up)_blocks/, 'sd'],
]

function targetOf(header) {
  const tally = new Map()
  for (const key of Object.keys(header)) {
    if (key === '__metadata__') continue
    for (const [re, family] of KEY_SIGNATURES) {
      if (re.test(key)) {
        tally.set(family, (tally.get(family) ?? 0) + 1)
        break
      }
    }
  }
  let best = null
  for (const [family, n] of tally) if (!best || n > best[1]) best = [family, n]
  return best?.[0]
}

/** Largeur du modèle visé : la dimension la plus fréquente des matrices de rang faible. */
function widthOf(header) {
  const tally = new Map()
  for (const [key, spec] of Object.entries(header)) {
    if (key === '__metadata__') continue
    if (!/lora_down|lora_up|lora_A|lora_B/.test(key)) continue
    const shape = spec?.shape
    if (!Array.isArray(shape) || shape.length !== 2) continue
    const wide = Math.max(...shape)
    tally.set(wide, (tally.get(wide) ?? 0) + 1)
  }
  let best = null
  for (const [dim, n] of tally) if (!best || n > best[1]) best = [dim, n]
  return best?.[0]
}

/** Expert visé, pour les modèles à double transformeur. */
function expertOf(meta, filename) {
  const haystack = [meta.ss_sd_model_name, meta['modelspec.title'], filename]
    .filter(Boolean).join(' ').toLowerCase()
  if (/high[\s_-]*noise|highnoise/.test(haystack)) return 'high'
  if (/low[\s_-]*noise|lownoise/.test(haystack)) return 'low'
  return undefined
}

/** Mot déclencheur, tel que les outils d'entraînement le rangent — au mieux. */
function triggerOf(meta) {
  const direct = meta['modelspec.trigger_phrase'] ?? meta.ss_output_name
  try {
    const datasets = JSON.parse(meta.ss_datasets ?? '[]')
    for (const d of datasets) {
      for (const sub of d.subsets ?? []) {
        if (sub.class_tokens) return sub.class_tokens
      }
    }
  } catch { /* champ absent ou illisible : le direct fera l'affaire */ }
  return direct || undefined
}

/** Rang de l'adaptateur : ce qui dit le plus de sa force et de son poids. */
function rankOf(meta, header) {
  const dim = Number(meta.ss_network_dim)
  if (Number.isFinite(dim) && dim > 0) return dim
  // Repli : la plus petite dimension d'une matrice `lora_down` est le rang.
  for (const [key, spec] of Object.entries(header)) {
    if (key === '__metadata__' || !key.includes('lora_down')) continue
    const shape = spec?.shape
    if (Array.isArray(shape) && shape.length === 2) return Math.min(...shape)
  }
  return undefined
}

async function describeLora(name) {
  const file = join(LORAS, name)
  const { size } = await stat(file)
  const header = (await readHeader(file)) ?? {}
  const meta = header.__metadata__ ?? {}

  const architecture = meta['modelspec.architecture'] ?? meta.ss_base_model_version
  return {
    file: name,
    name: meta['modelspec.title'] || name.replace(/\.safetensors$/i, ''),
    bytes: size,
    /* Ce que le fichier déclare — indicatif, et régulièrement faux. */
    architecture,
    /* Ce que ses clés démontrent — fiable, c'est là-dessus qu'on tranche. */
    target: targetOf(header),
    width: widthOf(header),
    rank: rankOf(meta, header),
    trigger: triggerOf(meta),
    expert: expertOf(meta, name),
  }
}

async function listLoras() {
  await mkdir(LORAS, { recursive: true })
  const names = (await readdir(LORAS)).filter((f) => /\.safetensors$/i.test(f) && !f.startsWith('.'))
  const items = await Promise.all(
    names.map((n) => describeLora(n).catch(() => null)),
  )
  return items.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}

/** Un nom venu du client ne doit jamais pouvoir désigner un fichier ailleurs. */
export function loraPath(name) {
  if (typeof name !== 'string' || !/\.safetensors$/i.test(name)) return null
  const full = join(LORAS, name)
  return full.startsWith(resolve(LORAS) + sep) && existsSync(full) ? full : null
}

/* ── Utilitaires de réponse ──────────────────────────────────────── */

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
  res.end(JSON.stringify(body))
}

function ndjson(res) {
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    // Sans cela un proxy tamponnerait la réponse et la progression arriverait d'un bloc.
    'X-Accel-Buffering': 'no',
  })
  return (event) => {
    if (!res.writableEnded) res.write(JSON.stringify(event) + '\n')
  }
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('Corps de requête illisible.')
  }
}

/* ── Lecture d'un échec ──────────────────────────────────────────── */

/** Les bibliothèques colorent leur sortie ; l'interface n'en veut pas. */
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g

/** Dernières lignes utiles d'une sortie d'erreur. */
function lastLines(text, count = 3) {
  return String(text)
    .replace(ANSI, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-count)
    .join(' · ')
    .slice(0, 400)
}

/** Ce qu'il faut dire quand un worker s'arrête mal. */
function explainFailure({ code, signal, tail }, entry) {
  if (signal === 'SIGKILL' || signal === 'SIGABRT' || signal === 'SIGBUS') {
    const weight = entry ? ` ${entry.name} ${entry.variant} demande plus de mémoire que la machine n'en a de libre.` : ''
    return (
      "Le système a interrompu la génération : la mémoire a manqué." + weight +
      ' Fermez des applications, réduisez la définition, ou choisissez un modèle plus léger.'
    )
  }
  const detail = lastLines(tail)
  if (detail) return detail
  return `La génération s'est arrêtée sans message (code ${code ?? '?'}${signal ? `, signal ${signal}` : ''}).`
}

/* ── Lancement du worker ─────────────────────────────────────────── */

export function engineInstalled() {
  return existsSync(PYTHON) && existsSync(WORKER)
}

/** Lance le worker et transforme ses lignes NDJSON en appels à `onEvent`. */
/** Sous Windows, les outils suivent la page de codes héritée s'ils ne sont pas
    forcés : les accents ressortent alors illisibles. */
const ENV_UTF8 = {
  ...process.env,
  PYTHONUNBUFFERED: '1',
  PYTHONIOENCODING: 'utf-8',
  // Mode UTF-8 complet : couvre aussi les chemins de fichiers accentués.
  PYTHONUTF8: '1',
}

function runWorker(command, job, onEvent) {
  const child = spawn(PYTHON, [WORKER, command], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: ENV_UTF8,
  })

  child.stdin.end(JSON.stringify(job))

  let buffer = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let nl
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      try {
        onEvent(JSON.parse(line))
      } catch {
        /* Ligne tronquée ou bruit : on ne laisse pas ça casser le flux. */
      }
    }
  })

  // La sortie d'erreur porte les barres de progression et les avertissements des bibliothèques.
  let tail = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (c) => { tail = (tail + c).slice(-4000) })

  const done = new Promise((resolvePromise) => {
    child.on('close', (code, signal) => resolvePromise({ code, signal, tail }))
    child.on('error', (err) => resolvePromise({ code: -1, signal: null, tail: err.message }))
  })

  let killed = false
  return {
    done,
    kill() {
      if (killed || child.exitCode !== null) return
      killed = true
      child.kill('SIGTERM')
      setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL') }, 4000).unref?.()
    },
  }
}

/* ── Travaux en cours ────────────────────────────────────────────── */

/** Une seule génération à la fois : deux modèles de 10 Go se disputeraient la mémoire. */
let generating = null
const pulls = new Map()

/* ── Installation du moteur ──────────────────────────────────────── */

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
async function hostPython() {
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
async function installPython(send, log) {
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

/** Une carte NVIDIA change la roue PyTorch à installer — et tout le reste. */
async function hasNvidia() {
  try {
    await execute('nvidia-smi', ['-L'], { timeout: 8000 })
    return true
  } catch {
    return false
  }
}

/**
 * Un échec d'écriture qui survit à la reconstruction de l'environnement n'est
 * plus un fichier verrouillé. Sous Windows, la cause courante est l'accès
 * contrôlé aux dossiers, qui protège `Documents` et refuse l'écriture aux
 * programmes qu'il ne connaît pas — sans que rien ne le dise clairement.
 */
async function expliquerPip(tail) {
  const brut = tail.slice(-300)
  if (platform() !== 'win32' || !VERROUILLE.test(tail)) return brut
  try {
    const { stdout } = await execute('powershell', ['-NoProfile', '-Command',
      `${PS_UTF8}(Get-MpPreference).EnableControlledFolderAccess`], { timeout: 15000 })
    if (stdout.trim() === '1') {
      return `${brut}\n\nL'accès contrôlé aux dossiers de Windows est actif : il bloque l'écriture dans Documents, Images et Bureau. Autorisez AI Studio dans Sécurité Windows, ou déplacez le dossier du projet hors de Documents.`
    }
  } catch { /* Defender absent ou muet */ }
  return brut
}

/** Signatures d'un fichier verrouillé ou à demi écrit, selon le système. */
const VERROUILLE = /check the permissions|permission denied|access is denied|winerror 5|winerror 32|being used by another process/i

function pipInstall(send) {
  return new Promise((done) => {
    const step = (label) => send({ type: 'phase', phase: 'install', label })

    const run = (cmd, args, label) =>
      new Promise((next) => {
        step(label)
        const child = spawn(cmd, args, { cwd: ROOT, env: ENV_UTF8 })
        let tail = ''
        const watch = (s) => {
          s.setEncoding('utf8')
          s.on('data', (c) => {
            tail = (tail + c).slice(-4000)
            // pip est bavard ; seule la ligne utile est renvoyée.
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
      if (!existsSync(PYTHON)) {
        let hote = await hostPython()
        if (!hote) {
          try {
            await installPython(send, (line) => send({ type: 'log', line }))
          } catch (e) {
            send({ type: 'error', message: `Python n'a pas pu être installé : ${e.message}` })
            return done()
          }
          hote = await hostPython()
          if (!hote) {
            send({ type: 'error', message: 'Python reste introuvable après installation.' })
            return done()
          }
        }
        const venv = await run(hote.cmd, [...hote.prefixe, '-m', 'venv', VENV], "Création de l'environnement Python")
        if (venv.code !== 0) {
          send({ type: 'error', message: `Environnement Python impossible à créer : ${venv.tail.slice(-300)}` })
          return done()
        }
      }

      /* PyTorch se choisit avant le reste : la roue CUDA vient d'un autre
         index que PyPI, et diffusers l'installerait sinon en version
         processeur, silencieusement. */
      if (RUNNER === 'diffusers') {
        const cuda = await hasNvidia()
        const args = ['-m', 'pip', 'install', '--upgrade', 'torch']
        if (cuda) args.push('--index-url', 'https://download.pytorch.org/whl/cu124')
        const torch = await run(PYTHON, args, cuda ? 'Installation de PyTorch (CUDA)' : 'Installation de PyTorch (processeur)')
        if (torch.code !== 0) {
          send({ type: 'error', message: `PyTorch n'a pas pu être installé : ${torch.tail.slice(-300)}` })
          return done()
        }
      }

      // pip se met à jour lui-même en premier : les vieilles versions
      // remplacent mal un fichier déjà présent, surtout sous Windows.
      await run(PYTHON, ['-m', 'pip', 'install', '--upgrade', 'pip'], 'Mise à jour de pip')

      const paquets = RUNNER === 'mflux'
        ? ['mflux']
        : ['diffusers', 'transformers', 'accelerate', 'safetensors', 'sentencepiece', 'protobuf', 'peft']
      const etiquette = RUNNER === 'mflux' ? 'Installation de mflux et MLX' : 'Installation de diffusers'

      let pip = await run(PYTHON, ['-m', 'pip', 'install', '--upgrade', ...paquets], etiquette)

      /* « Check the permissions » ne vient presque jamais des droits : un
         fichier d'un essai précédent est encore verrouillé, ou à moitié
         écrit. Refaire l'environnement coûte moins cher que d'expliquer. */
      if (pip.code !== 0 && VERROUILLE.test(pip.tail)) {
        send({ type: 'log', line: 'Environnement abîmé par un essai précédent — reconstruction.' })
        await rm(VENV, { recursive: true, force: true })
        const hote = await hostPython()
        const neuf = await run(hote.cmd, [...hote.prefixe, '-m', 'venv', VENV], "Reconstruction de l'environnement")
        if (neuf.code !== 0) {
          send({ type: 'error', message: `Environnement Python impossible à recréer : ${neuf.tail.slice(-300)}` })
          return done()
        }
        await run(PYTHON, ['-m', 'pip', 'install', '--upgrade', 'pip'], 'Mise à jour de pip')
        pip = await run(PYTHON, ['-m', 'pip', 'install', '--upgrade', ...paquets], etiquette)
      }

      if (pip.code !== 0) {
        send({ type: 'error', message: `Installation échouée : ${await expliquerPip(pip.tail)}` })
        return done()
      }
      send({ type: 'done' })
      done()
    })()
  })
}

/* ── Entretien du dépôt d'images ─────────────────────────────────── */

async function sweep() {
  try {
    const files = await readdir(STAGING)
    const now = Date.now()
    await Promise.all(
      files.map(async (f) => {
        const full = join(STAGING, f)
        try {
          const s = await stat(full)
          if (now - s.mtimeMs > STALE_MS) await rm(full, { force: true })
        } catch { /* déjà parti */ }
      }),
    )
  } catch { /* le dossier n'existe pas encore */ }
}

/** Un identifiant venu du client ne doit jamais pouvoir désigner un autre dossier. */
const ID = /^[0-9a-f-]{36}$/i

function stagedPath(id) {
  if (!ID.test(id)) return null
  const full = join(STAGING, `${id}.png`)
  return full.startsWith(resolve(STAGING) + sep) ? full : null
}

/* ── Routage ─────────────────────────────────────────────────────── */

export async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost')
  // Monté tantôt avec le préfixe (serveur de production), tantôt sans (Vite).
  const path = url.pathname.replace(/^\/images/, '') || '/'

  try {
    if (path === '/status' && req.method === 'GET') return await status(res)
    if (path === '/loras' && req.method === 'GET') return json(res, 200, { folder: LORAS, items: await listLoras() })
    if (path === '/loras/reveal' && req.method === 'POST') return await reveal(res)
    if (path === '/install' && req.method === 'POST') return await install(req, res)
    if (path === '/reset' && req.method === 'POST') return await resetEngine(res)
    if (path === '/pull' && req.method === 'POST') return await pull(req, res)
    if (path === '/generate' && req.method === 'POST') return await generate(req, res)
    if (path === '/cancel' && req.method === 'POST') return await cancel(req, res)
    if (path === '/remove' && req.method === 'POST') return await remove(req, res)
    if (path === '/file' && req.method === 'GET') return await serve(url, res)
    if (path === '/file' && req.method === 'DELETE') return await discard(url, res)
    return json(res, 404, { error: 'Route inconnue.' })
  } catch (e) {
    if (!res.headersSent) return json(res, 500, { error: e.message })
    res.end()
  }
}

/** Ouvre la bibliothèque dans l'explorateur : déposer un fichier doit rester trivial. */
async function reveal(res) {
  await mkdir(LORAS, { recursive: true })
  const commande = { darwin: 'open', win32: 'explorer' }[platform()] ?? 'xdg-open'
  spawn(commande, [LORAS], { stdio: 'ignore', detached: true }).unref()
  return json(res, 200, { folder: LORAS })
}

async function status(res) {
  void sweep()
  if (!engineInstalled()) {
    // Le dossier existe mais l'interpréteur n'y est pas : installation coupée.
    return json(res, 200, {
      ready: false, catalog: CATALOG, venv: VENV, busy: false, backend: RUNNER,
      partial: existsSync(VENV),
    })
  }

  const repos = CATALOG.map((m) => m.repo)
  let info = null
  const run = runWorker('info', { repos }, (ev) => { if (ev.type === 'info') info = ev })
  const { code, tail } = await run.done

  if (!info) {
    return json(res, 200, {
      ready: false,
      catalog: CATALOG,
      venv: VENV,
      busy: false,
      // Un moteur qui ne répond pas est un reste d'installation, pas un moteur.
      partial: true,
      error: `Moteur présent mais inutilisable (code ${code}). ${lastLines(tail, 2)}`.trim(),
    })
  }

  const present = new Map(info.repos.map((r) => [r.repo, r]))
  return json(res, 200, {
    ready: true,
    busy: generating !== null,
    engine: info.mflux,
    backend: info.backend ?? RUNNER,
    torch: info.torch ?? null,
    python: info.python,
    cache: info.cache,
    free: info.free,
    /* Xet garde en plus un cache de morceaux dédupliqués : le disque paie
       deux fois, une fois le cache, une fois les poids reconstitués. */
    xet: info.xet ?? 0,
    venv: VENV,
    catalog: CATALOG.map((m) => {
      const seen = present.get(m.repo)
      const onDisk = seen?.bytes ?? 0
      return {
        ...m,
        installed: !!seen?.present,
        onDisk,
        // Un transfert repéré sur le disque, qu'il vienne ou non de cette application : l'interface doit pouvoir le montrer après un redémarrage comme après un…
        downloading: !!seen?.downloading,
        /* Des morceaux partiels mais plus aucun mouvement : téléchargement
           interrompu, reprenable. */
        partial: !seen?.present && (seen?.partials ?? 0) > 0,
        progress: onDisk > 0 && !seen?.present ? Math.min(1, onDisk / m.bytes) : undefined,
      }
    }),
  })
}

/** Détachée de la requête : rafraîchir la page n'interrompt rien.
    `fresh` jette l'environnement avant de repartir — ce qu'il faut après une
    installation coupée au milieu. */
async function install(req, res) {
  const { fresh } = await readBody(req).catch(() => ({}))
  const job = start('engine', 'engine', "Moteur d'images", async (send) => {
    if (fresh) {
      send({ type: 'phase', phase: 'install', label: 'Effacement de l’installation précédente' })
      await rm(VENV, { recursive: true, force: true })
    }
    await pipInstall(send)
  })
  return attach(job, res)
}

/** Efface l'environnement du moteur, sans rien toucher aux modèles déjà
    téléchargés : ils vivent dans le cache Hugging Face. */
async function resetEngine(res) {
  if (isRunning('engine')) return json(res, 409, { error: 'Une installation est en cours.' })
  await rm(VENV, { recursive: true, force: true })
  return json(res, 200, { ok: true })
}

async function pull(req, res) {
  const { model } = await readBody(req)
  const entry = byId(model)
  if (!entry) return json(res, 400, { error: 'Modèle inconnu.' })
  if (!engineInstalled()) return json(res, 409, { error: "Le moteur d'images n'est pas installé." })
  // Pas de refus si un transfert tourne déjà : `start` rend celui-là, et
  // l'onglet qui revient d'un rafraîchissement retrouve sa progression.
  const job = start(`image:${model}`, 'image', `${entry.name} ${entry.variant}`, async (send, signal) => {
    send({ type: 'phase', phase: 'starting', label: 'Préparation', model })
    const run = runWorker('pull', { repo: entry.repo, subfolder: entry.subfolder, allow: entry.allow, ignore: entry.ignore }, send)
    pulls.set(model, run)
    signal.addEventListener('abort', () => run.kill(), { once: true })

    const outcome = await run.done
    pulls.delete(model)
    if (outcome.code !== 0) send({ type: 'error', message: explainFailure(outcome, entry) })
    else send({ type: 'done', model })
  })
  return attach(job, res)
}

async function generate(req, res) {
  const body = await readBody(req)
  const entry = byId(body.model)
  if (!entry) return json(res, 400, { error: 'Modèle inconnu.' })
  if (!engineInstalled()) return json(res, 409, { error: "Le moteur d'images n'est pas installé." })
  if (generating) return json(res, 409, { error: 'Une image est déjà en cours de génération.' })

  const prompt = String(body.prompt ?? '').trim()
  if (!prompt) return json(res, 400, { error: 'Description manquante.' })

  // Certains modèles ne peuvent pas tenir, quoi qu'on ferme.
  const OS_FLOOR = 2_000_000_000
  if (entry.needsRam && entry.needsRam > totalmem() - OS_FLOOR) {
    return json(res, 409, {
      error:
        `${entry.name} ${entry.variant} a besoin d'environ ${(entry.needsRam / 1e9).toFixed(1)} Go ` +
        `de mémoire résidente. Cette machine en a ${(totalmem() / 1e9).toFixed(0)} Go au total : ` +
        `le système interromprait la génération. Choisissez un modèle plus léger.`,
    })
  }

  await mkdir(STAGING, { recursive: true })
  const id = randomUUID()
  const output = join(STAGING, `${id}.png`)

  // FLUX travaille par multiples de 16 ; on borne aussi ce qui tient en mémoire.
  const round16 = (n, fallback) => {
    const v = Number.isFinite(Number(n)) ? Number(n) : fallback
    return Math.max(256, Math.min(1536, Math.round(v / 16) * 16))
  }
  const steps = Math.max(entry.steps.min, Math.min(entry.steps.max, Number(body.steps) || entry.steps.default))
  const seed = Number.isInteger(body.seed) && body.seed >= 0 ? body.seed : Math.floor(Math.random() * 2 ** 31)

  /* Les LoRAs arrivent par nom de fichier ; le serveur seul décide du chemin.
     Un nom inconnu est ignoré plutôt que de faire échouer toute la génération. */
  const loras = []
  for (const l of Array.isArray(body.loras) ? body.loras.slice(0, 6) : []) {
    const full = loraPath(l?.file)
    if (!full) continue

    // Contrôle avant de lancer quoi que ce soit.
    const described = await describeLora(l.file).catch(() => null)
    if (described && entry.loraWidth && described.width && described.width !== entry.loraWidth) {
      return json(res, 400, {
        error:
          `« ${described.name} » vise un modèle de largeur ${described.width}, ` +
          `alors que ${entry.name} ${entry.variant} fait ${entry.loraWidth}. ` +
          `Cet adaptateur est prévu pour une autre taille du même modèle.`,
      })
    }
    if (described?.target && entry.loraTarget && described.target !== entry.loraTarget) {
      return json(res, 400, {
        error:
          `« ${described.name} » est un adaptateur ${described.target}, ` +
          `et ${entry.name} est un modèle ${entry.loraTarget}. Aucune couche ne correspondrait.`,
      })
    }

    const scale = Number(l.scale)
    loras.push({
      path: full,
      scale: Number.isFinite(scale) ? Math.max(0, Math.min(2, scale)) : 1,
      /* Sur un modèle à double expert, chaque adaptateur ne vaut que pour l'un
         des deux transformeurs. Le fichier le dit, on le transmet. */
      expert: entry.dual ? described?.expert : undefined,
    })
  }

  const job = {
    repo: entry.repo,
    subfolder: entry.subfolder,
    base: entry.base,
    family: entry.family,
    runner: entry.runner,
    quantize: entry.quantize,
    variant: entry.weightsVariant,
    prompt,
    steps,
    seed,
    loras,
    // Fusionner l'adaptateur dans un modèle 4 bits oblige mflux à requantifier en 8 bits les couches touchées, et la mémoire grimpe d'autant.
    bakeLora: body.bakeLora === true,
    width: round16(body.width, 1024),
    height: round16(body.height, 1024),
    guidance: entry.guidance ? Number(body.guidance) || entry.guidance.default : 0,
    output,
  }

  const send = ndjson(res)
  send({
    type: 'start', id, seed, steps,
    width: job.width, height: job.height,
    // Le guidage effectif, pas celui demandé : un modèle distillé l'ignore.
    guidance: entry.guidance ? job.guidance : null,
    loras: loras.length,
    model: entry.id,
  })

  const run = runWorker('generate', job, (ev) => send(ev.type === 'done' ? { ...ev, id, seed } : ev))
  generating = { id, run }
  res.on('close', () => { if (!res.writableEnded) run.kill() })

  const outcome = await run.done
  generating = null
  if (outcome.code !== 0 && !res.writableEnded) {
    send({ type: 'error', message: explainFailure(outcome, entry) })
  }
  res.end()
}

async function cancel(req, res) {
  const { id, model } = await readBody(req)
  if (model && pulls.has(model)) {
    pulls.get(model).kill()
    return json(res, 200, { cancelled: 'pull' })
  }
  if (generating && (!id || generating.id === id)) {
    generating.run.kill()
    return json(res, 200, { cancelled: 'generate' })
  }
  return json(res, 200, { cancelled: null })
}

function hfRoot() {
  return process.env.HF_HOME ? resolve(process.env.HF_HOME) : join(homedir(), '.cache', 'huggingface')
}

async function remove(req, res) {
  const { model, xet } = await readBody(req)

  // Purge seule du cache de morceaux : il se reconstitue au besoin.
  if (xet && !model) {
    await rm(join(hfRoot(), 'xet'), { recursive: true, force: true })
    return json(res, 200, { removed: 'xet' })
  }

  const entry = byId(model)
  if (!entry) return json(res, 400, { error: 'Modèle inconnu.' })
  if (pulls.has(model)) return json(res, 409, { error: 'Téléchargement en cours.' })

  const cache = join(hfRoot(), 'hub')
  const dir = join(cache, 'models--' + entry.repo.replace(/\//g, '--'))
  // Garde-fou : on ne supprime que sous le cache, jamais ailleurs.
  if (!dir.startsWith(resolve(cache) + sep)) return json(res, 400, { error: 'Chemin refusé.' })
  await rm(dir, { recursive: true, force: true })
  return json(res, 200, { removed: entry.repo })
}

async function serve(url, res) {
  const file = stagedPath(url.searchParams.get('id') ?? '')
  if (!file || !existsSync(file)) return json(res, 404, { error: 'Image introuvable.' })
  const { size } = await stat(file)
  res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': size, 'Cache-Control': 'no-store' })
  createReadStream(file).pipe(res)
}

async function discard(url, res) {
  const file = stagedPath(url.searchParams.get('id') ?? '')
  if (file) await rm(file, { force: true })
  return json(res, 200, { ok: true })
}
