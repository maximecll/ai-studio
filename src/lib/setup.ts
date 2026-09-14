/** Prérequis de la machine : Ollama et matériel graphique. */

export interface GpuInfo {
  name: string
  cores?: number
  /** Mémoire unifiée : le GPU puise dans la réserve du système. */
  unified: boolean
  vram: number
  source: string
}

export type GitAuto = 'auto' | 'apple' | 'paquets'

export type GitEvent =
  | { type: 'phase'; phase: string; label: string; asset?: string }
  | { type: 'progress'; completed: number; total: number; speed: number; eta: number | null }
  | { type: 'done'; version?: string; already?: boolean }
  | { type: 'error'; message: string }

export interface SetupStatus {
  git: boolean
  gitVersion: string | null
  gitSource: 'runtime' | 'system' | null
  /** Ce que l'application peut faire elle-même selon le système. */
  gitAuto: GitAuto
  platform: string
  arch: string
  supported: boolean
  asset: string | null
  ollamaRunning: boolean
  /** Trouvé quelque part sur la machine : archive portable, PATH, ou
      emplacement d'installation officiel. */
  ollamaInstalled: boolean
  ollamaSource: 'runtime' | 'path' | 'system' | null
  totalRam: number
  gpu: GpuInfo | null
}

export type SetupEvent =
  | { type: 'phase'; phase: string; label: string; asset?: string; bytes?: number }
  | { type: 'progress'; completed: number; total: number; speed: number; eta: number | null }
  | { type: 'done'; bin: string }
  | { type: 'error'; message: string }

export async function setupStatus(): Promise<SetupStatus> {
  const res = await fetch('/setup/status')
  if (!res.ok) throw new Error(`Erreur ${res.status}`)
  return res.json()
}

export async function* installOllama(): AsyncGenerator<SetupEvent> {
  const res = await fetch('/setup/ollama', { method: 'POST' })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Erreur ${res.status}`)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lignes = buffer.split('\n')
    buffer = lignes.pop() ?? ''
    for (const l of lignes) if (l.trim()) yield JSON.parse(l) as SetupEvent
  }
  if (buffer.trim()) yield JSON.parse(buffer) as SetupEvent
}

export async function* installGit(): AsyncGenerator<GitEvent> {
  const res = await fetch('/setup/git', { method: 'POST' })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Erreur ${res.status}`)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lignes = buffer.split('\n')
    buffer = lignes.pop() ?? ''
    for (const l of lignes) if (l.trim()) yield JSON.parse(l) as GitEvent
  }
  if (buffer.trim()) yield JSON.parse(buffer) as GitEvent
}
