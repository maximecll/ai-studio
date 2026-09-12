export type Role = 'system' | 'user' | 'assistant'

/** Options d'inférence Ollama. Toutes optionnelles : non définie = valeur du modèle. */
export interface Params {
  temperature?: number
  top_p?: number
  top_k?: number
  min_p?: number
  repeat_penalty?: number
  repeat_last_n?: number
  num_ctx?: number
  num_predict?: number
  seed?: number
  stop?: string[]
  mirostat?: 0 | 1 | 2
  mirostat_tau?: number
  mirostat_eta?: number
}

/** Une entrée de `logprobs` telle que renvoyée par Ollama. */
export interface TokenLogprob {
  token: string
  logprob: number
  top?: Array<{ token: string; logprob: number }>
}

export interface GenStats {
  totalDuration?: number
  loadDuration?: number
  promptEvalCount?: number
  promptEvalDuration?: number
  evalCount?: number
  evalDuration?: number
  /** Temps jusqu'au premier jeton, mesuré côté client (ms). */
  ttft?: number
  doneReason?: string
  /** Mesures d'incertitude calculées à partir des log-probabilités. */
  uncertainty?: {
    meanEntropy: number
    maxEntropy: number
    perplexity: number
    confidence: number
    samples: number
    topK: number
  }
}

export interface Message {
  id: string
  conversationId: string
  role: Role
  content: string
  /** Raisonnement séparé, pour les modèles « thinking ». */
  thinking?: string
  createdAt: number
  model?: string
  stats?: GenStats
  error?: string
  /** Replié dans la mémoire : conservé et lisible, mais plus transmis au modèle. */
  folded?: 0 | 1
}

/** Mode d'affichage de la transcription. */
export type Transcript = 'normal' | 'thinking' | 'detailed'

export interface Conversation {
  id: string
  title: string
  model: string
  system: string
  params: Params
  think?: boolean
  folderId: string | null
  tags: string[]
  pinned: 0 | 1
  archived: 0 | 1
  presetId: string | null
  autoTitled: 0 | 1
  /** Vue de transcription — normale, réflexion, détaillée. */
  transcript: Transcript
  /** Mémo Markdown alimenté au fil de la conversation. */
  memory: string
  memoryUpdatedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface Preset {
  id: string
  name: string
  /** Clé du jeu d'icônes lucide — cf. lib/preset-icons. */
  icon: string
  description: string
  /** Modèle imposé par le preset, ou null = garder le modèle courant. */
  model: string | null
  system: string
  params: Params
  createdAt: number
}

export interface Folder {
  id: string
  name: string
  color: string
  order: number
  createdAt: number
}

export type Theme = 'light' | 'dark' | 'system'
export type UIFont = 'dm' | 'satoshi' | 'inter'

export interface Settings {
  id: 'app'
  theme: Theme
  /** Fonte de l'interface : Satoshi (défaut) ou Inter. */
  fontFamily: UIFont
  defaultModel: string
  defaultSystem: string
  defaultParams: Params
  /** Génère un titre automatiquement après le premier échange. */
  autoTitle: boolean
  /** Entrée envoie le message (sinon Cmd+Entrée). */
  sendOnEnter: boolean
  showStats: boolean
  /** Demande les log-probabilités pour mesurer l'entropie (H₈). */
  measureEntropy: boolean
  /** Compacte la conversation dans sa mémoire quand le contexte se remplit. */
  autoCompact: boolean
  /** Vue de transcription appliquée aux nouvelles conversations. */
  defaultTranscript: Transcript
  /** Durée de maintien du modèle en mémoire (format Ollama : « 5m », « 1h », « 0 »). */
  keepAlive: string
  density: 'cosy' | 'compact'
}

/* ── Réponses de l'API Ollama ─────────────────────────────────────── */

export interface OllamaModel {
  name: string
  model: string
  modified_at: string
  size: number
  digest: string
  details?: {
    family?: string
    families?: string[]
    parameter_size?: string
    quantization_level?: string
    format?: string
    context_length?: number
    embedding_length?: number
  }
  capabilities?: string[]
  /** Présent uniquement via /api/ps. */
  expires_at?: string
  size_vram?: number
  context_length?: number
}

export interface ChatChunk {
  model: string
  created_at: string
  message?: { role: Role; content: string; thinking?: string }
  logprobs?: Array<{
    token: string
    logprob: number
    top_logprobs?: Array<{ token: string; logprob: number }>
  }>
  done: boolean
  done_reason?: string
  total_duration?: number
  load_duration?: number
  prompt_eval_count?: number
  prompt_eval_duration?: number
  eval_count?: number
  eval_duration?: number
}
