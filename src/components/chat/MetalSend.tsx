import { useRef } from 'react'
import { MetalFx, useMetalBend } from 'metal-fx'

/**
 * Habillage métallique du bouton d'envoi.
 *
 * `metal-fx` peint un anneau de métal liquide et un halo autour de l'élément
 * qu'il enveloppe, en WebGL2 ; sans WebGL2 il rend l'enfant tel quel. Aucune
 * dépendance, et un seul bouton couvert, rien à voir avec un nuanceur plein
 * cadre.
 */
export function MetalSend({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  // Le creux qui suit le curseur.
  useMetalBend(ref)

  return (
    <MetalFx
      ref={ref}
      preset="chromatic"
      variant="circle"
      theme="dark"
      innerShadow
      /* Le bouton garde son propre fond : normalisé, sa pastille claire
         disparaissait et le chevron noir devenait invisible. */
      normalizeHostStyles={false}
      /* Rien à envoyer : l'anneau s'efface et cesse de tourner. */
      strength={muted ? 0.25 : 1}
      paused={muted}
    >
      {children}
    </MetalFx>
  )
}
