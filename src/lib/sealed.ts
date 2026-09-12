/**
 * Couche de scellement appliquée au passage de la base.
 *
 * La clé maîtresse vit uniquement en mémoire, déposée ici par le magasin du
 * coffre. Les fonctions de lecture et d'écriture de `db.ts` traversent ce
 * module : c'est le seul point où du texte clair devient du chiffré.
 */
import { isSealed, openText, sealText } from './crypto'
import type { Conversation, Message } from './types'

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

/** Vrai si le contenu est illisible en l'état — coffre fermé. */
export function isOpaque(msg: Message): boolean {
  return isSealed(msg.content) && !master
}
