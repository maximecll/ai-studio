import { create } from 'zustand'
import { updateStatus, watchUpdates, type UpdateStatus } from '../lib/update'

/** Filet de sécurité si le flux d'événements ne s'établit pas. */
const SECOURS = 10 * 60 * 1000

interface UpdateState {
  status: UpdateStatus | null
  chargement: boolean
  /** Version écartée après un échec : la fenêtre se taira jusqu'à la suivante. */
  ecartee: string | null
  refresh: (force?: boolean) => Promise<UpdateStatus | null>
  ecarter: () => void
  connect: () => () => void
}

export const useUpdate = create<UpdateState>((set, get) => ({
  status: null,
  chargement: false,
  ecartee: null,

  async refresh(force = false) {
    // Une vérification demandée à la main réarme la fenêtre, même si une
    // version avait été écartée après un échec.
    set({ chargement: true, ...(force ? { ecartee: null } : null) })
    try {
      const status = await updateStatus(force)
      set({ status, chargement: false })
      return status
    } catch {
      set({ chargement: false })
      return null
    }
  },

  ecarter() {
    set({ ecartee: get().status?.commits?.[0]?.sha ?? 'toutes' })
  },

  /** Le serveur pousse l'état dès qu'une référence distante bouge. */
  connect() {
    const stop = watchUpdates((status) => set({ status }))
    const id = setInterval(() => void get().refresh(), SECOURS)
    return () => { stop(); clearInterval(id) }
  },
}))

/** La fenêtre ne se montre que pour une version qui n'a pas été écartée. */
export function doitInstaller(s: UpdateState): boolean {
  const { status, ecartee } = s
  if (!status?.repo || status.behind <= 0) return false
  return ecartee === null || ecartee !== (status.commits?.[0]?.sha ?? 'toutes')
}
