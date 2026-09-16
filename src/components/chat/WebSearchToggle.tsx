import { useEffect } from 'react'
import { Globe } from 'lucide-react'
import { useOnline } from '../../lib/hooks'
import { href, navigate } from '../../lib/router'
import { useSearch } from '../../store/search'
import { cn } from '../../lib/utils'
import { Chip, Tooltip } from '../ui/primitives'

/** Bascule « Recherche web », contrôlée : le fil (ou l'accueil) consulte SearXNG
    avant de répondre. Tant que rien n'est installé, le clic mène aux Réglages ;
    hors ligne, elle est bloquée, la recherche ayant besoin d'Internet. */
export function WebSearchToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const status = useSearch((s) => s.status)
  const refresh = useSearch((s) => s.refresh)
  const online = useOnline()
  useEffect(() => { void refresh() }, [refresh])

  const installed = !!status?.installed
  const bloque = !online

  const clic = () => {
    if (bloque) return
    if (!installed) return navigate(href.settings())
    onToggle()
  }

  const infobulle = bloque
    ? 'Recherche web indisponible hors ligne'
    : installed
      ? (on ? 'Recherche web active' : 'Activer la recherche web')
      : 'Installer la recherche web (Réglages)'

  return (
    <Tooltip label={infobulle} side="top">
      <Chip
        as="button"
        active={on && !bloque}
        onClick={clic}
        aria-disabled={bloque}
        className={cn('min-w-0 shrink-0', bloque && 'cursor-not-allowed opacity-45')}
      >
        <Globe className={cn('size-3.5 shrink-0', (!installed || bloque) && 'text-fg-subtle')} />
        <span className="max-w-28 truncate">{bloque ? 'Hors ligne' : 'Web'}</span>
      </Chip>
    </Tooltip>
  )
}
