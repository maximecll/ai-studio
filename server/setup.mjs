/** Installation d'Ollama et détection du matériel. */
import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { chmod, mkdir, rm, stat } from 'node:fs/promises'
import { arch, homedir, platform, totalmem } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { get } from 'node:https'
import { get as getHttp } from 'node:http'

const run = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME = join(ROOT, '.runtime')
const OLLAMA_DIR = join(RUNTIME, 'ollama')
const VERSION = 'v0.34.0'

/* Git portable — Windows uniquement : c'est le seul des trois systèmes à ne
   pas livrer git, et le seul à publier une archive utilisable sans droit
   administrateur. */
const GIT_DIR = join(RUNTIME, 'git')
const GIT_TAG = 'v2.55.0.windows.5'
const GIT_BUILD = '2.55.0.5'
const PROBE = new URL(process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434')

/** Archives portables : ni installateur, ni élévation, ni PATH modifié. */
function asset() {
  const a = arch() === 'arm64' ? 'arm64' : 'amd64'
  switch (platform()) {
    case 'darwin': return { name: 'ollama-darwin.tgz', kind: 'tgz', bin: 'ollama' }
    case 'win32': return { name: `ollama-windows-${a}.zip`, kind: 'zip', bin: 'ollama.exe' }
    case 'linux': return { name: `ollama-linux-${a}.tar.zst`, kind: 'zst', bin: 'bin/ollama' }
    default: return null
  }
}

function localBinary() {
  const a = asset()
  if (!a) return null
  const p = join(OLLAMA_DIR, a.bin)
  return existsSync(p) ? p : null
}

/** Emplacements où les installateurs officiels déposent Ollama. Sous Windows
    le PATH n'est pas rafraîchi pour les processus déjà lancés : sans cette
    liste, une installation existante passe pour absente. */
function systemPaths() {
  const home = homedir()
  switch (platform()) {
    case 'win32': {
      const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
      const programs = process.env.ProgramFiles ?? 'C:\\Program Files'
      return [
        join(local, 'Programs', 'Ollama', 'ollama.exe'),
        join(local, 'Ollama', 'ollama.exe'),
        join(programs, 'Ollama', 'ollama.exe'),
      ]
    }
    case 'darwin':
      return [
        '/Applications/Ollama.app/Contents/Resources/ollama',
        '/usr/local/bin/ollama',
        '/opt/homebrew/bin/ollama',
        join(home, '.ollama', 'bin', 'ollama'),
      ]
    default:
      return ['/usr/local/bin/ollama', '/usr/bin/ollama', '/bin/ollama', join(home, '.local', 'bin', 'ollama')]
  }
}

async function pathBinary() {
  try {
    const { stdout } = await run(platform() === 'win32' ? 'where' : 'which', ['ollama'], { timeout: 5000 })
    const premier = stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean)
    return premier && existsSync(premier) ? premier : null
  } catch {
    return null
  }
}

/** Binaire utilisable, avec sa provenance — l'interface en a besoin pour
    proposer un démarrage plutôt qu'un téléchargement de 1,5 Go. */
async function findOllama() {
  const portable = localBinary()
  if (portable) return { bin: portable, source: 'runtime' }

  const surPath = await pathBinary()
  if (surPath) return { bin: surPath, source: 'path' }

  const connu = systemPaths().find((p) => existsSync(p))
  return connu ? { bin: connu, source: 'system' } : null
}

/* ── Git ──────────────────────────────────────────────────────────── */

function portableGit() {
  const p = platform() === 'win32' ? join(GIT_DIR, 'cmd', 'git.exe') : join(GIT_DIR, 'bin', 'git')
  return existsSync(p) ? p : null
}

/** Le git à employer : celui de .runtime s'il existe, celui du système sinon. */
export function gitBin() {
  return portableGit() ?? 'git'
}

async function gitState() {
  const portable = portableGit()
  try {
    const { stdout } = await run(portable ?? 'git', ['--version'], { timeout: 8000 })
    return { ok: true, version: stdout.trim().replace(/^git version /, ''), source: portable ? 'runtime' : 'system' }
  } catch {
    return { ok: false, version: null, source: null }
  }
}

/** Gestionnaire de paquets de la distribution, et la commande qui va avec. */
async function linuxInstaller() {
  const candidats = [
    ['apt-get', ['install', '-y', 'git']],
    ['dnf', ['install', '-y', 'git']],
    ['pacman', ['-S', '--noconfirm', 'git']],
    ['zypper', ['install', '-y', 'git']],
    ['apk', ['add', 'git']],
  ]
  for (const [cmd, args] of candidats) {
    try {
      await run('which', [cmd], { timeout: 5000 })
      return { cmd, args }
    } catch { /* suivant */ }
  }
  return null
}

/* ── Matériel ─────────────────────────────────────────────────────── */

/** Puce graphique et mémoire qui lui est réellement accessible. */
/** nvidia-smi donne la valeur exacte, sur Windows comme sur Linux. */
async function nvidia() {
  const { stdout } = await run(
    'nvidia-smi',
    ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
    { timeout: 15000 },
  )
  const [name, mib] = stdout.trim().split('\n')[0].split(',').map((t) => t.trim())
  const vram = Number(mib) * 1048576
  if (!name || !vram) throw new Error('nvidia-smi muet')
  return { name, unified: false, vram, source: 'nvidia-smi' }
}

/**
 * VRAM sous Windows, lue dans le registre.
 *
 * `Win32_VideoController.AdapterRAM` est un entier 32 bits : au-delà de 4 Gio
 * il sature, et une carte de 8 Go se déclare à 4. Le pilote publie la vraie
 * taille dans `HardwareInformation.qwMemorySize`, sur 64 bits.
 */
async function windowsRegistry() {
  const script = [
    "$c='HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}';",
    'Get-ChildItem $c -ErrorAction SilentlyContinue | ForEach-Object {',
    '  $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue;',
    "  $m = $p.'HardwareInformation.qwMemorySize';",
    "  if (-not $m) { $m = $p.'HardwareInformation.MemorySize' };",
    '  if ($m -is [byte[]]) { $b = New-Object byte[] 8; [Array]::Copy($m, $b, [Math]::Min(8, $m.Length)); $m = [BitConverter]::ToUInt64($b, 0) };',
    '  if ($m) { [PSCustomObject]@{ Name = $p.DriverDesc; Vram = [uint64]$m } }',
    '} | Sort-Object Vram -Descending | Select-Object -First 1 | ConvertTo-Json -Compress',
  ].join(' ')

  const { stdout } = await run('powershell', ['-NoProfile', '-Command', script], { timeout: 25000 })
  const carte = JSON.parse(stdout.trim() || 'null')
  if (!carte?.Vram) throw new Error('Registre muet')
  return { name: carte.Name ?? 'GPU inconnu', unified: false, vram: Number(carte.Vram), source: 'registre' }
}

/** Cartes AMD et Intel sous Linux : le noyau publie la taille dans sysfs. */
async function linuxSysfs() {
  const { stdout } = await run(
    'sh',
    ['-c', 'cat /sys/class/drm/card*/device/mem_info_vram_total 2>/dev/null | sort -n | tail -1'],
    { timeout: 10000 },
  )
  const octets = Number(stdout.trim())
  if (!octets) throw new Error('sysfs muet')
  const { stdout: nom } = await run('sh', ['-c', "lspci | grep -i 'vga\\|3d' | head -1"], { timeout: 15000 })
    .catch(() => ({ stdout: '' }))
  return { name: nom.split(':').pop()?.trim() || 'GPU inconnu', unified: false, vram: octets, source: 'sysfs' }
}

async function gpu() {
  try {
    if (platform() === 'darwin') {
      const { stdout } = await run('system_profiler', ['SPDisplaysDataType', '-json'], { timeout: 15000 })
      const d = JSON.parse(stdout).SPDisplaysDataType?.[0] ?? {}
      const name = d.sppci_model ?? 'GPU Apple'
      const cores = Number(d.sppci_cores) || undefined
      // Mémoire unifiée : le GPU puise dans la même réserve que le système.
      return { name, cores, unified: true, vram: Math.round(totalmem() * 0.75), source: 'system_profiler' }
    }
    if (platform() === 'win32') {
      for (const sonde of [nvidia, windowsRegistry]) {
        try { return await sonde() } catch { /* source suivante */ }
      }
      // Dernier recours : AdapterRAM, en écartant sa valeur saturée.
      const { stdout } = await run('powershell', ['-NoProfile', '-Command',
        'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress'],
        { timeout: 20000 })
      const list = [].concat(JSON.parse(stdout))
      const best = list.sort((x, y) => (y.AdapterRAM ?? 0) - (x.AdapterRAM ?? 0))[0] ?? {}
      const sature = best.AdapterRAM >= 4294967295
      return {
        name: best.Name ?? 'GPU inconnu',
        unified: false,
        vram: sature ? 0 : (best.AdapterRAM ?? 0),
        source: 'Win32_VideoController',
      }
    }

    for (const sonde of [nvidia, linuxSysfs]) {
      try { return await sonde() } catch { /* source suivante */ }
    }
    const { stdout } = await run('sh', ['-c', "lspci | grep -i 'vga\\|3d' | head -1"], { timeout: 15000 })
    return { name: stdout.split(':').pop()?.trim() || 'GPU inconnu', unified: false, vram: 0, source: 'lspci' }
  } catch {
    return null
  }
}

/* ── Téléchargement ───────────────────────────────────────────────── */

export function download(url, dest, onProgress) {
  return new Promise((ok, ko) => {
    const req = get(url, { headers: { 'user-agent': 'ai-studio' } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        res.resume()
        return download(res.headers.location, dest, onProgress).then(ok, ko)
      }
      if (res.statusCode !== 200) {
        res.resume()
        return ko(new Error(`HTTP ${res.statusCode}`))
      }
      const total = Number(res.headers['content-length']) || 0
      let seen = 0
      let last = 0
      res.on('data', (c) => {
        seen += c.length
        const now = Date.now()
        if (now - last > 400) { last = now; onProgress(seen, total) }
      })
      res.pipe(createWriteStream(dest)).on('finish', () => ok(total || seen)).on('error', ko)
    })
    req.on('error', ko)
  })
}

async function extract(archive, kind, dest) {
  await mkdir(dest, { recursive: true })
  if (kind === 'zst') {
    // tar de macOS ignore zstd ; sous Linux le binaire zstd est la voie sûre.
    await run('sh', ['-c', `zstd -dc ${JSON.stringify(archive)} | tar -x -C ${JSON.stringify(dest)}`], { timeout: 600000 })
  } else {
    await run('tar', ['-xf', archive, '-C', dest], { timeout: 600000 })
  }
}

/* ── Serveur Ollama ───────────────────────────────────────────────── */

let started = null

function reachable() {
  return new Promise((ok) => {
    const req = getHttp(new URL('/api/version', PROBE), { timeout: 2000 }, (res) => {
      res.resume()
      ok(res.statusCode === 200)
    })
    req.on('error', () => ok(false))
    req.on('timeout', () => { req.destroy(); ok(false) })
  }).catch(() => false)
}

function startOllama(bin) {
  if (started && started.exitCode === null) return started
  // Sous Windows, laisser Ollama rattache a notre console : sa fermeture
  // emporte alors le moteur et ses runners, qui verrouillent .runtime.
  const detached = platform() !== 'win32'
  started = spawn(bin, ['serve'], { stdio: 'ignore', detached, windowsHide: true })
  if (detached) started.unref()
  return started
}

async function waitUp(tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await reachable()) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

/** Au démarrage du serveur : Ollama installé mais éteint, on l'allume. */
export async function ensureOllama() {
  if (await reachable()) return 'deja-lance'
  const trouve = await findOllama()
  if (!trouve) return 'absent'
  startOllama(trouve.bin)
  return (await waitUp()) ? 'lance' : 'muet'
}

/** N'arrête que le processus qu'on a nous-mêmes lancé. */
export function stopOllama() {
  if (!started || started.exitCode !== null) return
  try {
    // Ollama se relance lui-meme comme « runner » : tuer le seul parent
    // laisserait un processus fils sur les fichiers du modele.
    if (platform() === 'win32') spawnSync('taskkill', ['/f', '/t', '/pid', String(started.pid)], { windowsHide: true })
    else process.kill(-started.pid)
  } catch { /* déjà parti */ }
  started = null
}

/* ── Routes ───────────────────────────────────────────────────────── */

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
  res.end(JSON.stringify(body))
}

export async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost')
  const path = url.pathname.replace(/^\/setup/, '') || '/'

  try {
    if (path === '/status' && req.method === 'GET') {
      const a = asset()
      const trouve = await findOllama()
      const git = await gitState()
      return json(res, 200, {
        git: git.ok,
        gitVersion: git.version,
        gitSource: git.source,
        /* Seul Windows s'installe sans intervention : ailleurs l'installateur
           du système demande une élévation qu'on ne peut pas contourner. */
        gitAuto: platform() === 'win32' ? 'auto' : platform() === 'darwin' ? 'apple' : 'paquets',
        platform: platform(),
        arch: arch(),
        supported: !!a,
        asset: a?.name ?? null,
        ollamaRunning: await reachable(),
        ollamaInstalled: !!trouve,
        ollamaSource: trouve?.source ?? null,
        totalRam: totalmem(),
        gpu: await gpu(),
      })
    }

    if (path === '/ollama' && req.method === 'POST') return await install(res)
    if (path === '/git' && req.method === 'POST') return await installGit(res)
    return json(res, 404, { error: 'Route inconnue.' })
  } catch (e) {
    if (!res.headersSent) return json(res, 500, { error: e.message })
    res.end()
  }
}

/* ── Installation de git ──────────────────────────────────────────── */

/** Windows n'a pas git, mais Git for Windows publie une archive auto-extractible
    qui ne demande aucun droit particulier. */
async function installGitWindows(send) {
  await mkdir(RUNTIME, { recursive: true })
  const nom = `PortableGit-${GIT_BUILD}-${arch() === 'arm64' ? 'arm64' : '64-bit'}.7z.exe`
  const archive = join(RUNTIME, nom)

  send({ type: 'phase', phase: 'downloading', label: 'Téléchargement de git', asset: nom })
  const t0 = Date.now()
  await download(
    `https://github.com/git-for-windows/git/releases/download/${GIT_TAG}/${nom}`,
    archive,
    (completed, total) => {
      const speed = completed / Math.max(0.001, (Date.now() - t0) / 1000)
      send({ type: 'progress', completed, total, speed, eta: speed > 1 && total ? (total - completed) / speed : null })
    },
  )

  send({ type: 'phase', phase: 'extracting', label: 'Installation' })
  await rm(GIT_DIR, { recursive: true, force: true })
  // Archive 7-Zip auto-extractible : `-o` sans espace, `-y` pour ne rien demander.
  await run(archive, [`-o${GIT_DIR}`, '-y'], { timeout: 600000, windowsHide: true })
  await rm(archive, { force: true })

  if (!portableGit()) throw new Error("L'archive ne contient pas le binaire attendu.")
}

/** macOS livre git avec les outils en ligne de commande d'Apple. Leur
    installateur est graphique et demande une élévation : on ne peut que
    l'ouvrir, puis attendre. */
async function installGitDarwin(send) {
  send({ type: 'phase', phase: 'prompting', label: 'Ouverture de l’installateur Apple' })
  try {
    await run('xcode-select', ['--install'], { timeout: 15000 })
  } catch { /* déjà en cours, ou déjà installé */ }
  send({
    type: 'phase',
    phase: 'waiting',
    label: 'Acceptez la fenêtre « Installer » d’Apple, puis patientez',
  })
  for (let i = 0; i < 120; i++) {
    if ((await gitState()).ok) return
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new Error("L'installation n'a pas abouti. Relancez-la depuis la fenêtre d'Apple, puis réessayez.")
}

/** Linux passe par le gestionnaire de paquets : mot de passe obligatoire. */
async function installGitLinux(send) {
  const gestionnaire = await linuxInstaller()
  if (!gestionnaire) throw new Error("Aucun gestionnaire de paquets reconnu. Installez git par vos moyens habituels.")
  const commande = `sudo ${gestionnaire.cmd} ${gestionnaire.args.join(' ')}`

  let pkexec = true
  try { await run('which', ['pkexec'], { timeout: 5000 }) } catch { pkexec = false }
  if (!pkexec) throw new Error(`Ouvrez un terminal et lancez : ${commande}`)

  send({ type: 'phase', phase: 'prompting', label: 'Saisissez votre mot de passe dans la fenêtre du système' })
  try {
    await run('pkexec', [gestionnaire.cmd, ...gestionnaire.args], { timeout: 600000 })
  } catch (e) {
    throw new Error(`Installation refusée ou interrompue. Ouvrez un terminal et lancez : ${commande} (${e.message})`)
  }
}

async function installGit(res) {
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  })
  const send = (e) => { if (!res.writableEnded) res.write(JSON.stringify(e) + '\n') }

  try {
    if ((await gitState()).ok) {
      send({ type: 'done', already: true })
      return res.end()
    }
    if (platform() === 'win32') await installGitWindows(send)
    else if (platform() === 'darwin') await installGitDarwin(send)
    else await installGitLinux(send)

    const etat = await gitState()
    send(etat.ok ? { type: 'done', version: etat.version } : { type: 'error', message: 'git reste introuvable après installation.' })
  } catch (e) {
    send({ type: 'error', message: e.message })
  }
  res.end()
}

async function install(res) {
  const a = asset()
  if (!a) return json(res, 400, { error: `Système non pris en charge : ${platform()} ${arch()}.` })

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  })
  const send = (e) => { if (!res.writableEnded) res.write(JSON.stringify(e) + '\n') }

  try {
    let bin = localBinary()
    if (!bin) {
      await mkdir(RUNTIME, { recursive: true })
      const archive = join(RUNTIME, a.name)
      send({ type: 'phase', phase: 'downloading', label: 'Téléchargement d’Ollama', asset: a.name })

      const t0 = Date.now()
      await download(
        `https://github.com/ollama/ollama/releases/download/${VERSION}/${a.name}`,
        archive,
        (completed, total) => {
          const speed = completed / Math.max(0.001, (Date.now() - t0) / 1000)
          send({ type: 'progress', completed, total, speed, eta: speed > 1 && total ? (total - completed) / speed : null })
        },
      )

      send({ type: 'phase', phase: 'extracting', label: 'Installation' })
      await rm(OLLAMA_DIR, { recursive: true, force: true })
      await extract(archive, a.kind, OLLAMA_DIR)
      await rm(archive, { force: true })

      bin = localBinary()
      if (!bin) throw new Error("L'archive ne contient pas le binaire attendu.")
      if (platform() !== 'win32') await chmod(bin, 0o755)
      send({ type: 'phase', phase: 'installed', label: 'Installé', bytes: (await stat(bin)).size })
    }

    if (!(await reachable())) {
      send({ type: 'phase', phase: 'starting', label: 'Démarrage d’Ollama' })
      startOllama(bin)
      await waitUp()
    }

    const up = await reachable()
    send(up ? { type: 'done', bin } : { type: 'error', message: "Ollama est installé mais ne répond pas." })
  } catch (e) {
    send({ type: 'error', message: e.message })
  }
  res.end()
}
