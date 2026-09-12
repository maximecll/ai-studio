import { create } from 'zustand'
import { ollama, OllamaError } from '../lib/ollama'
import {
  addMessage, db, deleteMessagesFrom, getSettings, messagesOf, updateConversation, updateMessage,
} from '../lib/db'
import type { GenStats, Message, TokenLogprob } from '../lib/types'
import { summarize } from '../lib/entropy'
import { splitThinking, uid } from '../lib/utils'
import { COMPACT_THRESHOLD, contextUsage, memoryBlock, plan, rewriteMemory } from '../lib/memory'
import { toast } from './ui'

export interface Stream {
  conversationId: string
  messageId: string
  model: string
  content: string
  thinking: string
  startedAt: number
  /** Horodatage mural, figé au démarrage — pour l'affichage de l'heure. */
  at: number
  ttft?: number
}

interface ChatState {
  streams: Record<string, Stream>
  /** Reprend une réponse interrompue par la limite de longueur. */
  continueLast: (conversationId: string) => Promise<void>
  /** Conversations en cours de compactage. */
  compacting: Record<string, boolean>
  compact: (conversationId: string) => Promise<void>
  send: (conversationId: string, text: string) => Promise<void>
  regenerate: (conversationId: string) => Promise<void>
  editUserMessage: (conversationId: string, messageId: string, text: string) => Promise<void>
  stop: (conversationId: string) => void
}

const controllers = new Map<string, AbortController>()

/** Rang de la distribution observée pour l'entropie — le « 8 » de H₈. */
export const TOP_LOGPROBS = 8

export const useChat = create<ChatState>((set, get) => {
  /* Les jetons arrivent vite : on regroupe les mises à jour sur une frame. */
  const pending = new Map<string, { content: string; thinking: string; ttft?: number }>()
  let frame = 0
  const flush = () => {
    frame = 0
    const streams = { ...get().streams }
    let changed = false
    for (const [id, p] of pending) {
      const s = streams[id]
      if (!s) continue
      streams[id] = { ...s, ...p }
      changed = true
    }
    pending.clear()
    if (changed) set({ streams })
  }
  const schedule = (id: string, p: { content: string; thinking: string; ttft?: number }) => {
    pending.set(id, p)
    if (!frame) frame = requestAnimationFrame(flush)
  }

  const clearStream = (conversationId: string) => {
    pending.delete(conversationId)
    const streams = { ...get().streams }
    delete streams[conversationId]
    set({ streams })
  }

  async function autoTitle(conversationId: string) {
    const settings = await getSettings()
    if (!settings.autoTitle) return
    const conv = await db.conversations.get(conversationId)
    if (!conv || conv.autoTitled) return
    const msgs = await messagesOf(conversationId)
    const first = msgs.find((m) => m.role === 'user')
    const answer = msgs.find((m) => m.role === 'assistant' && !m.error)
    if (!first || !answer) return
    try {
      const raw = await ollama.generate(
        conv.model,
        [
          "Résume cet échange en un titre court de 3 à 6 mots, en français.",
          "Réponds UNIQUEMENT par le titre, sans guillemets, sans ponctuation finale, sans préfixe.",
          '',
          `Question : ${first.content.slice(0, 700)}`,
          `Réponse : ${answer.content.slice(0, 400)}`,
          '',
          'Titre :',
        ].join('\n'),
        { temperature: 0.3, top_p: 0.9, num_predict: 28 },
      )
      const title = splitThinking(raw).content
        .replace(/^["'«»\s]+|["'«».\s]+$/g, '')
        .replace(/^titre\s*:\s*/i, '')
        .split('\n')[0]
        .slice(0, 64)
        .trim()
      if (title) await updateConversation(conversationId, { title, autoTitled: 1 })
    } catch {
      /* Un titre raté n'est pas une erreur bloquante. */
    }
  }

  /** Replie les échanges anciens dans la mémoire. Idempotent et interruptible. */
  async function compact(conversationId: string, manual = false) {
    if (get().compacting[conversationId]) return
    const conv = await db.conversations.get(conversationId)
    if (!conv?.model) return
    const messages = await messagesOf(conversationId)
    const p = plan(messages)
    if (!p) {
      if (manual) toast({ title: 'Rien à compacter', description: 'La conversation est encore courte.' })
      return
    }

    set({ compacting: { ...get().compacting, [conversationId]: true } })
    try {
      const memory = await rewriteMemory(conv.model, conv.memory, p.older)
      await db.transaction('rw', db.conversations, db.messages, async () => {
        await db.conversations.update(conversationId, { memory, memoryUpdatedAt: Date.now() })
        await db.messages.bulkUpdate(p.older.map((m) => ({ key: m.id, changes: { folded: 1 as const } })))
      })
      toast({
        title: 'Conversation compactée',
        description: `${p.older.length} messages repliés dans la mémoire.`,
        tone: 'success',
      })
    } catch (e) {
      toast({ title: 'Compactage impossible', description: (e as Error).message, tone: 'danger' })
    } finally {
      const next = { ...get().compacting }
      delete next[conversationId]
      set({ compacting: next })
    }
  }

  /** Déclenché après chaque réponse, quand la fenêtre se remplit. */
  async function maybeCompact(conversationId: string) {
    const settings = await getSettings()
    if (!settings.autoCompact) return
    const conv = await db.conversations.get(conversationId)
    if (!conv) return
    const messages = await messagesOf(conversationId)
    if (contextUsage(conv, messages) < COMPACT_THRESHOLD) return
    await compact(conversationId)
  }

  const CONTINUE_PROMPT =
    "Poursuis ta réponse précédente exactement là où elle s'est arrêtée. " +
    'Ne répète rien, ne réintroduis pas le sujet, enchaîne directement.'

  async function run(conversationId: string, opts: { continueFrom?: string } = {}) {
    const conv = await db.conversations.get(conversationId)
    if (!conv) return
    if (!conv.model) {
      toast({ title: 'Aucun modèle sélectionné', description: 'Choisissez un modèle dans la barre du haut.', tone: 'danger' })
      return
    }
    const settings = await getSettings()
    const history = await messagesOf(conversationId)

    const payload: Array<Pick<Message, 'role' | 'content'>> = []
    const preamble = [
      conv.system.trim(),
      conv.memory.trim() ? memoryBlock(conv.memory) : '',
    ].filter(Boolean).join('\n\n')
    if (preamble) payload.push({ role: 'system', content: preamble })
    for (const m of history) {
      // Les messages repliés vivent désormais dans la mémoire.
      if (m.role === 'system' || m.error || m.folded) continue
      payload.push({ role: m.role, content: m.content })
    }
    /* Reprise : on demande la suite sans persister cette consigne. */
    if (opts.continueFrom) payload.push({ role: 'user', content: CONTINUE_PROMPT })

    const controller = new AbortController()
    controllers.set(conversationId, controller)
    const startedAt = performance.now()
    const messageId = uid()
    set({
      streams: {
        ...get().streams,
        [conversationId]: { conversationId, messageId, model: conv.model, content: '', thinking: '', startedAt, at: Date.now() },
      },
    })

    let content = ''
    let thinking = ''
    let ttft: number | undefined
    let stats: GenStats | undefined
    let failure: string | undefined
    const tokens: TokenLogprob[] = []

    try {
      for await (const chunk of ollama.chat({
        model: conv.model,
        messages: payload,
        params: conv.params,
        think: conv.think,
        keepAlive: settings.keepAlive,
        topLogprobs: settings.measureEntropy ? TOP_LOGPROBS : 0,
        signal: controller.signal,
      })) {
        for (const lp of chunk.logprobs ?? []) {
          tokens.push({ token: lp.token, logprob: lp.logprob, top: lp.top_logprobs })
        }
        if (chunk.message?.thinking) thinking += chunk.message.thinking
        if (chunk.message?.content) {
          if (ttft === undefined) ttft = performance.now() - startedAt
          content += chunk.message.content
        }
        if (chunk.message) schedule(conversationId, { content, thinking, ttft })
        if (chunk.done) {
          stats = {
            totalDuration: chunk.total_duration,
            loadDuration: chunk.load_duration,
            promptEvalCount: chunk.prompt_eval_count,
            promptEvalDuration: chunk.prompt_eval_duration,
            evalCount: chunk.eval_count,
            evalDuration: chunk.eval_duration,
            doneReason: chunk.done_reason,
            ttft,
            uncertainty: summarize(tokens, TOP_LOGPROBS),
          }
        }
      }
    } catch (e) {
      const err = e as Error
      if (err.name === 'AbortError') {
        stats = { ...stats, ttft, doneReason: 'arrêté', uncertainty: summarize(tokens, TOP_LOGPROBS) }
      } else {
        failure = err instanceof OllamaError ? err.message : (err.message || 'Erreur inconnue')
        toast({ title: 'La génération a échoué', description: failure, tone: 'danger' })
      }
    } finally {
      controllers.delete(conversationId)
      if (frame) { cancelAnimationFrame(frame); frame = 0 }
      pending.delete(conversationId)
    }

    /* Le raisonnement peut arriver en ligne (<think>) plutôt que dans son champ. */
    const parsed = splitThinking(content)
    const finalThinking = thinking || parsed.thinking

    const body = parsed.content || content

    if (opts.continueFrom) {
      // On recolle la suite au message existant plutôt que d'en créer un autre.
      const previous = await db.messages.get(opts.continueFrom)
      if (previous && body.trim()) {
        const joint = /[\s\n]$/.test(previous.content) ? '' : ' '
        await updateMessage(opts.continueFrom, {
          content: previous.content + joint + body.trimStart(),
          stats: {
            ...previous.stats,
            ...stats,
            evalCount: (previous.stats?.evalCount ?? 0) + (stats?.evalCount ?? 0),
          },
        })
      }
    } else if (body.trim() || finalThinking.trim() || failure) {
      await addMessage({
        id: messageId,
        conversationId,
        role: 'assistant',
        content: body,
        thinking: finalThinking || undefined,
        model: conv.model,
        stats,
        error: failure,
      })
    }
    clearStream(conversationId)
    if (!failure) {
      void autoTitle(conversationId)
      void maybeCompact(conversationId)
    }
  }

  return {
    streams: {},
    compacting: {},
    compact: (id) => compact(id, true),

    async continueLast(conversationId) {
      if (get().streams[conversationId]) return
      const msgs = await messagesOf(conversationId)
      const last = msgs.at(-1)
      if (last?.role !== 'assistant' || last.error) return
      await run(conversationId, { continueFrom: last.id })
    },

    async send(conversationId, text) {
      const trimmed = text.trim()
      if (!trimmed || get().streams[conversationId]) return
      await addMessage({ conversationId, role: 'user', content: trimmed })
      await run(conversationId)
    },

    async regenerate(conversationId) {
      if (get().streams[conversationId]) return
      const msgs = await messagesOf(conversationId)
      const last = msgs.at(-1)
      if (last?.role === 'assistant') await db.messages.delete(last.id)
      await run(conversationId)
    },

    async editUserMessage(conversationId, messageId, text) {
      if (get().streams[conversationId]) return
      const msg = await db.messages.get(messageId)
      if (!msg) return
      await updateMessage(messageId, { content: text.trim() })
      await deleteMessagesFrom(conversationId, msg.createdAt)
      await run(conversationId)
    },

    stop(conversationId) {
      controllers.get(conversationId)?.abort()
    },
  }
})

export const useIsStreaming = (conversationId: string | null) =>
  useChat((s) => (conversationId ? !!s.streams[conversationId] : false))
