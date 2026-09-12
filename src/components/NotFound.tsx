import { motion } from 'framer-motion'
import { Home, SearchX } from 'lucide-react'
import { href, navigate } from '../lib/router'
import { Button } from './ui/primitives'

/** 404 — identifiant de conversation inconnu ou chemin inexistant. */
export function NotFound({ path }: { path: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="max-w-md text-center"
      >
        <span className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full bg-fg/[0.06]">
          <SearchX className="size-5 text-fg-muted" />
        </span>
        <p className="t-label mb-2 text-fg-subtle">Erreur 404</p>
        <h1 className="t-title">Cette conversation n'existe pas</h1>
        <p className="t-body mt-3 text-fg-muted">
          L'identifiant demandé est introuvable dans cette base locale. Il a peut-être été
          supprimé, ou créé sur une autre machine.
        </p>
        <p className="t-caption mt-3 font-mono break-all text-fg-subtle">{path}</p>
        <Button variant="primary" size="md" className="mt-7" onClick={() => navigate(href.home())}>
          <Home className="size-4" />
          Retour à l'accueil
        </Button>
      </motion.div>
    </div>
  )
}
