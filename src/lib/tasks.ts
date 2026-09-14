/** Tâches longues du serveur : on s'y rattache, on ne les possède pas. */

export interface TaskEvent {
  type: 'phase' | 'progress' | 'log' | 'done' | 'error'
  [k: string]: unknown
}

export interface TaskSummary {
  id: string
  kind: 'llm' | 'engine' | 'image' | 'ollama' | 'git'
  label: string
  startedAt: number
  done: boolean
  last: TaskEvent | null
}

export async function listTasks(): Promise<TaskSummary[]> {
  try {
    const res = await fetch('/tasks')
    if (!res.ok) return []
    return (await res.json()).tasks ?? []
  } catch {
    return []
  }
}

async function* ndjson(res: Response): AsyncGenerator<TaskEvent> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let tampon = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    tampon += decoder.decode(value, { stream: true })
    const lignes = tampon.split('\n')
    tampon = lignes.pop() ?? ''
    for (const l of lignes) if (l.trim()) yield JSON.parse(l) as TaskEvent
  }
  if (tampon.trim()) yield JSON.parse(tampon) as TaskEvent
}

/** Lance la tâche, ou rejoint celle qui porte déjà le même identifiant. */
export async function* startTask(kind: string, arg?: unknown): AsyncGenerator<TaskEvent> {
  const res = await fetch('/tasks/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, arg }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Erreur ${res.status}`)
  yield* ndjson(res)
}

/** Rejoue ce qui a été manqué, puis suit la suite. */
export async function* attachTask(id: string): AsyncGenerator<TaskEvent> {
  const res = await fetch(`/tasks/${encodeURIComponent(id)}`)
  if (!res.ok) return
  yield* ndjson(res)
}

export async function cancelTask(id: string): Promise<void> {
  await fetch(`/tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST' }).catch(() => {})
}
