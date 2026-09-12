/**
 * État mémoire de la machine.
 *
 * `os.freemem()` est trompeur sur macOS : il ignore les pages inactives et
 * compressées, qui sont pourtant récupérables. On lit donc `vm_stat` et
 * `sysctl`, comme le ferait le moniteur d'activité.
 */
import { execFile } from 'node:child_process'
import { totalmem } from 'node:os'
import { promisify } from 'node:util'

const run = promisify(execFile)

async function vmStat() {
  const { stdout } = await run('vm_stat', [], { timeout: 4000 })
  const pageSize = Number(/page size of (\d+)/.exec(stdout)?.[1] ?? 16384)
  const field = (label) => {
    const m = new RegExp(`${label}:\\s+(\\d+)`).exec(stdout)
    return m ? Number(m[1]) * pageSize : 0
  }
  return {
    free: field('Pages free'),
    inactive: field('Pages inactive'),
    compressed: field('Pages occupied by compressor'),
    wired: field('Pages wired down'),
  }
}

async function swap() {
  try {
    const { stdout } = await run('sysctl', ['-n', 'vm.swapusage'], { timeout: 4000 })
    const num = (label) => Number(new RegExp(`${label} = ([\\d.]+)M`).exec(stdout)?.[1] ?? 0) * 1_048_576
    return { total: num('total'), used: num('used') }
  } catch {
    return { total: 0, used: 0 }
  }
}

export async function memory() {
  const [vm, sw] = await Promise.all([vmStat(), swap()])
  const total = totalmem()
  // Récupérable sans peine : ce qui est libre plus ce qui est inactif.
  const available = vm.free + vm.inactive
  return {
    total,
    available,
    compressed: vm.compressed,
    wired: vm.wired,
    swap: sw,
    /** Le système repousse déjà des pages sur le disque. */
    swapping: sw.total > 0 && sw.used / sw.total > 0.5,
  }
}

export async function handle(req, res) {
  try {
    const body = await memory()
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
    res.end(JSON.stringify(body))
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: e.message }))
  }
}
