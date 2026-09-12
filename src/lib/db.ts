import Dexie, { type EntityTable } from 'dexie'
import type { Conversation, Folder, Message, Params, Preset, Settings } from './types'
import { fullDate, uid } from './utils'

class StudioDB extends Dexie {
  conversations!: EntityTable<Conversation, 'id'>
  messages!: EntityTable<Message, 'id'>
  presets!: EntityTable<Preset, 'id'>
  folders!: EntityTable<Folder, 'id'>
  settings!: EntityTable<Settings, 'id'>

  constructor() {
    super('ollama-studio')
    this.version(1).stores({
      conversations: 'id, updatedAt, createdAt, pinned, folderId, archived, *tags',
      messages: 'id, conversationId, createdAt, [conversationId+createdAt]',
      presets: 'id, name, createdAt',
      folders: 'id, order, name',
      settings: 'id',
    })
    // v2 : les presets passent de l'emoji à une icône du jeu lucide.
    this.version(2)
      .stores({
        conversations: 'id, updatedAt, createdAt, pinned, folderId, archived, *tags',
        messages: 'id, conversationId, createdAt, [conversationId+createdAt]',
        presets: 'id, name, createdAt',
        folders: 'id, order, name',
        settings: 'id',
      })
      .upgrade((tx) =>
        tx.table('presets').toCollection().modify((p: Record<string, unknown>) => {
          if (typeof p.icon !== 'string') p.icon = 'sparkles'
          delete p.emoji
        }),
      )

    // v3 : vue de transcription et mémoire de conversation.
    this.version(3).upgrade((tx) =>
      tx.table('conversations').toCollection().modify((c: Record<string, unknown>) => {
        c.transcript ??= 'normal'
        c.memory ??= ''
        c.memoryUpdatedAt ??= null
      }),
    )
  }
}

export const db = new StudioDB()

export const DEFAULT_PARAMS: Params = {
  temperature: 0.8,
  top_p: 0.9,
  top_k: 40,
  repeat_penalty: 1.1,
  num_ctx: 8192,
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  theme: 'system',
  fontFamily: 'dm',
  defaultModel: '',
  defaultSystem: '',
  defaultParams: DEFAULT_PARAMS,
  autoTitle: true,
  sendOnEnter: true,
  showStats: true,
  measureEntropy: true,
  autoCompact: true,
  defaultTranscript: 'normal',
  keepAlive: '10m',
  density: 'cosy',
}

const BUILTIN_PRESETS: Array<Omit<Preset, 'id' | 'createdAt'>> = [
  {
    name: 'Assistant',
    icon: 'sparkles',
    description: 'Polyvalent, réponses claires et directes.',
    model: null,
    system:
      "Tu es un assistant francophone précis et concis. Va droit au but, structure tes réponses quand c'est utile, et dis clairement quand tu n'es pas sûr.",
    params: { temperature: 0.7, top_p: 0.9, num_ctx: 8192 },
  },
  {
    name: 'Développeur',
    icon: 'terminal',
    description: 'Code propre, explications techniques, peu de bla-bla.',
    model: null,
    system:
      "Tu es un ingénieur logiciel senior. Donne du code complet et exécutable, commenté seulement là où c'est nécessaire. Explique les compromis techniques en une ou deux phrases. Pas de préambule inutile.",
    params: { temperature: 0.35, top_p: 0.9, repeat_penalty: 1.05, num_ctx: 16384 },
  },
  {
    name: 'Rédacteur',
    icon: 'pen',
    description: 'Écriture soignée, ton naturel, style travaillé.',
    model: null,
    system:
      "Tu es un rédacteur francophone au style net et vivant. Phrases courtes, vocabulaire précis, aucune formule creuse. Adapte le ton au contexte demandé.",
    params: { temperature: 0.9, top_p: 0.95, repeat_penalty: 1.15, num_ctx: 8192 },
  },
  {
    name: 'Brainstorm',
    icon: 'lightbulb',
    description: 'Créatif, exploratoire, volume d’idées.',
    model: null,
    system:
      "Tu es un partenaire de réflexion créatif. Propose des angles inattendus, pousse les idées plus loin, et n'hésite pas à contredire pour faire avancer. Quantité puis qualité.",
    params: { temperature: 1.1, top_p: 0.98, top_k: 80, repeat_penalty: 1.05, num_ctx: 8192 },
  },
  {
    name: 'Analyse',
    icon: 'binoculars',
    description: 'Factuel, rigoureux, température basse.',
    model: null,
    system:
      "Tu es un analyste rigoureux. Raisonne étape par étape, distingue explicitement les faits des hypothèses, et signale les informations manquantes plutôt que de les inventer.",
    params: { temperature: 0.2, top_p: 0.85, top_k: 20, num_ctx: 16384 },
  },
]

let bootstrapping: Promise<Settings> | null = null

/**
 * Crée les réglages et les presets d'origine au premier lancement.
 * Verrouillé : deux appels concurrents ne doivent pas semer les presets deux fois.
 */
export function bootstrap(defaultModel: string): Promise<Settings> {
  bootstrapping ??= doBootstrap(defaultModel)
  return bootstrapping
}

async function doBootstrap(defaultModel: string): Promise<Settings> {
  let settings = await db.settings.get('app')
  if (!settings) {
    settings = { ...DEFAULT_SETTINGS, defaultModel }
    await db.settings.put(settings)
  }
  if (!settings.defaultModel && defaultModel) {
    settings = { ...settings, defaultModel }
    await db.settings.put(settings)
  }
  if ((await db.presets.count()) === 0) {
    await db.presets.bulkAdd(
      BUILTIN_PRESETS.map((p, i) => ({ ...p, id: uid(), createdAt: Date.now() + i })),
    )
  }
  return settings
}

export async function getSettings(): Promise<Settings> {
  return (await db.settings.get('app')) ?? DEFAULT_SETTINGS
}

export async function patchSettings(patch: Partial<Settings>): Promise<void> {
  const cur = await getSettings()
  await db.settings.put({ ...cur, ...patch, id: 'app' })
}

/* ── Conversations ────────────────────────────────────────────────── */

export async function createConversation(init: Partial<Conversation> = {}): Promise<string> {
  const s = await getSettings()
  const now = Date.now()
  const conv: Conversation = {
    title: 'Nouvelle conversation',
    model: s.defaultModel,
    system: s.defaultSystem,
    params: { ...s.defaultParams },
    folderId: null,
    tags: [],
    pinned: 0,
    archived: 0,
    presetId: null,
    autoTitled: 0,
    transcript: s.defaultTranscript,
    memory: '',
    memoryUpdatedAt: null,
    ...init,
    id: init.id ?? uid(),
    createdAt: now,
    updatedAt: now,
  }
  await db.conversations.add(conv)
  return conv.id
}

export async function touchConversation(id: string): Promise<void> {
  await db.conversations.update(id, { updatedAt: Date.now() })
}

export async function updateConversation(id: string, patch: Partial<Conversation>): Promise<void> {
  await db.conversations.update(id, { ...patch, updatedAt: Date.now() })
}

export async function deleteConversation(id: string): Promise<void> {
  await db.transaction('rw', db.conversations, db.messages, async () => {
    await db.messages.where('conversationId').equals(id).delete()
    await db.conversations.delete(id)
  })
}

export async function deleteAllConversations(): Promise<void> {
  await db.transaction('rw', db.conversations, db.messages, async () => {
    await db.messages.clear()
    await db.conversations.clear()
  })
}

export async function duplicateConversation(id: string): Promise<string | null> {
  const conv = await db.conversations.get(id)
  if (!conv) return null
  const msgs = await messagesOf(id)
  const newId = uid()
  const now = Date.now()
  await db.transaction('rw', db.conversations, db.messages, async () => {
    await db.conversations.add({ ...conv, id: newId, title: `${conv.title} (copie)`, createdAt: now, updatedAt: now })
    await db.messages.bulkAdd(msgs.map((m) => ({ ...m, id: uid(), conversationId: newId })))
  })
  return newId
}

export function messagesOf(conversationId: string): Promise<Message[]> {
  return db.messages.where('conversationId').equals(conversationId).sortBy('createdAt')
}

/* ── Messages ─────────────────────────────────────────────────────── */

export async function addMessage(m: Omit<Message, 'id' | 'createdAt'> & Partial<Pick<Message, 'id' | 'createdAt'>>): Promise<string> {
  const msg: Message = { id: m.id ?? uid(), createdAt: m.createdAt ?? Date.now(), ...m } as Message
  await db.messages.add(msg)
  await touchConversation(msg.conversationId)
  return msg.id
}

export async function updateMessage(id: string, patch: Partial<Message>): Promise<void> {
  await db.messages.update(id, patch)
}

export async function deleteMessage(id: string): Promise<void> {
  await db.messages.delete(id)
}

/** Supprime tout ce qui suit un message — utilisé pour régénérer / éditer. */
export async function deleteMessagesFrom(conversationId: string, createdAt: number, inclusive = false): Promise<void> {
  const all = await messagesOf(conversationId)
  const doomed = all.filter((m) => (inclusive ? m.createdAt >= createdAt : m.createdAt > createdAt))
  await db.messages.bulkDelete(doomed.map((m) => m.id))
}

/* ── Recherche ────────────────────────────────────────────────────── */

export interface SearchHit {
  conversation: Conversation
  snippet?: string
  matchedIn: 'title' | 'message'
}

export async function search(query: string, limit = 40): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const convs = await db.conversations.toArray()
  const byId = new Map(convs.map((c) => [c.id, c]))
  const hits = new Map<string, SearchHit>()

  for (const c of convs) {
    if (c.title.toLowerCase().includes(q)) hits.set(c.id, { conversation: c, matchedIn: 'title' })
  }
  await db.messages.each((m) => {
    if (hits.has(m.conversationId)) return
    const idx = m.content.toLowerCase().indexOf(q)
    if (idx === -1) return
    const conv = byId.get(m.conversationId)
    if (!conv) return
    const start = Math.max(0, idx - 45)
    hits.set(m.conversationId, {
      conversation: conv,
      matchedIn: 'message',
      snippet: (start > 0 ? '…' : '') + m.content.slice(start, idx + q.length + 90).replace(/\s+/g, ' ') + '…',
    })
  })

  return [...hits.values()]
    .sort((a, b) => b.conversation.updatedAt - a.conversation.updatedAt)
    .slice(0, limit)
}

/* ── Import / export ──────────────────────────────────────────────── */

export async function exportMarkdown(id: string): Promise<string> {
  const conv = await db.conversations.get(id)
  if (!conv) return ''
  const msgs = await messagesOf(id)
  const head = [
    `# ${conv.title}`,
    '',
    `> Modèle : \`${conv.model}\`  `,
    `> Date : ${fullDate(conv.createdAt)}  `,
    conv.system ? `> Instructions : ${conv.system.replace(/\n/g, ' ')}  ` : '',
    '',
    '---',
    '',
  ].filter(Boolean)
  const body = msgs
    .filter((m) => m.role !== 'system')
    .map((m) => `### ${m.role === 'user' ? 'Moi' : 'Assistant'}\n\n${m.content}\n`)
  return [...head, ...body].join('\n')
}

export interface ExportBundle {
  format: 'ollama-studio'
  version: 1
  exportedAt: number
  conversations: Conversation[]
  messages: Message[]
  presets?: Preset[]
  folders?: Folder[]
}

export async function exportJSON(ids?: string[]): Promise<ExportBundle> {
  const conversations = ids
    ? ((await db.conversations.bulkGet(ids)).filter(Boolean) as Conversation[])
    : await db.conversations.toArray()
  const messages = (
    await Promise.all(conversations.map((c) => messagesOf(c.id)))
  ).flat()
  return {
    format: 'ollama-studio',
    version: 1,
    exportedAt: Date.now(),
    conversations,
    messages,
    presets: await db.presets.toArray(),
    folders: await db.folders.toArray(),
  }
}

export async function importJSON(bundle: ExportBundle): Promise<number> {
  if (bundle.format !== 'ollama-studio') throw new Error('Fichier non reconnu.')
  const idMap = new Map<string, string>()
  const convs = bundle.conversations.map((c) => {
    const nid = uid()
    idMap.set(c.id, nid)
    return { ...c, id: nid }
  })
  const msgs = bundle.messages
    .filter((m) => idMap.has(m.conversationId))
    .map((m) => ({ ...m, id: uid(), conversationId: idMap.get(m.conversationId)! }))
  await db.transaction('rw', db.conversations, db.messages, db.folders, async () => {
    if (bundle.folders?.length) {
      const existing = new Set((await db.folders.toArray()).map((f) => f.name))
      await db.folders.bulkPut(bundle.folders.filter((f) => !existing.has(f.name)))
    }
    await db.conversations.bulkAdd(convs)
    await db.messages.bulkAdd(msgs)
  })
  return convs.length
}
