import { memo, useCallback, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Copy, Download, Image as ImageIcon, RefreshCw, Square, Trash2, TriangleAlert } from 'lucide-react'
import type { Message as Msg } from '../../lib/types'
import { useImageURL } from '../../lib/hooks'
import { cn, formatBytes, formatMs, shortTime } from '../../lib/utils'
import { jobCaption, type Job } from '../../store/images'
import { Button, MorphButton, ShakeButton, SpinButton, Tooltip } from '../ui/primitives'
import { MosaicReveal } from './MosaicReveal'

const ENTER = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { type: 'spring' as const, stiffness: 380, damping: 32 },
}

/** Au-delà, une image occuperait toute la colonne au détriment du fil. */
const MAX_WIDTH = 520
/** Borne de hauteur : un carré tiré à 520 px écrasait tout ce qui l'entoure,
    alors qu'un 16:9 à la même largeur reste sage. */
const MAX_HEIGHT = 360

/** Largeur d'affichage, bornée dans les deux sens par le format demandé. */
function frameWidth(aspect: number): number {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  return Math.round(Math.min(MAX_WIDTH, MAX_HEIGHT * ratio))
}

function Header({ name, at }: { name: string; at: number }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="flex size-5 items-center justify-center rounded-full bg-fg/[0.06]">
        <ImageIcon className="size-3 text-fg-muted" strokeWidth={2} />
      </span>
      <span className="t-caption max-w-60 truncate font-bold text-fg">{name}</span>
      <span className="t-caption text-fg-subtle">{shortTime(at)}</span>
    </div>
  )
}

function Metric({ label, value, title }: { label: string; value: string; title: string }) {
  return (
    <Tooltip label={title} side="top">
      <span className="flex cursor-default items-baseline gap-1">
        <span className="text-[11px] font-medium text-fg-subtle">{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-fg-muted">{value}</span>
      </span>
    </Tooltip>
  )
}

/* ── Génération en cours ──────────────────────────────────────────── */

/** La mosaïque tient la place de l'image jusqu'à ce qu'elle existe, puis la révèle. */
export function GeneratingImage({ job, onCancel, onRevealed }: { job: Job; onCancel: () => void; onRevealed: () => void }) {
  const aspect = job.width / job.height
  return (
    <motion.div {...ENTER} className="group/msg max-w-[94%]">
      <Header name={job.modelName} at={job.startedAt} />
      <div style={{ maxWidth: frameWidth(aspect) }}>
        <MosaicReveal
          src={job.src ?? null}
          alt={job.prompt}
          aspect={aspect}
          caption={jobCaption(job)}
          onRevealComplete={onRevealed}
        />
      </div>
      <div className="mt-2.5 flex h-7 items-center gap-4">
        {job.phase !== 'revealing' && (
          <Button variant="soft" size="icon-sm" onClick={onCancel} title="Arrêter" aria-label="Arrêter">
            <Square className="size-3 fill-current" />
          </Button>
        )}
        <span className="t-caption text-fg-subtle">
          {job.width} × {job.height} · {job.steps} pas
        </span>
      </div>
    </motion.div>
  )
}

/* ── Image produite ───────────────────────────────────────────────── */

export const ImageMessage = memo(function ImageMessage({
  message, showStats, canRegenerate, onRegenerate, onDelete, disabled, faded,
}: {
  message: Msg
  faded?: boolean
  showStats: boolean
  canRegenerate: boolean
  onRegenerate: () => void
  onDelete: () => void
  disabled?: boolean
}) {
  const meta = message.image!
  const url = useImageURL(meta.blobId)
  const [copied, setCopied] = useState(false)

  const copy = useCallback(async () => {
    if (!url) return
    try {
      const blob = await (await fetch(url)).blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      // Le presse-papiers refuse les images hors contexte sécurisé : on se rabat
      // sur la description, qui a au moins une valeur.
      await navigator.clipboard.writeText(meta.prompt).catch(() => undefined)
    }
  }, [url, meta.prompt])

  const save = useCallback(() => {
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = `studio-${meta.seed}.png`
    a.click()
  }, [url, meta.seed])

  if (message.error) {
    return (
      <motion.div {...ENTER} className={cn('group/msg max-w-[94%]', faded && 'opacity-55')}>
        <Header name={meta?.modelName ?? 'Image'} at={message.createdAt} />
        <div className="flex items-start gap-3 rounded-sm bg-negative-wash px-4 py-3.5">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-negative" />
          <div className="min-w-0">
            <p className="t-ui text-negative">L’image n’a pas pu être produite</p>
            <p className="t-meta mt-1 break-words text-fg-muted">{message.error}</p>
          </div>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div {...ENTER} className={cn('group/msg max-w-[94%]', faded && 'opacity-55')}>
      <Header name={meta.modelName} at={message.createdAt} />

      <div style={{ maxWidth: frameWidth(meta.width / meta.height) }}>
        {url ? (
          <img
            src={url}
            alt={meta.prompt}
            width={meta.width}
            height={meta.height}
            className="block w-full rounded-lg"
            style={{ aspectRatio: meta.width / meta.height }}
          />
        ) : (
          /* Coffre fermé, ou lecture en cours : on tient la place sans rien montrer. */
          <div
            className="flex w-full items-center justify-center rounded-lg bg-surface-2"
            style={{ aspectRatio: meta.width / meta.height }}
          >
            <span className="t-caption text-fg-subtle">Image verrouillée</span>
          </div>
        )}
      </div>

      {/* Icônes et mesures partagent le même révélateur, comme pour le texte. */}
      <div className="mt-2.5 flex h-7 flex-wrap items-center gap-x-4 opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100 focus-within:opacity-100">
        <div className="-ml-2 flex items-center gap-0.5">
          <MorphButton idle={Copy} hover={Check} size="icon-sm" title="Copier l’image" done={copied} onClick={copy} />
          <MorphButton idle={Download} hover={Check} size="icon-sm" title="Enregistrer" onClick={save} />
          {canRegenerate && (
            <SpinButton icon={RefreshCw} size="icon-sm" title="Régénérer avec une autre graine" onClick={onRegenerate} />
          )}
          <ShakeButton icon={Trash2} size="icon-sm" title="Supprimer" disabled={disabled} onClick={onDelete} />
        </div>
        {showStats && (
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
            <Metric
              label="taille" value={`${meta.width}×${meta.height}`}
              title="Dimensions de l’image, en pixels."
            />
            <Metric label="pas" value={String(meta.steps)} title="Pas de débruitage effectués." />
            {meta.guidance != null && (
              <Metric
                label="guidage" value={meta.guidance.toFixed(1)}
                title="Fidélité à la description : plus c’est haut, moins le modèle s’écarte."
              />
            )}
            <Metric
              label="graine" value={String(meta.seed)}
              title="Graine aléatoire. La même graine et la même description redonnent la même image."
            />
            {meta.loras?.map((l) => (
              <Metric
                key={l.file}
                label="lora"
                value={`${l.file.replace(/\.safetensors$/i, '')} ${l.scale.toFixed(2)}`}
                title="Adaptateur appliqué, et son dosage. Avec la graine, c’est ce qui rend l’image reproductible."
              />
            ))}
            <Metric label="durée" value={formatMs(meta.ms)} title="Temps total, chargement du modèle compris." />
            <Metric label="poids" value={formatBytes(meta.bytes)} title="Poids du fichier." />
          </div>
        )}
      </div>
    </motion.div>
  )
})
