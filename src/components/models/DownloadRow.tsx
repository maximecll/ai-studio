import { motion } from 'framer-motion'
import { Check, Loader2, TriangleAlert, X } from 'lucide-react'
import type { Download } from '../../store/downloads'
import { useDownloads } from '../../store/downloads'
import { cn, formatBytes, formatEta, formatRate } from '../../lib/utils'
import { prettyModel } from '../../lib/ollama'
import { Button } from '../ui/primitives'

function Bar({ pct, tone }: { pct: number; tone: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-fg/[0.08]">
      <motion.div
        className={cn('h-full rounded-full', tone)}
        initial={false}
        animate={{ width: `${Math.max(1.5, pct)}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 26 }}
      />
    </div>
  )
}

/** Avancement d'un téléchargement. */
export function DownloadRow({ dl, compact }: { dl: Download; compact?: boolean }) {
  const { cancel, dismiss } = useDownloads()
  const pct = dl.total > 0 ? (dl.completed / dl.total) * 100 : 0
  const running = dl.phase !== 'done' && dl.phase !== 'error'
  const tone = dl.phase === 'error' ? 'bg-negative' : dl.phase === 'done' ? 'bg-positive' : 'bg-fg/45'

  if (compact) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="t-caption flex items-center gap-1.5 text-fg-muted">
            {running && <Loader2 className="size-3 animate-spin" />}
            {dl.label}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-fg-subtle">
            {dl.total > 0 ? `${pct.toFixed(0)} %` : '…'}
          </span>
        </div>
        <Bar pct={pct} tone={tone} />
        {dl.total > 0 && (
          <div className="flex items-baseline justify-between font-mono text-[11px] tabular-nums text-fg-subtle">
            <span>{formatBytes(dl.completed)} / {formatBytes(dl.total)}</span>
            {running && <span>{formatEta(dl.eta)}</span>}
          </div>
        )}
      </div>
    )
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className="space-y-2.5 px-5 py-4"
    >
      <div className="flex items-center gap-3">
        <span className="shrink-0">
          {dl.phase === 'done' ? (
            <Check className="size-4 text-positive" />
          ) : dl.phase === 'error' ? (
            <TriangleAlert className="size-4 text-negative" />
          ) : (
            <Loader2 className="size-4 animate-spin text-fg-muted" />
          )}
        </span>
        <span className="t-ui min-w-0 flex-1 truncate font-bold text-fg">{prettyModel(dl.model)}</span>
        <span className="t-caption shrink-0 text-fg-muted">{dl.label}</span>
        <Button
          size="icon-sm"
          onClick={() => (running ? cancel(dl.model) : dismiss(dl.model))}
          aria-label={running ? 'Annuler' : 'Masquer'}
        >
          <X className="size-4" />
        </Button>
      </div>

      <Bar pct={pct} tone={tone} />

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums text-fg-subtle">
        {dl.total > 0 ? (
          <>
            <span className="font-bold text-fg">{pct.toFixed(1)} %</span>
            <span>{formatBytes(dl.completed)} sur {formatBytes(dl.total)}</span>
            {running && <span>{formatRate(dl.speed)}</span>}
            {running && <span>reste {formatEta(dl.eta)}</span>}
          </>
        ) : (
          <span>{running ? 'Négociation avec le registre…' : '—'}</span>
        )}
        {dl.error && <span className="text-negative">{dl.error}</span>}
      </div>
    </motion.div>
  )
}
