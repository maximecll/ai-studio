/** Opérations longues, détachées de la connexion qui les a lancées.
 *
 * Un téléchargement ou une installation ne doit pas mourir parce qu'un onglet
 * s'est rafraîchi ou que l'utilisateur est parti lire une conversation. Le
 * travail vit ici ; les clients s'y rattachent et rejouent ce qu'ils ont manqué.
 */

const jobs = new Map()

/** Au-delà, l'historique ne sert plus à rattraper : il encombre. */
const MAX_EVENTS = 400
/** Un job terminé reste consultable le temps qu'un onglet revienne. */
const OUBLI_MS = 120_000

function resume(job) {
  return {
    id: job.id,
    kind: job.kind,
    label: job.label,
    startedAt: job.startedAt,
    done: job.done,
    last: job.last,
  }
}

export function list() {
  return [...jobs.values()].map(resume)
}

export function get(id) {
  return jobs.get(id)
}

export function isRunning(id) {
  const job = jobs.get(id)
  return !!job && !job.done
}

/**
 * Démarre le travail, ou rend celui qui tourne déjà sous le même identifiant.
 * `runner(send, signal)` reçoit de quoi rapporter sa progression et de quoi
 * savoir qu'on lui demande d'arrêter.
 */
export function start(id, kind, label, runner) {
  const encours = jobs.get(id)
  if (encours && !encours.done) return encours

  const controller = new AbortController()
  const job = {
    id, kind, label,
    startedAt: Date.now(),
    events: [],
    subs: new Set(),
    done: false,
    last: null,
    controller,
  }
  jobs.set(id, job)

  const send = (event) => {
    job.events.push(event)
    if (job.events.length > MAX_EVENTS) job.events.splice(0, job.events.length - MAX_EVENTS)
    // Les lignes de journal défilent ; l'état, lui, doit rester lisible d'un coup.
    if (event.type !== 'log') job.last = event
    for (const res of [...job.subs]) {
      try { res.write(JSON.stringify(event) + '\n') } catch { job.subs.delete(res) }
    }
  }

  job.promise = Promise.resolve()
    .then(() => runner(send, controller.signal))
    .catch((e) => send({ type: 'error', message: e?.message ?? String(e) }))
    .finally(() => {
      job.done = true
      for (const res of [...job.subs]) {
        try { res.end() } catch { /* déjà fermé */ }
      }
      job.subs.clear()
      setTimeout(() => { if (jobs.get(id) === job) jobs.delete(id) }, OUBLI_MS).unref?.()
    })

  return job
}

/** Rejoue ce qui s'est passé, puis suit la suite en direct. */
export function attach(job, res) {
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  })
  for (const event of job.events) {
    try { res.write(JSON.stringify(event) + '\n') } catch { return }
  }
  if (job.done) return res.end()
  job.subs.add(res)
  // Fermer l'onglet ne doit rien interrompre : on se contente de se désabonner.
  res.on('close', () => job.subs.delete(res))
}

export function cancel(id) {
  const job = jobs.get(id)
  if (!job || job.done) return false
  job.controller.abort()
  return true
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

/** `starters` associe un genre de tâche à la fonction qui la fabrique. */
export function routes(starters) {
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost')
    const chemin = url.pathname.replace(/^\/tasks/, '') || '/'

    if (chemin === '/' && req.method === 'GET') return json(res, 200, { tasks: list() })

    if (chemin === '/start' && req.method === 'POST') {
      const { kind, arg } = await body(req)
      const fabrique = starters[kind]
      if (!fabrique) return json(res, 400, { error: `Tâche inconnue : ${kind}.` })
      const job = fabrique(arg)
      return attach(job, res)
    }

    const suite = decodeURIComponent(chemin.slice(1))
    if (suite.endsWith('/cancel') && req.method === 'POST') {
      return json(res, 200, { cancelled: cancel(suite.replace(/\/cancel$/, '')) })
    }
    const job = get(suite)
    if (!job) return json(res, 404, { error: 'Tâche terminée ou inconnue.' })
    if (req.method !== 'GET') return json(res, 405, { error: 'Méthode non permise.' })
    return attach(job, res)
  }
}
