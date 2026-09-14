import { useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, RefreshCw } from 'lucide-react'
import { updateStatus, type UpdateStatus } from '../../lib/update'
import { toast } from '../../store/ui'
import { Button } from '../ui/primitives'

function Ligne({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="t-caption text-fg-muted">{label}</span>
      <span className="t-caption min-w-0 text-right text-fg">{children}</span>
    </div>
  )
}

/** Contenu du bloc « Mises à jour » des réglages. */
export function UpdateSettings() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [occupe, setOccupe] = useState(false)

  useEffect(() => { void updateStatus().then(setStatus).catch(() => setStatus(null)) }, [])

  const verifier = async () => {
    setOccupe(true)
    try {
      const s = await updateStatus(true)
      setStatus(s)
      if (!s.git) toast({ title: 'git est introuvable', description: s.reason, tone: 'danger' })
      else if (!s.repo) toast({ title: 'Mises à jour indisponibles', description: s.reason, tone: 'danger' })
      else if (s.behind > 0) {
        toast({ title: `${s.behind} mise${s.behind > 1 ? 's' : ''} à jour disponible${s.behind > 1 ? 's' : ''}`, description: 'Rechargez la page pour l’installer.' })
      } else toast({ title: 'AI Studio est à jour', tone: 'success' })
    } catch {
      toast({ title: 'Vérification impossible', description: 'Le serveur n’a pas répondu.', tone: 'danger' })
    }
    setOccupe(false)
  }

  const absent = status !== null && status.git === false

  return (
    <div className="space-y-4">
      {status === null ? (
        <p className="t-caption text-fg-subtle">Relevé en cours…</p>
      ) : (
        <>
          <Ligne label="git">
            {absent ? (
              <span className="inline-flex items-center gap-1.5 text-negative">
                <CircleAlert className="size-3.5" />
                introuvable
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <CircleCheck className="size-3.5 text-positive" />
                <span className="font-mono text-[12px]">{status.gitVersion ?? 'présent'}</span>
              </span>
            )}
          </Ligne>

          {status.head && (
            <Ligne label="Version installée">
              <code className="font-mono text-[12px] text-fg-subtle">{status.head}</code>
            </Ligne>
          )}

          {status.repo && status.upstream && (
            <Ligne label="État">
              {status.behind > 0 ? `${status.behind} en attente` : 'À jour'}
            </Ligne>
          )}

          {status.reason && (
            <p className={`t-caption flex items-start gap-2 rounded-sm px-3 py-2.5 text-fg-muted ${absent ? 'bg-negative-wash' : 'bg-surface-2'}`}>
              <CircleAlert className={`mt-0.5 size-4 shrink-0 ${absent ? 'text-negative' : 'text-fg-subtle'}`} />
              <span className="min-w-0">
                {status.reason}
                {absent && status.gitInstall && (
                  <>
                    {' '}
                    <a
                      href={status.gitInstall}
                      target="_blank"
                      rel="noreferrer"
                      className="text-fg underline underline-offset-2"
                    >
                      Installer git
                    </a>
                    , puis relancez AI Studio.
                  </>
                )}
              </span>
            </p>
          )}
        </>
      )}

      <Button variant="soft" size="sm" disabled={occupe} onClick={() => void verifier()}>
        <RefreshCw className={occupe ? 'size-4 animate-spin' : 'size-4'} />
        Vérifier maintenant
      </Button>
    </div>
  )
}
