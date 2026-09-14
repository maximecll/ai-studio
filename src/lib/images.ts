/**
 * Client du moteur d'images.
 *
 * Ollama ne fait pas de diffusion : la génération passe par `/images/*`, servi
 * par `server/images.mjs`, qui pilote mflux dans un processus Python séparé.
 * Les opérations longues répondent en NDJSON — même motif que les
 * téléchargements Ollama, pour que l'interface n'ait qu'une façon d'afficher
 * une progression.
 */
import type { ImageEngine, ImageModel, ImageParams, LoraChoice, LoraFile } from './types'

const BASE = '/images'

export class ImageError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'ImageError'
  }
}

async function req(path: string, init?: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(BASE + path, init)
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ImageError("Le serveur de Studio ne répond pas. L'application est-elle bien lancée ?")
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    let msg = detail
    try {
      msg = JSON.parse(detail).error ?? detail
    } catch { /* texte brut */ }
    throw new ImageError(msg || `Erreur ${res.status}`, res.status)
  }
  return res
}

/** Découpe un flux NDJSON en objets successifs. */
async function* ndjson<T>(res: Response): AsyncGenerator<T> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const t = line.trim()
      if (t) yield JSON.parse(t) as T
    }
  }
  const rest = buffer.trim()
  if (rest) yield JSON.parse(rest) as T
}

/* ── Événements ───────────────────────────────────────────────────── */

export type EngineEvent =
  | { type: 'phase'; phase: string; label: string; steps?: number; model?: string }
  | { type: 'log'; line: string }
  | { type: 'progress'; phase: string; completed: number; total: number; speed: number; eta: number | null }
  | { type: 'step'; step: number; steps: number; stepMs: number; elapsedMs: number }
  | { type: 'lora'; file: string; scale?: number; layers: number; matched: number; total: number }
  | { type: 'start'; id: string; seed: number; steps: number; width: number; height: number; guidance: number | null; loras: number; model: string }
  | { type: 'done'; id?: string; seed?: number; path?: string; bytes?: number; ms?: number }
  | { type: 'cancelled' }
  | { type: 'error'; kind?: string; message: string }

/* ── Opérations ───────────────────────────────────────────────────── */

export async function engineStatus(): Promise<ImageEngine> {
  return (await req('/status')).json()
}

/* ── Bibliothèque de LoRAs ───────────────────────────────────────── */

export async function loraLibrary(): Promise<{ folder: string; items: LoraFile[] }> {
  return (await req('/loras')).json()
}

/** Ouvre le dossier dans le Finder — déposer un fichier doit rester trivial. */
export async function revealLoras(): Promise<void> {
  await req('/loras/reveal', { method: 'POST' })
}

/** Dosage par défaut d'un LoRA fraîchement activé. */
export const DEFAULT_LORA_SCALE = 1

/** LoRAs retenus, débarrassés de ceux qui ont quitté la bibliothèque. */
export function activeLoras(chosen: LoraChoice[] | undefined, library: LoraFile[]): LoraChoice[] {
  if (!chosen?.length) return []
  const known = new Set(library.map((l) => l.file))
  return chosen.filter((c) => known.has(c.file))
}

export function installEngine(signal?: AbortSignal): AsyncGenerator<EngineEvent> {
  return stream('/install', {}, signal)
}

export function pullModel(model: string, signal?: AbortSignal): AsyncGenerator<EngineEvent> {
  return stream('/pull', { model }, signal)
}

export interface GenerateJob extends Omit<ImageParams, 'seed'> {
  prompt: string
  seed?: number | null
  /** Fusionner l'adaptateur dans les poids plutôt que de l'appliquer à l'exécution. */
  bakeLora?: boolean
}

export function generate(job: GenerateJob, signal?: AbortSignal): AsyncGenerator<EngineEvent> {
  // Une graine nulle veut dire « laisse le serveur tirer » : on ne l'envoie pas.
  const { seed, ...rest } = job
  return stream('/generate', seed == null ? rest : { ...rest, seed }, signal)
}

async function* stream(path: string, body: unknown, signal?: AbortSignal): AsyncGenerator<EngineEvent> {
  const res = await req(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  yield* ndjson<EngineEvent>(res)
}

/** Interrompt une génération, ou un téléchargement si `model` est donné. */
export async function cancel(what: { id?: string; model?: string }): Promise<void> {
  await req('/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(what),
  }).catch(() => undefined)
}

export async function removeModel(model: string): Promise<void> {
  await req('/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  })
}

/** Vide le cache de morceaux Xet — il se reconstitue au prochain téléchargement. */
export async function purgeChunkCache(): Promise<void> {
  await req('/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ xet: true }),
  })
}

/**
 * Récupère l'image fraîchement produite, puis la retire du dépôt temporaire.
 *
 * Le serveur n'est qu'un sas : les octets appartiennent à la base, où ils
 * seront chiffrés si la conversation est verrouillée. Les laisser traîner sur
 * le disque contredirait ce chiffrement.
 */
export async function collect(id: string): Promise<Uint8Array> {
  const res = await req(`/file?id=${encodeURIComponent(id)}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  void req(`/file?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined)
  return bytes
}

/* ── Format et définition ────────────────────────────────────────── */

/**
 * Le format et la définition sont deux réglages distincts, parce qu'ils ne
 * coûtent pas la même chose : changer de format ne change rien au temps de
 * calcul, le doubler en définition le quadruple. Sur une puce M3, c'est le
 * levier le plus efficace dont dispose l'utilisateur.
 */
export const RATIOS = [
  { id: 'square', label: 'Carré', hint: '1:1', w: 1, h: 1 },
  { id: 'landscape', label: 'Paysage', hint: '3:2', w: 3, h: 2 },
  { id: 'portrait', label: 'Portrait', hint: '2:3', w: 2, h: 3 },
  { id: 'wide', label: 'Large', hint: '16:9', w: 16, h: 9 },
] as const

export const DEFINITIONS = [
  { id: 'draft', label: 'Aperçu', px: 640, note: 'Le plus rapide — pour chercher une idée.' },
  { id: 'standard', label: 'Standard', px: 1024, note: "La définition d'entraînement de FLUX." },
  { id: 'fine', label: 'Détail', px: 1280, note: 'Plus fin, nettement plus long.' },
] as const

export type Ratio = (typeof RATIOS)[number]
export type Definition = (typeof DEFINITIONS)[number]

const round16 = (n: number) => Math.max(256, Math.round(n / 16) * 16)

/**
 * Dimensions d'un format à une définition donnée, à surface constante :
 * un paysage et un carré de même définition coûtent le même temps de calcul.
 */
export function dimensions(ratio: Ratio, def: Definition): { width: number; height: number } {
  const k = Math.sqrt(ratio.w / ratio.h)
  return { width: round16(def.px * k), height: round16(def.px / k) }
}

/** Retrouve le format et la définition les plus proches de dimensions données. */
export function describeSize(width: number, height: number): { ratio: Ratio; def: Definition } {
  const target = width / height
  const ratio = RATIOS.reduce((best, r) =>
    Math.abs(r.w / r.h - target) < Math.abs(best.w / best.h - target) ? r : best,
  )
  const area = Math.sqrt(width * height)
  const def = DEFINITIONS.reduce((best, d) => (Math.abs(d.px - area) < Math.abs(best.px - area) ? d : best))
  return { ratio, def }
}

/* ── Aides d'affichage ────────────────────────────────────────────── */

export function modelOf(catalog: ImageModel[], id: string): ImageModel | undefined {
  return catalog.find((m) => m.id === id)
}

/** Libellé complet d'un modèle d'images : « FLUX.1 dev · 4 bits ». */
export function imageModelName(m: ImageModel | undefined): string {
  return m ? `${m.name} · ${m.variant}` : 'Modèle d’images'
}

/**
 * Temps de calcul attendu, en millisecondes.
 *
 * Le coût suit la surface de l'image, puisque c'est le nombre de jetons latents
 * qui commande le travail, et la taille du modèle. Le coût par pas vient du
 * catalogue : chronométré pour FLUX.1 dev sur cette machine (27 s à 768 × 768),
 * déduit de la taille pour les autres tant qu'ils n'ont pas tourné.
 */
export function estimate(
  steps: number, width: number, height: number,
  msPerStep = 27_000, loadMs = 20_000,
): number {
  const area = (width * height) / (768 * 768)
  return loadMs + steps * msPerStep * area
}

/**
 * Un LoRA vise-t-il bien ce modèle ?
 *
 * Un adaptateur est un jeu de corrections adressées à des couches nommées d'une
 * architecture précise. Chargé sur une autre famille, aucun nom ne correspond :
 * il se charge sans erreur et ne fait rien. Mieux vaut le dire avant.
 */
export function loraFits(lora: LoraFile, model: ImageModel | undefined): boolean | null {
  if (!model) return null
  // La famille se lit dans les noms de tenseurs, jamais dans les métadonnées.
  if (lora.target && model.loraTarget && lora.target !== model.loraTarget) return false
  // Deux tailles d'un même modèle portent les mêmes noms de couches : seule la
  // largeur les sépare. C'est le cas de Wan 5 B face au A14B.
  if (lora.width && model.loraWidth && lora.width !== model.loraWidth) return false
  if (lora.target && model.loraTarget && lora.target === model.loraTarget) {
    return !model.loraWidth || !lora.width || lora.width === model.loraWidth
  }
  return null
}

/** Pourquoi un adaptateur ne convient pas — dit en une ligne. */
export function loraMismatch(lora: LoraFile, model: ImageModel | undefined): string | null {
  if (!model || loraFits(lora, model) !== false) return null
  if (lora.target && model.loraTarget && lora.target !== model.loraTarget) {
    return `adaptateur ${lora.target}`
  }
  return `prévu pour une largeur ${lora.width}, ce modèle fait ${model.loraWidth}`
}

/** « ~4 min » — une estimation arrondie, jamais une promesse à la seconde. */
export function roughly(ms: number): string {
  const min = ms / 60_000
  if (min < 1) return `~${Math.max(10, Math.round(ms / 10_000) * 10)} s`
  if (min < 10) return `~${Math.round(min)} min`
  return `~${Math.round(min / 5) * 5} min`
}
