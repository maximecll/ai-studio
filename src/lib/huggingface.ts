/**
 * Recherche de modèles GGUF sur Hugging Face.
 *
 * L'API publique restreint son CORS : tout passe par le relais `/hf` du
 * serveur local. Ollama ne sait tirer que du GGUF, d'où le filtre.
 */

const BASE = '/hf/api'

export interface HfModel {
  id: string
  downloads: number
  likes: number
  updatedAt: string
  gated: boolean
}

export interface HfQuant {
  /** Étiquette telle qu'attendue par Ollama : Q4_K_M, IQ4_XS, F16… */
  label: string
  file: string
  size: number
}

/** Motif des quantisations GGUF usuelles, où qu'elles soient dans le nom. */
const QUANT = /(IQ\d+_[A-Z]+(?:_[A-Z]+)?|Q\d+_K_[A-Z]+|Q\d+_K|Q\d+_\d+|BF16|F16|F32)/i

/** Ordre de présentation : du plus léger au plus fidèle. */
const ORDER = ['Q2', 'Q3', 'IQ3', 'Q4', 'IQ4', 'Q5', 'Q6', 'Q8', 'F16', 'BF16', 'F32']

function rank(label: string): number {
  const i = ORDER.findIndex((p) => label.toUpperCase().startsWith(p))
  return i === -1 ? ORDER.length : i
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(BASE + path, { signal, headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`Hugging Face a répondu ${res.status}`)
  return res.json() as Promise<T>
}

export async function search(query: string, signal?: AbortSignal): Promise<HfModel[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const params = new URLSearchParams({
    search: q,
    filter: 'gguf',
    sort: 'downloads',
    direction: '-1',
    limit: '18',
  })
  const raw = await get<Array<Record<string, unknown>>>(`/models?${params}`, signal)
  return raw.map((m) => ({
    id: String(m.id),
    downloads: Number(m.downloads ?? 0),
    likes: Number(m.likes ?? 0),
    updatedAt: String(m.lastModified ?? m.createdAt ?? ''),
    gated: Boolean(m.gated),
  }))
}

/** Quantisations disponibles dans un dépôt, avec leur poids réel. */
export async function quants(repo: string, signal?: AbortSignal): Promise<HfQuant[]> {
  const tree = await get<Array<{ path: string; size?: number; lfs?: { size?: number } }>>(
    `/models/${repo}/tree/main`,
    signal,
  )
  const found = new Map<string, HfQuant>()
  for (const entry of tree) {
    if (!entry.path.toLowerCase().endsWith('.gguf')) continue
    // Les fichiers scindés (…-00001-of-00003.gguf) ne sont pas gérés par Ollama.
    if (/-\d{5}-of-\d{5}\.gguf$/i.test(entry.path)) continue
    const label = QUANT.exec(entry.path)?.[1]?.toUpperCase()
    if (!label || found.has(label)) continue
    found.set(label, { label, file: entry.path, size: entry.lfs?.size ?? entry.size ?? 0 })
  }
  return [...found.values()].sort((a, b) => rank(a.label) - rank(b.label) || a.size - b.size)
}

/** Référence à passer à Ollama pour ce dépôt et cette quantisation. */
export function reference(repo: string, quant?: string): string {
  return quant ? `hf.co/${repo}:${quant}` : `hf.co/${repo}`
}

/**
 * Rend utilisable ce que l'utilisateur a tapé.
 * Une URL Hugging Face, un « org/dépôt » ou une référence déjà complète
 * aboutissent tous à quelque chose qu'Ollama comprend.
 */
export function normalize(input: string): string {
  let s = input.trim()
  if (!s) return s

  const url = /^https?:\/\/(?:www\.)?(?:huggingface\.co|hf\.co)\/([^/]+\/[^/?#]+)/i.exec(s)
  if (url) return `hf.co/${url[1]}`

  s = s.replace(/^https?:\/\//i, '')
  if (/^(hf\.co|huggingface\.co)\//i.test(s)) return s.replace(/^huggingface\.co\//i, 'hf.co/')

  // « org/dépôt » sans préfixe : c'est une référence Hugging Face.
  const parts = s.split(':')[0].split('/')
  if (parts.length === 2 && parts.every(Boolean)) return `hf.co/${s}`

  // Sinon c'est un nom de la bibliothèque Ollama.
  return s
}

/** Un dépôt Hugging Face sans GGUF ne peut pas être tiré par Ollama. */
export function explainFailure(reference: string): string | null {
  if (!/^hf\.co\//i.test(reference)) return null
  return (
    "Ollama ne sait tirer que des dépôts contenant des fichiers GGUF. " +
    "Cherchez le même modèle avec « GGUF » dans le nom du dépôt."
  )
}
