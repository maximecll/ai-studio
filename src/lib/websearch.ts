/** Recherche web — instance SearXNG locale, côté client.
 *
 * Le serveur héberge SearXNG ; ici on interroge, on met en forme pour le prompt,
 * et on suit l'installation. Les résultats sont cités comme les connaissances. */

export interface WebResult {
  title: string
  url: string
  content: string
  engine: string | null
}

export interface SearchStatus {
  installed: boolean
  running: boolean
  /** Environnement présent mais installation inachevée. */
  partial: boolean
  port: number
}

export type SearchEvent =
  | { type: 'phase'; phase: string; label: string }
  | { type: 'progress'; completed: number; total: number; speed: number; eta: number | null }
  | { type: 'log'; line: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

export async function searchStatus(): Promise<SearchStatus> {
  const res = await fetch('/search/status')
  if (!res.ok) throw new Error(`Erreur ${res.status}`)
  return res.json()
}

/** Interroge l'instance ; renvoie au plus `count` résultats. */
export async function webSearch(query: string, count = 5): Promise<WebResult[]> {
  const res = await fetch('/search/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, count }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Erreur ${res.status}`)
  return (await res.json()).results as WebResult[]
}

export async function resetSearch(): Promise<void> {
  await fetch('/search/reset', { method: 'POST' })
}

export async function* installSearch(): AsyncGenerator<SearchEvent> {
  const res = await fetch('/search/install', { method: 'POST' })
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
    for (const l of lignes) if (l.trim()) yield JSON.parse(l) as SearchEvent
  }
  if (buffer.trim()) yield JSON.parse(buffer) as SearchEvent
}

/** Met les résultats en forme pour le prompt, avec sources citables. */
export function webContextBlock(results: WebResult[]): string {
  const corps = results
    .map((r, i) => `[${i + 1}] ${r.title} — ${r.url}\n${r.content}`)
    .join('\n\n')
  return (
    'Résultats de recherche web (SearXNG). Appuie-toi dessus pour répondre à jour ' +
    'et cite la source entre crochets (ex. [1]). Ces extraits sont partiels : si ' +
    'l’information manque, dis-le plutôt que d’inventer.\n\n' +
    corps
  )
}
