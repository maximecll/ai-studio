import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronRight, Download, Heart, Loader2, Search, TriangleAlert, X } from 'lucide-react'
import * as hf from '../../lib/huggingface'
import type { HfModel, HfQuant } from '../../lib/huggingface'
import { cn, formatBytes, formatNumber } from '../../lib/utils'
import { useDownloads } from '../../store/downloads'
import { useModels } from '../../store/models'
import { Badge, Input, Tooltip } from '../ui/primitives'
import { BORDURE, COURT, gpuVerdict, PASTILLE, useHardware } from '../../lib/hardware'

/** Modèles de la bibliothèque Ollama, tirables par leur seul nom. */
const LIBRARY = [
  { name: 'llama3.2:3b', note: 'léger et rapide' },
  { name: 'qwen2.5:7b', note: 'très polyvalent' },
  { name: 'qwen2.5-coder:7b', note: 'spécial code' },
  { name: 'mistral:7b', note: 'solide en français' },
  { name: 'gemma2:9b', note: 'qualité Google' },
  { name: 'phi4:14b', note: 'raisonnement' },
  { name: 'deepseek-r1:7b', note: 'réflexion' },
  { name: 'nomic-embed-text', note: 'vecteurs' },
]

/** Quantisations dépliées d'un dépôt, avec leur poids réel. */
function Quants({ repo }: { repo: string }) {
  const [items, setItems] = useState<HfQuant[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const start = useDownloads((s) => s.start)
  const hardware = useHardware()

  useEffect(() => {
    const controller = new AbortController()
    setItems(null)
    setError(null)
    hf.quants(repo, controller.signal)
      .then(setItems)
      .catch((e: Error) => { if (e.name !== 'AbortError') setError(e.message) })
    return () => controller.abort()
  }, [repo])

  if (error) return <p className="t-caption px-4 pb-4 text-negative">{error}</p>
  if (!items) {
    return (
      <p className="t-caption flex items-center gap-2 px-4 pb-4 text-fg-subtle">
        <Loader2 className="size-3.5 animate-spin" /> Lecture des fichiers…
      </p>
    )
  }
  if (!items.length) {
    return (
      <p className="t-caption flex items-start gap-2 px-4 pb-4 text-fg-muted">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-caution" />
        Aucun fichier GGUF utilisable dans ce dépôt — Ollama ne sait pas le tirer.
      </p>
    )
  }

  /* Avant téléchargement, la forme du modèle est inconnue : le verdict porte
     sur le poids majoré, sans le cache d'attention. L'info-bulle le dit. */
  const verdictDe = (poids: number) =>
    hardware ? gpuVerdict(poids, null, 0, hardware.gpu, hardware.totalRam) : null

  return (
    <div className="flex flex-wrap gap-2 px-4 pb-4">
      {items.map((q) => {
        const v = verdictDe(q.size)
        const pastille = (
          <button
            onClick={() => void start(hf.reference(repo, q.label))}
            className={cn(
              'group flex h-9 cursor-pointer items-center gap-2 rounded-full border bg-surface px-3.5',
              'text-[13px] transition-colors duration-150 hover:bg-fg/[0.04]',
              v ? BORDURE[v.level] : 'border-line hover:border-line-strong',
            )}
          >
            <Download className="size-3.5 text-fg-subtle group-hover:text-fg" />
            <span className="font-mono font-bold text-fg">{q.label}</span>
            <span className="text-fg-subtle">{formatBytes(q.size)}</span>
            {v && (
              <span className="flex items-center gap-1.5 border-l border-line pl-2.5 text-fg-muted">
                <span className={cn('size-1.5 shrink-0 rounded-full', PASTILLE[v.level])} />
                {COURT[v.level]}
              </span>
            )}
          </button>
        )
        return v
          ? <Tooltip key={q.label} label={`${v.label} — ${v.tip}`} side="top">{pastille}</Tooltip>
          : <span key={q.label}>{pastille}</span>
      })}
      {hardware && (
        <p className="t-caption w-full text-fg-subtle">
          Compatibilité estimée sur le poids du fichier : le cache d’attention, qui dépend du contexte,
          s’y ajoutera une fois le modèle installé.
        </p>
      )}
    </div>
  )
}

function Result({ model }: { model: HfModel }) {
  const [open, setOpen] = useState(false)
  const installed = useModels((s) => s.models.some((m) => m.name.includes(model.id)))

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-fg/[0.03]"
      >
        <ChevronRight className={cn('size-4 shrink-0 text-fg-subtle transition-transform duration-200', open && 'rotate-90')} />
        <span className="min-w-0 flex-1">
          <span className="t-meta block truncate font-bold text-fg">{model.id.split('/')[1]}</span>
          <span className="t-caption block truncate text-fg-subtle">{model.id.split('/')[0]}</span>
        </span>
        {installed && <Badge tone="positive">installé</Badge>}
        {model.gated && <Badge tone="caution">accès restreint</Badge>}
        <span className="t-caption hidden shrink-0 items-center gap-3 font-mono tabular-nums text-fg-subtle sm:flex">
          <span className="flex items-center gap-1"><Download className="size-3" />{formatNumber(model.downloads)}</span>
          <span className="flex items-center gap-1"><Heart className="size-3" />{formatNumber(model.likes)}</span>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <Quants repo={model.id} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Recherche unifiée : la bibliothèque Ollama et Hugging Face au même endroit. */
export function ModelBrowser() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<HfModel[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const start = useDownloads((s) => s.start)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => {
    controller.current?.abort()
    const q = query.trim()
    if (q.length < 2) { setResults([]); setSearching(false); setError(null); return }

    const c = new AbortController()
    controller.current = c
    setSearching(true)
    const t = setTimeout(() => {
      hf.search(q, c.signal)
        .then((r) => { setResults(r); setError(null) })
        .catch((e: Error) => { if (e.name !== 'AbortError') setError(e.message) })
        .finally(() => { if (!c.signal.aborted) setSearching(false) })
    }, 320)

    return () => { clearTimeout(t); c.abort() }
  }, [query])

  const direct = hf.normalize(query)
  const looksLikeReference = /\//.test(query.trim())
  const library = LIBRARY.filter((m) => !query.trim() || m.name.includes(query.trim().toLowerCase()))

  return (
    <section className="rounded-lg bg-surface shadow-card">
      <div className="p-6 pb-5">
        <h2 className="t-section">Télécharger un modèle</h2>
        <p className="t-meta mt-1 text-fg-muted">
          Cherchez sur Hugging Face, piochez dans la bibliothèque Ollama, ou collez une référence.
        </p>

        <div className="relative mt-5">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-fg-subtle" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="qwen coder uncensored, llama3.2, hf.co/org/dépôt…"
            className="h-11 pr-10 pl-10"
            autoFocus
          />
          <span className="absolute top-1/2 right-3 -translate-y-1/2">
            {searching ? (
              <Loader2 className="size-4 animate-spin text-fg-subtle" />
            ) : query ? (
              <button onClick={() => setQuery('')} className="text-fg-subtle transition-colors hover:text-fg" aria-label="Effacer">
                <X className="size-4" />
              </button>
            ) : null}
          </span>
        </div>

        {/* Référence collée : on la propose directement, sans passer par la recherche. */}
        {looksLikeReference && (
          <button
            onClick={() => { void start(direct); setQuery('') }}
            className="mt-3 flex h-11 w-full cursor-pointer items-center gap-3 rounded-sm border border-line px-3.5 text-left transition-colors hover:bg-fg/[0.03]"
          >
            <Download className="size-4 shrink-0 text-fg-subtle" />
            <span className="min-w-0 flex-1">
              <span className="t-caption block text-fg-subtle">Télécharger cette référence</span>
              <span className="block truncate font-mono text-[13px] font-bold text-fg">{direct}</span>
            </span>
          </button>
        )}

        {library.length > 0 && (
          <div className="mt-4">
            <h3 className="t-label mb-2.5 text-fg-subtle">Bibliothèque Ollama</h3>
            <div className="flex flex-wrap gap-2">
              {library.map((m) => (
                <button
                  key={m.name}
                  onClick={() => void start(m.name)}
                  className={cn(
                    'group flex h-9 cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-3.5',
                    'text-[13px] transition-colors duration-150 hover:border-line-strong hover:bg-fg/[0.04]',
                  )}
                >
                  <Download className="size-3.5 text-fg-subtle group-hover:text-fg" />
                  <span className="font-medium text-fg">{m.name}</span>
                  <span className="text-fg-subtle">{m.note}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && <p className="t-caption border-t border-line px-6 py-4 text-negative">{error}</p>}

      {results.length > 0 && (
        <div className="border-t border-line">
          <h3 className="t-label px-6 pt-4 pb-2 text-fg-subtle">
            Hugging Face · {results.length} dépôts GGUF
          </h3>
          <div className="divide-y divide-[var(--line)] px-2 pb-2">
            {results.map((m) => <Result key={m.id} model={m} />)}
          </div>
        </div>
      )}

      {!searching && !results.length && query.trim().length >= 2 && !looksLikeReference && !error && (
        <p className="t-meta border-t border-line px-6 py-5 text-fg-muted">
          Aucun dépôt GGUF pour « {query.trim()} ». Ollama ne sait tirer que des fichiers GGUF :
          essayez d'ajouter <span className="font-mono">GGUF</span> à votre recherche.
        </p>
      )}
    </section>
  )
}
