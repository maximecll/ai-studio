import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ImageIcon, X } from 'lucide-react'
import { useImageURL } from '../../lib/hooks'
import type { Pending } from '../../lib/attachments'
import type { Attachment } from '../../lib/types'
import { cn, formatBytes } from '../../lib/utils'

/* ── Aperçu plein écran ───────────────────────────────────────────── */

function Preview({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  const url = useImageURL(attachment.blobId)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-80 flex flex-col items-center justify-center p-6 sm:p-10">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 bg-black/80 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.99 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        role="dialog"
        aria-modal
        aria-label={attachment.name}
        className="relative flex min-h-0 flex-col items-center gap-3"
      >
        {url ? (
          <img src={url} alt={attachment.name} className="max-h-[78vh] max-w-full rounded-lg object-contain shadow-float" />
        ) : (
          <span className="t-caption rounded-lg bg-surface px-6 py-10 text-fg-subtle">Image indisponible.</span>
        )}
        <span className="t-caption max-w-full truncate text-fg-muted">
          {attachment.name} · {formatBytes(attachment.size)}
        </span>
      </motion.div>
      <button
        onClick={onClose}
        aria-label="Fermer l’aperçu"
        className="absolute top-5 right-5 flex size-9 cursor-pointer items-center justify-center rounded-full bg-surface text-fg-muted transition-colors hover:text-fg"
      >
        <X className="size-4" />
      </button>
    </div>,
    document.body,
  )
}

/* ── Badges sous un message ───────────────────────────────────────── */

function Vignette({ blobId }: { blobId: string }) {
  const url = useImageURL(blobId)
  return url
    ? <img src={url} alt="" className="size-5 shrink-0 rounded-sm object-cover" />
    : <ImageIcon className="size-3.5 shrink-0 text-fg-subtle" />
}

/** Le nom du fichier, cliquable : l'aperçu s'ouvre par-dessus la conversation. */
export function AttachmentBadges({ attachments, align = 'end' }: { attachments: Attachment[]; align?: 'start' | 'end' }) {
  const [ouverte, setOuverte] = useState<Attachment | null>(null)

  return (
    <>
      <div className={cn('flex flex-wrap gap-1.5', align === 'end' ? 'justify-end' : 'justify-start')}>
        {attachments.map((a) => (
          <button
            key={a.blobId}
            onClick={() => setOuverte(a)}
            title={`${a.name} · ${formatBytes(a.size)}`}
            className={cn(
              'flex max-w-56 cursor-pointer items-center gap-2 rounded-full bg-surface-2 py-1 pr-3 pl-1',
              'text-fg-muted transition-colors hover:bg-fg/[0.08] hover:text-fg',
            )}
          >
            <Vignette blobId={a.blobId} />
            <span className="t-caption min-w-0 truncate">{a.name}</span>
          </button>
        ))}
      </div>
      <AnimatePresence>
        {ouverte && <Preview attachment={ouverte} onClose={() => setOuverte(null)} />}
      </AnimatePresence>
    </>
  )
}

/* ── Fichiers en attente, dans le composeur ───────────────────────── */

export function PendingStrip({ items, onRemove }: { items: Pending[]; onRemove: (id: string) => void }) {
  if (!items.length) return null
  return (
    <div className="flex flex-wrap gap-2 px-5 pt-4">
      {items.map((p) => (
        <span
          key={p.id}
          className="group/piece flex max-w-56 items-center gap-2 rounded-full bg-surface-2 py-1 pr-1 pl-1"
        >
          <img src={p.url} alt="" className="size-6 shrink-0 rounded-full object-cover" />
          <span className="t-caption min-w-0 truncate text-fg-muted">{p.file.name}</span>
          <button
            onClick={() => onRemove(p.id)}
            aria-label={`Retirer ${p.file.name}`}
            className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-fg-subtle transition-colors hover:bg-fg/[0.08] hover:text-fg"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  )
}
