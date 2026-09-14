/** Moteur d'images — installation, poids, entretien. */
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check, Cpu, Download, FolderOpen, HardDrive, Image as ImageIcon, Layers, Loader2,
  RefreshCw, Trash2, TriangleAlert, X,
} from 'lucide-react'
import { estimate, purgeChunkCache, revealLoras, roughly } from '../../lib/images'
import type { ImageModel, LoraFile } from '../../lib/types'
import { cn, formatBytes, formatEta, formatRate } from '../../lib/utils'
import { useSystemMemory } from '../../lib/hooks'
import { useImages, type Pull } from '../../store/images'
import { toast } from '../../store/ui'
import { Badge, Button, ConfirmModal, Tooltip } from '../ui/primitives'

/** Barre de progression d'un téléchargement de poids. */
function PullRow({ pull, onCancel }: { pull: Pull; onCancel: () => void }) {
  const ratio = pull.total > 0 ? Math.min(1, pull.completed / pull.total) : 0
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="overflow-hidden"
    >
      <div className="pt-3">
        <div className="flex items-center gap-3">
          <span className="t-caption min-w-0 flex-1 truncate text-fg-muted">
            {pull.error ? pull.error : pull.label}
          </span>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-subtle">
            {pull.total > 0 && `${formatBytes(pull.completed)} / ${formatBytes(pull.total)}`}
          </span>
          {!pull.error && (
            <Button size="icon-sm" onClick={onCancel} title="Annuler" aria-label="Annuler">
              <X className="size-4" />
            </Button>
          )}
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-fg/[0.08]">
          <motion.span
            className={cn('block h-full rounded-full', pull.error ? 'bg-negative' : 'bg-fg/45')}
            animate={{ width: `${Math.max(2, ratio * 100)}%` }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          />
        </div>
        {!pull.error && pull.speed > 0 && (
          <p className="mt-1.5 font-mono text-[11px] tabular-nums text-fg-subtle">
            {formatRate(pull.speed)} · {formatEta(pull.eta)} restant · {Math.round(ratio * 100)} %
          </p>
        )}
      </div>
    </motion.div>
  )
}

/** Transfert repéré sur le disque, sans flux pour le décrire. */
function DiskProgress({ model }: { model: ImageModel }) {
  const ratio = model.progress ?? 0
  return (
    <div className="pt-3">
      <div className="flex items-center gap-3">
        <span className="t-caption min-w-0 flex-1 truncate text-fg-muted">
          {model.downloading ? 'Téléchargement en cours' : 'Téléchargement interrompu — reprenable'}
        </span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-subtle">
          {formatBytes(model.onDisk ?? 0)} / {formatBytes(model.bytes)}
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-fg/[0.08]">
        <motion.span
          className={cn('block h-full rounded-full', model.downloading ? 'bg-fg/45' : 'bg-caution')}
          animate={{ width: `${Math.max(2, ratio * 100)}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>
      <p className="mt-1.5 font-mono text-[11px] tabular-nums text-fg-subtle">
        {Math.round(ratio * 100)} %
      </p>
    </div>
  )
}

function ModelRow({ model, first }: { model: ImageModel; first: boolean }) {
  const pull = useImages((s) => s.pulls[model.id])
  const pullModel = useImages((s) => s.pull)
  const cancelPull = useImages((s) => s.cancelPull)
  const remove = useImages((s) => s.remove)
  const [confirm, setConfirm] = useState(false)

  /* Ce que coûtera une image à la définition d'entraînement : la seule
     donnée qui compte vraiment avant de télécharger dix gigaoctets. */
  const wait = roughly(estimate(model.steps.default, 1024, 1024, model.msPerStep768, model.loadMs))
  /* Au-delà de ce que la machine peut offrir, le système tuerait le processus.
     Autant le dire sur la carte, pas seulement au moment de générer. */
  const memory = useSystemMemory()
  const tooHeavy = !!model.needsRam && !!memory && model.needsRam > memory.total - 2_000_000_000

  return (
    <div className={cn('px-5 py-4', !first && 'border-t border-line')}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] leading-tight font-bold tracking-[-0.02em]">{model.name}</h3>
            <span className="font-mono text-[11px] text-fg-subtle">{model.variant}</span>
            {model.installed && <Badge tone="positive">Installé</Badge>}
            {model.recommended && !model.installed && <Badge>Conseillé</Badge>}
            {tooHeavy ? <Badge tone="negative">Trop lourd pour cette machine</Badge>
            : model.heavy && <Badge tone="caution">Lourd</Badge>}
          </div>
          <p className="t-meta mt-1.5 text-fg-muted">{model.note}</p>
          <p className="t-caption mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-fg-subtle">
            <span className="font-mono">{formatBytes(model.bytes)}</span>
            {model.needsRam && (
              <Tooltip label="Mémoire vive occupée pendant la génération — ce qui décide si le modèle tient sur la machine.">
                <span className={cn('cursor-default font-mono', tooHeavy && 'text-negative')}>
                  {formatBytes(model.needsRam)} en mémoire
                </span>
              </Tooltip>
            )}
            <span className="font-mono">{model.steps.default} pas</span>
            <span className="font-mono">{wait} par image en 1024²</span>
            {!model.measured && (
              <Tooltip label="Déduit de la taille du modèle. Le chiffre se précisera après la première image.">
                <span className="t-caption cursor-default text-fg-subtle">estimé</span>
              </Tooltip>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {model.installed ? (
            <Tooltip label="Supprimer les poids du disque">
              <Button size="icon-sm" onClick={() => setConfirm(true)} aria-label="Supprimer">
                <Trash2 className="size-4" />
              </Button>
            </Tooltip>
          ) : model.downloading ? (
            <span className="t-caption flex items-center gap-2 pr-1 text-fg-muted">
              <Loader2 className="size-4 animate-spin" />
              En cours
            </span>
          ) : (
            <Button
              variant="soft" size="sm"
              disabled={!!pull}
              onClick={() => void pullModel(model.id)}
            >
              <Download className="size-4" />
              {model.partial ? 'Reprendre' : 'Télécharger'}
            </Button>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {pull ? (
          <PullRow key={model.id} pull={pull} onCancel={() => cancelPull(model.id)} />
        ) : (model.downloading || model.partial) ? (
          <DiskProgress key={`${model.id}-disk`} model={model} />
        ) : null}
      </AnimatePresence>

      <ConfirmModal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Supprimer ${model.name} ${model.variant} ?`}
        description={`${formatBytes(model.onDisk || model.bytes)} seront libérés. Le modèle pourra être retéléchargé.`}
        confirmLabel="Supprimer"
        danger
        onConfirm={async () => {
          try {
            await remove(model.id)
            toast({ title: 'Modèle d’images supprimé', description: model.name, tone: 'success' })
          } catch (e) {
            toast({ title: 'Suppression impossible', description: (e as Error).message, tone: 'danger' })
          }
        }}
      />
    </div>
  )
}

/** Le moteur n'est pas là : on explique ce qui sera installé, puis on le fait. */
function Install() {
  const install = useImages((s) => s.install)
  const installing = useImages((s) => s.installing)

  return (
    <div className="px-5 py-6">
      <div className="flex items-start gap-3">
        <Cpu className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
        <div className="min-w-0 flex-1">
          <p className="t-ui font-bold">Le moteur d’images n’est pas installé</p>
          <p className="t-meta mt-1.5 text-fg-muted">
            Ollama ne sait pas générer d’images. AI Studio s’appuie donc sur mflux, le portage MLX de FLUX,
            qui tourne nativement sur la puce Apple. L’installation crée un environnement Python à part,
            dans le dossier de l’application — environ 2 Go, sans rien toucher au reste du système.
          </p>
        </div>
      </div>

      {installing ? (
        <div className="mt-4">
          <p className="t-meta flex items-center gap-2 text-fg-muted">
            <Loader2 className="size-4 animate-spin" />
            {installing.label}
          </p>
          {installing.line && (
            <p className="mt-2 truncate rounded-sm bg-surface-2 px-3 py-2 font-mono text-[11px] text-fg-subtle">
              {installing.line}
            </p>
          )}
        </div>
      ) : (
        <Button variant="primary" size="sm" className="mt-4" onClick={() => void install()}>
          <Download className="size-4" />
          Installer le moteur
        </Button>
      )}
    </div>
  )
}

/** Bibliothèque de LoRAs. */
function LoraRow({ lora, first }: { lora: LoraFile; first: boolean }) {
  return (
    <div className={cn('flex items-start gap-3 px-5 py-3.5', !first && 'border-t border-line')}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-[14px] leading-tight font-bold tracking-[-0.02em]">{lora.name}</h3>
          {lora.target ? <Badge>{lora.target}</Badge> : <Badge variant="outline">Architecture indéterminée</Badge>}
          {lora.expert && (
            <Badge variant="outline">{lora.expert === 'high' ? 'bruit élevé' : 'bruit faible'}</Badge>
          )}
        </div>
        <p className="t-caption mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-fg-subtle">
          <span className="font-mono">{formatBytes(lora.bytes)}</span>
          {lora.rank && <span className="font-mono">rang {lora.rank}</span>}
          {lora.width && <span className="font-mono">largeur {lora.width}</span>}
          {/* Déclaration du fichier, gardée pour information : elle est
              souvent fausse, et ne sert jamais à décider. */}
          {lora.architecture && lora.architecture !== lora.target && (
            <Tooltip label="Déclaré dans les métadonnées du fichier. Souvent inexact — l’architecture retenue vient des noms de tenseurs.">
              <span className="cursor-default font-mono opacity-60">déclare {lora.architecture}</span>
            </Tooltip>
          )}
        </p>
        {lora.trigger && (
          <p className="t-caption mt-1 text-fg-muted">
            Déclencheur : <span className="font-mono text-fg">{lora.trigger}</span>
          </p>
        )}
      </div>
      <span className="t-caption shrink-0 truncate pt-0.5 font-mono text-fg-subtle">{lora.file}</span>
    </div>
  )
}

function LoraLibrary() {
  const library = useImages((s) => s.library)
  const folder = useImages((s) => s.loraFolder)
  const refreshLoras = useImages((s) => s.refreshLoras)

  useEffect(() => { void refreshLoras() }, [refreshLoras])

  return (
    <section className="overflow-hidden rounded-lg bg-surface shadow-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-5 py-3">
        <Layers className="size-4 shrink-0 text-fg-subtle" />
        <h2 className="t-label text-fg-subtle">Bibliothèque de LoRAs</h2>
        <span className="t-caption text-fg-subtle">
          {library.length} fichier{library.length > 1 ? 's' : ''}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Tooltip label="Relire le dossier">
            <Button size="icon-sm" onClick={() => void refreshLoras()} aria-label="Relire">
              <RefreshCw className="size-4" />
            </Button>
          </Tooltip>
          <Tooltip label={folder || 'Ouvrir le dossier'}>
            <Button size="icon-sm" onClick={() => void revealLoras()} aria-label="Ouvrir le dossier">
              <FolderOpen className="size-4" />
            </Button>
          </Tooltip>
        </div>
      </header>

      {library.length === 0 ? (
        <div className="px-5 py-6">
          <p className="t-meta text-fg-muted">
            Déposez des fichiers <span className="font-mono">.safetensors</span> dans ce dossier, puis relisez-le.
            Ils deviendront activables dans chaque conversation, indépendamment les unes des autres.
          </p>
          <p className="t-caption mt-2 font-mono text-fg-subtle">{folder}</p>
        </div>
      ) : (
        library.map((l, i) => <LoraRow key={l.file} lora={l} first={i === 0} />)
      )}

      <footer className="border-t border-line px-5 py-3">
        <p className="t-caption text-fg-subtle">
          L’architecture affichée est déduite des noms de tenseurs, pas des métadonnées — celles-ci sont
          régulièrement fausses. La largeur distingue deux tailles d’un même modèle : un adaptateur Wan A14B
          et un Wan 5 B portent les mêmes noms de couches, seule la largeur les sépare.
          L’adaptateur s’applique à l’exécution, sans toucher au modèle : la mémoire ne bouge presque pas, et
          désactiver un LoRA n’exige aucun rechargement.
        </p>
      </footer>
    </section>
  )
}

export function ImageEngine() {
  const engine = useImages((s) => s.engine)
  const probing = useImages((s) => s.probing)
  const refresh = useImages((s) => s.refresh)
  const [purging, setPurging] = useState(false)

  useEffect(() => { void refresh() }, [refresh])

  /* Un téléchargement repéré sur le disque n'émet rien : on relit l'état
     régulièrement tant qu'il avance, et on s'arrête dès qu'il est fini. */
  const active = (engine?.catalog ?? []).some((m) => m.downloading)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => void refresh(), 2000)
    return () => clearInterval(id)
  }, [active, refresh])

  const installed = (engine?.catalog ?? []).filter((m) => m.installed)
  const onDisk = installed.reduce((n, m) => n + (m.onDisk || 0), 0)

  return (
    <section className="overflow-hidden rounded-lg bg-surface shadow-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-5 py-3">
        <ImageIcon className="size-4 shrink-0 text-fg-subtle" />
        <h2 className="t-label text-fg-subtle">Génération d’images</h2>
        {engine?.ready && (
          <span className="t-caption text-fg-subtle">
            {installed.length} modèle{installed.length > 1 ? 's' : ''}
            {onDisk > 0 && ` · ${formatBytes(onDisk)}`}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          {engine?.engine && <span className="font-mono text-[12px] text-fg-subtle">mflux v{engine.engine}</span>}
        </div>
      </header>

      {probing ? (
        <p className="t-meta flex items-center gap-2 px-5 py-6 text-fg-subtle">
          <Loader2 className="size-4 animate-spin" />
          Recherche du moteur…
        </p>
      ) : !engine ? (
        <p className="t-meta px-5 py-6 text-fg-muted">
          Le serveur d’AI Studio ne répond pas. La génération d’images passe par lui : lancez l’application
          depuis son raccourci plutôt que d’ouvrir le fichier directement.
        </p>
      ) : !engine.ready ? (
        <>
          {engine.error && (
            <p className="t-meta flex items-start gap-2 border-b border-line bg-caution-wash px-5 py-3 text-fg-muted">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-caution" />
              {engine.error}
            </p>
          )}
          <Install />
        </>
      ) : (
        <>
          {engine.catalog.map((m, i) => (
            <ModelRow key={m.id} model={m} first={i === 0} />
          ))}

          <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-5 py-3">
            <span className="t-caption flex items-center gap-1.5 text-fg-subtle">
              <HardDrive className="size-3.5" />
              {formatBytes(engine.free ?? 0)} libres sur le disque
            </span>
            {(engine.xet ?? 0) > 0 && (
              <Tooltip label="Cache de morceaux du téléchargement. Il accélère les reprises mais peut être vidé sans rien perdre.">
                <span className="t-caption cursor-default text-fg-subtle">
                  cache de transfert : {formatBytes(engine.xet ?? 0)}
                </span>
              </Tooltip>
            )}
            {(engine.xet ?? 0) > 100_000_000 && (
              <Button
                size="sm" variant="soft" className="ml-auto"
                disabled={purging}
                onClick={async () => {
                  setPurging(true)
                  try {
                    await purgeChunkCache()
                    await refresh()
                    toast({ title: 'Cache de transfert vidé', tone: 'success' })
                  } catch (e) {
                    toast({ title: 'Nettoyage impossible', description: (e as Error).message, tone: 'danger' })
                  } finally {
                    setPurging(false)
                  }
                }}
              >
                {purging ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Vider le cache de transfert
              </Button>
            )}
          </footer>
        </>
      )}
    </section>
  )
}

export { LoraLibrary }
