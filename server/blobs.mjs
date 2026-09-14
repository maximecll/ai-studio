/** Entretien du magasin de blobs d'Ollama. */
import { readdir, readFile, stat, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = process.env.OLLAMA_MODELS ?? join(homedir(), '.ollama', 'models')
const BLOBS = join(ROOT, 'blobs')
const MANIFESTS = join(ROOT, 'manifests')

const DIGEST = /^sha256-[0-9a-f]{64}$/
const PARTIAL = /^sha256-[0-9a-f]{64}-partial/
/** Un fichier touché récemment appartient sans doute à un transfert en cours. */
const FRESH_MS = 120_000

async function walk(dir) {
  const out = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out
}

/** Digests cités par au moins un manifeste : intouchables. */
async function referencedDigests() {
  const files = await walk(MANIFESTS)
  const digests = new Set()
  for (const f of files) {
    try {
      const text = await readFile(f, 'utf8')
      for (const m of text.matchAll(/sha256:([0-9a-f]{64})/g)) digests.add(`sha256-${m[1]}`)
    } catch {
      /* Un manifeste illisible ne doit pas faire passer ses blobs pour orphelins. */
      throw new Error(`Manifeste illisible : ${f}`)
    }
  }
  return { digests, manifestCount: files.length }
}

/** Inventaire de ce qui peut être supprimé. */
export async function plan() {
  if (!existsSync(BLOBS)) {
    return { safe: false, reason: "Magasin Ollama introuvable.", partials: [], orphans: [], inUse: 0 }
  }

  const { digests, manifestCount } = await referencedDigests()

  // Garde-fou capital : sans manifeste lisible, tout paraîtrait orphelin.
  if (manifestCount === 0) {
    return {
      safe: false,
      reason: "Aucun manifeste lisible : impossible de distinguer les orphelins.",
      partials: [], orphans: [], inUse: 0,
    }
  }

  const names = await readdir(BLOBS)
  const now = Date.now()
  const partials = []
  const orphans = []
  let inUse = 0

  for (const name of names) {
    const full = join(BLOBS, name)
    let info
    try {
      info = await stat(full)
    } catch {
      continue
    }
    if (!info.isFile()) continue

    const fresh = now - info.mtimeMs < FRESH_MS
    const entry = { name, size: info.size, fresh }

    if (PARTIAL.test(name)) partials.push(entry)
    else if (DIGEST.test(name)) {
      if (digests.has(name)) inUse += info.size
      else orphans.push(entry)
    }
    // Tout autre nom est laissé strictement tranquille.
  }

  return {
    safe: true,
    manifestCount,
    partials,
    orphans,
    inUse,
    reclaimable: [...partials, ...orphans].filter((e) => !e.fresh).reduce((n, e) => n + e.size, 0),
    busy: [...partials, ...orphans].some((e) => e.fresh),
  }
}

/** Supprime les déchets. Ne touche jamais un blob référencé ni un fichier récent. */
export async function purge() {
  const report = await plan()
  if (!report.safe) throw new Error(report.reason)

  const removed = []
  let freed = 0

  for (const entry of [...report.partials, ...report.orphans]) {
    if (entry.fresh) continue // transfert probablement en cours
    const full = resolve(BLOBS, entry.name)
    // Ceinture et bretelles : jamais en dehors du dossier des blobs.
    if (!full.startsWith(resolve(BLOBS) + '/')) continue
    try {
      await unlink(full)
      removed.push(entry.name)
      freed += entry.size
    } catch {
      /* Fichier déjà disparu ou verrouillé : on passe. */
    }
  }

  return { removed: removed.length, freed, skipped: report.busy }
}

/** Point d'entrée HTTP commun au serveur de production et au serveur de dev. */
export async function handle(req, res) {
  const send = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
    res.end(JSON.stringify(body))
  }
  try {
    if (req.method === 'GET') return send(200, await plan())
    if (req.method === 'POST') return send(200, await purge())
    return send(405, { error: 'Méthode non autorisée' })
  } catch (e) {
    return send(500, { error: e.message })
  }
}
