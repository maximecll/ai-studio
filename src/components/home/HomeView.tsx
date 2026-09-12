import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowUpRight, Check, ChevronDown, Circle, Clock, Send } from 'lucide-react'
import { createConversation, updateConversation } from '../../lib/db'
import { useConversations, usePresets, useSettings } from '../../lib/hooks'
import { PresetGlyph } from '../../lib/preset-icons'
import { href, navigate } from '../../lib/router'
import type { Preset } from '../../lib/types'
import { cn, modKey, relativeTime } from '../../lib/utils'
import { prettyModel, suggestedContext } from '../../lib/ollama'
import { useModels } from '../../store/models'
import { useChat } from '../../store/chat'
import { Chip, Menu, MenuItem, MenuLabel, MorphButton } from '../ui/primitives'

const SUGGESTIONS = [
  'Explique-moi ce concept simplement',
  'Relis et améliore ce texte',
  'Aide-moi à déboguer ce code',
  'Donne-moi dix idées sur…',
]

/**
 * Page d'accueil : on écrit d'abord, la conversation naît ensuite.
 * L'UUID est attribué à l'envoi du premier message, puis l'URL bascule
 * sur /c/<uuid> — la session devient adressable.
 */
export function HomeView() {
  const settings = useSettings()
  const presets = usePresets()
  const conversations = useConversations() ?? []
  const models = useModels((s) => s.models)
  const send = useChat((s) => s.send)

  const [text, setText] = useState('')
  const [preset, setPreset] = useState<Preset | null>(null)
  const [model, setModel] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  /* L'inventaire est rafraîchi toutes les 15 s : sans ce garde, chaque
     sondage réécrasait le modèle choisi par le défaut. On ne retombe sur le
     défaut que si la sélection courante a disparu. */
  useEffect(() => {
    setModel((cur) => (cur && models.some((m) => m.name === cur) ? cur : settings.defaultModel || models[0]?.name || ''))
  }, [settings.defaultModel, models])
  useEffect(() => { requestAnimationFrame(() => ref.current?.focus()) }, [])

  const start = async (message: string) => {
    const body = message.trim()
    if (!body || !model) return
    const chosen = models.find((m) => m.name === model)
    const id = await createConversation({
      model,
      params: { ...settings.defaultParams, num_ctx: suggestedContext(chosen) },
    })
    if (preset) {
      await updateConversation(id, {
        presetId: preset.id,
        system: preset.system,
        params: preset.params,
        ...(preset.model ? { model: preset.model } : {}),
      })
    }
    navigate(href.conversation(id))
    void send(id, body)
  }

  const hour = new Date().getHours()
  const greeting = hour < 6 ? 'Bonne nuit' : hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir'
  const recent = conversations.slice(0, 4)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto scroll-thin">
      <div className="mx-auto flex w-full max-w-[820px] flex-1 flex-col justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <h1 className="t-display">
            {greeting}.
            <span className="block text-fg-subtle">Par quoi commençons-nous&nbsp;?</span>
          </h1>

          <div className="mt-8 rounded-lg bg-surface shadow-card transition-shadow duration-200 focus-within:shadow-float">
            <textarea
              ref={ref}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                const withMod = e.metaKey || e.ctrlKey
                if (settings.sendOnEnter ? !e.shiftKey && !withMod : withMod) {
                  e.preventDefault()
                  void start(text)
                }
              }}
              rows={1}
              placeholder="Écrivez votre premier message…"
              className="t-body block max-h-[40vh] min-h-14 w-full resize-none bg-transparent px-5 pt-4 pb-1 text-fg outline-none scroll-thin placeholder:text-fg-subtle"
            />
            <div className="flex h-14 items-center gap-1.5 px-3">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
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

              </div>
              <div className="shrink-0">
                <MorphButton
                  idle={Send} hover={Check} variant="primary" size="icon"
                  iconClassName="translate-x-px -translate-y-px"
                  title={settings.sendOnEnter ? 'Envoyer (Entrée)' : `Envoyer (${modKey}+Entrée)`}
                  disabled={!text.trim() || !model}
                  onClick={() => void start(text)}
                />
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s, i) => (
              <motion.button
                key={s}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.06 * i + 0.1, type: 'spring', stiffness: 300, damping: 30 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => { setText(s); ref.current?.focus() }}
                className={cn(
                  'group inline-flex h-9 max-w-full cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-4',
                  't-meta text-fg-muted transition-colors duration-150 hover:border-line-strong hover:text-fg',
                )}
              >
                <span className="truncate">{s}</span>
                <ArrowUpRight className="size-3.5 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
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
  )
}
