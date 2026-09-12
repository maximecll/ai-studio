import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { KeyRound, Lock } from 'lucide-react'
import type { Conversation } from '../../lib/types'
import { fullDate } from '../../lib/utils'
import { useUI } from '../../store/ui'
import { useVault } from '../../store/vault'
import { Button } from '../ui/primitives'

/**
 * Écran d'une conversation verrouillée, coffre fermé.
 *
 * On n'affiche pas le chiffré : il n'apprend rien et ressemble à une panne.
 * On explique, et on propose l'action qui débloque. Le coffre s'ouvre de
 * lui-même à l'arrivée pour éviter un clic superflu.
 */
export function LockedView({ conv }: { conv: Conversation }) {
  const setVaultOpen = useUI((s) => s.setVaultOpen)
  const exists = useVault((s) => s.exists)

  useEffect(() => {
    // Un coffre inexistant mène à sa création, pas à une demande de phrase.
    const id = setTimeout(() => setVaultOpen(true), 350)
    return () => clearTimeout(id)
  }, [setVaultOpen])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg">
      <header className="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-line px-3">
        <span />
        <h1 className="t-ui flex items-center gap-2 truncate text-center text-fg-muted">
          <Lock className="size-3.5" />
          Conversation verrouillée
        </h1>
        <span />
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="max-w-md text-center"
        >
          <span className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full bg-fg/[0.06]">
            <Lock className="size-5 text-fg-muted" />
          </span>

          <h2 className="t-title">Cette conversation est verrouillée</h2>
          <p className="t-body mt-3 text-fg-muted">
            Son contenu est chiffré sur le disque. Ouvrez votre coffre pour y accéder.
          </p>
          <p className="t-caption mt-4 text-fg-subtle">
            Créée le {fullDate(conv.createdAt)}
          </p>

          <Button variant="primary" size="md" className="mt-7" onClick={() => setVaultOpen(true)}>
            <KeyRound className="size-4" />
            {exists === false ? 'Créer le coffre' : 'Ouvrir le coffre'}
          </Button>
        </motion.div>
      </div>
    </div>
  )
}
