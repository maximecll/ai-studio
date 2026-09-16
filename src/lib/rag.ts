/** Cœur du RAG : découpage, vectorisation, recherche par similarité — en local. */
import { db } from './db'
import { ollama } from './ollama'
import type { Chunk } from './types'
import { hasMaster, openChunkText } from './sealed'

/** Modèle d'embedding par défaut : petit, rapide, déjà dans la bibliothèque. */
export const DEFAULT_EMBED_MODEL = 'nomic-embed-text'

/** Taille d'un morceau et recouvrement, en caractères. ~1600 ≈ 400 jetons. */
const TAILLE = 1600
const RECOUVREMENT = 200

/**
 * Découpe un texte en morceaux qui se chevauchent.
 *
 * On coupe de préférence sur une fin de paragraphe ou de ligne proche de la
 * limite : un morceau qui s'arrête au milieu d'une phrase se retrouve mal.
 */
export function chunkText(texte: string): string[] {
  const propre = texte.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (propre.length <= TAILLE) return propre ? [propre] : []

  const morceaux: string[] = []
  let i = 0
  while (i < propre.length) {
    let fin = Math.min(i + TAILLE, propre.length)
    if (fin < propre.length) {
      // Chercher une coupure naturelle dans le dernier quart du morceau.
      const fenetre = propre.slice(i + Math.floor(TAILLE * 0.75), fin)
      const coupe = Math.max(fenetre.lastIndexOf('\n\n'), fenetre.lastIndexOf('\n'), fenetre.lastIndexOf('. '))
      if (coupe > 0) fin = i + Math.floor(TAILLE * 0.75) + coupe + 1
    }
    const bout = propre.slice(i, fin).trim()
    if (bout) morceaux.push(bout)
    if (fin >= propre.length) break
    i = fin - RECOUVREMENT
  }
  return morceaux
}

/** Rend le vecteur unitaire : la similarité cosinus devient un simple produit scalaire. */
function normaliser(v: number[]): number[] {
  let norme = 0
  for (const x of v) norme += x * x
  norme = Math.sqrt(norme) || 1
  return v.map((x) => x / norme)
}

function produitScalaire(a: number[], b: number[]): number {
  let s = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}

/** Vectorise un lot de textes, par paquets pour ne pas saturer Ollama. */
export async function embedBatch(model: string, textes: string[]): Promise<number[][]> {
  const vecteurs: number[][] = []
  const PAQUET = 32
  for (let i = 0; i < textes.length; i += PAQUET) {
    const lot = await ollama.embed(model, textes.slice(i, i + PAQUET))
    for (const v of lot) vecteurs.push(normaliser(v))
  }
  return vecteurs
}

export interface Passage {
  text: string
  docName: string
  score: number
}

/**
 * Les passages les plus proches de la question, dans les bases actives.
 *
 * Recherche exhaustive en mémoire : quelques milliers de morceaux × 768
 * dimensions se comparent en une poignée de millisecondes, sans index à tenir.
 */
export async function retrieve(
  query: string,
  knowledgeIds: string[],
  opts: { topK?: number; model?: string } = {},
): Promise<Passage[]> {
  if (!query.trim() || !knowledgeIds.length) return []
  const model = opts.model ?? DEFAULT_EMBED_MODEL
  const topK = opts.topK ?? 5

  const [qVec] = await embedBatch(model, [query])
  if (!qVec) return []

  // Une base chiffrée dont le coffre est fermé est illisible : on la saute.
  const bases = await db.knowledge.bulkGet(knowledgeIds)
  const scellees = new Set(bases.filter((b) => b?.sealed).map((b) => b!.id))

  const chunks: Chunk[] = []
  for (const id of knowledgeIds) {
    if (scellees.has(id) && !hasMaster()) continue
    chunks.push(...(await db.chunks.where('knowledgeId').equals(id).toArray()))
  }
  if (!chunks.length) return []

  const meilleurs = chunks
    .map((c) => ({ c, score: produitScalaire(qVec, c.vector) }))
    .sort((a, b) => b.score - a.score)
    // En deçà, le passage n'a rien à voir avec la question : mieux vaut rien.
    .filter((x) => x.score > 0.35)
    .slice(0, topK)

  const passages: Passage[] = []
  for (const { c, score } of meilleurs) {
    const text = await openChunkText(c.text)
    if (text) passages.push({ text, docName: c.docName, score })
  }
  return passages
}

/** Bloc de contexte injecté en tête du prompt, avec les sources citées. */
export function contextBlock(passages: Passage[]): string {
  const corps = passages
    .map((p, i) => `[${i + 1}] (${p.docName})\n${p.text}`)
    .join('\n\n')
  return (
    'Contexte tiré des documents de l’utilisateur. Appuie-toi dessus en priorité ' +
    'et cite la source entre crochets (ex. [1]). Si le contexte ne répond pas, ' +
    'dis-le plutôt que d’inventer.\n\n' +
    corps
  )
}
