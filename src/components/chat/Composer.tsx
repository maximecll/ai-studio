import { useEffect, useRef, useState } from 'react'
import { Brain, Check, ChevronDown, Circle, Image as ImageIcon, Paperclip, Send, Square } from 'lucide-react'
import { imageParamsOf, updateConversation } from '../../lib/db'
import { usePresets } from '../../lib/hooks'
import type { Conversation, ImageParams, Settings } from '../../lib/types'
import { cn, estimateTokens, formatCompact, formatNumber, modKey } from '../../lib/utils'
import { prettyModel } from '../../lib/ollama'
import { PresetGlyph } from '../../lib/preset-icons'
import { useModels } from '../../store/models'
import { useChat } from '../../store/chat'
import { useUI } from '../../store/ui'
import { Button, Chip, Menu, MenuItem, MenuLabel, MenuSeparator, MorphButton, Tooltip } from '../ui/primitives'
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
function PresetChip({ conv }: { conv: Conversation }) {
  const presets = usePresets()
  const setPresetsOpen = useUI((s) => s.setPresetsOpen)
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
      <MenuItem onClick={() => setPresetsOpen(true)}>Gérer les presets…</MenuItem>
    </Menu>
  )
}

/**
 * Bascule texte / image.
 *
 * Le choix reste collé à la conversation : on décrit rarement une image puis
 * on repose une question dans la foulée, et retrouver le mode où on l'avait
 * laissé évite de se tromper d'envoi.
 */
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

export function Composer({
  conversation, settings, streaming, usedTokens, hasMemory, onSend, onGenerate, generating, onStop,
}: {
  conversation: Conversation
  settings: Settings
  streaming: boolean
  /** Jetons effectivement occupés, mémoire et flux en cours compris. */
  usedTokens: number
  hasMemory: boolean
  onSend: (text: string) => void
  /** Envoi en mode image — la description part vers le moteur de diffusion. */
  onGenerate: (prompt: string, params: ImageParams) => void
  generating: boolean
  onStop: () => void
}) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const [mode, setMode] = useComposerMode(conversation.id)
  const { engine } = useImageEngine()
  const hasImageModel = (engine?.catalog ?? []).some((m) => m.installed)
  const image = mode === 'image' && hasImageModel
  const busy = image ? generating : streaming

  /* Les réglages de diffusion appartiennent à la conversation, comme ceux du
     modèle de langage : changer de format ici ne doit rien changer ailleurs. */
  const imageParams = imageParamsOf(conversation, settings)

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
    if (!t || busy) return
    setText('')
    if (image) onGenerate(t, imageParams)
    else onSend(t)
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
        <div
          className={cn(
            'rounded-lg bg-surface transition-shadow duration-200',
            'shadow-card focus-within:shadow-float',
          )}
        >
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
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

          {/* Barre de pilotage : modèle, preset, contexte, envoi — tout à la même hauteur. */}
          {/* Groupe de gauche compressible, groupe de droite intouchable :
              le bouton d'envoi reste dans la carte à toute largeur. */}
          <div className="flex h-14 items-center gap-1.5 px-3">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
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
                  {hasMemory && (
                    <Tooltip label="Une mémoire résume les échanges anciens de cette conversation" side="top">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full text-fg-subtle">
                        <Brain className="size-4" />
                      </span>
                    </Tooltip>
                  )}
                </>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {!image && (
                <Tooltip label="Les pièces jointes arrivent bientôt" side="top">
                  <Button size="icon-sm" disabled className="hidden sm:inline-flex"><Paperclip className="size-4" /></Button>
                </Tooltip>
              )}

              {!image && <Tooltip
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
              </Tooltip>}

              {busy ? (
                <Button variant="soft" size="icon" onClick={onStop} title="Arrêter (Échap)" aria-label="Arrêter">
                  <Square className="size-3 fill-current" />
                </Button>
              ) : (
                <MorphButton
                  idle={image ? ImageIcon : Send} hover={Check} variant="primary" size="icon"
                  iconClassName={image ? undefined : 'translate-x-px -translate-y-px'}
                  title={
                    image
                      ? 'Produire l’image'
                      : settings.sendOnEnter ? 'Envoyer (Entrée)' : `Envoyer (${modKey}+Entrée)`
                  }
                  disabled={!text.trim()} onClick={submit}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
