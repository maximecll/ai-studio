import { useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Boxes, Copy, Download, FileJson, Lock, LockOpen, MoreHorizontal, PanelLeft, Pencil, Pin,
  PinOff, Plus, Search, Settings as SettingsIcon, Sparkles, Trash2, X,
} from 'lucide-react'
import {
  deleteConversation, duplicateConversation, exportJSON, exportMarkdown, updateConversation,
} from '../../lib/db'
import { useConversations, useMediaQuery } from '../../lib/hooks'
import type { Conversation } from '../../lib/types'
import { cn, download, modKey, shortTime, slugify, timeBucket } from '../../lib/utils'
import { href, navigate, useRoute } from '../../lib/router'
import { useUI } from '../../store/ui'
import { useModels } from '../../store/models'
import { useVault } from '../../store/vault'
import { Button, ConfirmModal, Menu, MenuItem, MenuSeparator, Tooltip } from '../ui/primitives'

function StatusDot() {
  const status = useModels((s) => s.status)
  const version = useModels((s) => s.version)
  const map = {
    online: { color: 'bg-positive', label: `Ollama connecté${version ? ` · v${version}` : ''}` },
    offline: { color: 'bg-negative', label: 'Ollama injoignable' },
    loading: { color: 'bg-caution', label: 'Connexion…' },
    idle: { color: 'bg-fg-subtle', label: 'En attente' },
  }[status]
  return (
    <Tooltip label={map.label} side="bottom">
      <span className={cn('block size-1.5 rounded-full', map.color)} />
    </Tooltip>
  )
}

/** Ligne de navigation — hauteur 36px, rayon du palier « lignes ». */
function NavRow({
  icon, label, active, onClick, trailing,
}: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; trailing?: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-sm px-2.5',
        't-meta transition-colors duration-100',
        active ? 'bg-fg/[0.06] font-medium text-fg' : 'text-fg-muted hover:bg-fg/[0.04] hover:text-fg',
      )}
    >
      <span className="flex w-4 shrink-0 justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {trailing}
    </button>
  )
}

function ConversationRow({
  conv, active, onOpen, onAskDelete,
}: { conv: Conversation; active: boolean; onOpen: () => void; onAskDelete: () => void }) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(conv.title)
  const inputRef = useRef<HTMLInputElement>(null)

  const commit = () => {
    const t = draft.trim()
    setRenaming(false)
    if (t && t !== conv.title) void updateConversation(conv.id, { title: t, autoTitled: 1 })
    else setDraft(conv.title)
  }

  if (renaming) {
    return (
      <input
        ref={inputRef}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(conv.title); setRenaming(false) }
        }}
        className="t-meta h-9 w-full rounded-sm border border-accent bg-surface px-2.5 shadow-[0_0_0_3px_var(--accent-ring)] outline-none"
      />
    )
  }

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 34 }}
      className={cn(
        'group/row relative flex h-9 cursor-pointer items-center gap-2 rounded-sm px-2.5',
        't-meta transition-colors duration-100',
        active ? 'bg-fg/[0.06] font-medium text-fg' : 'text-fg-muted hover:bg-fg/[0.04] hover:text-fg',
      )}
      onClick={onOpen}
      onDoubleClick={() => { setDraft(conv.title); setRenaming(true) }}
    >
      {conv.locked === 1 && <Lock className="size-3 shrink-0 text-fg-subtle" />}
      {conv.pinned === 1 && <Pin className="size-3 shrink-0 -rotate-45 text-fg-subtle" />}
      <span className="min-w-0 flex-1 truncate">{conv.title}</span>
      <span className="t-caption shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover/row:opacity-0 sm:opacity-100">
        {shortTime(conv.createdAt)}
      </span>

      <div
        className="absolute right-1 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className={cn(
            'pointer-events-none absolute top-1/2 right-full h-9 w-8 -translate-y-1/2 bg-gradient-to-r from-transparent',
            active ? 'to-[color-mix(in_srgb,var(--fg)_6%,var(--nav))]' : 'to-[color-mix(in_srgb,var(--fg)_4%,var(--nav))]',
          )}
        />
        <Menu
          align="end"
          trigger={() => (
            <span className="relative flex size-7 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-fg/[0.08] hover:text-fg">
              <MoreHorizontal className="size-4" />
            </span>
          )}
        >
          <MenuItem icon={<Pencil className="size-4" />} onClick={() => { setDraft(conv.title); setRenaming(true) }}>
            Renommer
          </MenuItem>
          <MenuItem
            icon={conv.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
            onClick={() => void updateConversation(conv.id, { pinned: conv.pinned ? 0 : 1 })}
          >
            {conv.pinned ? 'Détacher' : 'Épingler'}
          </MenuItem>
          <MenuItem icon={<Copy className="size-4" />} onClick={() => void duplicateConversation(conv.id)}>
            Dupliquer
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={<Download className="size-4" />}
            onClick={async () => download(`${slugify(conv.title)}.md`, await exportMarkdown(conv.id), 'text/markdown')}
          >
            Exporter en Markdown
          </MenuItem>
          <MenuItem
            icon={<FileJson className="size-4" />}
            onClick={async () =>
              download(`${slugify(conv.title)}.json`, JSON.stringify(await exportJSON([conv.id]), null, 2), 'application/json')
            }
          >
            Exporter en JSON
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Trash2 className="size-4" />} danger onClick={onAskDelete}>Supprimer</MenuItem>
        </Menu>
      </div>
    </motion.div>
  )
}

export function Sidebar() {
  const conversations = useConversations() ?? []
  const { setSettingsOpen, setPresetsOpen, setVaultOpen, sidebarOpen, toggleSidebar } = useUI()
  const vault = useVault()
  const route = useRoute()
  const activeId = route.name === 'conversation' ? route.id : null
  const modelCount = useModels((s) => s.models.length)
  const [query, setQuery] = useState('')
  const [toDelete, setToDelete] = useState<Conversation | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations
  }, [conversations, query])

  const { pinned, groups } = useMemo(() => {
    const pinned = filtered.filter((c) => c.pinned === 1)
    const rest = filtered.filter((c) => c.pinned !== 1)
    const groups = new Map<string, Conversation[]>()
    for (const c of rest) {
      const k = timeBucket(c.updatedAt)
      const arr = groups.get(k)
      if (arr) arr.push(c)
      else groups.set(k, [c])
    }
    return { pinned, groups }
  }, [filtered])


  /* Sous 900 px, la barre passe en superposition : garder 272 px figés
     étranglerait la conversation. */
  const wide = useMediaQuery('(min-width: 901px)')
  if (!sidebarOpen) return null

  const panel = (
    <aside
      className={cn(
        'flex w-68 flex-col border-r border-line bg-nav',
        wide ? 'shrink-0' : 'fixed inset-y-0 left-0 z-50 shadow-float',
      )}
    >
      {/* En-tête — même hauteur que la barre du haut, à la ligne près */}
      <div className="flex h-14 shrink-0 items-center gap-2 px-3">
        <button
          onClick={() => navigate(href.home())}
          className="flex h-8 cursor-pointer items-center gap-2 rounded-full px-2 transition-colors hover:bg-fg/[0.05]"
        >
          <span className="text-[15px] leading-none font-bold tracking-[-0.02em]">AI Studio</span>
          <StatusDot />
        </button>
        <div className="ml-auto flex items-center gap-0.5">
          <Tooltip label="Nouvelle conversation" kbd={`${modKey}N`}>
            <Button size="icon-sm" onClick={() => navigate(href.home())} aria-label="Nouvelle conversation">
              <Plus className="size-4" strokeWidth={2.25} />
            </Button>
          </Tooltip>
          <Tooltip label="Masquer la barre latérale" kbd={`${modKey}B`}>
            <Button size="icon-sm" onClick={toggleSidebar} aria-label="Masquer la barre latérale">
              <PanelLeft className="size-4" />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="px-3 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher"
            className={cn(
              't-meta h-9 w-full rounded-full bg-fg/[0.04] pr-8 pl-9 text-fg',
              'transition-shadow placeholder:text-fg-subtle',
              'focus:bg-surface focus:shadow-[0_0_0_3px_var(--accent-ring)] focus:outline-none',
            )}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute top-1/2 right-2.5 -translate-y-1/2 text-fg-subtle transition-colors hover:text-fg"
              aria-label="Effacer"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin px-3 pb-2">
        {!query && (
          <button
            onClick={() => navigate(href.home())}
            className={cn(
              'mt-1 flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-sm px-2.5 t-meta',
              'transition-colors duration-100',
              route.name === 'home' ? 'bg-fg/[0.06] font-bold text-fg' : 'text-fg-muted hover:bg-fg/[0.04] hover:text-fg',
            )}
          >
            <span className="flex w-4 shrink-0 justify-center"><Plus className="size-4" /></span>
            <span className="flex-1 text-left">Nouvelle conversation</span>
            <span className="font-mono text-[11px] text-fg-subtle">{modKey}N</span>
          </button>
        )}
        {filtered.length === 0 && (
          <p className="t-caption px-2 py-10 text-center whitespace-pre-line text-fg-subtle">
            {query ? 'Aucun résultat.' : 'Aucune conversation.\nCommencez-en une.'}
          </p>
        )}

        {pinned.length > 0 && (
          <section className="mb-1">
            <h3 className="t-label px-2.5 pt-3 pb-1.5 text-fg-subtle">Épinglées</h3>
            {pinned.map((c) => (
              <ConversationRow
                key={c.id} conv={c} active={c.id === activeId}
                onOpen={() => navigate(href.conversation(c.id))} onAskDelete={() => setToDelete(c)}
              />
            ))}
          </section>
        )}

        {[...groups.entries()].map(([label, items]) => (
          <section key={label} className="mb-1">
            <h3 className="t-label px-2.5 pt-3 pb-1.5 text-fg-subtle">{label}</h3>
            {items.map((c) => (
              <ConversationRow
                key={c.id} conv={c} active={c.id === activeId}
                onOpen={() => navigate(href.conversation(c.id))} onAskDelete={() => setToDelete(c)}
              />
            ))}
          </section>
        ))}
      </div>

      <div className="border-t border-line p-3">
        <NavRow
          icon={<Boxes className="size-4" />} label="Modèles" active={route.name === 'models'} onClick={() => navigate(href.models())}
          trailing={modelCount ? <span className="font-mono text-[11px] text-fg-subtle">{modelCount}</span> : undefined}
        />
        <NavRow icon={<Sparkles className="size-4" />} label="Presets" onClick={() => setPresetsOpen(true)} />
        <NavRow
          icon={vault.unlocked ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
          label="Coffre"
          onClick={() => (vault.unlocked ? vault.lock() : setVaultOpen(true))}
          trailing={
            <span className={cn('t-caption', vault.unlocked ? 'text-positive' : 'text-fg-subtle')}>
              {vault.exists === false ? 'à créer' : vault.unlocked ? 'ouvert' : 'fermé'}
            </span>
          }
        />
        <NavRow
          icon={<SettingsIcon className="size-4" />} label="Réglages" onClick={() => setSettingsOpen(true)}
          trailing={<span className="font-mono text-[11px] text-fg-subtle">{modKey},</span>}
        />
      </div>

      <ConfirmModal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title={`Supprimer « ${toDelete?.title ?? ''} » ?`}
        confirmLabel="Supprimer"
        danger
        onConfirm={async () => {
          if (!toDelete) return
          await deleteConversation(toDelete.id)
          if (activeId === toDelete.id) navigate(href.home())
        }}
      />
    </aside>
  )

  if (wide) return panel
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-40 bg-black/40"
        onClick={toggleSidebar}
        aria-hidden
      />
      {panel}
    </>
  )
}
