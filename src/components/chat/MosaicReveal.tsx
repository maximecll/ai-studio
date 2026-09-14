import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { cn } from '../../lib/utils'

export interface MosaicRevealProps {
  src: string | null
  alt?: string
  aspect?: number
  caption?: string
  onRevealComplete?: () => void
  className?: string
  style?: React.CSSProperties
}

const RAYON = 18
/** Côté d'une cellule, en pixels CSS. */
const CELLULE = 7
/** Au-delà, le tramage coûte plus qu'il ne rend sur un écran dense. */
const DPR_MAX = 2

/** Fond de la carte, et couleur des cellules allumées. */
const BASE = [20, 16, 17] as const
const POINT = [196, 192, 194] as const

const DISSIPATION_MS = 950
/** Temps qu'une cellule met à disparaître, une fois son tour venu. */
const CELLULE_MS = 380

/**
 * Trois ondes planes d'orientations et de périodes différentes. Leur somme ne
 * se répète pas à l'œil : c'est leur interférence qui déplace la densité, et
 * non une boucle qu'on finirait par reconnaître.
 */
const ONDES = [
  { angle: 0.35, longueur: 9, vitesse: 0.55, poids: 0.46 },
  { angle: 2.2, longueur: 15, vitesse: -0.38, poids: 0.32 },
  { angle: 1.15, longueur: 26, vitesse: 0.22, poids: 0.22 },
] as const

/** Valeur stable par cellule : c'est elle qui rend la trame irrégulière. */
function grain(i: number, j: number): number {
  const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453
  return n - Math.floor(n)
}

function champ(cx: number, cy: number, t: number): number {
  let v = 0
  for (const o of ONDES) {
    const proj = cx * Math.cos(o.angle) + cy * Math.sin(o.angle)
    v += o.poids * Math.sin((proj / o.longueur) * Math.PI * 2 + t * o.vitesse)
  }
  return (v + 1) / 2
}

/**
 * Mosaïque d'attente, puis dissipation vers l'image.
 *
 * Une cellule ne s'allume que si la vague la porte au-dessus de son propre
 * seuil : quatre sur cinq restent éteintes à chaque instant, et ce sont les
 * vagues qui font circuler les allumées. Tout se peint en Canvas 2D, quelques
 * milliers de rectangles par image.
 */
export function MosaicReveal({
  src, alt = '', aspect = 1, caption, onRevealComplete, className, style,
}: MosaicRevealProps) {
  const reduce = useReducedMotion()
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1

  const cadre = useRef<HTMLDivElement>(null)
  const toile = useRef<HTMLCanvasElement>(null)
  const [fini, setFini] = useState(false)

  const rendu = useRef(onRevealComplete)
  rendu.current = onRevealComplete

  useEffect(() => { if (!src) setFini(false) }, [src])

  useEffect(() => {
    const canvas = toile.current
    const hote = cadre.current
    if (!canvas || !hote) return

    if (src && reduce) {
      setFini(true)
      rendu.current?.()
      return
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let largeur = 0
    let hauteur = 0
    let colonnes = 0
    let lignes = 0
    /** Retard de dissipation par cellule, figé au moment de la révélation. */
    let retards = new Float32Array(0)
    let debutDissipation: number | null = null

    const mesurer = () => {
      const r = hote.getBoundingClientRect()
      if (!r.width || !r.height) return
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX)
      largeur = r.width
      hauteur = r.height
      canvas.width = Math.round(largeur * dpr)
      canvas.height = Math.round(hauteur * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      colonnes = Math.max(2, Math.ceil(largeur / CELLULE))
      lignes = Math.max(2, Math.ceil(hauteur / CELLULE))
    }

    mesurer()
    const observateur = new ResizeObserver(mesurer)
    observateur.observe(hote)

    const depart = performance.now()
    let brut = 0

    const peindre = (maintenant: number) => {
      brut = requestAnimationFrame(peindre)
      // Un onglet caché n'a rien à animer.
      if (document.hidden || !largeur || !hauteur) return

      const t = (maintenant - depart) / 1000
      const dx = largeur / colonnes
      const dy = hauteur / lignes
      const avance = debutDissipation === null ? 0 : maintenant - debutDissipation

      ctx.clearRect(0, 0, largeur, hauteur)
      // Pendant l'attente le fond est opaque ; pendant la dissipation il s'en
      // va avec les cellules, et l'image posée dessous apparaît.
      if (debutDissipation === null) {
        ctx.fillStyle = `rgb(${BASE[0]} ${BASE[1]} ${BASE[2]})`
        ctx.fillRect(0, 0, largeur, hauteur)
      }
      ctx.fillStyle = `rgb(${POINT[0]} ${POINT[1]} ${POINT[2]})`

      for (let j = 0; j < lignes; j++) {
        for (let i = 0; i < colonnes; i++) {
          const h = grain(i, j)
          const clignotement = 0.5 + 0.5 * Math.sin(t * 2.6 + h * 19.7)
          let vif = champ(i, j, t) * (0.4 + 0.6 * clignotement) - h * 0.93
          if (vif <= 0) continue
          vif = Math.min(1, vif * 3.4)

          let alpha = vif
          let retrait = 0
          if (debutDissipation !== null) {
            const p = Math.min(1, Math.max(0, (avance - (retards[j * colonnes + i] ?? 0)) / CELLULE_MS))
            alpha *= 1 - p
            // Les cellules montent en s'effaçant : elles partent en l'air.
            retrait = p * dy * 1.6
          }
          if (alpha <= 0.004) continue

          const cote = Math.max(1, (dx - 2.2) * (0.7 + 0.3 * vif))
          ctx.globalAlpha = alpha * 0.8
          ctx.fillRect(i * dx + (dx - cote) / 2, j * dy + (dy - cote) / 2 - retrait, cote, cote)
        }
      }
      ctx.globalAlpha = 1

      if (debutDissipation !== null && avance >= DISSIPATION_MS + CELLULE_MS) {
        cancelAnimationFrame(brut)
        ctx.clearRect(0, 0, largeur, hauteur)
        setFini(true)
        rendu.current?.()
      }
    }

    // Le retard suit la vague : la dissipation la prolonge, au lieu de balayer
    // l'image d'un bord à l'autre.
    if (src) {
      retards = new Float32Array(colonnes * lignes)
      const t = (performance.now() - depart) / 1000
      for (let j = 0; j < lignes; j++) {
        for (let i = 0; i < colonnes; i++) {
          retards[j * colonnes + i] = champ(i, j, t) * (DISSIPATION_MS - CELLULE_MS)
        }
      }
      debutDissipation = performance.now()
    }

    brut = requestAnimationFrame(peindre)
    return () => {
      cancelAnimationFrame(brut)
      observateur.disconnect()
    }
  }, [src, reduce])

  return (
    <div
      ref={cadre}
      className={cn('relative w-full overflow-hidden', className)}
      style={{ aspectRatio: String(ratio), borderRadius: RAYON, background: `rgb(${BASE.join(' ')})`, ...style }}
    >
      {src && (
        <img
          src={src}
          alt={alt}
          className="absolute inset-0 block h-full w-full object-cover"
          style={{ borderRadius: RAYON }}
        />
      )}

      <canvas
        ref={toile}
        className="absolute inset-0 block h-full w-full"
        style={{ borderRadius: RAYON, opacity: fini ? 0 : 1 }}
        aria-hidden
      />

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
              className="block text-[11px] leading-6 font-medium whitespace-nowrap text-white/80"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.28, ease: [0.4, 0, 0.2, 1] }}
            >
              {caption}
            </motion.span>
          </AnimatePresence>
        </motion.div>
      ) : null}
    </div>
  )
}
