import { create } from 'zustand'
import { ollama } from '../lib/ollama'
import { useModels } from './models'
import { toast } from './ui'

export type Phase = 'connecting' | 'manifest' | 'downloading' | 'verifying' | 'writing' | 'done' | 'error'

export interface Download {
  model: string
  phase: Phase
  /** Libellé lisible de l'étape en cours. */
  label: string
  /** Octets, cumulés sur toutes les couches vues jusqu'ici. */
  total: number
  completed: number
  /** Débit lissé, en octets par seconde. */
  speed: number
  /** Secondes restantes estimées, ou null tant que le débit est inconnu. */
  eta: number | null
  startedAt: number
  finishedAt?: number
  error?: string
}

const PHASES: Array<[RegExp, Phase, string]> = [
  [/^pulling manifest/i, 'manifest', 'Lecture du manifeste'],
  [/^pulling/i, 'downloading', 'Téléchargement'],
  [/^verifying/i, 'verifying', 'Vérification de l’empreinte'],
  [/^writing/i, 'writing', 'Écriture sur le disque'],
  [/^removing/i, 'writing', 'Nettoyage des couches inutilisées'],
  [/^success/i, 'done', 'Terminé'],
]

function describe(status: string): { phase: Phase; label: string } {
  for (const [re, phase, label] of PHASES) {
    if (re.test(status)) return { phase, label }
  }
  return { phase: 'downloading', label: status }
}

interface State {
  items: Record<string, Download>
  start: (model: string) => Promise<void>
  cancel: (model: string) => void
  dismiss: (model: string) => void
}

const controllers = new Map<string, AbortController>()

export const useDownloads = create<State>((set, get) => {
  const put = (model: string, patch: Partial<Download>) => {
    const cur = get().items[model]
    if (!cur) return
    set({ items: { ...get().items, [model]: { ...cur, ...patch } } })
  }

  return {
    items: {},

    async start(model) {
      const name = model.trim()
      if (!name || get().items[name]?.phase === 'downloading') return

      const controller = new AbortController()
      controllers.set(name, controller)
      set({
        items: {
          ...get().items,
          [name]: {
            model: name, phase: 'connecting', label: 'Connexion…',
            total: 0, completed: 0, speed: 0, eta: null, startedAt: Date.now(),
          },
        },
      })

      /* Ollama annonce les couches une par une : on somme pour obtenir
         une progression globale plutôt qu'un pourcentage qui repart à zéro. */
      const layers = new Map<string, { total: number; completed: number }>()
      let lastAt = Date.now()
      let lastBytes = 0
      let speed = 0

      try {
        for await (const ev of ollama.pull(name, controller.signal)) {
          if (ev.error) throw new Error(ev.error)

          if (ev.digest && ev.total) {
            layers.set(ev.digest, { total: ev.total, completed: ev.completed ?? 0 })
          }
          let total = 0
          let completed = 0
          for (const l of layers.values()) {
            total += l.total
            completed += l.completed
          }

          const now = Date.now()
          const dt = (now - lastAt) / 1000
          if (dt > 0.4) {
            const instant = Math.max(0, completed - lastBytes) / dt
            // Lissage exponentiel : une estimation stable vaut mieux qu'exacte.
            speed = speed ? speed * 0.7 + instant * 0.3 : instant
            lastAt = now
            lastBytes = completed
          }

          const { phase, label } = describe(ev.status ?? '')
          put(name, {
            phase, label, total, completed, speed,
            eta: speed > 0 && total > completed ? (total - completed) / speed : null,
          })
        }

        put(name, { phase: 'done', label: 'Terminé', finishedAt: Date.now(), eta: 0, speed: 0 })
        toast({ title: 'Modèle installé', description: name, tone: 'success' })
        await useModels.getState().refresh()
        // On laisse la ligne visible un instant, puis elle s'efface.
        setTimeout(() => get().dismiss(name), 6000)
      } catch (e) {
        const err = e as Error
        if (err.name === 'AbortError') {
          get().dismiss(name)
          return
        }
        put(name, { phase: 'error', label: 'Échec', error: err.message, finishedAt: Date.now() })
        toast({ title: 'Téléchargement impossible', description: err.message, tone: 'danger' })
      } finally {
        controllers.delete(name)
      }
    },

    cancel(model) {
      controllers.get(model)?.abort()
    },

    dismiss(model) {
      const items = { ...get().items }
      delete items[model]
      set({ items })
    },
  }
})

/** Téléchargement visant ce modèle, s'il y en a un. */
export function downloadFor(items: Record<string, Download>, model: string): Download | undefined {
  return items[model] ?? items[`${model}:latest`] ?? items[model.replace(/:latest$/, '')]
}
