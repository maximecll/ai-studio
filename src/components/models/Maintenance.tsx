import { useCallback, useEffect, useState } from 'react'
import { Loader2, Sparkles, TriangleAlert } from 'lucide-react'
import { formatBytes } from '../../lib/utils'
import { useDownloads } from '../../store/downloads'
import { toast } from '../../store/ui'
import { Button, ConfirmModal } from '../ui/primitives'

interface Entry { name: string; size: number; fresh: boolean }
interface Plan {
  safe: boolean
  reason?: string
  partials: Entry[]
  orphans: Entry[]
  inUse: number
  reclaimable: number
  busy: boolean
}

/** Entretien du magasin Ollama : morceaux de téléchargements interrompus et blobs qu'aucun modèle ne référence plus. */
export function Maintenance() {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [working, setWorking] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const downloading = useDownloads((s) => Object.keys(s.items).length > 0)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/maintenance/blobs')
      setPlan(await res.json())
    } catch {
      setPlan(null)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (!plan) return null

  if (!plan.safe) {
    return (
      <section className="flex items-start gap-3 rounded-lg border border-caution/30 bg-caution-wash p-6">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-caution" />
        <div>
          <h2 className="t-ui text-fg">Entretien indisponible</h2>
          <p className="t-meta mt-1 text-fg-muted">{plan.reason}</p>
        </div>
      </section>
    )
  }

  const count = plan.partials.length + plan.orphans.length
  if (count === 0) return null

  const bits = [
    plan.partials.length && `${plan.partials.length} morceau${plan.partials.length > 1 ? 'x' : ''} de téléchargement interrompu`,
    plan.orphans.length && `${plan.orphans.length} blob${plan.orphans.length > 1 ? 's' : ''} sans modèle`,
  ].filter(Boolean) as string[]

  return (
    <section className="rounded-lg bg-surface p-6 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="t-section">Entretien du magasin</h2>
          <p className="t-meta mt-1 text-fg-muted">
            {bits.join(' et ')}, <span className="font-bold text-fg">{formatBytes(plan.reclaimable)}</span> récupérables.
          </p>
          <p className="t-caption mt-2 text-fg-subtle">
            Ces fichiers ne servent à aucun modèle installé. Les {formatBytes(plan.inUse)} en service
            ne sont jamais touchés, pas plus qu'un transfert en cours.
          </p>
        </div>

        <Button
          variant="soft"
          size="md"
          className="shrink-0"
          disabled={working || downloading || plan.reclaimable === 0}
          onClick={() => setConfirm(true)}
        >
          {working ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          Nettoyer
        </Button>
      </div>

      {downloading && (
        <p className="t-caption mt-3 text-caution">
          Un téléchargement est en cours : le nettoyage attendra qu'il se termine.
        </p>
      )}

      <ConfirmModal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Libérer ${formatBytes(plan.reclaimable)} ?`}
        description={`${count} fichier${count > 1 ? 's' : ''} seront supprimés du magasin Ollama. Les modèles installés restent intacts.`}
        confirmLabel="Nettoyer"
        danger
        onConfirm={async () => {
          setWorking(true)
          try {
            const res = await fetch('/maintenance/blobs', { method: 'POST' })
            const r = await res.json()
            if (r.error) throw new Error(r.error)
            toast({
              title: `${formatBytes(r.freed)} libérés`,
              description: `${r.removed} fichier${r.removed > 1 ? 's' : ''} supprimé${r.removed > 1 ? 's' : ''}.`,
              tone: 'success',
            })
            await load()
          } catch (e) {
            toast({ title: 'Nettoyage impossible', description: (e as Error).message, tone: 'danger' })
          } finally {
            setWorking(false)
          }
        }}
      />
    </section>
  )
}
