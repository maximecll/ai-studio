import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDownToLine, CircleAlert, Loader2, RefreshCw } from 'lucide-react'
import { applyUpdate, waitForServer } from '../../lib/update'
import { useChat } from '../../store/chat'
import { doitInstaller, useUpdate } from '../../store/update'
import { Button } from './primitives'

type Etape = 'attente' | 'cours' | 'redemarrage' | 'echec' | 'manuel'

/** Une version est disponible : on barre l'application tant qu'elle n'est
    pas installée. L'échappatoire n'apparaît qu'après un échec. */
export function UpdateGate() {
  const status = useUpdate((s) => s.status)
  const aInstaller = useUpdate(doitInstaller)
  const ecarter = useUpdate((s) => s.ecarter)
  const connect = useUpdate((s) => s.connect)
  const refresh = useUpdate((s) => s.refresh)

  const [etape, setEtape] = useState<Etape>('attente')
  const [phase, setPhase] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)

  useEffect(() => {
    void refresh()
    return connect()
  }, [connect, refresh])

  const installer = async () => {
    setEtape('cours')
    setErreur(null)
    setPhase('Préparation')
    try {
      for await (const ev of applyUpdate()) {
        if (ev.type === 'phase') setPhase(ev.label)
        if (ev.type === 'error') {
          setErreur(ev.message)
          setEtape('echec')
          return
        }
        if (ev.type === 'done') {
          if (!ev.restart) { setEtape('manuel'); return }
          setEtape('redemarrage')
          setPhase('Redémarrage')
          if (await waitForServer()) location.reload()
          else {
            setErreur("Le serveur n'est pas revenu. Relancez AI Studio à la main.")
            setEtape('echec')
          }
          return
        }
      }
      setErreur('La mise à jour s’est interrompue.')
      setEtape('echec')
    } catch (e) {
      setErreur((e as Error).message)
      setEtape('echec')
    }
  }

  /* Une réponse en cours de génération passerait à la trappe au redémarrage :
     on attend qu'elle soit terminée pour barrer l'écran. */
  const genere = useChat((s) => Object.keys(s.streams).length > 0)

  const visible = aInstaller && (!genere || etape !== 'attente')
  const commits = status?.commits ?? []

  return (
    <AnimatePresence>
      {visible && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-fg/25 p-6 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.99 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            role="dialog"
            aria-modal
            className="relative w-full max-w-lg rounded-lg bg-surface p-8 shadow-float"
          >
            <span className="flex size-9 items-center justify-center rounded-full bg-accent-wash text-accent">
              <ArrowDownToLine className="size-4" />
            </span>

            <h2 className="t-title mt-4">Mise à jour disponible</h2>
            <p className="t-body mt-2 text-fg-muted">
              {status?.behind === 1
                ? 'Une nouveauté vous attend.'
                : `${status?.behind} nouveautés vous attendent.`}{' '}
              L’installation prend moins d’une minute et AI Studio se relance tout seul.
            </p>

            {commits.length > 0 && etape === 'attente' && (
              <ul className="scroll-thin mt-5 max-h-44 space-y-1.5 overflow-y-auto rounded-sm bg-surface-2 px-4 py-3">
                {commits.map((c) => (
                  <li key={c.sha} className="t-caption flex gap-2.5 text-fg-muted">
                    <code className="shrink-0 font-mono text-[11px] text-fg-subtle">{c.sha}</code>
                    <span className="min-w-0 flex-1">{c.subject}</span>
                  </li>
                ))}
              </ul>
            )}

            {(etape === 'cours' || etape === 'redemarrage') && (
              <p className="t-caption mt-5 flex items-center gap-2 rounded-sm bg-surface-2 px-4 py-3 text-fg-muted">
                <Loader2 className="size-4 shrink-0 animate-spin" />
                {phase}…
              </p>
            )}

            {etape === 'manuel' && (
              <p className="t-caption mt-5 rounded-sm bg-surface-2 px-4 py-3 text-fg-muted">
                Installée. Fermez la fenêtre du lanceur puis rouvrez AI Studio pour en profiter.
              </p>
            )}

            {erreur && (
              <p className="t-caption mt-5 flex items-start gap-2 rounded-sm bg-negative-wash px-4 py-3 text-fg-muted">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-negative" />
                <span className="min-w-0">{erreur}</span>
              </p>
            )}

            <div className="mt-6 flex items-center justify-end gap-2">
              {etape === 'echec' && (
                <Button variant="quiet" size="sm" onClick={ecarter}>
                  Continuer sans mettre à jour
                </Button>
              )}
              {etape === 'manuel' ? (
                <Button variant="primary" size="sm" onClick={() => location.reload()}>
                  <RefreshCw className="size-4" />
                  Recharger
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={etape === 'cours' || etape === 'redemarrage'}
                  onClick={() => void installer()}
                >
                  <ArrowDownToLine className="size-4" />
                  {etape === 'echec' ? 'Réessayer' : 'Mettre à jour'}
                </Button>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
