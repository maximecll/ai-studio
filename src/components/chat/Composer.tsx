import { useEffect, useRef, useState } from 'react'
import { Brain, Check, ChevronDown, Circle, Globe, Image as ImageIcon, Library, Paperclip, Send, Square, TriangleAlert } from 'lucide-react'
import { imageParamsOf, updateConversation } from '../../lib/db'
import { useOnline, usePresets } from '../../lib/hooks'
import type { Conversation, ImageParams, Settings } from '../../lib/types'
import { cn, estimateTokens, formatCompact, formatNumber, modKey } from '../../lib/utils'
import { hasCapability, prettyModel } from '../../lib/ollama'
import { PresetGlyph } from '../../lib/preset-icons'
import { findModel, useModels } from '../../store/models'
import { useChat } from '../../store/chat'
import { useKnowledge } from '../../store/knowledge'
import { useSearch } from '../../store/search'
import { Button, Chip, Menu, MenuItem, MenuLabel, MenuSeparator, MorphButton, Tooltip } from '../ui/primitives'
import { useAttachments } from '../../lib/attachments'
import { PendingStrip } from './Attachments'
import { MetalSend } from './MetalSend'
import { href, navigate } from '../../lib/router'
import { ImageControls, ModeToggle, useImageEngine } from './ImageControls'

/** Sélecteur de modèle — placé là où l'on écrit, pas dans l'en-tête. */
function ModelChip({ conv }: { conv: Conversation }) {
  const switchModel = useChat((s) => s.switchModel)
  const models = useModels((s) => s.models)
  const running = useModels((s) => s.running)
  const loaded = (name: string) => running.some((r) => r.name === name)

  return (
    <Menu
      side="top"
      width="w-80"
      trigger={({ open }) => (
        <Chip as="span" active={open} className="min-w-0 max-w-[min(46vw,240px)]">
          {loaded(conv.model) && <span className="size-1.5 shrink-0 rounded-full bg-positive" />}
          <span className="truncate">
            {conv.model ? prettyModel(conv.model) : <span className="text-fg-subtle">Choisir un modèle</span>}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
        </Chip>
      )}
    >
      <MenuLabel>Modèle</MenuLabel>
      {models.length === 0 && (
        <p className="t-caption px-2.5 py-3 text-fg-muted">Aucun modèle installé.</p>
      )}
      {models.map((m) => (
        <MenuItem
          key={m.name}
          active={m.name === conv.model}
          icon={m.name === conv.model ? <Check className="size-4 text-fg" /> : null}
          onClick={() => void switchModel(conv.id, m.name, m.details?.context_length ?? 8192)}
        >
          <span className="flex items-center gap-2">
            <span className="truncate">{prettyModel(m.name)}</span>
            {m.details?.parameter_size && (
              <span className="shrink-0 font-mono text-[11px] text-fg-subtle">{m.details.parameter_size}</span>
            )}
            {loaded(m.name) && <span className="size-1.5 shrink-0 rounded-full bg-positive" />}
          </span>
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem onClick={() => navigate(href.models())}>Gérer les modèles…</MenuItem>
    </Menu>
  )
}

/** Sélecteur de preset — même capsule, même hauteur, même graisse. */
function KnowledgeChip({ conv }: { conv: Conversation }) {
  const bases = useKnowledge((s) => s.bases)
  const refresh = useKnowledge((s) => s.refresh)
  useEffect(() => { void refresh() }, [refresh])

  const active = conv.knowledgeIds ?? []
  if (!bases.length) return null

  const toggle = (id: string) => {
    const next = active.includes(id) ? active.filter((x) => x !== id) : [...active, id]
    void updateConversation(conv.id, { knowledgeIds: next })
  }
  const n = active.filter((id) => bases.some((b) => b.id === id)).length

  return (
    <Menu
      side="top"
      width="w-64"
      trigger={({ open }) => (
        <Chip as="span" active={open || n > 0} className="min-w-0 shrink">
          <Library className="size-3.5 shrink-0" />
          <span className="max-w-28 truncate">{n > 0 ? `${n} base${n > 1 ? 's' : ''}` : 'Connaissances'}</span>
          <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
        </Chip>
      )}
    >
      <MenuLabel>Bases actives dans ce fil</MenuLabel>
      {bases.map((b) => (
        <MenuItem
          key={b.id}
          active={active.includes(b.id)}
          icon={active.includes(b.id) ? <Check className="size-4 text-fg" /> : <Circle className="size-4" />}
          onClick={() => toggle(b.id)}
        >
          {b.name}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem onClick={() => navigate(href.knowledge())}>Gérer les connaissances…</MenuItem>
    </Menu>
  )
}

/** Bascule « Recherche web » : le fil consulte SearXNG avant de répondre.
    Tant que rien n'est installé, le clic mène aux Réglages plutôt que d'activer.
    Hors ligne, la bascule est bloquée : la recherche a besoin d'Internet. */
function WebSearchChip({ conv }: { conv: Conversation }) {
  const status = useSearch((s) => s.status)
  const refresh = useSearch((s) => s.refresh)
  const online = useOnline()
  useEffect(() => { void refresh() }, [refresh])

  const installed = !!status?.installed
  const on = !!conv.webSearch
  const bloque = !online

  const clic = () => {
    if (bloque) return
    if (!installed) return navigate(href.settings())
    void updateConversation(conv.id, { webSearch: !on })
  }

  const infobulle = bloque
    ? 'Recherche web indisponible hors ligne'
    : installed
      ? (on ? 'Recherche web active' : 'Activer la recherche web')
      : 'Installer la recherche web (Réglages)'

  return (
    <Tooltip label={infobulle}>
      <Chip
        as="button"
        active={on && !bloque}
        onClick={clic}
        aria-disabled={bloque}
        className={cn('min-w-0 shrink-0', bloque && 'cursor-not-allowed opacity-45')}
      >
        <Globe className={cn('size-3.5 shrink-0', (!installed || bloque) && 'text-fg-subtle')} />
        <span className="max-w-28 truncate">{bloque ? 'Hors ligne' : 'Web'}</span>
      </Chip>
    </Tooltip>
  )
}

function PresetChip({ conv }: { conv: Conversation }) {
  const presets = usePresets()
  const current = presets.find((p) => p.id === conv.presetId)

  return (
    <Menu
      side="top"
      width="w-64"
      trigger={({ open }) => (
        <Chip as="span" active={open || !!current} className="min-w-0 shrink">
          {current ? <PresetGlyph name={current.icon} className="size-3.5" /> : <Circle className="size-3.5" />}
          <span className="max-w-28 truncate">{current?.name ?? 'Preset'}</span>
          <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
        </Chip>
      )}
    >
      <MenuLabel>Preset</MenuLabel>
      <MenuItem
        active={!conv.presetId}
        icon={<Circle className="size-4" />}
        onClick={() => void updateConversation(conv.id, { presetId: null })}
      >
        Aucun
      </MenuItem>
      {presets.map((p) => (
        <MenuItem
          key={p.id}
          active={p.id === conv.presetId}
          icon={<PresetGlyph name={p.icon} />}
          onClick={() =>
            void updateConversation(conv.id, {
              presetId: p.id,
              system: p.system,
              params: { ...conv.params, ...p.params },
              ...(p.model ? { model: p.model } : {}),
            })
          }
        >
          {p.name}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem onClick={() => navigate(href.presets())}>Gérer les presets…</MenuItem>
    </Menu>
  )
}

/** Bascule texte / image. */
export function useComposerMode(conversationId: string) {
  const [mode, setMode] = useState<'text' | 'image'>('text')
  useEffect(() => {
    setMode(sessionStorage.getItem(`mode.${conversationId}`) === 'image' ? 'image' : 'text')
  }, [conversationId])
  const choose = (next: 'text' | 'image') => {
    setMode(next)
    sessionStorage.setItem(`mode.${conversationId}`, next)
  }
  return [mode, choose] as const
}

/**
 * Coquille du composeur : un tiroir, un en-tête, le champ, un pied, un statut.
 *
 * Les emplacements nommés viennent du ChatComposer d'Astryx, sans la
 * bibliothèque : elle pesait un tiers du paquet et restylait toute
 * l'application. La jauge de contexte, elle, reste au pied près du bouton
 * d'envoi — la remonter en en-tête lui donnait une ligne pour rien et
 * désaccordait le mode texte du mode image.
 */
function ComposerShell({
  drawer, footerActions, sendActions, sendButton, status, survol, children, ...zone
}: {
  drawer?: React.ReactNode
  footerActions: React.ReactNode
  sendActions?: React.ReactNode
  sendButton: React.ReactNode
  status?: React.ReactNode
  survol: boolean
  children: React.ReactNode
} & Pick<React.HTMLAttributes<HTMLDivElement>, 'onDragOver' | 'onDragLeave' | 'onDrop'>) {
  return (
    <>
      <div
        {...zone}
        className={cn(
          'rounded-lg bg-surface transition-shadow duration-200',
          'shadow-card focus-within:shadow-float',
          survol && 'ring-2 ring-accent',
        )}
      >
        {drawer}

        {children}

        {/* Groupe de gauche compressible, groupe de droite intouchable : le
            bouton d'envoi reste dans la carte à toute largeur. */}
        <div className="flex h-14 items-center gap-1.5 px-3">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">{footerActions}</div>
          <div className="flex shrink-0 items-center gap-2">
            {sendActions}
            {sendButton}
          </div>
        </div>
      </div>

      {status}
    </>
  )
}

export function Composer({
  conversation, settings, streaming, usedTokens, hasMemory, onSend, onGenerate, generating, onStop,
}: {
  conversation: Conversation
  settings: Settings
  streaming: boolean
  /** Jetons effectivement occupés, mémoire et flux en cours compris. */
  usedTokens: number
  hasMemory: boolean
  onSend: (text: string, files: File[]) => void
  /** Envoi en mode image — la description part vers le moteur de diffusion. */
  onGenerate: (prompt: string, params: ImageParams) => void
  generating: boolean
  onStop: () => void
}) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const fichierRef = useRef<HTMLInputElement>(null)
  const jointes = useAttachments()
  const [survol, setSurvol] = useState(false)
  const [mode, setMode] = useComposerMode(conversation.id)
  const { engine } = useImageEngine()
  const hasImageModel = (engine?.catalog ?? []).some((m) => m.installed)
  const image = mode === 'image' && hasImageModel
  const busy = image ? generating : streaming

  /* Les réglages de diffusion appartiennent à la conversation, comme ceux du
     modèle de langage : changer de format ici ne doit rien changer ailleurs. */
  const imageParams = imageParamsOf(conversation, settings)

  /* Sans la capacité « vision », le modèle reçoit les images et les ignore
     en silence : mieux vaut le dire avant l'envoi. */
  const catalogue = useModels((s) => s.models)
  const aveugle = !!jointes.items.length
    && !hasCapability(findModel(catalogue, conversation.model ?? ''), 'vision')

  useEffect(() => {
    setText(sessionStorage.getItem(`draft.${conversation.id}`) ?? '')
    requestAnimationFrame(() => ref.current?.focus())
  }, [conversation.id])

  useEffect(() => {
    if (text) sessionStorage.setItem(`draft.${conversation.id}`, text)
    else sessionStorage.removeItem(`draft.${conversation.id}`)
  }, [text, conversation.id])

  const submit = () => {
    const t = text.trim()
    if (busy) return
    if (image) {
      if (!t) return
      setText('')
      return onGenerate(t, imageParams)
    }
    if (!t && !jointes.files.length) return
    setText('')
    onSend(t, jointes.files)
    jointes.clear()
  }

  /* Une capture d'écran collée arrive dans `files` : autant la joindre. */
  const onPaste = (e: React.ClipboardEvent) => {
    if (image) return
    const fichiers = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
    if (!fichiers.length) return
    e.preventDefault()
    void jointes.add(fichiers)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return
    const withMod = e.metaKey || e.ctrlKey
    if (settings.sendOnEnter ? !e.shiftKey && !withMod : withMod) {
      e.preventDefault()
      submit()
    }
  }

  const ctxMax = conversation.params.num_ctx ?? 4096
  const used = usedTokens + estimateTokens(text)
  const filled = Math.min(1, used / ctxMax)
  const tight = filled > 0.8

  return (
    <div className="px-6 pt-2 pb-6">
      <div className="mx-auto w-full max-w-[860px]">
        <ComposerShell
          survol={survol}
          onDragOver={(e) => { if (!image) { e.preventDefault(); setSurvol(true) } }}
          onDragLeave={() => setSurvol(false)}
          onDrop={(e) => {
            if (image) return
            e.preventDefault()
            setSurvol(false)
            void jointes.add(e.dataTransfer.files)
          }}
          drawer={jointes.items.length ? <PendingStrip items={jointes.items} onRemove={jointes.remove} /> : undefined}
          footerActions={
            <>
              <ModeToggle mode={mode} onChange={setMode} ready={hasImageModel} />
              {image ? (
                <ImageControls
                  params={imageParams}
                  onPatch={(patch) =>
                    void updateConversation(conversation.id, { imageParams: { ...imageParams, ...patch } })
                  }
                />
              ) : (
                <>
                  <ModelChip conv={conversation} />
                  <PresetChip conv={conversation} />
                  <KnowledgeChip conv={conversation} />
                  <WebSearchChip conv={conversation} />
                  {hasMemory && (
                    <Tooltip label="Une mémoire résume les échanges anciens de cette conversation" side="top">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full text-fg-subtle">
                        <Brain className="size-4" />
                      </span>
                    </Tooltip>
                  )}
                </>
              )}
            </>
          }
          sendActions={
            !image ? (
              <>
                <input
                  ref={fichierRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => { void jointes.add(e.target.files); e.target.value = '' }}
                />
                <Tooltip label="Joindre une image — ou la déposer ici, ou la coller" side="top">
                  <Button size="icon-sm" onClick={() => fichierRef.current?.click()}>
                    <Paperclip className="size-4" />
                  </Button>
                </Tooltip>

                <Tooltip
                  label={`${formatNumber(used)} jetons sur ${formatNumber(ctxMax)} — ${Math.round(filled * 100)} % du contexte`}
                  side="top"
                >
                  <span className="hidden items-center gap-2 pr-1 sm:flex">
                    <span className="h-1 w-10 overflow-hidden rounded-full bg-fg/[0.08]">
                      <span
                        className={cn('block h-full rounded-full transition-[width] duration-300', tight ? 'bg-caution' : 'bg-fg/35')}
                        style={{ width: `${Math.max(3, filled * 100)}%` }}
                      />
                    </span>
                    <span className={cn('font-mono text-[11px] tabular-nums whitespace-nowrap', tight ? 'text-caution' : 'text-fg-subtle')}>
                      {formatCompact(used)} / {formatCompact(ctxMax)}
                    </span>
                  </span>
                </Tooltip>
              </>
            ) : undefined
          }
          sendButton={
            busy ? (
              <Button variant="soft" size="icon" onClick={onStop} title="Arrêter (Échap)" aria-label="Arrêter">
                <Square className="size-3 fill-current" />
              </Button>
            ) : (
              <MetalSend muted={!text.trim() && (image || !jointes.files.length)}>
                <MorphButton
                  idle={image ? ImageIcon : Send} hover={Check} variant="primary" size="icon"
                  iconClassName={image ? undefined : 'translate-x-px -translate-y-px'}
                  title={
                    image
                      ? 'Produire l’image'
                      : settings.sendOnEnter ? 'Envoyer (Entrée)' : `Envoyer (${modKey}+Entrée)`
                  }
                  disabled={!text.trim() && (image || !jointes.files.length)} onClick={submit}
                />
              </MetalSend>
            )
          }
          status={
            aveugle ? (
              <p className="t-caption mt-2 flex items-start gap-2 px-1 text-caution">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                {prettyModel(conversation.model ?? '')} ne lit pas les images — choisissez un modèle « vision ».
              </p>
            ) : undefined
          }
        >
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={onPaste}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={
              busy
                ? 'Génération en cours…'
                : image
                  ? 'Décrivez l’image à produire…'
                  : 'Écrivez votre message…'
            }
            className={cn(
              'block max-h-[40vh] min-h-12 w-full resize-none bg-transparent px-5 pt-4 pb-1',
              'text-[15px] leading-[1.6] text-fg outline-none scroll-thin placeholder:text-fg-subtle',
            )}
          />
        </ComposerShell>
      </div>
    </div>
  )
}
