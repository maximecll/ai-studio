/** Matériel de la machine, et ce qu'il peut porter. */
import { useEffect, useState } from 'react'
import { estimateMemory, type ModelShape } from './ollama'
import { setupStatus, type GpuInfo, type SetupStatus } from './setup'
import { formatBytes } from './utils'

/* Le matériel ne change pas en cours de session : une seule interrogation
   sert toutes les cartes de la page. */
let releve: SetupStatus | null = null
let attente: Promise<SetupStatus> | null = null

export function useHardware(): SetupStatus | null {
  const [etat, setEtat] = useState<SetupStatus | null>(releve)

  useEffect(() => {
    if (releve) return
    let vivant = true
    attente ??= setupStatus()
    void attente
      .then((s) => { releve = s; if (vivant) setEtat(s) })
      .catch(() => { attente = null })
    return () => { vivant = false }
  }, [])

  return etat
}

export type Support = 'ok' | 'partiel' | 'non'

export interface Verdict {
  level: Support
  label: string
  /** Une ligne, tenue courte : l'info-bulle ne revient pas à la ligne. */
  tip: string
  /** Ce qu'il faut comprendre — affiché dans la carte, pas en info-bulle. */
  detail: string
  need: number
}

/** Marge laissée au système : ni le GPU ni la mémoire vive ne sont libres en entier. */
const MARGE = 0.9

/** Sans la forme du modèle, le cache d'attention est inconnu : on majore les
    poids plutôt que de ne rien dire. */
function besoin(weights: number, shape: ModelShape | null, numCtx: number): { need: number; exact: boolean } {
  const est = estimateMemory(weights, shape, numCtx)
  return est ? { need: est.total, exact: true } : { need: weights * 1.15, exact: false }
}

/**
 * Trois niveaux, selon où le modèle tient.
 *
 * Ollama place sur le GPU autant de couches que la mémoire graphique en
 * accepte et laisse le reste au processeur : au-delà du budget GPU la
 * génération continue, beaucoup plus lentement. Au-delà de la mémoire vive
 * elle part sur le disque, et n'est plus utilisable.
 */
export function gpuVerdict(
  weights: number,
  shape: ModelShape | null,
  numCtx: number,
  gpu: GpuInfo | null,
  totalRam: number,
): Verdict | null {
  if (!weights || !totalRam) return null

  const { need, exact } = besoin(weights, shape, numCtx)
  const surGpu = (gpu?.vram ?? 0) * MARGE
  const enRam = totalRam * MARGE
  const tip = `${prettyGpu(gpu)}modèle ≈ ${formatBytes(need)}${exact ? '' : ' hors cache'}`

  if (surGpu > 0 && need <= surGpu) {
    return {
      level: 'ok',
      label: 'Supporté',
      tip,
      detail: `Tient entièrement sur ${gpu?.unified ? 'la mémoire unifiée' : 'la carte graphique'}.`,
      need,
    }
  }
  if (need <= enRam) {
    return {
      level: 'partiel',
      label: 'Supporté à moitié',
      tip,
      detail: surGpu > 0
        ? `Dépasse les ${formatBytes(gpu?.vram ?? 0)} du GPU : une partie des couches ira sur le processeur, nettement plus lentement.`
        : 'Aucune carte graphique exploitable : tout tournera sur le processeur.',
      need,
    }
  }
  // Quand ce sont les poids seuls qui tiennent, c'est le contexte qui déborde.
  const parLeContexte = weights <= enRam * 0.8
  return {
    level: 'non',
    label: 'Non supporté',
    tip,
    detail: `Dépasse les ${formatBytes(totalRam)} de la machine : le modèle serait relu depuis le disque à chaque jeton.`
      + (parLeContexte ? ' Un contexte plus court le ramènerait peut-être dans les clous.' : ''),
    need,
  }
}

function prettyGpu(gpu: GpuInfo | null): string {
  if (!gpu) return ''
  return `${gpu.name} ${gpu.vram > 0 ? formatBytes(gpu.vram) : ''} · `
}

export const TONE: Record<Support, 'positive' | 'caution' | 'negative'> = {
  ok: 'positive',
  partiel: 'caution',
  non: 'negative',
}
