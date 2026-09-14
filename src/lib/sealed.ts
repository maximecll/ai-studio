/** Couche de scellement appliquée au passage de la base. */
import { isSealed, openBytes, openText, sealBytes, sealText } from './crypto'
import type { Conversation, ImageBlob, Message } from './types'

let master: CryptoKey | null = null

export function setMaster(key: CryptoKey | null) {
  master = key
}

export function hasMaster(): boolean {
  return master !== null
}

/** Champs chiffrés d'une conversation verrouillée. */
const CONV_FIELDS = ['title', 'system', 'memory'] as const
/** Champs chiffrés d'un message appartenant à une conversation verrouillée. */
const MSG_FIELDS = ['content', 'thinking'] as const

export const LOCKED_LABEL = 'Conversation verrouillée'

async function map<T extends object, K extends readonly (keyof T)[]>(
  record: T,
  fields: K,
  fn: (v: string) => Promise<string>,
): Promise<T> {
  const out = { ...record }
  for (const f of fields) {
    const v = out[f]
    if (typeof v === 'string' && v) out[f] = (await fn(v)) as T[typeof f]
  }
  return out
}

export async function sealConversation(conv: Conversation): Promise<Conversation> {
  if (!conv.locked || !master) return conv
  return map(conv, CONV_FIELDS, (v) => (isSealed(v) ? Promise.resolve(v) : sealText(master!, v)))
}

export async function openConversation(conv: Conversation): Promise<Conversation> {
  if (!conv.locked) return conv
  if (!master) {
    // Coffre fermé : on ne divulgue rien, pas même le titre.
    return { ...conv, title: LOCKED_LABEL, system: '', memory: '' }
  }
  return map(conv, CONV_FIELDS, (v) => openText(master!, v))
}

export async function sealMessage(msg: Message, locked: boolean): Promise<Message> {
  if (!locked || !master) return msg
  return map(msg, MSG_FIELDS, (v) => (isSealed(v) ? Promise.resolve(v) : sealText(master!, v)))
}

export async function openMessage(msg: Message): Promise<Message> {
  if (!master) return msg
  if (!MSG_FIELDS.some((f) => isSealed(msg[f]))) return msg
  return map(msg, MSG_FIELDS, (v) => openText(master!, v))
}

/* ── Images ───────────────────────────────────────────────────────── */

/** Les octets d'une image suivent la même règle que le texte : chiffrés dès que la conversation est verrouillée, et illisibles sans la clé maîtresse. */
export async function sealImage(bytes: Uint8Array, type: string, locked: boolean): Promise<Pick<ImageBlob, 'data' | 'sealed' | 'iv' | 'type'>> {
  if (!locked || !master) {
    return { data: new Blob([bytes as BlobPart], { type }), sealed: 0, type }
  }
  const { iv, data } = await sealBytes(master, bytes)
  return { data: new Blob([data as BlobPart], { type: 'application/octet-stream' }), sealed: 1, iv, type }
}

/** Rend un Blob affichable, ou `null` si le coffre est fermé. */
export async function openImage(row: ImageBlob): Promise<Blob | null> {
  if (!row.sealed) return row.data
  if (!master || !row.iv) return null
  const bytes = await openBytes(master, { iv: row.iv, data: new Uint8Array(await row.data.arrayBuffer()) })
  return new Blob([bytes as BlobPart], { type: row.type })
}

/** Vrai si le contenu est illisible en l'état — coffre fermé. */
export function isOpaque(msg: Message): boolean {
  return isSealed(msg.content) && !master
}
