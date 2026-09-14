import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ImageGeneration, type ImageGenerationHandle } from 'img-fx'
import { cn } from '../../lib/utils'

/** Même contrat que GridReveal : le remplacement se fait sur une ligne. */
export interface ShaderRevealProps {
  src: string | null
  alt?: string
  aspect?: number
  caption?: string
  onRevealComplete?: () => void
  className?: string
  style?: React.CSSProperties
}

const RAYON = 18

/** Le nuanceur sait dessiner sur un fond opaque, pas deviner ce qu'il y a derrière. */
const FOND = '#141011'

const SHIMMER: React.CSSProperties = {
  backgroundImage: 'linear-gradient(90deg, rgba(255,255,255,0.5) 0%, #fff 50%, rgba(255,255,255,0.5) 100%)',
  backgroundSize: '220% 100%',
}

/**
 * Mosaïque de pixels pendant le calcul, puis dissolution vers l'image.
 *
 * L'attente n'a pas de fin connue : `autoReveal` est laissé à l'écart et la
 * révélation est déclenchée à l'arrivée de l'image, en mode `manual` pour
 * qu'elle ne se referme jamais.
 */
export function ShaderReveal({
  src, alt = '', aspect = 1, caption, onRevealComplete, className, style,
}: ShaderRevealProps) {
  const reduce = useReducedMotion()
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1

  const poignee = useRef<ImageGenerationHandle>(null)
  const [fini, setFini] = useState(false)
  const rendu = useRef(onRevealComplete)
  rendu.current = onRevealComplete

  useEffect(() => {
    if (!src) return setFini(false)
    // Une frame d'écart : la liste `images` doit être posée avant la demande.
    const t = requestAnimationFrame(() => poignee.current?.triggerReveal({ hold: 'manual' }))
    return () => cancelAnimationFrame(t)
  }, [src])

  return (
    <div
      className={cn('relative w-full overflow-hidden', className)}
      style={{ aspectRatio: String(ratio), borderRadius: RAYON, background: FOND, ...style }}
    >
      <ImageGeneration
        ref={poignee}
        preset="pixels-organic"
        theme="dark"
        images={src ? [src] : []}
        autoReveal={false}
        paused={!!reduce}
        borderRadius={RAYON}
        cardBg={FOND}
        onCycle={(e) => {
          if (e.phase !== 'visible' || fini) return
          setFini(true)
          rendu.current?.()
        }}
        style={{ width: '100%', height: '100%' }}
        {...(alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true })}
      >
        <div style={{ width: '100%', height: '100%', borderRadius: RAYON }} />
      </ImageGeneration>

      {caption ? (
        <motion.div
          className="pointer-events-none absolute bottom-3 left-3 flex h-6 items-center overflow-hidden bg-black/45 px-2.5 backdrop-blur-md"
          style={{ borderRadius: 9999 }}
          animate={{ opacity: fini ? 0 : 1 }}
          transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={caption}
              className={cn(
                'block text-[11px] leading-6 font-medium whitespace-nowrap',
                reduce ? 'text-white/75' : 'bg-clip-text text-transparent',
              )}
              style={reduce ? undefined : SHIMMER}
              initial={{ opacity: 0 }}
              animate={{
                opacity: 1,
                ...(reduce || fini ? {} : { backgroundPosition: ['105% 0%', '-5% 0%'] }),
              }}
              exit={{ opacity: 0 }}
              transition={{
                duration: reduce ? 0 : 0.28,
                ease: [0.4, 0, 0.2, 1],
                backgroundPosition: { duration: 1.6, repeat: Infinity, repeatDelay: 0.5, ease: [0.45, 0, 0.55, 1] },
              }}
            >
              {caption}
            </motion.span>
          </AnimatePresence>
        </motion.div>
      ) : null}
    </div>
  )
}
