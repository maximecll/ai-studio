import { create } from 'zustand'
import { createVault, cryptoAvailable, openVault, rekeyVault, VaultError, type Vault } from '../lib/crypto'
import { db } from '../lib/db'
import { setMaster } from '../lib/sealed'
import { toast } from './ui'

/** Fermeture automatique après cette durée sans activité. */
const IDLE_MS = 15 * 60_000

interface VaultState {
  /** Un coffre a déjà été créé sur cette machine. */
  exists: boolean | null
  /** La clé maîtresse est en mémoire : les conversations verrouillées sont lisibles. */
  unlocked: boolean
  busy: boolean
  error: string | null

  load: () => Promise<void>
  create: (passphrase: string) => Promise<boolean>
  unlock: (passphrase: string) => Promise<boolean>
  lock: () => void
  changePassphrase: (current: string, next: string) => Promise<boolean>
  touch: () => void
}

let idleTimer: ReturnType<typeof setTimeout> | null = null

export const useVault = create<VaultState>((set, get) => {
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      if (get().unlocked) {
        get().lock()
        toast({ title: 'Coffre refermé', description: "Aucune activité depuis quinze minutes." })
      }
    }, IDLE_MS)
  }

  return {
    exists: null,
    unlocked: false,
    busy: false,
    error: null,

    async load() {
      set({ exists: !!(await db.vault.get('vault')) })
    },

    async create(passphrase) {
      if (!cryptoAvailable) {
        set({ error: "Le chiffrement exige une connexion sécurisée (https ou localhost)." })
        return false
      }
      set({ busy: true, error: null })
      try {
        const { vault, master } = await createVault(passphrase)
        await db.vault.put(vault)
        setMaster(master)
        set({ exists: true, unlocked: true, busy: false })
        armIdle()
        return true
      } catch (e) {
        set({ busy: false, error: e instanceof VaultError ? e.message : (e as Error).message })
        return false
      }
    },

    async unlock(passphrase) {
      const vault = await db.vault.get('vault')
      if (!vault) {
        set({ error: 'Aucun coffre sur cette machine.' })
        return false
      }
      set({ busy: true, error: null })
      try {
        setMaster(await openVault(vault as Vault, passphrase))
        set({ unlocked: true, busy: false })
        armIdle()
        return true
      } catch (e) {
        set({ busy: false, error: e instanceof VaultError ? e.message : (e as Error).message })
        return false
      }
    },

    lock() {
      setMaster(null)
      if (idleTimer) clearTimeout(idleTimer)
      set({ unlocked: false })
    },

    async changePassphrase(current, next) {
      const vault = await db.vault.get('vault')
      if (!vault) return false
      set({ busy: true, error: null })
      try {
        await db.vault.put(await rekeyVault(vault as Vault, current, next))
        set({ busy: false })
        toast({ title: 'Phrase de passe modifiée', tone: 'success' })
        return true
      } catch (e) {
        set({ busy: false, error: e instanceof VaultError ? e.message : (e as Error).message })
        return false
      }
    },

    /** Repousse la fermeture automatique, appelé à chaque interaction utile. */
    touch() {
      if (get().unlocked) armIdle()
    },
  }
})
