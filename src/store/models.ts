import { create } from 'zustand'
import { ollama, readShape, type ModelShape } from '../lib/ollama'
import type { OllamaModel } from '../lib/types'

type Status = 'idle' | 'loading' | 'online' | 'offline'

interface ModelsState {
  models: OllamaModel[]
  /** Forme des modèles, lue à la demande pour estimer la mémoire. */
  shapes: Record<string, ModelShape | null>
  loadShape: (name: string) => Promise<void>
  running: OllamaModel[]
  version: string | null
  status: Status
  error: string | null
  refresh: (silent?: boolean) => Promise<void>
}

export const useModels = create<ModelsState>((set, get) => ({
  models: [],
  shapes: {},
  running: [],
  version: null,
  status: 'idle',
  error: null,

  /** Interroge `/api/show` une seule fois par modèle. */
  async loadShape(name) {
    if (name in get().shapes) return
    set({ shapes: { ...get().shapes, [name]: null } })
    try {
      const shape = readShape(await ollama.show(name))
      set({ shapes: { ...get().shapes, [name]: shape } })
    } catch {
      /* Sans métadonnées, on n'affiche simplement pas d'estimation. */
    }
  },

  async refresh(silent = false) {
    if (!silent && get().status !== 'online') set({ status: 'loading' })
    try {
      const [version, models, running] = await Promise.all([
        ollama.version(), ollama.list(), ollama.running(),
      ])
      models.sort((a, b) => a.name.localeCompare(b.name))
      /* Conserver la référence quand l'inventaire est identique : sinon chaque
         sondage propage un rendu inutile dans toute l'interface. */
      const prev = get()
      const same = (a: OllamaModel[], b: OllamaModel[]) =>
        a.length === b.length && a.every((m, i) => m.name === b[i].name && m.modified_at === b[i].modified_at)
      set({
        version,
        models: same(prev.models, models) ? prev.models : models,
        running: same(prev.running, running) ? prev.running : running,
        status: 'online',
        error: null,
      })
    } catch (e) {
      set({ status: 'offline', error: (e as Error).message })
    }
  },
}))

export function findModel(models: OllamaModel[], name: string): OllamaModel | undefined {
  return models.find((m) => m.name === name || m.model === name)
}
