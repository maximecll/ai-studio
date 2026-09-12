import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, db, messagesOf } from './db'
import type { Conversation, Message, Preset, Settings } from './types'

export function useSettings(): Settings {
  return useLiveQuery(async () => (await db.settings.get('app')) ?? DEFAULT_SETTINGS, [], DEFAULT_SETTINGS)
}

/** `undefined` tant que la base n'a pas répondu — à distinguer d'une base vide. */
export function useConversations(): Conversation[] | undefined {
  return useLiveQuery(
    async () => (await db.conversations.toArray()).sort((a, b) => b.updatedAt - a.updatedAt),
    [],
  )
}

export function useConversation(id: string | null): Conversation | undefined {
  return useLiveQuery(async () => (id ? db.conversations.get(id) : undefined), [id])
}

export function useMessages(id: string | null): Message[] {
  return useLiveQuery(async () => (id ? messagesOf(id) : []), [id], [])
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
