import { useState } from 'react'
import { CircleAlert, CircleCheck, Download, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { installGit } from '../../lib/setup'
import { useHardware } from '../../lib/hardware'
import { formatBytes } from '../../lib/utils'
import { toast } from '../../store/ui'
import { useUpdate } from '../../store/update'
import { Button } from '../ui/primitives'

function Ligne({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="t-caption text-fg-muted">{label}</span>
      <span className="t-caption min-w-0 text-right text-fg">{children}</span>
    </div>
  )
}

/** Contenu du bloc « Mises à jour » des réglages. L'état vient du même
    magasin que la fenêtre bloquante : rafraîchir ici la fait apparaître. */
export function UpdateSettings() {
  const status = useUpdate((s) => s.status)
  const chargement = useUpdate((s) => s.chargement)
  const refresh = useUpdate((s) => s.refresh)

  const hardware = useHardware()
  const [pose, setPose] = useState<string | null>(null)

  /** git s'installe depuis l'application : archive portable sous Windows,
      installateur du système ailleurs. */
  const poserGit = async () => {
    setPose('Préparation')
    try {
      for await (const ev of installGit()) {
        if (ev.type === 'phase') setPose(ev.label)
        if (ev.type === 'progress' && ev.total) {
          setPose(`Téléchargement — ${formatBytes(ev.completed)} / ${formatBytes(ev.total)}`)
        }
        if (ev.type === 'error') {
          toast({ title: 'Installation de git impossible', description: ev.message, tone: 'danger' })
          setPose(null)
          return
        }
        if (ev.type === 'done') {
          toast({ title: 'git est prêt', description: ev.version ? `Version ${ev.version}` : undefined, tone: 'success' })
          setPose(null)
          await refresh(true)
          return
        }
      }
      setPose(null)
    } catch (e) {
      toast({ title: 'Installation de git impossible', description: (e as Error).message, tone: 'danger' })
      setPose(null)
    }
  }

  const rafraichir = async () => {
    const s = await refresh(true)
    if (!s) return toast({ title: 'Vérification impossible', description: 'Le serveur n’a pas répondu.', tone: 'danger' })
    if (!s.git) return toast({ title: 'git est introuvable', description: s.reason, tone: 'danger' })
    if (!s.repo) return toast({ title: 'Mises à jour indisponibles', description: s.reason, tone: 'danger' })
    if (s.behind > 0) {
      return toast({
        title: `${s.behind} nouveauté${s.behind > 1 ? 's' : ''}`,
        description: 'La fenêtre d’installation vient de s’ouvrir.',
      })
    }
    toast({ title: 'AI Studio est à jour', tone: 'success' })
  }

  const absent = status !== null && status.git === false
  const suivi = !!status?.repo && !!status.upstream
  const retard = status?.behind ?? 0

  return (
    <div className="space-y-4">
      {status === null ? (
        <p className="t-caption text-fg-subtle">Relevé en cours…</p>
      ) : (
        <>
          {suivi && (
            <p
              className={`t-caption flex items-start gap-2 rounded-sm px-3 py-2.5 ${
                retard > 0 ? 'bg-accent-wash text-fg' : 'bg-surface-2 text-fg-muted'
              }`}
            >
              {retard > 0 ? (
                <>
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" />
                  <span className="min-w-0">
                    {retard} version{retard > 1 ? 's' : ''} en attente d’installation.
                  </span>
                </>
              ) : (
                <>
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-positive" />
                  <span className="min-w-0">AI Studio est à la dernière version.</span>
                </>
              )}
            </p>
          )}

          {status.head && (
            <Ligne label="Version installée">
              <code className="font-mono text-[12px] text-fg-subtle">{status.head}</code>
            </Ligne>
          )}

          <Ligne label="git">
            {absent ? (
              <span className="inline-flex items-center gap-1.5 text-negative">
                <CircleAlert className="size-3.5" />
                introuvable
              </span>
            ) : (
              <span className="font-mono text-[12px]">{status.gitVersion ?? 'présent'}</span>
            )}
          </Ligne>

          {status.reason && (
            <p className={`t-caption flex items-start gap-2 rounded-sm px-3 py-2.5 text-fg-muted ${absent ? 'bg-negative-wash' : 'bg-surface-2'}`}>
              <CircleAlert className={`mt-0.5 size-4 shrink-0 ${absent ? 'text-negative' : 'text-fg-subtle'}`} />
              <span className="min-w-0">
                {status.reason}
                {absent && hardware?.gitAuto !== 'auto' && status.gitInstall && (
                  <>
                    {' '}
                    <a
                      href={status.gitInstall}
                      target="_blank"
                      rel="noreferrer"
                      className="text-fg underline underline-offset-2"
                    >
                      Le faire à la main
                    </a>
                    .
                  </>
                )}
              </span>
            </p>
          )}
        </>
      )}

      {pose && (
        <p className="t-caption flex items-center gap-2 rounded-sm bg-surface-2 px-3 py-2.5 text-fg-muted">
          <Loader2 className="size-4 shrink-0 animate-spin" />
          {pose}…
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {absent && (
          <Button variant="primary" size="sm" disabled={!!pose} onClick={() => void poserGit()}>
            <Download className="size-4" />
            {hardware?.gitAuto === 'auto'
              ? 'Installer git (≈ 56 Mo)'
              : hardware?.gitAuto === 'apple'
                ? 'Installer les outils Apple'
                : 'Installer git'}
          </Button>
        )}
        <Button variant="soft" size="sm" disabled={chargement || !!pose} onClick={() => void rafraichir()}>
          <RefreshCw className={chargement ? 'size-4 animate-spin' : 'size-4'} />
          Rafraîchir
        </Button>
      </div>
    </div>
  )
}
