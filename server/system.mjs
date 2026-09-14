/** État mémoire de la machine, sur les trois systèmes. */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { freemem, platform, totalmem } from 'node:os'
import { promisify } from 'node:util'

const run = promisify(execFile)
const VIDE = { available: 0, compressed: 0, wired: 0, swap: { total: 0, used: 0 } }

async function darwin() {
  const { stdout } = await run('vm_stat', [], { timeout: 4000 })
  const pageSize = Number(/page size of (\d+)/.exec(stdout)?.[1] ?? 16384)
  const pages = (label) => {
    const m = new RegExp(`${label}:\\s+(\\d+)`).exec(stdout)
    return m ? Number(m[1]) * pageSize : 0
  }

  let swap = { total: 0, used: 0 }
  try {
    const { stdout: s } = await run('sysctl', ['-n', 'vm.swapusage'], { timeout: 4000 })
    const num = (label) => Number(new RegExp(`${label} = ([\\d.]+)M`).exec(s)?.[1] ?? 0) * 1_048_576
    swap = { total: num('total'), used: num('used') }
  } catch { /* machine sans fichier d'échange */ }

  // Récupérable sans peine : ce qui est libre plus ce qui est inactif.
  return {
    available: pages('Pages free') + pages('Pages inactive'),
    compressed: pages('Pages occupied by compressor'),
    wired: pages('Pages wired down'),
    swap,
  }
}

async function linux() {
  const text = await readFile('/proc/meminfo', 'utf8')
  const kb = (label) => Number(new RegExp(`^${label}:\\s+(\\d+) kB`, 'm').exec(text)?.[1] ?? 0) * 1024
  const total = kb('SwapTotal')
  return { ...VIDE, available: kb('MemAvailable') || freemem(), swap: { total, used: total - kb('SwapFree') } }
}

/** Windows n'expose pas de compteur bon marché : interroger WMI à chaque
    sondage coûterait plus cher que l'information ne vaut. */
function windows() {
  return { ...VIDE, available: freemem() }
}

export async function memory() {
  let m
  try {
    if (platform() === 'darwin') m = await darwin()
    else if (platform() === 'linux') m = await linux()
    else m = windows()
  } catch {
    m = { ...VIDE, available: freemem() }
  }
  return {
    total: totalmem(),
    ...m,
    /** Le système repousse déjà des pages sur le disque. */
    swapping: m.swap.total > 0 && m.swap.used / m.swap.total > 0.5,
  }
}

export async function handle(req, res) {
  const body = await memory()
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
  res.end(JSON.stringify(body))
}
