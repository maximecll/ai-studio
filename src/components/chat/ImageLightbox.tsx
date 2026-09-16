import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'

/** Aperçu plein écran, pièces jointes comme images produites. */
export function ImageLightbox({
  url, label, caption, onClose,
}: {
  url: string | null
  label: string
  /** Ligne sous l'image : nom et poids, ou description et dimensions. */
  caption?: string
  onClose: () => void
}) {
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
        aria-label={label}
        className="relative flex min-h-0 flex-col items-center gap-3"
      >
        {url ? (
          <img src={url} alt={label} className="max-h-[82vh] max-w-full rounded-lg object-contain shadow-float" />
        ) : (
          <span className="t-caption rounded-lg bg-surface px-6 py-10 text-fg-subtle">Image indisponible.</span>
        )}
        {caption && <span className="t-caption max-w-full truncate text-fg-muted">{caption}</span>}
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
