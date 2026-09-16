import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { href, navigate } from '../../lib/router'
import { cn } from '../../lib/utils'
import { Button } from '../ui/primitives'

/** Coque commune aux pages plein écran : Modèles, Réglages, Presets. */
export function Page({
  title, subtitle, actions, children, width = '',
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  width?: string
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-nav px-4">
        <Button size="icon-sm" onClick={() => navigate(href.home())} aria-label="Retour">
          <ArrowLeft size={16} />
        </Button>
        <h1 className="text-[15px] font-bold tracking-[-0.02em]">{title}</h1>
        {subtitle && <span className="t-meta truncate text-fg-subtle">{subtitle}</span>}
        {actions && <div className="ml-auto flex items-center gap-3">{actions}</div>}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div className={cn('w-full px-6 py-8', width)}>{children}</div>
      </div>
    </div>
  )
}
