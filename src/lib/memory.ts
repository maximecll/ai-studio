import { ollama } from './ollama'
import type { Conversation, Message } from './types'
import { estimateTokens } from './utils'

/**
 * Mémoire de conversation.
 *
 * Plutôt que de laisser le contexte déborder puis tout perdre, on entretient
 * un mémo Markdown court qui absorbe les échanges anciens. Quand la fenêtre se
 * remplit, les vieux messages sont « repliés » : ils restent en base et
 * consultables, mais ne sont plus envoyés au modèle — le mémo les remplace.
 *
 * Le mémo suit toujours les mêmes sections, ce qui le garde lisible et évite
 * qu'il enfle à chaque passage.
 */

export const MEMORY_SECTIONS = ['Sujet', 'Décisions', 'Faits établis', 'Préférences', 'En cours'] as const

/** Au-delà de cette part du contexte, on compacte. */
export const COMPACT_THRESHOLD = 0.72
/** Nombre de messages récents toujours transmis mot pour mot. */
export const KEEP_VERBATIM = 6

const TEMPLATE = MEMORY_SECTIONS.map((s) => `## ${s}\n—`).join('\n\n')

export function emptyMemory(): string {
  return TEMPLATE
}

export function isEmptyMemory(memo: string): boolean {
  return !memo.trim() || memo.replace(/##[^\n]*\n?|—|\s/g, '') === ''
}

/** Bloc injecté en tête de contexte, juste après les instructions système. */
export function memoryBlock(memo: string): string {
  return [
    '<mémoire>',
    "Résumé de ce qui précède dans cette conversation. Ces éléments sont acquis :",
    "n'y contredis pas et ne redemande pas ce qui y figure déjà.",
    '',
    memo.trim(),
    '</mémoire>',
  ].join('\n')
}

function transcript(messages: Message[]): string {
  return messages
    .filter((m) => m.role !== 'system' && !m.error)
    .map((m) => `${m.role === 'user' ? 'Utilisateur' : 'Assistant'} : ${m.content.slice(0, 2400)}`)
    .join('\n\n')
}

function buildPrompt(memo: string, older: Message[]): string {
  return [
    "Tu tiens à jour la mémoire d'une conversation. Fusionne les nouveaux échanges",
    'dans le mémo existant et renvoie le mémo mis à jour, rien d’autre.',
    '',
    'Règles :',
    `- Garde exactement ces sections, dans cet ordre : ${MEMORY_SECTIONS.map((s) => `## ${s}`).join(', ')}.`,
    '- Une section sans contenu prend un tiret cadratin (—).',
    '- Des puces courtes, factuelles, au présent. 200 mots au total au maximum.',
    "- N'invente rien. Ne recopie pas le dialogue : retiens ce qui reste vrai ensuite.",
    '- Conserve noms propres, chiffres, chemins de fichiers et décisions arrêtées.',
    "- Fusionne les redites, supprime ce qui est devenu caduc.",
    '',
    '# Mémo actuel',
    memo.trim() || '(vide)',
    '',
    '# Nouveaux échanges à intégrer',
    transcript(older),
    '',
    '# Mémo mis à jour',
  ].join('\n')
}

/** Nettoie la sortie du modèle : pas de préambule, pas de bloc de code. */
function sanitize(raw: string, fallback: string): string {
  let out = raw.trim()
  out = out.replace(/^```(?:markdown|md)?\n?/i, '').replace(/\n?```$/, '')
  out = out.replace(/^<think>[\s\S]*?<\/think>/i, '').trim()
  const first = out.indexOf('## ')
  if (first > 0) out = out.slice(first)
  if (!out.startsWith('## ')) return fallback
  return out.slice(0, 4000)
}

export interface CompactionPlan {
  /** Messages à replier dans la mémoire. */
  older: Message[]
  /** Messages transmis mot pour mot. */
  recent: Message[]
}

/**
 * Décide ce qui doit être replié. On ne replie jamais les derniers échanges,
 * et on coupe toujours avant un message utilisateur pour ne pas séparer une
 * question de sa réponse.
 */
export function plan(messages: Message[], keep = KEEP_VERBATIM): CompactionPlan | null {
  const live = messages.filter((m) => !m.folded && m.role !== 'system')
  if (live.length <= keep + 2) return null

  let cut = live.length - keep
  while (cut > 0 && live[cut].role !== 'user') cut--
  if (cut <= 0) return null

  return { older: live.slice(0, cut), recent: live.slice(cut) }
}

/** Part du contexte occupée par ce qui sera réellement envoyé. */
export function contextUsage(conv: Conversation, messages: Message[]): number {
  const live = messages.filter((m) => !m.folded)
  const used =
    estimateTokens(conv.system) +
    (conv.memory ? estimateTokens(memoryBlock(conv.memory)) : 0) +
    live.reduce((n, m) => n + estimateTokens(m.content), 0)
  return used / (conv.params.num_ctx ?? 4096)
}

/** Demande au modèle le mémo fusionné. Renvoie le mémo précédent en cas d'échec. */
export async function rewriteMemory(
  model: string,
  memo: string,
  older: Message[],
  signal?: AbortSignal,
): Promise<string> {
  const raw = await ollama.generate(
    model,
    buildPrompt(memo || emptyMemory(), older),
    { temperature: 0.2, top_p: 0.9, num_predict: 700 },
    signal,
  )
  return sanitize(raw, memo || emptyMemory())
}
