import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Boxes, CornerDownLeft, MessageSquare, Moon, Plus, Search, Settings as SettingsIcon,
  Sparkles, Sun, PanelLeft, SlidersHorizontal, Monitor,
} from 'lucide-react'
import { patchSettings, search as searchDb, updateConversation } from '../../lib/db'
import { useSettings } from '../../lib/hooks'
import type { SearchHit } from '../../lib/db'
import { cn, modKey } from '../../lib/utils'
import { prettyModel } from '../../lib/ollama'
import { useModels } from '../../store/models'
import { useUI } from '../../store/ui'
import { href, navigate, useRoute } from '../../lib/router'

interface Command {
  id: string
  label: string
  hint?: string
  icon: React.ReactNode
  group: string
  keywords?: string
  run: () => void | Promise<void>
}

export function CommandPalette() {
  const ui = useUI()
  const settings = useSettings()
  const models = useModels((s) => s.models)
  const route = useRoute()
  const activeId = route.name === 'conversation' ? route.id : null
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ui.paletteOpen) { setQuery(''); setIndex(0); setHits([]) }
  }, [ui.paletteOpen])

  useEffect(() => {
    let alive = true
    const t = setTimeout(async () => {
      const r = query.trim().length >= 2 ? await searchDb(query, 8) : []
      if (alive) setHits(r)
    }, 110)
    return () => { alive = false; clearTimeout(t) }
  }, [query])

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      {
        id: 'new', label: 'Nouvelle conversation', icon: <Plus size={16} />, group: 'Actions',
        hint: `${modKey}N`, keywords: 'créer chat discussion',
        run: () => navigate(href.home()),
      },
      { id: 'models', label: 'Gérer les modèles', icon: <Boxes size={16} />, group: 'Actions', keywords: 'télécharger pull vram', run: () => navigate(href.models()) },
      { id: 'presets', label: 'Gérer les presets', icon: <Sparkles size={16} />, group: 'Actions', keywords: 'persona instructions', run: () => ui.setPresetsOpen(true) },
      { id: 'settings', label: 'Ouvrir les réglages', icon: <SettingsIcon size={16} />, group: 'Actions', hint: `${modKey},`, run: () => ui.setSettingsOpen(true) },
      { id: 'sidebar', label: 'Afficher/masquer la barre latérale', icon: <PanelLeft size={16} />, group: 'Affichage', hint: `${modKey}B`, run: ui.toggleSidebar },
      { id: 'inspector', label: 'Afficher/masquer les paramètres', icon: <SlidersHorizontal size={16} />, group: 'Affichage', hint: `${modKey}I`, run: ui.toggleInspector },
      {
        id: 'theme-light', label: 'Thème clair', icon: <Sun size={16} />, group: 'Affichage',
        keywords: 'jour blanc', run: () => void patchSettings({ theme: 'light' }),
      },
      {
        id: 'theme-dark', label: 'Thème sombre', icon: <Moon size={16} />, group: 'Affichage',
        keywords: 'nuit noir', run: () => void patchSettings({ theme: 'dark' }),
      },
      {
        id: 'theme-system', label: 'Thème système', icon: <Monitor size={16} />, group: 'Affichage',
        keywords: 'auto', run: () => void patchSettings({ theme: 'system' }),
      },
    ]

    const modelCmds: Command[] = activeId
      ? models.map((m) => ({
          id: `model-${m.name}`,
          label: prettyModel(m.name),
          hint: m.details?.parameter_size,
          icon: <Boxes size={16} />,
          group: 'Changer de modèle',
          keywords: m.name,
          run: () => void updateConversation(activeId!, { model: m.name }),
        }))
      : []

    return [...base, ...modelCmds]
  }, [ui, settings.defaultModel, models, activeId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands.filter((c) => c.group !== 'Changer de modèle')
    return commands.filter((c) => (c.label + ' ' + (c.keywords ?? '')).toLowerCase().includes(q))
  }, [commands, query])

  const rows = useMemo(
    () => [
      ...filtered.map((c) => ({ kind: 'cmd' as const, cmd: c })),
      ...hits.map((h) => ({ kind: 'hit' as const, hit: h })),
    ],
    [filtered, hits],
  )

  useEffect(() => { setIndex((i) => Math.min(i, Math.max(0, rows.length - 1))) }, [rows.length])

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (!ui.paletteOpen) return null

  const runRow = (i: number) => {
    const row = rows[i]
    if (!row) return
    ui.setPalette(false)
    if (row.kind === 'cmd') void row.cmd.run()
    else navigate(href.conversation(row.hit.conversation.id))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => (i + 1) % Math.max(1, rows.length)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => (i - 1 + rows.length) % Math.max(1, rows.length)) }
    if (e.key === 'Enter') { e.preventDefault(); runRow(index) }
    if (e.key === 'Escape') { e.preventDefault(); ui.setPalette(false) }
  }

  let lastGroup = ''

  return (
    <div className="fixed inset-0 z-70 flex items-start justify-center p-6 pt-[12vh]">
      <div className="fixed inset-0 bg-[#333]/25 backdrop-blur-[2px] dark:bg-black/60" onClick={() => ui.setPalette(false)} />
      <div className="relative w-full max-w-xl animate-pop overflow-hidden rounded-lg bg-surface shadow-float">
        <div className="flex h-16 items-center gap-3 border-b border-line px-5">
          <Search size={16} className="shrink-0 text-fg-subtle" />
          <input
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setIndex(0) }}
            onKeyDown={onKeyDown}
            placeholder="Rechercher une conversation ou lancer une action…"
            className="h-16 w-full bg-transparent text-[15px] outline-none placeholder:text-fg-subtle"
          />
          <kbd className="shrink-0 rounded-sm border border-line px-2 py-1 font-mono text-[11px] leading-none text-fg-subtle">esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto scroll-thin p-2">
          {rows.length === 0 && (
            <p className="px-3 py-10 text-center text-[14px] text-fg-subtle">Aucun résultat.</p>
          )}
          {rows.map((row, i) => {
            const group = row.kind === 'cmd' ? row.cmd.group : 'Conversations'
            const header = group !== lastGroup ? group : null
            lastGroup = group
            const active = i === index
            return (
              <div key={row.kind === 'cmd' ? row.cmd.id : row.hit.conversation.id}>
                {header && <h3 className="t-label px-3 pt-3 pb-1.5 text-fg-subtle">{header}</h3>}
                <button
                  data-active={active}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => runRow(i)}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-3 rounded-sm px-3 py-2 text-left transition-colors duration-100',
                    active ? 'bg-fg/[0.06]' : 'hover:bg-fg/[0.035]',
                  )}
                >
                  <span className={cn('flex w-4 shrink-0 justify-center', active ? 'text-fg' : 'text-fg-muted')}>
                    {row.kind === 'cmd' ? row.cmd.icon : <MessageSquare size={16} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-[14px]', active ? 'font-bold text-fg' : 'font-medium')}>
                      {row.kind === 'cmd' ? row.cmd.label : row.hit.conversation.title}
                    </span>
                    {row.kind === 'hit' && row.hit.snippet && (
                      <span className="mt-0.5 block truncate text-[12px] text-fg-subtle">{row.hit.snippet}</span>
                    )}
                  </span>
                  {row.kind === 'cmd' && row.cmd.hint && (
                    <span className="shrink-0 font-mono text-[11px] text-fg-subtle">{row.cmd.hint}</span>
                  )}
                  {active && <CornerDownLeft size={14} className="shrink-0 text-fg-subtle" />}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
