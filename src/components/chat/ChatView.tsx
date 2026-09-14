import { useCallback, useMemo, useState } from 'react'
import { ArrowDown, Brain, ChevronDown, Loader2, RefreshCw } from 'lucide-react'
import { createConversation, db, deleteImage, deleteMessagesFrom } from '../../lib/db'
import { href, navigate } from '../../lib/router'
import { useMessages, useSettings } from '../../lib/hooks'
import type { Conversation, ImageMeta, ImageParams } from '../../lib/types'
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
import { useImages } from '../../store/images'
import { GeneratingImage, ImageMessage } from './ImageMessage'

export function ChatView({ conv }: { conv: Conversation }) {
  const vaultUnlocked = useVault((s) => s.unlocked)
  const messages = useMessages(conv.id)
  const settings = useSettings()
  const stream = useChat((s) => s.streams[conv.id])
  const { send, stop, regenerate, editUserMessage, continueLast } = useChat()
  /* La diffusion a son propre moteur : une tâche par conversation, suivie
     hors du flux de jetons. */
  const job = useImages((s) => s.jobs[conv.id])
  const { create: generate, cancel: cancelImage, finish: finishImage } = useImages()

  const { ref, atBottom, scrollToBottom } = useStickToBottom([
    messages.length, stream?.content, stream?.thinking, job?.step, job?.phase,
  ])

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
  /** Texte ou image : dans les deux cas la conversation travaille. */
  const busy = streaming || !!job
  const lastAssistantId = [...live].reverse().find((m) => m.role === 'assistant')?.id
  /* Flux interrompu (rechargement, coupure) : la question reste sans réponse.
     Une diffusion en cours n'en est pas une : son message arrivera. */
  const pending = live.at(-1)
  const awaitingAnswer = !busy && live.length > 0 && pending?.role === 'user'
  /* La description partait vers le moteur d'images : la relancer vers le
     modèle de texte n'aurait aucun sens. */
  const awaitingImage = awaitingAnswer ? pending?.imageRequest : undefined
  const shown = showFolded ? messages : live

  // Recoller une réponse déjà présente pousse le modèle à la reproduire au lieu de l'exécuter — mesuré, et insensible à toute consigne.
  const [echoWarning, setEchoWarning] = useState<{ text: string; files: File[] } | null>(null)

  const onSend = useCallback(
    (text: string, files: File[] = []) => {
      const duplicate = messages.some((m) => m.role === 'assistant' && !m.error && resembles(text, m.content))
      if (duplicate) { setEchoWarning({ text, files }); return }
      void send(conv.id, text, files)
    },
    [conv.id, send, messages],
  )

  /* Un message rejoué dans une conversation neuve échappe à l'influence des
     tours précédents — c'est le remède au modèle qui recopie ce qu'il a lu. */
  const onGenerate = useCallback(
    (prompt: string, params: ImageParams) => void generate(conv.id, prompt, params),
    [conv.id, generate],
  )

  /** Régénère une image : même description, nouvelle graine. */
  const regenerateImage = useCallback(
    (meta: ImageMeta) =>
      void generate(conv.id, meta.prompt, {
        model: meta.model,
        width: meta.width,
        height: meta.height,
        steps: meta.steps,
        guidance: meta.guidance,
        loras: meta.loras,
        seed: null,
      }),
    [conv.id, generate],
  )

  /** Supprimer un message porteur d'image emporte aussi ses octets. */
  /** Supprimer un message emporte ses octets : image produite et pièces jointes. */
  const dropMessage = useCallback(async (id: string) => {
    const msg = await db.messages.get(id)
    await db.messages.delete(id)
    for (const blobId of [msg?.image?.blobId, ...(msg?.attachments ?? []).map((a) => a.blobId)]) {
      if (blobId) await deleteImage(blobId)
    }
  }, [])

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
            ) : m.image ? (
              <ImageMessage
                key={m.id}
                message={m}
                faded={!!m.folded}
                showStats={settings.showStats}
                canRegenerate={!busy}
                disabled={busy}
                onRegenerate={() => regenerateImage(m.image!)}
                onDelete={() => void dropMessage(m.id)}
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
            awaitingImage ? (
              <SpinButton
                icon={RefreshCw} variant="soft" size="md" label="Reprendre la génération de l’image"
                onClick={() => void generate(conv.id, pending!.content, awaitingImage, { resume: true })}
              />
            ) : (
              <SpinButton
                icon={RefreshCw} variant="soft" size="md" label="Générer la réponse"
                onClick={() => void regenerate(conv.id)}
              />
            )
          )}
          {job && (
            <GeneratingImage
              job={job}
              onCancel={() => cancelImage(conv.id)}
              onRevealed={() => void finishImage(conv.id)}
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
                onClick={() => { const e = echoWarning!; setEchoWarning(null); void send(conv.id, e.text, e.files) }}
              >
                Envoyer ici quand même
              </Button>
              <Button
                variant="primary" size="sm"
                onClick={() => { const e = echoWarning!; setEchoWarning(null); void restart(e.text) }}
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
          generating={!!job}
          usedTokens={usedTokens}
          hasMemory={!!conv.memory.trim()}
          onSend={onSend}
          onGenerate={onGenerate}
          onStop={() => (job ? cancelImage(conv.id) : stop(conv.id))}
        />
      </div>
    </div>
  )
}
