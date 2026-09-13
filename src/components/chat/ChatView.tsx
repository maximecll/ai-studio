import { useCallback, useMemo, useState } from 'react'
import { ArrowDown, Brain, ChevronDown, Loader2, RefreshCw } from 'lucide-react'
import { createConversation, db, deleteMessagesFrom } from '../../lib/db'
import { href, navigate } from '../../lib/router'
import { useMessages, useSettings } from '../../lib/hooks'
import type { Conversation } from '../../lib/types'
import { cn, resembles } from '../../lib/utils'
import { contextUsage } from '../../lib/memory'
import { estimateTokens } from '../../lib/utils'
import { useChat } from '../../store/chat'
import { Button, Chip, Modal, SpinButton, useStickToBottom } from '../ui/primitives'
import { AssistantMessage, StreamingMessage, UserMessage } from './Message'
import { Composer } from './Composer'
import { TopBar } from '../layout/TopBar'
import { LockedView } from './LockedView'
import { useVault } from '../../store/vault'

export function ChatView({ conv }: { conv: Conversation }) {
  const vaultUnlocked = useVault((s) => s.unlocked)
  const messages = useMessages(conv.id)
  const settings = useSettings()
  const stream = useChat((s) => s.streams[conv.id])
  const { send, stop, regenerate, editUserMessage, continueLast } = useChat()
  const { ref, atBottom, scrollToBottom } = useStickToBottom([messages.length, stream?.content, stream?.thinking])

  const compacting = useChat((s) => !!s.compacting[conv.id])
  const [showFolded, setShowFolded] = useState(false)

  const folded = useMemo(() => messages.filter((m) => m.folded), [messages])
  const live = useMemo(() => messages.filter((m) => !m.folded), [messages])
  /* Le flux en cours n'est pas encore en base : sans lui, la jauge resterait
     figée pendant toute la génération. */
  const streamed = stream ? estimateTokens(stream.content) + estimateTokens(stream.thinking) : 0
  const ctxMax = conv.params.num_ctx ?? 4096
  const usedTokens = Math.round(contextUsage(conv, messages) * ctxMax) + streamed
  const streaming = !!stream
  const lastAssistantId = [...live].reverse().find((m) => m.role === 'assistant')?.id
  /* Flux interrompu (rechargement, coupure) : la question reste sans réponse. */
  const awaitingAnswer = !streaming && live.length > 0 && live.at(-1)?.role === 'user'
  const shown = showFolded ? messages : live

  /* Recoller une réponse déjà présente pousse le modèle à la reproduire au lieu
     de l'exécuter — mesuré, et insensible à toute consigne. On le signale au
     moment où c'est encore rattrapable. */
  const [echoWarning, setEchoWarning] = useState<string | null>(null)

  const onSend = useCallback(
    (text: string) => {
      const duplicate = messages.some((m) => m.role === 'assistant' && !m.error && resembles(text, m.content))
      if (duplicate) { setEchoWarning(text); return }
      void send(conv.id, text)
    },
    [conv.id, send, messages],
  )

  /* Un message rejoué dans une conversation neuve échappe à l'influence des
     tours précédents — c'est le remède au modèle qui recopie ce qu'il a lu. */
  const restart = useCallback(
    async (content: string) => {
      const id = await createConversation({
        model: conv.model,
        params: { ...conv.params },
        system: conv.system,
      })
      navigate(href.conversation(id))
      void send(id, content)
    },
    [conv.model, conv.params, conv.system, send],
  )

  // Verrouillée et coffre fermé : on ne montre rien, on explique.
  if (conv.locked === 1 && !vaultUnlocked) return <LockedView conv={conv} />

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg">
      <TopBar conv={conv} />

      <div ref={ref} className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div className="mx-auto w-full max-w-[820px] space-y-7 px-6 py-8">
          {folded.length > 0 && (
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-line" />
              <Chip as="button" onClick={() => setShowFolded((v) => !v)} className="shrink-0">
                <Brain className="size-3.5" />
                {folded.length} message{folded.length > 1 ? 's' : ''} replié{folded.length > 1 ? 's' : ''} en mémoire
                <ChevronDown className={cn('size-3.5 transition-transform duration-200', showFolded && 'rotate-180')} />
              </Chip>
              <span className="h-px flex-1 bg-line" />
            </div>
          )}

          {shown.map((m) =>
            m.role === 'user' ? (
              <UserMessage
                key={m.id}
                message={m}
                faded={!!m.folded}
                disabled={streaming}
                onEdit={(text) => void editUserMessage(conv.id, m.id, text)}
                onRestart={() => void restart(m.content)}
                onDelete={async () => { await db.messages.delete(m.id); await deleteMessagesFrom(conv.id, m.createdAt) }}
              />
            ) : (
              <AssistantMessage
                key={m.id}
                message={m}
                faded={!!m.folded}
                transcript={conv.transcript}
                showStats={settings.showStats}
                canRegenerate={m.id === lastAssistantId && !streaming}
                disabled={streaming}
                onRegenerate={() => void regenerate(conv.id)}
                onContinue={m.id === lastAssistantId ? () => void continueLast(conv.id) : undefined}
                onDelete={() => void db.messages.delete(m.id)}
              />
            ),
          )}
          {compacting && (
            <div className="t-meta flex items-center justify-center gap-2 text-fg-subtle">
              <Loader2 className="size-4 animate-spin" />
              Compactage de la conversation…
            </div>
          )}

          {awaitingAnswer && !compacting && (
            <SpinButton
              icon={RefreshCw} variant="soft" size="md" label="Générer la réponse"
              onClick={() => void regenerate(conv.id)}
            />
          )}
          {stream && (
            <StreamingMessage
              content={stream.content}
              thinking={stream.thinking}
              model={stream.model}
              startedAt={stream.at}
              transcript={conv.transcript}
              tokens={stream.tokens}
              thinkingTokens={stream.thinkingTokens}
            />
          )}
        </div>
      </div>

      <div className="relative shrink-0">
        {!atBottom && messages.length > 1 && (
          <div className="pointer-events-none absolute inset-x-0 -top-4 flex justify-center">
            <Button
              size="icon-sm" variant="soft" onClick={scrollToBottom}
              className="pointer-events-auto bg-surface shadow-card" aria-label="Aller en bas"
            >
              <ArrowDown className="size-4" />
            </Button>
          </div>
        )}
        <Modal
          open={!!echoWarning}
          onClose={() => setEchoWarning(null)}
          title="Ce texte reprend une réponse précédente"
          description="Envoyé dans cette conversation, le modèle aura tendance à le recopier plutôt qu'à l'exécuter."
          width="max-w-md"
          footer={
            <>
              <Button
                variant="soft" size="sm"
                onClick={() => { const t = echoWarning!; setEchoWarning(null); void send(conv.id, t) }}
              >
                Envoyer ici quand même
              </Button>
              <Button
                variant="primary" size="sm"
                onClick={() => { const t = echoWarning!; setEchoWarning(null); void restart(t) }}
              >
                Rejouer à part
              </Button>
            </>
          }
        >
          <p className="t-meta text-fg-muted">
            Le modèle voit ce texte comme quelque chose qu'il a déjà produit, et complète le motif en
            le répétant. Aucune consigne ne l'en dissuade — seul un contexte vierge y parvient.
          </p>
          <p className="t-caption mt-3 text-fg-subtle">
            « Rejouer à part » ouvre une conversation neuve avec le même modèle et les mêmes réglages,
            et y envoie ce message seul.
          </p>
        </Modal>

        <Composer
          conversation={conv}
          settings={settings}
          streaming={streaming}
          usedTokens={usedTokens}
          hasMemory={!!conv.memory.trim()}
          onSend={onSend}
          onStop={() => stop(conv.id)}
        />
      </div>
    </div>
  )
}
