import { create } from 'zustand'
import { db } from '../lib/db'
import { chunkText, DEFAULT_EMBED_MODEL, embedBatch } from '../lib/rag'
import { uid } from '../lib/utils'
import { extractText, isPdf } from '../lib/extract'
import { hasMaster, sealChunkText } from '../lib/sealed'
import type { KnowledgeBase } from '../lib/types'
import { toast } from './ui'

/** Extensions texte qu'on sait indexer sans dépendance externe. */
const TEXTE = /\.(txt|md|markdown|mdx|rst|log|csv|tsv|json|ya?ml|toml|ini|cfg|conf|html?|xml|svg|tex|js|jsx|ts|tsx|py|rb|go|rs|java|kt|c|h|cpp|cc|hpp|cs|php|swift|sh|bash|zsh|sql|css|scss|vue|astro|dockerfile)$/i

function indexable(file: File): boolean {
  return isPdf(file) || file.type.startsWith('text/') || TEXTE.test(file.name) || file.type === 'application/json'
}

export interface Indexing {
  base: string
  label: string
  done: number
  total: number
}

interface DocCount {
  docs: number
  chunks: number
}

interface KnowledgeState {
  bases: KnowledgeBase[]
  counts: Record<string, DocCount>
  indexing: Indexing | null
  refresh: () => Promise<void>
  create: (name: string, sealed?: boolean) => Promise<string>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
  addFiles: (id: string, files: File[]) => Promise<void>
  removeDoc: (id: string, docId: string) => Promise<void>
}

async function counts(): Promise<Record<string, DocCount>> {
  const out: Record<string, DocCount> = {}
  const docsVus: Record<string, Set<string>> = {}
  await db.chunks.each((c) => {
    const bucket = (out[c.knowledgeId] ??= { docs: 0, chunks: 0 })
    bucket.chunks++
    const vus = (docsVus[c.knowledgeId] ??= new Set())
    if (!vus.has(c.docId)) { vus.add(c.docId); bucket.docs++ }
  })
  return out
}

export const useKnowledge = create<KnowledgeState>((set, get) => ({
  bases: [],
  counts: {},
  indexing: null,

  async refresh() {
    const [bases, c] = await Promise.all([
      db.knowledge.orderBy('createdAt').reverse().toArray(),
      counts(),
    ])
    set({ bases, counts: c })
  },

  async create(name, sealed = false) {
    const id = uid()
    const now = Date.now()
    await db.knowledge.add({
      id, name: name.trim() || 'Sans titre', embedModel: DEFAULT_EMBED_MODEL,
      sealed: sealed ? 1 : 0, createdAt: now, updatedAt: now,
    })
    await get().refresh()
    return id
  },

  async rename(id, name) {
    await db.knowledge.update(id, { name: name.trim() || 'Sans titre', updatedAt: Date.now() })
    await get().refresh()
  },

  async remove(id) {
    await db.transaction('rw', db.knowledge, db.chunks, async () => {
      await db.chunks.where('knowledgeId').equals(id).delete()
      await db.knowledge.delete(id)
    })
    await get().refresh()
  },

  /** Indexe des fichiers texte : lecture, découpage, vectorisation, stockage. */
  async addFiles(id, files) {
    const base = await db.knowledge.get(id)
    if (!base) return
    if (base.sealed && !hasMaster()) {
      toast({ title: 'Coffre fermé', description: 'Ouvrez le coffre pour indexer dans une base chiffrée.', tone: 'danger' })
      return
    }
    const bons = files.filter(indexable)
    const rejetes = files.length - bons.length
    if (rejetes > 0) {
      toast({ title: 'Fichiers ignorés', description: `${rejetes} fichier(s) non pris en charge (images, binaires…).`, tone: 'danger' })
    }
    if (!bons.length) return

    set({ indexing: { base: id, label: 'Lecture', done: 0, total: bons.length } })
    try {
      for (let i = 0; i < bons.length; i++) {
        const file = bons[i]
        set({ indexing: { base: id, label: file.name, done: i, total: bons.length } })
        const texte = await extractText(file)
        const morceaux = chunkText(texte)
        if (!morceaux.length) continue

        let vecteurs: number[][]
        try {
          vecteurs = await embedBatch(base.embedModel, morceaux)
        } catch (e) {
          toast({
            title: 'Indexation impossible',
            description: `Le modèle d’embedding « ${base.embedModel} » a échoué. Installez-le depuis Modèles. (${(e as Error).message})`,
            tone: 'danger',
          })
          return
        }

        const docId = uid()
        const now = Date.now()
        // Le texte du morceau est chiffré si la base l'est ; le vecteur reste
        // en clair, il sert à la recherche et ne restitue pas le texte.
        const rows = await Promise.all(
          morceaux.map(async (text, index) => ({
            id: uid(), knowledgeId: id, docId, docName: file.name, index,
            text: await sealChunkText(text, !!base.sealed), vector: vecteurs[index] ?? [], createdAt: now,
          })),
        )
        await db.chunks.bulkAdd(rows)
      }
      await db.knowledge.update(id, { updatedAt: Date.now() })
      toast({ title: 'Documents indexés', description: base.name, tone: 'success' })
    } finally {
      set({ indexing: null })
      await get().refresh()
    }
  },

  async removeDoc(id, docId) {
    await db.chunks.where({ knowledgeId: id, docId }).delete()
    await get().refresh()
  },
}))
