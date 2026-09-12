import { memo, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, ChevronRight, CornerDownRight, Copy, Pencil, RefreshCw, Sparkles, Trash2, TriangleAlert } from 'lucide-react'
import type { Message as Msg, Transcript } from '../../lib/types'
import { cn, formatMs, formatNumber, formatNs, shortTime, tokensPerSecond } from '../../lib/utils'
import { entropyBand } from '../../lib/entropy'
import { prettyModel } from '../../lib/ollama'
import { Button, MorphButton, ShakeButton, SpinButton, Tooltip } from '../ui/primitives'
import { Markdown } from './Markdown'

const ENTER = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { type: 'spring' as const, stiffness: 380, damping: 32 },
}

/* ── Raisonnement — panneau inséré, sans barre de citation ────────── */

function Thinking({ text, live, defaultOpen }: { text: string; live?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen)
  /* Changer de vue réapplique l'état par défaut aux messages déjà affichés :
     sans cela, un message déplié en « détaillée » le restait en « normale ». */
  useEffect(() => { setOpen(!!defaultOpen) }, [defaultOpen])
  if (!text.trim()) return null
  return (
    <div className="mb-3">
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          't-caption flex h-7 cursor-pointer items-center gap-1.5 rounded-full pr-2.5 pl-3 font-medium transition-colors',
          open ? 'bg-fg/[0.07] text-fg' : 'text-fg-subtle hover:bg-fg/[0.05] hover:text-fg-muted',
        )}
      >
        {live && <span className="size-1.5 animate-pulse rounded-full bg-accent" />}
        {live ? 'Réflexion en cours' : 'Raisonnement'}
        <ChevronRight className={cn('size-3.5 transition-transform duration-200', open && 'rotate-90')} />
      </motion.button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="raisonnement"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="t-meta mt-2 rounded-sm bg-surface-2 px-4 py-3 whitespace-pre-wrap text-fg-muted">
              {text.trim()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Mesures — alignées à gauche, sous la réponse du modèle ───────── */

function Metric({ label, value, title, tone }: { label: string; value: string; title: string; tone?: string }) {
  return (
    <Tooltip label={title} side="top">
      <span className="flex cursor-default items-baseline gap-1">
        <span className="text-[11px] font-medium text-fg-subtle">{label}</span>
        <span className={cn('font-mono text-[11px] tabular-nums', tone ?? 'text-fg-muted')}>{value}</span>
      </span>
    </Tooltip>
  )
}

/* Classes explicites : Tailwind ne peut pas extraire un nom construit. */
const BAND_CLASS = {
  positive: 'text-positive font-bold',
  caution: 'text-caution font-bold',
  negative: 'text-negative font-bold',
} as const

function Metrics({ m }: { m: Msg }) {
  const s = m.stats
  if (!s) return null
  const tps = tokensPerSecond(s.evalCount, s.evalDuration)
  const u = s.uncertainty
  const band = u ? entropyBand(u.meanEntropy) : undefined

  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
      {u && band && (
        <Metric
          label={`H${u.topK}`}
          value={`${u.meanEntropy.toFixed(2)} bits`}
          tone={BAND_CLASS[band.tone]}
          title={`Entropie moyenne sur la distribution top-${u.topK} : ${band.label}. Pic à ${u.maxEntropy.toFixed(2)} bits sur ${formatNumber(u.samples)} jetons.`}
        />
      )}
      {u && (
        <Metric
          label="ppl" value={u.perplexity.toFixed(2)}
          title="Perplexité : plus elle est basse, plus le texte était prévisible pour le modèle."
        />
      )}
      {u && (
        <Metric
          label="conf" value={`${Math.round(u.confidence * 100)} %`}
          title="Probabilité moyenne du jeton effectivement retenu."
        />
      )}
      {tps && (
        <Metric label="débit" value={`${tps.toFixed(1)} jet./s`} title="Jetons générés par seconde." />
      )}
      {s.evalCount && (
        <Metric label="sortie" value={formatNumber(s.evalCount)} title="Jetons produits." />
      )}
      {s.ttft && (
        <Metric label="latence" value={formatMs(s.ttft)} title="Délai avant le premier jeton." />
      )}
      {s.totalDuration && (
        <Metric label="total" value={formatNs(s.totalDuration)} title="Durée totale de la génération." />
      )}
      {s.doneReason === 'arrêté' && <span className="t-caption text-caution">interrompu</span>}
      {s.doneReason === 'length' && <span className="t-caption text-caution">limite atteinte</span>}
    </div>
  )
}

/** Repli d'un contenu derrière un intitulé — utilisé par la vue « Réflexion ». */
function Disclosure({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          't-caption flex h-7 cursor-pointer items-center gap-1.5 rounded-full pr-2.5 pl-3 font-medium transition-colors',
          open ? 'bg-fg/[0.07] text-fg' : 'text-fg-subtle hover:bg-fg/[0.05] hover:text-fg-muted',
        )}
      >
        {label}
        <ChevronRight className={cn('size-3.5 transition-transform duration-200', open && 'rotate-90')} />
      </motion.button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="contenu"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="pt-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Message de l'utilisateur — à droite ──────────────────────────── */

export const UserMessage = memo(function UserMessage({
  message, onEdit, onDelete, disabled, faded,
}: { message: Msg; onEdit: (text: string) => void; onDelete: () => void; disabled?: boolean; faded?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) {
      ref.current?.focus()
      ref.current?.setSelectionRange(draft.length, draft.length)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  const submit = () => {
    const t = draft.trim()
    setEditing(false)
    if (t && t !== message.content) onEdit(t)
    else setDraft(message.content)
  }

  if (editing) {
    return (
      <motion.div {...ENTER} className="flex justify-end">
        <div className="w-full max-w-[86%] rounded-lg bg-surface p-4 shadow-card">
          <textarea
            ref={ref}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setEditing(false); setDraft(message.content) }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
            }}
            rows={Math.min(14, draft.split('\n').length + 1)}
            className="t-body w-full resize-none bg-transparent text-fg outline-none scroll-thin"
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <span className="t-caption mr-auto text-fg-subtle">La suite sera régénérée.</span>
            <Button variant="soft" size="sm" onClick={() => { setEditing(false); setDraft(message.content) }}>
              Annuler
            </Button>
            <Button variant="primary" size="sm" onClick={submit}>Envoyer</Button>
          </div>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div {...ENTER} className={cn('group/msg flex flex-col items-end gap-1', faded && 'opacity-55')}>
      <div className="max-w-[86%] rounded-lg rounded-br-sm bg-surface-2 px-4 py-3">
        <p className="t-body whitespace-pre-wrap text-fg">{message.content}</p>
      </div>
      <div className="flex h-7 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100 focus-within:opacity-100">
        <span className="t-caption mr-1 text-fg-subtle">{shortTime(message.createdAt)}</span>
        <MorphButton idle={Copy} hover={Check} size="icon-sm" title="Copier"
          onClick={() => navigator.clipboard.writeText(message.content)} />
        <MorphButton idle={Pencil} hover={Pencil} size="icon-sm" title="Modifier et renvoyer"
          disabled={disabled} onClick={() => setEditing(true)} />
        <ShakeButton icon={Trash2} size="icon-sm" title="Supprimer" disabled={disabled} onClick={onDelete} />
      </div>
    </motion.div>
  )
})

/* ── Message du modèle — à gauche ─────────────────────────────────── */

function ModelLabel({ model, at }: { model?: string; at: number }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="flex size-5 items-center justify-center rounded-full bg-fg/[0.06]">
        <Sparkles className="size-3 text-fg-muted" strokeWidth={2} />
      </span>
      <span className="t-caption max-w-60 truncate font-bold text-fg">{model ? prettyModel(model) : 'Modèle'}</span>
      <span className="t-caption text-fg-subtle">{shortTime(at)}</span>
    </div>
  )
}

export const AssistantMessage = memo(function AssistantMessage({
  message, showStats, canRegenerate, onRegenerate, onContinue, onDelete, disabled, transcript = 'normal', faded,
}: {
  message: Msg
  faded?: boolean
  showStats: boolean
  canRegenerate: boolean
  onRegenerate: () => void
  onContinue?: () => void
  onDelete: () => void
  disabled?: boolean
  transcript?: Transcript
}) {
  /* Normale : raisonnement replié. Réflexion : raisonnement ouvert, réponse
     repliée. Détaillée : tout est ouvert. Les mesures, elles, restent toujours
     au survol — comme les icônes, et en même temps qu'elles. */
  const focusThinking = transcript === 'thinking' && !!message.thinking
  /* Réponse arrêtée par la limite de jetons : à signaler franchement, pas
     seulement dans les mesures au survol. */
  const truncated = message.stats?.doneReason === 'length' && !message.error

  const body = message.error ? null : <Markdown>{message.content}</Markdown>

  return (
    <motion.div {...ENTER} className={cn('group/msg max-w-[94%]', faded && 'opacity-55')}>
      <ModelLabel model={message.model} at={message.createdAt} />
      {message.thinking && <Thinking text={message.thinking} defaultOpen={transcript !== 'normal'} />}

      {message.error ? (
        <div className="flex items-start gap-3 rounded-sm bg-negative-wash px-4 py-3.5">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-negative" />
          <div className="min-w-0">
            <p className="t-ui text-negative">La génération a échoué</p>
            <p className="t-meta mt-1 break-words text-fg-muted">{message.error}</p>
            {message.content && <div className="mt-3"><Markdown>{message.content}</Markdown></div>}
          </div>
        </div>
      ) : focusThinking ? (
        <Disclosure label="Afficher la réponse">{body}</Disclosure>
      ) : (
        body
      )}

      {truncated && onContinue && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-sm bg-caution-wash px-4 py-3">
          <TriangleAlert className="size-4 shrink-0 text-caution" />
          <p className="t-caption min-w-0 flex-1 text-fg-muted">
            Réponse interrompue : la limite de longueur a été atteinte.
          </p>
          <Button variant="soft" size="sm" disabled={disabled} onClick={onContinue}>
            <CornerDownRight className="size-4" />
            Continuer
          </Button>
        </div>
      )}

      {/* Icônes et mesures partagent le même révélateur : elles apparaissent
          et disparaissent ensemble au survol du message. */}
      <div className="mt-2.5 flex h-7 flex-wrap items-center gap-x-4 opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100 focus-within:opacity-100">
        <div className="-ml-2 flex items-center gap-0.5">
          <MorphButton idle={Copy} hover={Check} size="icon-sm" title="Copier"
            onClick={() => navigator.clipboard.writeText(message.content)} />
          {canRegenerate && <SpinButton icon={RefreshCw} size="icon-sm" title="Régénérer" onClick={onRegenerate} />}
          <ShakeButton icon={Trash2} size="icon-sm" title="Supprimer" disabled={disabled} onClick={onDelete} />
        </div>
        {showStats && !message.error && <Metrics m={message} />}
      </div>
    </motion.div>
  )
})

/* ── Génération en cours ──────────────────────────────────────────── */

export function StreamingMessage({
  content, thinking, model, startedAt, transcript = 'normal',
}: { content: string; thinking: string; model: string; startedAt: number; transcript?: Transcript }) {
  const waiting = !content && !thinking
  return (
    <motion.div {...ENTER} className="max-w-[94%]">
      <ModelLabel model={model} at={startedAt} />
      {thinking && <Thinking text={thinking} live={!content} defaultOpen={transcript !== 'normal'} />}
      {waiting ? (
        <p className="t-meta flex h-6 items-center gap-2 text-fg-subtle">
          <span className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="size-1.5 rounded-full bg-fg-subtle"
                animate={{ opacity: [0.25, 1, 0.25] }}
                transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.16, ease: 'easeInOut' }}
              />
            ))}
          </span>
          Génération…
        </p>
      ) : (
        <>
          <Markdown>{content}</Markdown>
          {content && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-caret bg-accent align-middle" />}
        </>
      )}
    </motion.div>
  )
}
