import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useUI } from '../../store/ui'
import { cn } from '../../lib/utils'

export function Toasts() {
  const { toasts, dismiss } = useUI()
  if (!toasts.length) return null
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-80 flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex animate-fade-up items-start gap-3 rounded-sm border px-4 py-3.5 shadow-float',
            t.tone === 'danger' ? 'border-danger/25 bg-negative-wash' : 'border-line bg-surface',
          )}
        >
          <span className={cn('mt-0.5 shrink-0', t.tone === 'danger' ? 'text-danger' : t.tone === 'success' ? 'text-positive' : 'text-fg-subtle')}>
            {t.tone === 'danger' ? <AlertTriangle size={16} /> : t.tone === 'success' ? <CheckCircle2 size={16} /> : <Info size={16} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] leading-tight font-medium">{t.title}</p>
            {t.description && <p className="mt-1 text-[12px] leading-snug break-words text-fg-muted">{t.description}</p>}
          </div>
          <button onClick={() => dismiss(t.id)} className="shrink-0 text-fg-subtle transition-colors hover:text-fg">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
