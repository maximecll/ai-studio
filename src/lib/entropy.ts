import type { TokenLogprob } from './types'

const LN2 = Math.LN2

/** Entropie de Shannon sur la distribution renvoyée par le modèle, en bits. */
export function tokenEntropy(top: Array<{ logprob: number }>): number {
  if (!top.length) return 0
  let h = 0
  let mass = 0
  for (const { logprob } of top) {
    const p = Math.exp(logprob)
    if (p <= 0) continue
    mass += p
    h -= p * (logprob / LN2)
  }
  const rest = 1 - mass
  if (rest > 1e-9) h -= rest * (Math.log(rest) / LN2)
  return h
}

export interface Uncertainty {
  /** Entropie moyenne par jeton, en bits, sur la distribution top-k. */
  meanEntropy: number
  /** Entropie maximale rencontrée, le moment où le modèle a le plus hésité. */
  maxEntropy: number
  /** Perplexité : exp(−moyenne des log-probabilités des jetons retenus). */
  perplexity: number
  /** Probabilité moyenne du jeton effectivement choisi, entre 0 et 1. */
  confidence: number
  /** Nombre de jetons mesurés. */
  samples: number
  /** Rang k de la distribution observée (8 par défaut). */
  topK: number
}

export function summarize(tokens: TokenLogprob[], topK: number): Uncertainty | undefined {
  if (!tokens.length) return undefined
  let hSum = 0
  let hMax = 0
  let lpSum = 0
  let pSum = 0
  for (const t of tokens) {
    const h = tokenEntropy(t.top ?? [])
    hSum += h
    if (h > hMax) hMax = h
    lpSum += t.logprob
    pSum += Math.exp(t.logprob)
  }
  const n = tokens.length
  return {
    meanEntropy: hSum / n,
    maxEntropy: hMax,
    perplexity: Math.exp(-lpSum / n),
    confidence: pSum / n,
    samples: n,
    topK,
  }
}

/** Qualifie le niveau d'hésitation pour l'affichage. */
export function entropyBand(bits: number): { label: string; tone: 'positive' | 'caution' | 'negative' } {
  if (bits < 0.5) return { label: 'très sûr', tone: 'positive' }
  if (bits < 1.2) return { label: 'sûr', tone: 'positive' }
  if (bits < 2.2) return { label: 'hésitant', tone: 'caution' }
  return { label: 'très incertain', tone: 'negative' }
}
