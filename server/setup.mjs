/** Installation d'Ollama et détection du matériel. */
import { spawn } from 'node:child_process'
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

/* ── Matériel ─────────────────────────────────────────────────────── */

/** Puce graphique et mémoire qui lui est réellement accessible. */
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
      const { stdout } = await run('powershell', ['-NoProfile', '-Command',
        'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress'],
        { timeout: 20000 })
      const list = [].concat(JSON.parse(stdout))
      const best = list.sort((x, y) => (y.AdapterRAM ?? 0) - (x.AdapterRAM ?? 0))[0] ?? {}
      return { name: best.Name ?? 'GPU inconnu', unified: false, vram: best.AdapterRAM ?? 0, source: 'Win32_VideoController' }
    }
    // Linux : nvidia-smi donne la VRAM exacte, sinon on se contente du nom.
    try {
      const { stdout } = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { timeout: 15000 })
      const [name, mib] = stdout.trim().split('\n')[0].split(',').map((s) => s.trim())
      return { name, unified: false, vram: Number(mib) * 1048576, source: 'nvidia-smi' }
    } catch {
      const { stdout } = await run('sh', ['-c', "lspci | grep -i 'vga\\|3d' | head -1"], { timeout: 15000 })
      return { name: stdout.split(':').pop()?.trim() || 'GPU inconnu', unified: false, vram: 0, source: 'lspci' }
    }
  } catch {
    return null
  }
}

/* ── Téléchargement ───────────────────────────────────────────────── */

function download(url, dest, onProgress) {
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
    const req = getHttp('http://127.0.0.1:11434/api/version', { timeout: 2000 }, (res) => {
      res.resume()
      ok(res.statusCode === 200)
    })
    req.on('error', () => ok(false))
    req.on('timeout', () => { req.destroy(); ok(false) })
  }).catch(() => false)
}

function startOllama(bin) {
  if (started && started.exitCode === null) return started
  started = spawn(bin, ['serve'], { stdio: 'ignore', detached: true })
  started.unref()
  return started
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
      return json(res, 200, {
        platform: platform(),
        arch: arch(),
        supported: !!a,
        asset: a?.name ?? null,
        ollamaRunning: await reachable(),
        ollamaLocal: !!localBinary(),
        totalRam: totalmem(),
        gpu: await gpu(),
      })
    }

    if (path === '/ollama' && req.method === 'POST') return await install(res)
    return json(res, 404, { error: 'Route inconnue.' })
  } catch (e) {
    if (!res.headersSent) return json(res, 500, { error: e.message })
    res.end()
  }
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
      for (let i = 0; i < 60; i++) {
        if (await reachable()) break
        await new Promise((r) => setTimeout(r, 500))
      }
    }

    const up = await reachable()
    send(up ? { type: 'done', bin } : { type: 'error', message: "Ollama est installé mais ne répond pas." })
  } catch (e) {
    send({ type: 'error', message: e.message })
  }
  res.end()
}
