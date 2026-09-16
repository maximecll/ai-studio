import { useEffect } from 'react'
import { CircleCheck, Download, Globe, Loader2, Trash2, WifiOff } from 'lucide-react'
import { useOnline } from '../../lib/hooks'
import { useSearch } from '../../store/search'
import { Button } from '../ui/primitives'

/** Bloc « Recherche web » : héberge une instance SearXNG locale, respectueuse
    de la vie privée. L'installation est lourde (Python + SearXNG) : elle reste
    volontaire, comme le moteur d'images. */
export function WebSearchSettings() {
  const status = useSearch((s) => s.status)
  const installing = useSearch((s) => s.installing)
  const log = useSearch((s) => s.log)
  const refresh = useSearch((s) => s.refresh)
  const install = useSearch((s) => s.install)
  const reset = useSearch((s) => s.reset)
  const online = useOnline()

  useEffect(() => { void refresh() }, [refresh])

  const installed = !!status?.installed

  return (
    <div className="space-y-4">
      <p className="t-caption leading-relaxed text-fg-muted">
        Une instance <span className="font-mono">SearXNG</span> tourne en local : un métamoteur qui interroge
        plusieurs moteurs sans compte, sans clé, sans traçage. Activez la recherche dans une conversation, et le
        modèle consulte le web avant de répondre, en citant ses sources. Seules les requêtes de recherche quittent
        la machine.
      </p>

      {!online && (
        <p className="t-caption flex items-center gap-2 rounded-sm bg-caution-wash px-3 py-2.5 text-fg-muted">
          <WifiOff className="size-4 shrink-0 text-caution" />
          Hors ligne : la recherche web est bloquée tant qu’Internet n’est pas revenu.
        </p>
      )}

      {status === null ? (
        <p className="t-caption text-fg-subtle">Relevé en cours…</p>
      ) : installed ? (
        <p className="t-caption flex items-center gap-2 rounded-sm bg-surface-2 px-3 py-2.5 text-fg-muted">
          <CircleCheck className="size-4 shrink-0 text-positive" />
          Installée{status.running ? ' et active' : ', démarre à la première recherche'}.
        </p>
      ) : (
        <p className="t-caption flex items-start gap-2 rounded-sm bg-surface-2 px-3 py-2.5 text-fg-muted">
          <Globe className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
          <span className="min-w-0">
            Pas encore installée. L’installation télécharge Python (si absent) et SearXNG, comptez quelques
            minutes et ≈ 200 Mo.
          </span>
        </p>
      )}

      {installing && (
        <div className="space-y-2 rounded-sm bg-surface-2 px-3 py-2.5">
          <p className="t-caption flex items-center gap-2 text-fg-muted">
            <Loader2 className="size-4 shrink-0 animate-spin" />
            {installing}…
          </p>
          {log.length > 0 && (
            <pre className="max-h-24 overflow-hidden font-mono text-[11px] leading-snug text-fg-subtle">
              {log.join('\n')}
            </pre>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!installed && (
          <Button variant="primary" size="sm" disabled={!!installing} onClick={() => void install()}>
            <Download className="size-4" />
            Installer la recherche web
          </Button>
        )}
        {(installed || status?.partial) && (
          <Button variant="soft" size="sm" className="text-danger" disabled={!!installing} onClick={() => void reset()}>
            <Trash2 className="size-4" />
            Retirer
          </Button>
        )}
      </div>
    </div>
  )
}
