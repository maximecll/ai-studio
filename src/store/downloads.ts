import { create } from 'zustand'
import { attachTask, cancelTask, listTasks, startTask, type TaskEvent } from '../lib/tasks'
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

interface State {
  items: Record<string, Download>
  start: (model: string) => Promise<void>
  cancel: (model: string) => void
  dismiss: (model: string) => void
  /** Rattache l'interface aux transferts que le serveur mène déjà. */
  resume: () => Promise<void>
}

export const useDownloads = create<State>((set, get) => {
  const put = (model: string, patch: Partial<Download>) => {
    const cur = get().items[model]
    if (!cur) return
    set({ items: { ...get().items, [model]: { ...cur, ...patch } } })
  }

  const neuf = (model: string): Download => ({
    model, phase: 'connecting', label: 'Connexion…',
    total: 0, completed: 0, speed: 0, eta: null, startedAt: Date.now(),
  })

  /** Consomme un flux de tâche, qu'il vienne d'un démarrage ou d'une reprise. */
  const suivre = async (name: string, flux: AsyncGenerator<TaskEvent>) => {
    try {
      for await (const ev of flux) {
        if (ev.type === 'progress') {
          put(name, {
            phase: (ev.phase as Phase) ?? 'downloading',
            label: (ev.label as string) ?? 'Téléchargement',
            total: (ev.total as number) ?? 0,
            completed: (ev.completed as number) ?? 0,
            speed: (ev.speed as number) ?? 0,
            eta: (ev.eta as number | null) ?? null,
          })
        }
        if (ev.type === 'error') {
          put(name, { phase: 'error', label: 'Échec', error: ev.message as string, finishedAt: Date.now() })
          toast({ title: 'Téléchargement impossible', description: ev.message as string, tone: 'danger' })
          return
        }
        if (ev.type === 'done') {
          put(name, { phase: 'done', label: 'Terminé', finishedAt: Date.now(), eta: 0, speed: 0 })
          toast({ title: 'Modèle installé', description: name, tone: 'success' })
          await useModels.getState().refresh()
          // On laisse la ligne visible un instant, puis elle s'efface.
          setTimeout(() => get().dismiss(name), 6000)
          return
        }
      }
      // Flux clos sans verdict : la tâche a été annulée.
      get().dismiss(name)
    } catch (e) {
      put(name, { phase: 'error', label: 'Échec', error: (e as Error).message, finishedAt: Date.now() })
    }
  }

  return {
    items: {},

    async start(model) {
      const name = model.trim()
      if (!name || get().items[name]?.phase === 'downloading') return
      set({ items: { ...get().items, [name]: neuf(name) } })
      await suivre(name, startTask('llm', name))
    },

    /* Le transfert vit côté serveur : reprendre après un rafraîchissement ne
       consiste qu'à se rebrancher sur son flux. */
    async resume() {
      for (const tache of await listTasks()) {
        if (tache.kind !== 'llm' || tache.done) continue
        const name = tache.label
        if (get().items[name]) continue
        set({ items: { ...get().items, [name]: { ...neuf(name), startedAt: tache.startedAt } } })
        void suivre(name, attachTask(tache.id))
      }
    },

    cancel(model) {
      void cancelTask(`llm:${model}`)
      get().dismiss(model)
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
