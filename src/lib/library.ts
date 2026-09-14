/** Bibliothèque Ollama : ce qu'on propose, selon ce que la machine porte. */
import { gpuVerdict, type Support } from './hardware'
import type { GpuInfo } from './setup'

export interface LibraryModel {
  /** Référence exacte, tirable telle quelle. */
  name: string
  /** Poids du transfert, relevé sur le registre officiel d'Ollama. */
  bytes: number
  note: string
}

interface Famille {
  label: string
  /** Du plus léger au plus lourd : on prend le dernier qui passe. */
  models: LibraryModel[]
}

const FAMILLES: Famille[] = [
  {
    label: 'polyvalent',
    models: [
      { name: 'llama3.2:1b', bytes: 1_320_000_000, note: 'minimal' },
      { name: 'llama3.2:3b', bytes: 2_020_000_000, note: 'léger et rapide' },
      { name: 'qwen2.5:7b', bytes: 4_680_000_000, note: 'très polyvalent' },
      { name: 'qwen2.5:14b', bytes: 8_990_000_000, note: 'polyvalent, plus fin' },
      { name: 'qwen2.5:32b', bytes: 19_850_000_000, note: 'polyvalent, haut de gamme' },
    ],
  },
  {
    label: 'code',
    models: [
      { name: 'qwen2.5-coder:1.5b', bytes: 990_000_000, note: 'code, minimal' },
      { name: 'qwen2.5-coder:7b', bytes: 4_680_000_000, note: 'spécial code' },
      { name: 'qwen2.5-coder:14b', bytes: 8_990_000_000, note: 'code, plus fin' },
      { name: 'qwen2.5-coder:32b', bytes: 19_850_000_000, note: 'code, haut de gamme' },
    ],
  },
  {
    label: 'raisonnement',
    models: [
      { name: 'deepseek-r1:1.5b', bytes: 1_120_000_000, note: 'réflexion, minimal' },
      { name: 'deepseek-r1:7b', bytes: 4_680_000_000, note: 'réflexion' },
      { name: 'deepseek-r1:14b', bytes: 8_990_000_000, note: 'réflexion, plus fine' },
      { name: 'deepseek-r1:32b', bytes: 19_850_000_000, note: 'réflexion, haut de gamme' },
    ],
  },
  {
    label: 'images',
    models: [
      { name: 'llava:7b', bytes: 4_730_000_000, note: 'lit les images' },
      { name: 'llama3.2-vision:11b', bytes: 7_820_000_000, note: 'lit les images, plus fin' },
    ],
  },
  {
    label: 'vecteurs',
    models: [{ name: 'nomic-embed-text', bytes: 270_000_000, note: 'vecteurs' }],
  },
]

export interface Suggestion extends LibraryModel {
  /** `partiel` quand même le plus petit de la famille déborde. */
  level: Support
}

/**
 * Le plus gros modèle de chaque famille que la machine fait tenir entièrement
 * sur sa carte. Quand aucun ne passe, on propose quand même le plus petit :
 * mieux vaut un modèle lent qu'une liste vide.
 */
export function recommended(gpu: GpuInfo | null, totalRam: number): Suggestion[] {
  return FAMILLES.map((famille) => {
    const juges = famille.models.map((m) => ({ m, v: gpuVerdict(m.bytes, null, 0, gpu, totalRam) }))
    const tenus = juges.filter((j) => j.v?.level === 'ok')
    const retenu = tenus.at(-1) ?? juges[0]
    return { ...retenu.m, level: retenu.v?.level ?? 'partiel' }
  })
}

/** Toutes les références, pour que la recherche locale continue de les trouver. */
export const ALL_LIBRARY: LibraryModel[] = FAMILLES.flatMap((f) => f.models)
