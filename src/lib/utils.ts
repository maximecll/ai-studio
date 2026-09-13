export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/**
 * UUID v4. `crypto.randomUUID` n'existe que dans un contexte sécurisé
 * (https, localhost) : sur un nom local en http, on retombe sur
 * `getRandomValues`, toujours disponible, pour ne pas casser l'application.
 */
export function uid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = [...b].map((n) => n.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Le chiffrement exige WebCrypto, donc un contexte sécurisé. */
export const isSecureContextAvailable =
  typeof window !== 'undefined' && window.isSecureContext && !!crypto.subtle

export function formatBytes(n?: number): string {
  if (!n) return '—'
  const u = ['o', 'Ko', 'Mo', 'Go', 'To']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('fr-FR').format(n)
}

/** Nanosecondes (Ollama) → « 1,4 s » / « 320 ms ». */
export function formatNs(ns?: number): string {
  if (!ns) return '—'
  const ms = ns / 1e6
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`
}

export function formatMs(ms?: number): string {
  if (ms === undefined) return '—'
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`
}

const RTF = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' })

export function relativeTime(ts: number): string {
  const diff = ts - Date.now()
  const abs = Math.abs(diff)
  const min = 60_000, hour = 3_600_000, day = 86_400_000
  if (abs < min) return "à l'instant"
  if (abs < hour) return RTF.format(Math.round(diff / min), 'minute')
  if (abs < day) return RTF.format(Math.round(diff / hour), 'hour')
  if (abs < day * 7) return RTF.format(Math.round(diff / day), 'day')
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(ts)
}

export function fullDate(ts: number): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(ts)
}

/** Regroupe des conversations par tranche temporelle, pour la barre latérale. */
export function timeBucket(ts: number): string {
  const now = new Date()
  const d = new Date(ts)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ts >= startOfToday) return "Aujourd'hui"
  if (ts >= startOfToday - 86_400_000) return 'Hier'
  if (ts >= startOfToday - 7 * 86_400_000) return '7 derniers jours'
  if (ts >= startOfToday - 30 * 86_400_000) return '30 derniers jours'
  if (d.getFullYear() === now.getFullYear()) {
    const m = new Intl.DateTimeFormat('fr-FR', { month: 'long' }).format(ts)
    return m.charAt(0).toUpperCase() + m.slice(1)
  }
  return String(d.getFullYear())
}

/** Vitesse de génération en jetons/seconde. */
export function tokensPerSecond(evalCount?: number, evalDuration?: number): number | undefined {
  if (!evalCount || !evalDuration) return undefined
  return evalCount / (evalDuration / 1e9)
}

export function download(filename: string, content: string, type = 'text/plain') {
  const blob = new Blob([content], { type: `${type};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function slugify(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'conversation'
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const modKey = isMac ? '⌘' : 'Ctrl'

/** Estimation grossière : ~4 caractères par jeton. Suffisant pour une jauge de contexte. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function debounce<T extends (...a: never[]) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

/**
 * Certains modèles émettent leur raisonnement en ligne dans `<think>…</think>`
 * au lieu du champ `thinking` de l'API. On l'isole pour l'afficher à part.
 */
export function splitThinking(raw: string): { thinking: string; content: string; open: boolean } {
  const s = raw.trimStart()
  if (!s.startsWith('<think>')) return { thinking: '', content: raw, open: false }
  const end = s.indexOf('</think>')
  if (end === -1) return { thinking: s.slice(7), content: '', open: true }
  return { thinking: s.slice(7, end), content: s.slice(end + 8).trimStart(), open: false }
}

/** « 14:32 » — heure courte, pour horodater messages et conversations. */
export function shortTime(ts: number): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(ts)
}

/** « 2 min 30 s », « 45 s » — durée restante, jamais au-delà de l'heure. */
export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—'
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

/** « 12,4 Mo/s » */
export function formatRate(bytesPerSecond: number): string {
  if (!bytesPerSecond || !Number.isFinite(bytesPerSecond)) return '—'
  return `${formatBytes(bytesPerSecond)}/s`
}

/** « 12,4 k » — nombre compact, lisible à toute échelle. */
export function formatCompact(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace('.', ',')} k`
  return `${(n / 1_000_000).toFixed(1).replace('.', ',')} M`
}

/**
 * Ressemblance grossière entre deux textes, sur leurs débuts normalisés.
 * Sert à repérer qu'un message recolle une réponse déjà présente — situation
 * où le modèle tend à la reproduire au lieu de l'exécuter.
 */
export function resembles(a: string, b: string, window = 240): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/```[a-z]*\n?/g, '').replace(/\s+/g, ' ').trim().slice(0, window)
  const x = norm(a)
  const y = norm(b)
  if (x.length < 80 || y.length < 80) return false
  return x.includes(y.slice(0, 120)) || y.includes(x.slice(0, 120))
}
