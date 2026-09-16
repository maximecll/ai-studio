import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowUpRight, Check, ChevronDown, Circle, Clock, Image as ImageIcon, Paperclip, Send, SlidersHorizontal } from 'lucide-react'
import { createConversation, patchSettings, updateConversation } from '../../lib/db'
import { useConversations, usePresets, useSettings } from '../../lib/hooks'
import { PresetGlyph } from '../../lib/preset-icons'
import { href, navigate } from '../../lib/router'
import type { Preset } from '../../lib/types'
import { cn, modKey, relativeTime } from '../../lib/utils'
import { prettyModel, suggestedContext } from '../../lib/ollama'
import { useModels } from '../../store/models'
import { useChat } from '../../store/chat'
import { useImages } from '../../store/images'
import { ImageControls, ModeToggle, useImageEngine } from '../chat/ImageControls'
import { useAttachments } from '../../lib/attachments'
import { PendingStrip } from '../chat/Attachments'
import { MetalSend } from '../chat/MetalSend'
import { useUI } from '../../store/ui'
import { Button, Chip, Menu, MenuItem, MenuLabel, MorphButton, Tooltip } from '../ui/primitives'

const SUGGESTIONS = [
  'Explique-moi ce concept simplement',
  'Relis et améliore ce texte',
  'Aide-moi à déboguer ce code',
  'Donne-moi dix idées sur…',
]

/* FLUX répond bien aux descriptions concrètes : un sujet, une lumière, un
   cadrage. Ces amorces sont là pour donner le ton, pas pour être envoyées telles quelles. */
const IMAGE_SUGGESTIONS = [
  'Un atelier de menuiserie au petit matin, lumière rasante',
  'Portrait au 85 mm, fond neutre, lumière douce de fenêtre',
  'Affiche typographique suisse, deux couleurs, grain de papier',
  'Paysage de montagne dans la brume, à l’aquarelle',
]

/** Page d'accueil : on écrit d'abord, la conversation naît ensuite. */
export function HomeView() {
  const settings = useSettings()
  const presets = usePresets()
  const conversations = useConversations() ?? []
  const models = useModels((s) => s.models)
  const send = useChat((s) => s.send)
  const generate = useImages((s) => s.create)
  const { engine } = useImageEngine()
  const hasImageModel = (engine?.catalog ?? []).some((m) => m.installed)

  const [text, setText] = useState('')
  const jointes = useAttachments()
  const fichierRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'text' | 'image'>('text')
  const image = mode === 'image' && hasImageModel
  const [preset, setPreset] = useState<Preset | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const { inspectorOpen, toggleInspector } = useUI()

  // Le modèle de l'accueil est celui des nouvelles conversations : une seule source de vérité, partagée avec le panneau de paramètres.
  const model = settings.defaultModel || models[0]?.name || ''
  const setModel = (name: string) => void patchSettings({ defaultModel: name })

  useEffect(() => { requestAnimationFrame(() => ref.current?.focus()) }, [])

  const start = async (message: string) => {
    const body = message.trim()
    if (!body && !jointes.files.length) return

    // En mode image, la conversation naît aussi, mais son premier échange est une description et une image, pas un tour de parole avec un modèle de…
    if (image) {
      if (!body) return
      const id = await createConversation({ model, params: settings.defaultParams, system: settings.defaultSystem })
      /* On arrive dans la conversation avec le composeur déjà en mode image :
         on enchaîne rarement une image et une question. */
      sessionStorage.setItem(`mode.${id}`, 'image')
      navigate(href.conversation(id))
      void generate(id, body, settings.imageParams)
      return
    }

    if (!model) return
    const chosen = models.find((m) => m.name === model)
    /* Un contexte réglé à la main prime ; sinon on l'ajuste au modèle. */
    const params = {
      ...settings.defaultParams,
      num_ctx: settings.defaultParams.num_ctx ?? suggestedContext(chosen),
    }
    const id = await createConversation({ model, params, system: settings.defaultSystem })
    if (preset) {
      await updateConversation(id, {
        presetId: preset.id,
        system: preset.system,
        params: preset.params,
        ...(preset.model ? { model: preset.model } : {}),
      })
    }
    navigate(href.conversation(id))
    const fichiers = jointes.files
    jointes.clear()
    void send(id, body, fichiers)
  }

  const hour = new Date().getHours()
  const greeting = hour < 6 ? 'Bonne nuit' : hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir'
  const recent = conversations.slice(0, 4)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-line px-3">
        <span />
        <h1 className="t-ui truncate text-center text-fg-muted">Nouvelle conversation</h1>
        <div className="flex items-center justify-end">
          <Tooltip label="Paramètres par défaut" kbd={`${modKey}I`}>
            <Button size="icon" active={inspectorOpen} onClick={toggleInspector} aria-label="Paramètres par défaut">
              <SlidersHorizontal className="size-4" />
            </Button>
          </Tooltip>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
      <div className="mx-auto flex w-full max-w-[820px] flex-col justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <h1 className="t-display">
            {greeting}{settings.displayName ? `, ${settings.displayName}` : ''}.
            <span className="block text-fg-subtle">Par quoi commençons-nous&nbsp;?</span>
          </h1>

          <div
            className="mt-8 rounded-lg bg-surface shadow-card transition-shadow duration-200 focus-within:shadow-float"
            onDragOver={(e) => { if (!image) e.preventDefault() }}
            onDrop={(e) => { if (image) return; e.preventDefault(); void jointes.add(e.dataTransfer.files) }}
          >
            <PendingStrip items={jointes.items} onRemove={jointes.remove} />
            <textarea
              ref={ref}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                if (image) return
                const fichiers = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
                if (!fichiers.length) return
                e.preventDefault()
                void jointes.add(fichiers)
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                const withMod = e.metaKey || e.ctrlKey
                if (settings.sendOnEnter ? !e.shiftKey && !withMod : withMod) {
                  e.preventDefault()
                  void start(text)
                }
              }}
              rows={1}
              placeholder={image ? 'Décrivez l’image à produire…' : 'Écrivez votre premier message…'}
              className="t-body block max-h-[40vh] min-h-14 w-full resize-none bg-transparent px-5 pt-4 pb-1 text-fg outline-none scroll-thin placeholder:text-fg-subtle"
            />
            <div className="flex h-14 items-center gap-1.5 px-3">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <ModeToggle mode={mode} onChange={setMode} ready={hasImageModel} />
              {image ? (
                <ImageControls
                  params={settings.imageParams}
                  onPatch={(patch) =>
                    void patchSettings({ imageParams: { ...settings.imageParams, ...patch } })
                  }
                />
              ) : (
                <>
              <Menu
                side="top" width="w-80"
                trigger={({ open }) => (
                  <Chip as="span" active={open} className="min-w-0 max-w-[min(46vw,240px)]">
                    <span className="truncate">{model ? prettyModel(model) : 'Choisir un modèle'}</span>
                    <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
                  </Chip>
                )}
              >
                <MenuLabel>Modèle</MenuLabel>
                {models.map((m) => (
                  <MenuItem
                    key={m.name} active={m.name === model}
                    icon={m.name === model ? <Check className="size-4 text-fg" /> : null}
                    onClick={() => setModel(m.name)}
                  >
                    {prettyModel(m.name)}
                  </MenuItem>
                ))}
              </Menu>

              <Menu
                side="top" width="w-64"
                trigger={({ open }) => (
                  <Chip as="span" active={open || !!preset} className="min-w-0 shrink">
                    {preset ? <PresetGlyph name={preset.icon} className="size-3.5" /> : <Circle className="size-3.5" />}
                    <span className="max-w-28 truncate">{preset?.name ?? 'Preset'}</span>
                    <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
                  </Chip>
                )}
              >
                <MenuLabel>Preset</MenuLabel>
                <MenuItem active={!preset} icon={<Circle className="size-4" />} onClick={() => setPreset(null)}>
                  Aucun
                </MenuItem>
                {presets.map((p) => (
                  <MenuItem
                    key={p.id} active={p.id === preset?.id}
                    icon={<PresetGlyph name={p.icon} />}
                    onClick={() => setPreset(p)}
                  >
                    {p.name}
                  </MenuItem>
                ))}
              </Menu>
                </>
              )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!image && (
                  <>
                    <input
                      ref={fichierRef}
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      onChange={(e) => { void jointes.add(e.target.files); e.target.value = '' }}
                    />
                    <Tooltip label="Joindre une image" side="top">
                      <Button size="icon-sm" onClick={() => fichierRef.current?.click()}>
                        <Paperclip className="size-4" />
                      </Button>
                    </Tooltip>
                  </>
                )}
                <MetalSend muted={(!text.trim() && (image || !jointes.files.length)) || (!image && !model)}>
                  <MorphButton
                    idle={image ? ImageIcon : Send} hover={Check} variant="primary" size="icon"
                    iconClassName={image ? undefined : 'translate-x-px -translate-y-px'}
                    title={
                      image
                        ? 'Produire l’image'
                        : settings.sendOnEnter ? 'Envoyer (Entrée)' : `Envoyer (${modKey}+Entrée)`
                    }
                    disabled={(!text.trim() && (image || !jointes.files.length)) || (!image && !model)}
                    onClick={() => void start(text)}
                  />
                </MetalSend>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {(image ? IMAGE_SUGGESTIONS : SUGGESTIONS).map((s, i) => (
              <motion.button
                key={s}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.06 * i + 0.1, type: 'spring', stiffness: 300, damping: 30 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => { setText(s); ref.current?.focus() }}
                className={cn(
                  'group inline-flex h-9 max-w-full cursor-pointer items-center rounded-full border border-line bg-surface px-4',
                  't-meta text-fg-muted transition-colors duration-150 hover:border-line-strong hover:text-fg',
                )}
              >
                <span className="truncate">{s}</span>
                <ArrowUpRight
                  className="h-3.5 w-0 shrink-0 overflow-hidden text-fg-subtle opacity-0 transition-all duration-150 group-hover:ml-1.5 group-hover:w-3.5 group-hover:opacity-100"
                />
              </motion.button>
            ))}
          </div>

          {recent.length > 0 && (
            <section className="mt-10">
              <h2 className="t-label mb-3 text-fg-subtle">Reprendre</h2>
              <div className="overflow-hidden rounded-lg bg-surface shadow-card">
                {recent.map((c, i) => (
                  <button
                    key={c.id}
                    onClick={() => navigate(href.conversation(c.id))}
                    className={cn(
                      'group flex h-12 w-full cursor-pointer items-center gap-3 px-5 text-left',
                      't-meta text-fg-muted transition-colors duration-150 hover:bg-fg/[0.03] hover:text-fg',
                      i > 0 && 'border-t border-line',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    <span className="t-caption flex shrink-0 items-center gap-1.5 text-fg-subtle">
                      <Clock className="size-3" />
                      {relativeTime(c.updatedAt)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </motion.div>
      </div>
      </div>
    </div>
  )
}
