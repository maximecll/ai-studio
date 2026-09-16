import type { ChatChunk, Message, OllamaModel, Params } from './types'

/** Tout passe par le proxy Vite/serveur local → aucune config CORS côté Ollama. */
const BASE = '/ollama'

export class OllamaError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'OllamaError'
  }
}

async function req(path: string, init?: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(BASE + path, init)
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new OllamaError("Ollama est injoignable. Le serveur est-il lancé ? (`ollama serve`)")
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    let msg = detail
    try {
      msg = JSON.parse(detail).error ?? detail
    } catch { /* texte brut */ }
    throw new OllamaError(msg || `Erreur ${res.status}`, res.status)
  }
  return res
}

/** Découpe un flux NDJSON en objets successifs. */
async function* ndjson<T>(res: Response, signal?: AbortSignal): AsyncGenerator<T> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
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
  } finally {
    if (signal?.aborted) reader.cancel().catch(() => {})
  }
}

export const ollama = {
  async version(): Promise<string> {
    const res = await req('/api/version')
    return (await res.json()).version
  },

  async list(): Promise<OllamaModel[]> {
    const res = await req('/api/tags')
    return (await res.json()).models ?? []
  },

  /** Modèles actuellement chargés en mémoire. */
  async running(): Promise<OllamaModel[]> {
    const res = await req('/api/ps')
    return (await res.json()).models ?? []
  },

  /** Vecteurs d'embedding. `input` peut être une chaîne ou un lot de chaînes. */
  async embed(model: string, input: string | string[]): Promise<number[][]> {
    const res = await req('/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input }),
    })
    return (await res.json()).embeddings ?? []
  },

  async show(model: string): Promise<Record<string, unknown>> {
    const res = await req('/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    })
    return res.json()
  },

  async remove(model: string): Promise<void> {
    await req('/api/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    })
  },

  /** Libère la mémoire occupée par un modèle (keep_alive = 0). */
  async unload(model: string): Promise<void> {
    await req('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: 0 }),
    })
  },

  async *pull(model: string, signal?: AbortSignal) {
    const res = await req('/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
      signal,
    })
    yield* ndjson<{ status: string; digest?: string; total?: number; completed?: number; error?: string }>(res, signal)
  },

  /** Flux de conversation. Renvoie les morceaux bruts de l'API. */
  async *chat(opts: {
    model: string
    /** `images` : base64 nu, ce qu'attend Ollama pour les modèles à vision. */
    messages: Array<Pick<Message, 'role' | 'content'> & { images?: string[] }>
    params?: Params
    think?: boolean
    keepAlive?: string
    /** Rang de la distribution demandée : 0 désactive la mesure. */
    topLogprobs?: number
    signal?: AbortSignal
  }) {
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.images?.length ? { images: m.images } : null),
      })),
      stream: true,
      options: cleanParams(opts.params ?? {}),
    }
    if (opts.think !== undefined) body.think = opts.think
    if (opts.keepAlive) body.keep_alive = keepAliveValue(opts.keepAlive)
    if (opts.topLogprobs) {
      body.logprobs = true
      body.top_logprobs = opts.topLogprobs
    }

    const res = await req('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    })
    yield* ndjson<ChatChunk>(res, opts.signal)
  },

  /** Génération courte non streamée — utilisée pour les titres automatiques. */
  async generate(model: string, prompt: string, params?: Params, signal?: AbortSignal): Promise<string> {
    const res = await req('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false, think: false, options: cleanParams(params ?? {}) }),
      signal,
    })
    return (await res.json()).response ?? ''
  },
}

/** Retire les champs vides pour laisser Ollama appliquer ses valeurs par défaut. */
export function cleanParams(p: Params): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) {
      const arr = v.filter((s) => String(s).length > 0)
      if (arr.length) out[k] = arr
      continue
    }
    if (typeof v === 'number' && Number.isNaN(v)) continue
    out[k] = v
  }
  return out
}

/** `keep_alive` accepte soit une durée (« 5m »), soit un nombre de secondes. */
export function keepAliveValue(raw: string): string | number {
  return /^-?\d+$/.test(raw.trim()) ? Number(raw) : raw
}

/** Contexte à ouvrir pour un modèle donné. */
export const CONTEXT_CAP = 32768

export function suggestedContext(model: OllamaModel | undefined): number {
  const max = model?.details?.context_length ?? 8192
  return Math.max(2048, Math.min(max, CONTEXT_CAP))
}

/** Ce qu'on retient de `/api/show` pour estimer l'empreinte mémoire. */
export interface ModelShape {
  layers: number
  kvHeads: number
  headDim: number
  maxContext: number
}

/** Extrait la forme du modèle des métadonnées GGUF, quel que soit son préfixe. */
export function readShape(show: Record<string, unknown>): ModelShape | null {
  const info = show.model_info as Record<string, number> | undefined
  if (!info) return null
  const pick = (suffix: string) =>
    Object.entries(info).find(([k]) => k.endsWith(suffix))?.[1]

  const layers = pick('block_count')
  const kvHeads = pick('attention.head_count_kv') ?? pick('attention.head_count')
  const heads = pick('attention.head_count')
  const embedding = pick('embedding_length')
  const headDim = pick('attention.key_length') ?? (embedding && heads ? embedding / heads : undefined)
  const maxContext = pick('context_length')

  if (!layers || !kvHeads || !headDim) return null
  return { layers, kvHeads, headDim, maxContext: maxContext ?? 8192 }
}

/** Octets de cache d'attention par jeton : deux tenseurs (clés et valeurs), une fois par couche, par tête KV, en demi-précision. */
export function kvBytesPerToken(shape: ModelShape): number {
  return 2 * shape.layers * shape.kvHeads * shape.headDim * 2
}

/** Marge pour les tampons de calcul, indépendante du contexte. */
const COMPUTE_OVERHEAD = 320_000_000

export interface MemoryEstimate {
  weights: number
  cache: number
  total: number
}

export function estimateMemory(weightsBytes: number, shape: ModelShape | null, numCtx: number): MemoryEstimate | null {
  if (!shape) return null
  const cache = kvBytesPerToken(shape) * numCtx
  return { weights: weightsBytes, cache, total: weightsBytes + cache + COMPUTE_OVERHEAD }
}

export function hasCapability(m: OllamaModel | undefined, cap: string): boolean {
  return !!m?.capabilities?.includes(cap)
}

/** Ne garde que le nom du modèle : on retire l'organisation, l'étiquette, puis les marqueurs de réglage et de quantisation. */
const NOISE = new RegExp(
  '^(' +
    'gguf|ggml|safetensors|awq|gptq|exl2|mlx|' +
    'nvfp4|fp4|fp8|fp16|bf16|int4|int8|q\d[\w.]*|iq\d[\w.]*|k[sml]|\d+bpw|' +
    'uncensored|heretic|abliterated|unaligned|unfiltered|' +
    'dpo|sft|rlhf|lora|merge|finetune|ft' +
  ')$',
  'i',
)

export function prettyModel(name: string): string {
  const last = (name.split('/').pop() ?? name).replace(/:latest$/, '')
  const [base, tag] = last.split(':')
  const strip = (s: string) => {
    const kept = s.split('-').filter((part) => !NOISE.test(part))
    return (kept.length ? kept : [s]).join('-')
  }
  const clean = strip(base)
  return tag ? `${clean}:${strip(tag)}` : clean
}

export function modelOwner(name: string): string | null {
  const noTag = name.replace(/:latest$/, '')
  const parts = noTag.split('/')
  return parts.length > 1 ? parts.slice(0, -1).join('/') : null
}
