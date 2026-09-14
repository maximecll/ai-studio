import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Cpu, Download, Loader2, TriangleAlert } from 'lucide-react'
import { installOllama, setupStatus, type SetupStatus } from '../../lib/setup'
import { cn, formatBytes, formatEta, formatRate } from '../../lib/utils'
import { useModels } from '../../store/models'
import { toast } from '../../store/ui'
import { Button } from '../ui/primitives'

interface Avancement {
  label: string
  completed: number
  total: number
  speed: number
  eta: number | null
}

/** Ollama manquant : on l'installe depuis l'interface, sans terminal. */
export function OllamaSetup({ onReady }: { onReady?: () => void }) {
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [avancement, setAvancement] = useState<Avancement | null>(null)
  const refresh = useModels((s) => s.refresh)

  useEffect(() => { void setupStatus().then(setStatus).catch(() => setStatus(null)) }, [])

  const installer = async () => {
    setAvancement({ label: 'Préparation', completed: 0, total: 0, speed: 0, eta: null })
    try {
      for await (const ev of installOllama()) {
        if (ev.type === 'phase') setAvancement((a) => ({ ...(a ?? { completed: 0, total: 0, speed: 0, eta: null }), label: ev.label }))
        if (ev.type === 'progress') {
          setAvancement((a) => ({ label: a?.label ?? 'Téléchargement', completed: ev.completed, total: ev.total, speed: ev.speed, eta: ev.eta }))
        }
        if (ev.type === 'error') {
          toast({ title: 'Installation impossible', description: ev.message, tone: 'danger' })
          setAvancement(null)
          return
        }
        if (ev.type === 'done') {
          toast({ title: 'Ollama est prêt', tone: 'success' })
          setAvancement(null)
          await refresh()
          setStatus(await setupStatus().catch(() => null))
          onReady?.()
          return
        }
      }
    } catch (e) {
      toast({ title: 'Installation impossible', description: (e as Error).message, tone: 'danger' })
      setAvancement(null)
    }
  }

  if (!status || status.ollamaRunning) return null

  const ratio = avancement && avancement.total > 0 ? avancement.completed / avancement.total : 0

  return (
    <section className="rounded-lg bg-surface p-6 shadow-card">
      <div className="flex items-start gap-3">
        <Cpu className="mt-0.5 size-4 shrink-0 text-caution" />
        <div className="min-w-0 flex-1">
          <h2 className="t-ui font-bold text-fg">Ollama n’est pas démarré</h2>
          <p className="t-meta mt-1.5 text-fg-muted">
            C’est le moteur qui fait tourner vos modèles de langage. AI Studio peut l’installer pour
            vous : une archive portable est déposée dans le dossier du projet, sans droit
            administrateur et sans rien modifier ailleurs sur la machine.
          </p>
          {status.gpu && (
            <p className="t-caption mt-2 text-fg-subtle">
              Détecté : {status.gpu.name}
              {status.gpu.cores ? ` · ${status.gpu.cores} cœurs` : ''}
              {status.gpu.vram > 0 ? ` · ${formatBytes(status.gpu.vram)} ${status.gpu.unified ? 'de mémoire unifiée' : 'de VRAM'}` : ''}
            </p>
          )}
        </div>
      </div>

      {!status.supported ? (
        <p className="t-meta mt-4 flex items-start gap-2 rounded-sm bg-caution-wash px-3 py-2.5 text-fg-muted">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-caution" />
          Système non pris en charge ({status.platform} {status.arch}). Installez Ollama depuis ollama.com.
        </p>
      ) : avancement ? (
        <div className="mt-5">
          <div className="flex items-center gap-3">
            <span className="t-caption flex min-w-0 flex-1 items-center gap-2 text-fg-muted">
              <Loader2 className="size-4 shrink-0 animate-spin" />
              {avancement.label}
            </span>
            {avancement.total > 0 && (
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-subtle">
                {formatBytes(avancement.completed)} / {formatBytes(avancement.total)}
              </span>
            )}
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-fg/[0.08]">
            <motion.span
              className={cn('block h-full rounded-full bg-fg/45')}
              animate={{ width: `${Math.max(2, ratio * 100)}%` }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            />
          </div>
          {avancement.speed > 0 && (
            <p className="mt-1.5 font-mono text-[11px] tabular-nums text-fg-subtle">
              {formatRate(avancement.speed)} · {formatEta(avancement.eta)} restant
            </p>
          )}
        </div>
      ) : (
        <Button variant="primary" size="sm" className="mt-5" onClick={() => void installer()}>
          <Download className="size-4" />
          {status.ollamaLocal ? 'Démarrer Ollama' : `Installer Ollama (${status.asset?.includes('windows') || status.asset?.includes('linux') ? '≈ 1,5 Go' : '≈ 160 Mo'})`}
        </Button>
      )}
    </section>
  )
}
