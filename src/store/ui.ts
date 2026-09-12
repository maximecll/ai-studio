import { create } from 'zustand'
import { uid } from '../lib/utils'

export interface Toast {
  id: string
  title: string
  description?: string
  tone?: 'default' | 'success' | 'danger'
}

const LS = {
  get(key: string, fallback: boolean) {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  },
  set(key: string, v: boolean) {
    localStorage.setItem(key, v ? '1' : '0')
  },
}

interface UIState {
  sidebarOpen: boolean
  inspectorOpen: boolean
  paletteOpen: boolean
  settingsOpen: boolean
  presetsOpen: boolean
  shortcutsOpen: boolean
  memoryOpen: boolean
  vaultOpen: boolean
  toasts: Toast[]

  toggleSidebar: () => void
  toggleInspector: () => void
  setPalette: (b: boolean) => void
  setSettingsOpen: (b: boolean) => void
  setPresetsOpen: (b: boolean) => void
  setShortcutsOpen: (b: boolean) => void
  setMemoryOpen: (b: boolean) => void
  setVaultOpen: (b: boolean) => void
  toast: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: string) => void
}

export const useUI = create<UIState>((set, get) => ({
  sidebarOpen: LS.get('studio.sidebar', true),
  inspectorOpen: LS.get('studio.inspector', false),
  paletteOpen: false,
  settingsOpen: false,
  presetsOpen: false,
  shortcutsOpen: false,
  memoryOpen: false,
  vaultOpen: false,
  toasts: [],

  toggleSidebar: () => {
    const v = !get().sidebarOpen
    LS.set('studio.sidebar', v)
    set({ sidebarOpen: v })
  },
  toggleInspector: () => {
    const v = !get().inspectorOpen
    LS.set('studio.inspector', v)
    set({ inspectorOpen: v })
  },
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setPresetsOpen: (presetsOpen) => set({ presetsOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setMemoryOpen: (memoryOpen) => set({ memoryOpen }),
  setVaultOpen: (vaultOpen) => set({ vaultOpen }),

  toast: (t) => {
    const id = uid()
    set({ toasts: [...get().toasts, { ...t, id }] })
    setTimeout(() => get().dismiss(id), t.tone === 'danger' ? 7000 : 3800)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

export const toast = (t: Omit<Toast, 'id'>) => useUI.getState().toast(t)
