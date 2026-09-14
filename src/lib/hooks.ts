import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { useVault } from '../store/vault'
import { loadURL, peekURL } from '../store/images'
import { DEFAULT_SETTINGS, db, messagesOf } from './db'
import { openConversation } from './sealed'
import type { Conversation, Message, Preset, Settings } from './types'

export function useSettings(): Settings {
  /* Fusionnés sur les valeurs d'origine : une base créée avant l'ajout d'une
     option ne doit pas rendre ce champ indéfini au premier rendu. */
  return useLiveQuery(
    async () => {
      const stored = await db.settings.get('app')
      return stored ? { ...DEFAULT_SETTINGS, ...stored } : DEFAULT_SETTINGS
    },
    [],
    DEFAULT_SETTINGS,
  )
}

/**
 * URL affichable d'une image rangée en base.
 *
 * `null` signifie « pas encore » ou « coffre fermé » — les deux se distinguent
 * par l'état du coffre, dont dépend cette lecture. L'URL est partagée avec la
 * tâche de génération qui vient de produire l'image, pour que le passage de
 * l'animation au message ne redessine rien.
 */
export function useImageURL(blobId: string | undefined): string | null {
  const unlocked = useVault((s) => s.unlocked)
  const [url, setUrl] = useState<string | null>(() => (blobId ? (peekURL(blobId) ?? null) : null))

  useEffect(() => {
    if (!blobId) return setUrl(null)
    let alive = true
    const cached = peekURL(blobId)
    if (cached) return setUrl(cached)
    void loadURL(blobId).then((u) => { if (alive) setUrl(u) })
    return () => { alive = false }
  }, [blobId, unlocked])

  return url
}

/** `undefined` tant que la base n'a pas répondu — à distinguer d'une base vide. */
export function useConversations(): Conversation[] | undefined {
  const unlocked = useVault((s) => s.unlocked)
  return useLiveQuery(
    async () => {
      const raw = await db.conversations.toArray()
      const open = await Promise.all(raw.map(openConversation))
      return open.sort((a, b) => b.updatedAt - a.updatedAt)
    },
    [unlocked],
  )
}

export function useConversation(id: string | null): Conversation | undefined {
  const unlocked = useVault((s) => s.unlocked)
  return useLiveQuery(async () => {
    if (!id) return undefined
    const conv = await db.conversations.get(id)
    return conv ? openConversation(conv) : undefined
  }, [id, unlocked])
}

export function useMessages(id: string | null): Message[] {
  const unlocked = useVault((s) => s.unlocked)
  return useLiveQuery(async () => (id ? messagesOf(id) : []), [id, unlocked], [])
}

export function usePresets(): Preset[] {
  return useLiveQuery(async () => (await db.presets.toArray()).sort((a, b) => a.createdAt - b.createdAt), [], [])
}

/** Raccourci clavier global. `combo` façon « mod+k », « escape », « mod+shift+n ». */
export function useHotkey(combo: string, handler: (e: KeyboardEvent) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const parts = combo.toLowerCase().split('+')
    const key = parts.at(-1)!
    const needMod = parts.includes('mod')
    const needShift = parts.includes('shift')
    const needAlt = parts.includes('alt')

    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (needMod !== mod) return
      if (needShift !== e.shiftKey) return
      if (needAlt !== e.altKey) return
      if (e.key.toLowerCase() !== key) return
      handler(e)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [combo, handler, enabled])
}

/** Vrai quand le focus est dans un champ de saisie. */
export function isTyping(): boolean {
  const el = document.activeElement
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)
}

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const on = () => setMatch(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

export interface SystemMemory {
  total: number
  available: number
  compressed: number
  swap: { total: number; used: number }
  swapping: boolean
}

/**
 * Mémoire de la machine, relevée par le serveur.
 * Le navigateur n'y a pas accès : sans cela, impossible de dire à
 * l'utilisateur qu'un contexte ne tiendra pas.
 */
export function useSystemMemory(intervalMs = 20_000): SystemMemory | null {
  const [memory, setMemory] = useState<SystemMemory | null>(null)

  useEffect(() => {
    let alive = true
    const read = async () => {
      try {
        const res = await fetch('/maintenance/memory')
        const body = await res.json()
        if (alive && !body.error) setMemory(body)
      } catch {
        /* Serveur de production absent : on se passe de l'information. */
      }
    }
    void read()
    const id = setInterval(read, intervalMs)
    return () => { alive = false; clearInterval(id) }
  }, [intervalMs])

  return memory
}
