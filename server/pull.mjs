/** Téléchargement d'un modèle Ollama, conduit par le serveur.
 *
 * Conduit ici plutôt que dans le navigateur : un rafraîchissement de page ne
 * doit pas interrompre plusieurs gigaoctets de transfert.
 */
import { request } from 'node:http'

const OLLAMA = new URL(process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434')

const PHASES = [
  [/^pulling manifest/i, { phase: 'connecting', label: 'Lecture du manifeste' }],
  [/^pulling/i, { phase: 'downloading', label: 'Téléchargement' }],
  [/^verifying/i, { phase: 'verifying', label: 'Vérification' }],
  [/^writing/i, { phase: 'writing', label: 'Écriture' }],
  [/^success/i, { phase: 'done', label: 'Terminé' }],
]

function describe(status) {
  for (const [motif, sortie] of PHASES) if (motif.test(status)) return sortie
  return { phase: 'downloading', label: status || 'Téléchargement' }
}

/** Ollama annonce les couches une par une : on somme pour une progression
    globale, plutôt qu'un pourcentage qui repart à zéro à chaque couche. */
export function pullModel(model) {
  return (send, signal) => new Promise((resolve, reject) => {
    const couches = new Map()
    let vitesse = 0
    let dernierAt = Date.now()
    let dernierOctets = 0
    let erreur = null

    const req = request(
      {
        hostname: OLLAMA.hostname,
        port: OLLAMA.port || 11434,
        path: '/api/pull',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let tampon = ''
        res.setEncoding('utf8')
        res.on('data', (morceau) => {
          tampon += morceau
          const lignes = tampon.split('\n')
          tampon = lignes.pop() ?? ''
          for (const ligne of lignes) {
            if (!ligne.trim()) continue
            let ev
            try { ev = JSON.parse(ligne) } catch { continue }
            if (ev.error) { erreur = new Error(ev.error); req.destroy(); return }

            if (ev.digest && ev.total) {
              couches.set(ev.digest, { total: ev.total, completed: ev.completed ?? 0 })
            }
            let total = 0
            let completed = 0
            for (const c of couches.values()) { total += c.total; completed += c.completed }

            const maintenant = Date.now()
            const dt = (maintenant - dernierAt) / 1000
            if (dt > 0.4) {
              const instant = Math.max(0, completed - dernierOctets) / dt
              // Lissage exponentiel : une estimation stable vaut mieux qu'exacte.
              vitesse = vitesse ? vitesse * 0.7 + instant * 0.3 : instant
              dernierAt = maintenant
              dernierOctets = completed
            }

            const { phase, label } = describe(ev.status ?? '')
            send({
              type: 'progress',
              phase, label, total, completed,
              speed: vitesse,
              eta: vitesse > 0 && total > completed ? (total - completed) / vitesse : null,
            })
          }
        })
        res.on('end', () => {
          if (erreur) return reject(erreur)
          send({ type: 'done', model })
          resolve()
        })
      },
    )

    req.on('error', (e) => reject(erreur ?? new Error(`Ollama injoignable : ${e.message}`)))
    signal.addEventListener('abort', () => { erreur = null; req.destroy(); resolve() }, { once: true })
    req.end(JSON.stringify({ model, stream: true }))
  })
}
