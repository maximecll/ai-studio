/** Mises à jour du dépôt, pilotées depuis l'interface. */

export interface Commit {
  sha: string
  subject: string
}

export interface UpdateStatus {
  repo: boolean
  upstream?: string | null
  head?: string
  behind: number
  dirty?: boolean
  /** Lancé par un lanceur capable de le relancer tout seul. */
  supervised?: boolean
  commits?: Commit[]
  reason?: string
}

export type UpdateEvent =
  | { type: 'phase'; label: string }
  | { type: 'log'; line: string }
  | { type: 'done'; restart: boolean; head?: string }
  | { type: 'error'; message: string }

export async function updateStatus(force = false): Promise<UpdateStatus> {
  const res = await fetch(`/update/status${force ? '?force=1' : ''}`)
  if (!res.ok) throw new Error(`Erreur ${res.status}`)
  return res.json()
}

export async function* applyUpdate(): AsyncGenerator<UpdateEvent> {
  const res = await fetch('/update/apply', { method: 'POST' })
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
    for (const l of lignes) if (l.trim()) yield JSON.parse(l) as UpdateEvent
  }
  if (buffer.trim()) yield JSON.parse(buffer) as UpdateEvent
}

/** Le serveur redémarre : on attend qu'il réponde de nouveau. */
export async function waitForServer(timeoutMs = 180_000): Promise<boolean> {
  const fin = Date.now() + timeoutMs
  // Le port reste ouvert un instant après l'appel : laisser le temps de tomber.
  await new Promise((r) => setTimeout(r, 1500))
  while (Date.now() < fin) {
    try {
      const res = await fetch('/update/status', { cache: 'no-store' })
      if (res.ok) return true
    } catch { /* pas encore relancé */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}
