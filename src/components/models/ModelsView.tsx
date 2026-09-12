import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Boxes, Brain, Eye, HardDrive, MessageSquare,
  MessageSquarePlus, PowerOff, RefreshCw, Trash2, Wrench,
} from 'lucide-react'
import { createConversation } from '../../lib/db'
import { modelOwner, ollama, prettyModel, suggestedContext } from '../../lib/ollama'
import type { OllamaModel } from '../../lib/types'
import { cn, formatBytes, formatNumber, relativeTime } from '../../lib/utils'
import { useModels } from '../../store/models'
import { downloadFor, useDownloads } from '../../store/downloads'
import { DownloadRow } from './DownloadRow'
import { ModelBrowser } from './ModelBrowser'
import { Maintenance } from './Maintenance'
import { toast } from '../../store/ui'
import { Badge, Button, ConfirmModal, Tooltip } from '../ui/primitives'
import { href, navigate } from '../../lib/router'

const CAPABILITIES: Record<string, { label: string; icon: React.ReactNode }> = {
  completion: { label: 'Texte', icon: <MessageSquare className="size-3" /> },
  vision: { label: 'Vision', icon: <Eye className="size-3" /> },
  tools: { label: 'Outils', icon: <Wrench className="size-3" /> },
  thinking: { label: 'Réflexion', icon: <Brain className="size-3" /> },
  embedding: { label: 'Vecteurs', icon: <Boxes className="size-3" /> },
  insert: { label: 'Insertion', icon: <MessageSquarePlus className="size-3" /> },
}

/** File des téléchargements — sous la liste des modèles, toujours visible. */
function Downloads() {
  const items = useDownloads((s) => s.items)
  const list = Object.values(items).sort((a, b) => a.startedAt - b.startedAt)
  if (!list.length) return null

  return (
    <section className="overflow-hidden rounded-lg bg-surface shadow-card">
      <header className="flex items-center gap-2 border-b border-line px-5 py-3">
        <h2 className="t-label text-fg-subtle">Téléchargements</h2>
        <span className="t-caption text-fg-subtle">{list.length} en cours</span>
      </header>
      <AnimatePresence initial={false}>
        {list.map((dl, i) => (
          <div key={dl.model} className={cn(i > 0 && 'border-t border-line')}>
            <DownloadRow dl={dl} />
          </div>
        ))}
      </AnimatePresence>
    </section>
  )
}

function ModelCard({ model, loaded }: { model: OllamaModel; loaded?: OllamaModel }) {
  const refresh = useModels((s) => s.refresh)
  const dl = useDownloads((s) => downloadFor(s.items, model.name))
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const owner = modelOwner(model.name)

  return (
    <article
      className={cn(
        'flex h-full flex-col rounded-lg border bg-surface p-6 transition-all duration-200',
        loaded ? 'border-positive/45 shadow-card' : 'border-line hover:shadow-card',
      )}
    >
      {/* Hauteur fixe : le titre sur une ou deux lignes ne décale pas les cartes voisines. */}
      <header className="flex min-h-11 items-start justify-between gap-3">
        <div className="min-w-0">
          {owner && <p className="truncate text-[11px] leading-tight text-fg-subtle">{owner}</p>}
          <h3 className="truncate text-[15px] leading-tight font-bold tracking-[-0.02em]">{prettyModel(model.name)}</h3>
        </div>
        {loaded && (
          <Tooltip
            label={`En mémoire · ${formatBytes(loaded.size_vram)}${loaded.expires_at ? ` · libéré ${relativeTime(new Date(loaded.expires_at).getTime())}` : ''}`}
            side="left"
          >
            <span className="mt-1.5 flex size-2 shrink-0 rounded-full bg-positive" />
          </Tooltip>
        )}
      </header>

      {/* Deux rangées de badges réservées : au-delà, la carte ne bouge plus. */}
      <div className="mt-4 flex min-h-14 flex-wrap content-start gap-1.5">
        {model.details?.parameter_size && <Badge>{model.details.parameter_size}</Badge>}
        {model.details?.quantization_level && model.details.quantization_level !== 'unknown' && (
          <Badge>{model.details.quantization_level}</Badge>
        )}
        {(model.capabilities ?? []).map((c) => {
          const meta = CAPABILITIES[c]
          return (
            <Badge key={c} variant="outline">
              {meta?.icon}
              {meta?.label ?? c}
            </Badge>
          )
        })}
      </div>

      <dl className="mt-4 space-y-2 text-[13px]">
        <div className="flex justify-between">
          <dt className="text-fg-subtle">Disque</dt>
          <dd className="font-mono tabular-nums">{formatBytes(model.size)}</dd>
        </div>
        {!!model.details?.context_length && (
          <div className="flex justify-between">
            <dt className="text-fg-subtle">Contexte</dt>
            <dd className="font-mono tabular-nums">{formatNumber(model.details.context_length)}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-fg-subtle">Ajouté</dt>
          <dd>{relativeTime(new Date(model.modified_at).getTime())}</dd>
        </div>
      </dl>

      <div className="h-5" />

      {dl && (
        <div className="mt-4 border-t border-line pt-4">
          <DownloadRow dl={dl} compact />
        </div>
      )}

      <footer className="mt-auto flex items-center gap-2 border-t border-line pt-5">
        <Button
          variant="soft" size="sm" className="flex-1"
          onClick={async () =>
            navigate(href.conversation(await createConversation({
              model: model.name,
              params: { num_ctx: suggestedContext(model) },
            })))
          }
        >
          <MessageSquarePlus size={16} /> Discuter
        </Button>
        {loaded && (
          <Tooltip label="Libérer la mémoire">
            <Button
              size="icon-sm" disabled={busy}
              onClick={async () => {
                setBusy(true)
                try { await ollama.unload(model.name); await refresh() } finally { setBusy(false) }
              }}
            >
              <PowerOff size={16} />
            </Button>
          </Tooltip>
        )}
        <Tooltip label="Supprimer du disque">
          <Button size="icon-sm" onClick={() => setConfirm(true)}><Trash2 size={16} /></Button>
        </Tooltip>
      </footer>

      <ConfirmModal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Supprimer ${prettyModel(model.name)} ?`}
        description={`${formatBytes(model.size)} seront libérés sur le disque.`}
        confirmLabel="Supprimer"
        danger
        onConfirm={async () => {
          try {
            await ollama.remove(model.name)
            toast({ title: 'Modèle supprimé', description: prettyModel(model.name), tone: 'success' })
            await refresh()
          } catch (e) {
            toast({ title: 'Suppression impossible', description: (e as Error).message, tone: 'danger' })
          }
        }}
      />
    </article>
  )
}

export function ModelsView() {
  const { models, running, status, error, version, refresh } = useModels()
  const [spinning, setSpinning] = useState(false)

  useEffect(() => { void refresh() }, [refresh])

  const totalSize = models.reduce((n, m) => n + m.size, 0)
  const vram = running.reduce((n, m) => n + (m.size_vram ?? 0), 0)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-nav px-4">
        <Button size="icon-sm" onClick={() => navigate(href.home())} aria-label="Retour"><ArrowLeft size={16} /></Button>
        <h1 className="text-[15px] font-bold tracking-[-0.02em]">Modèles</h1>
        <span className="text-[13px] text-fg-subtle">
          {models.length} installé{models.length > 1 ? 's' : ''} · {formatBytes(totalSize)}
          {vram > 0 && ` · ${formatBytes(vram)} en mémoire`}
        </span>
        <div className="ml-auto flex items-center gap-3">
          {version && <span className="font-mono text-[12px] text-fg-subtle">Ollama v{version}</span>}
          <Tooltip label="Rafraîchir">
            <Button
              size="icon-sm"
              onClick={async () => { setSpinning(true); await refresh(); setTimeout(() => setSpinning(false), 400) }}
            >
              <RefreshCw size={16} className={cn(spinning && 'animate-spin')} />
            </Button>
          </Tooltip>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-8">
          {status === 'offline' && (
            <div className="flex items-start gap-3 rounded-lg border border-danger/25 bg-negative-wash p-6">
              <HardDrive size={16} className="mt-0.5 shrink-0 text-danger" />
              <div>
                <p className="text-[15px] font-bold text-danger">Ollama est injoignable</p>
                <p className="mt-1 text-[14px] text-fg-muted">{error}</p>
                <p className="mt-2 rounded-sm bg-surface px-3 py-2 font-mono text-[13px] text-fg-muted">ollama serve</p>
              </div>
            </div>
          )}

          <ModelBrowser />
          <Downloads />

          {models.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {models.map((m) => (
                <ModelCard key={m.name} model={m} loaded={running.find((r) => r.name === m.name)} />
              ))}
            </div>
          )}

          <Maintenance />

          {models.length === 0 && status === 'online' && (
            <div className="rounded-lg border border-dashed border-line py-20 text-center">
              <Boxes size={20} className="mx-auto text-fg-subtle" />
              <p className="mt-4 text-[15px] font-medium">Aucun modèle installé</p>
              <p className="mt-1 text-[14px] text-fg-subtle">Téléchargez-en un ci-dessus pour commencer.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
