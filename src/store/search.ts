import { create } from 'zustand'
import { installSearch, resetSearch, searchStatus, type SearchStatus } from '../lib/websearch'
import { toast } from './ui'

interface SearchState {
  status: SearchStatus | null
  /** Étape courante de l'installation, ou null au repos. */
  installing: string | null
  /** Dernières lignes du journal d'installation, pour rassurer sur l'avancée. */
  log: string[]
  refresh: () => Promise<void>
  install: () => Promise<void>
  reset: () => Promise<void>
}

export const useSearch = create<SearchState>((set, get) => ({
  status: null,
  installing: null,
  log: [],

  async refresh() {
    try {
      set({ status: await searchStatus() })
    } catch {
      set({ status: { installed: false, running: false, partial: false, port: 0 } })
    }
  },

  async install() {
    if (get().installing) return
    set({ installing: 'Préparation', log: [] })
    try {
      for await (const ev of installSearch()) {
        if (ev.type === 'phase') set({ installing: ev.label })
        if (ev.type === 'log') set((s) => ({ log: [...s.log, ev.line].slice(-6) }))
        if (ev.type === 'error') {
          toast({ title: 'Installation de la recherche web impossible', description: ev.message, tone: 'danger' })
          set({ installing: null })
          return
        }
        if (ev.type === 'done') {
          toast({ title: 'Recherche web prête', description: 'SearXNG tourne en local.', tone: 'success' })
          set({ installing: null, log: [] })
          await get().refresh()
          return
        }
      }
      set({ installing: null })
      await get().refresh()
    } catch (e) {
      toast({ title: 'Installation de la recherche web impossible', description: (e as Error).message, tone: 'danger' })
      set({ installing: null })
    }
  },

  async reset() {
    await resetSearch()
    set({ log: [] })
    await get().refresh()
    toast({ title: 'Recherche web retirée', tone: 'success' })
  },
}))
