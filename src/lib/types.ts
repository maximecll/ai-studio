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

/** Un LoRA retenu, avec son dosage. Le fichier est la clé : la bibliothèque est un dossier. */
export interface LoraChoice {
  file: string
  /** 0 = sans effet, 1 = tel qu'entraîné. Au-delà, l'image se rigidifie. */
  scale: number
}

/** Un fichier de la bibliothèque, tel que le serveur le décrit. */
export interface LoraFile {
  file: string
  name: string
  bytes: number
  /** Architecture déclarée dans les métadonnées. */
  architecture?: string
  /** Famille déduite des noms de tenseurs — fiable, c'est là-dessus qu'on tranche. */
  target?: string
  /** Largeur du modèle visé : ce qui sépare deux tailles d'une même famille. */
  width?: number
  /** Rang de l'adaptateur : sa capacité, et son poids. */
  rank?: number
  /** Mot déclencheur à placer dans la description, quand l'auteur en a prévu un. */
  trigger?: string
  /** Expert visé sur un modèle à double transformeur : « high » pour le bruit élevé, « low » pour le bruit faible. */
  expert?: 'high' | 'low'
}

/** Réglages de diffusion. */
export interface ImageParams {
  /** Identifiant du catalogue servi par `/images/status`. */
  model: string
  width: number
  height: number
  /** Pas de débruitage. Plus il y en a, plus l'image se précise — et se paie. */
  steps?: number
  /** Fidélité à la description. Sans effet sur schnell, qui n'a pas de branche de guidage. */
  guidance?: number
  /** Graine fixée à la main, pour reproduire une image à l'identique. */
  seed?: number | null
  /** LoRAs actifs. Liste vide ou absente : le modèle travaille seul. */
  loras?: LoraChoice[]
}

/** Ce qu'on garde d'une image produite. Les octets, eux, vivent dans `db.images`. */
export interface ImageMeta {
  /** Clé de la ligne portant les octets, dans la table `images`. */
  blobId: string
  prompt: string
  /** Identifiant du catalogue, et son libellé au moment de la génération. */
  model: string
  modelName: string
  width: number
  height: number
  steps: number
  seed: number
  guidance?: number
  /** LoRAs appliqués — avec la graine, c'est ce qui rend l'image reproductible. */
  loras?: LoraChoice[]
  /** Durée totale, chargement du modèle compris. */
  ms: number
  bytes: number
}

export interface Message {
  id: string
  conversationId: string
  role: Role
  content: string
  /** Image produite par diffusion — le message porte alors l'image, pas du texte. */
  image?: ImageMeta
  /** Réglages avec lesquels ce message a été envoyé au moteur de diffusion. */
  imageRequest?: ImageParams
  /** Images jointes à la question, transmises au modèle. */
  attachments?: Attachment[]
  /** Raisonnement séparé, pour les modèles « thinking ». */
  thinking?: string
  createdAt: number
  model?: string
  stats?: GenStats
  error?: string
  /** Replié dans la mémoire : conservé et lisible, mais plus transmis au modèle. */
  folded?: 0 | 1
}

/** Image jointe par l'utilisateur, lue par le modèle s'il a la vision. */
export interface Attachment {
  /** Clé de la ligne portant les octets, dans la table `images`. */
  blobId: string
  name: string
  type: string
  size: number
}

/** Octets d'une image, rangés à part des messages. */
export interface ImageBlob {
  id: string
  conversationId: string
  /** Chiffré si la conversation est verrouillée — d'où `iv`. */
  data: Blob
  sealed: 0 | 1
  iv?: string
  type: string
  createdAt: number
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
  /** Contenus chiffrés au repos, illisibles coffre fermé. */
  locked: 0 | 1
  /** Réglages de diffusion propres à cette conversation — modèle, format, LoRAs. */
  imageParams?: ImageParams
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


export interface ImageTiming {
  /** Chargement du modèle, hors débruitage. */
  loadMs: number
  /** Millisecondes par pas, ramenées à une surface de 768². */
  msPerStep768: number
  /** Nombre de générations ayant nourri la moyenne. */
  samples: number
}

export interface Settings {
  id: 'app'
  /** Nom d'affichage, utilisé dans la salutation de l'accueil. */
  displayName: string
  /** Le didacticiel de premier lancement a été vu ou ignoré. */
  onboarded: boolean
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
  /** Réglages de diffusion dont héritent les nouvelles conversations. */
  imageParams: ImageParams
  /** Durées relevées sur cette machine, par modèle d'images. Le catalogue ne
      donne qu'un ordre de grandeur : seule la machine sait ce qu'elle vaut. */
  imageTimings?: Record<string, ImageTiming>
  density: 'cosy' | 'compact'
}

/* ── Moteur d'images (cf. server/images.mjs) ──────────────────────── */

export interface ImageModel {
  id: string
  /** Famille d'architecture : décide de la classe employée, et des LoRAs compatibles. */
  family: string
  /** Moteur qui l'exécute — mflux, ou mlx-video pour les modèles vidéo. */
  runner: 'mflux' | 'mlx-video'
  name: string
  /** Niveau de quantification, tel qu'affiché à côté du nom. */
  variant: string
  repo: string
  base: string
  bytes: number
  steps: { default: number; min: number; max: number }
  /** Nul pour les modèles distillés, qui ignorent le guidage. */
  guidance: { default: number; min: number; max: number } | null
  /** Coût d'un pas à 768 × 768, en millisecondes. */
  msPerStep768: number
  /** Coût fixe par génération : chargement, encodage du texte, décodage final. */
  loadMs: number
  /** Famille de LoRAs acceptée, et largeur attendue de leurs matrices. */
  loraTarget?: string
  loraWidth?: number | null
  /** Deux transformeurs experts : les adaptateurs vont par paires. */
  dual?: boolean
  /** Mémoire résidente nécessaire pendant la génération, en octets. */
  needsRam?: number
  /** Vrai quand ce coût a été chronométré ici, faux quand il est déduit de la taille. */
  measured: boolean
  note: string
  recommended?: boolean
  /** Trop lourd pour la mémoire de la machine : à signaler avant de télécharger. */
  heavy?: boolean
  installed?: boolean
  onDisk?: number
  /** Transfert en cours, repéré sur le disque même s'il vient d'ailleurs. */
  downloading?: boolean
  /** Des morceaux partiels, mais plus aucun mouvement : reprenable. */
  partial?: boolean
  /** Avancement, de 0 à 1, tant que le modèle n'est pas installé. */
  progress?: number
}

export interface ImageEngine {
  ready: boolean
  busy: boolean
  engine?: string
  /** mflux sur puce Apple, diffusers partout ailleurs. */
  backend?: 'mflux' | 'diffusers'
  /** Appareil vu par PyTorch — seulement sur le chemin diffusers. */
  torch?: { device: 'cuda' | 'mps' | 'cpu'; name: string | null; vram: number } | null
  python?: string
  cache?: string
  free?: number
  /** Cache de morceaux Xet : un second espace disque, indépendant des poids. */
  xet?: number
  venv: string
  /** Environnement présent mais inutilisable : installation coupée. */
  partial?: boolean
  error?: string
  catalog: ImageModel[]
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
