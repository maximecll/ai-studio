import { useEffect, useState } from 'react'
import { Plus, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { db, updateConversation } from '../../lib/db'
import { usePresets } from '../../lib/hooks'
import type { Preset } from '../../lib/types'
import { cn, uid } from '../../lib/utils'
import { PresetGlyph } from '../../lib/preset-icons'
import { IconPicker } from './SavePresetModal'
import { toast, useUI } from '../../store/ui'
import { Button, Field, Input, Modal, Slider, Textarea } from '../ui/primitives'
import { useRoute } from '../../lib/router'


export function PresetsModal() {
  const { presetsOpen, setPresetsOpen } = useUI()
  const route = useRoute()
  const activeId = route.name === 'conversation' ? route.id : null
  const presets = usePresets()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = presets.find((p) => p.id === selectedId) ?? presets[0]

  useEffect(() => {
    if (presetsOpen && !selectedId && presets.length) setSelectedId(presets[0].id)
  }, [presetsOpen, selectedId, presets])

  const patch = (p: Preset, changes: Partial<Preset>) => void db.presets.update(p.id, changes)

  const create = async () => {
    const id = uid()
    await db.presets.add({
      id, name: 'Nouveau preset', icon: 'sparkles', description: '', model: null,
      system: '', params: { temperature: 0.8, top_p: 0.9, num_ctx: 8192 }, createdAt: Date.now(),
    })
    setSelectedId(id)
  }

  return (
    <Modal
      open={presetsOpen}
      onClose={() => setPresetsOpen(false)}
      title="Presets"
      description="Des combinaisons d'instructions et de paramètres, applicables en un clic."
      width="max-w-3xl"
      icon={<Sparkles size={16} />}
      footer={
        <>
          <Button variant="soft" size="sm" onClick={create}><Plus size={16} /> Nouveau preset</Button>
          <div className="flex-1" />
          {selected && activeId && (
            <Button
              variant="primary" size="sm"
              onClick={async () => {
                const conv = await db.conversations.get(activeId)
                if (!conv) return
                await updateConversation(activeId, {
                  presetId: selected.id,
                  system: selected.system,
                  params: { ...conv.params, ...selected.params },
                  ...(selected.model ? { model: selected.model } : {}),
                })
                toast({ title: 'Preset appliqué', description: selected.name, tone: 'success' })
                setPresetsOpen(false)
              }}
            >
              <Wand2 size={16} /> Appliquer à la conversation
            </Button>
          )}
        </>
      }
    >
      <div className="flex min-h-[420px] gap-6">
        <nav className="w-52 shrink-0 space-y-0.5 border-r border-line pr-4">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={cn(
                'flex h-10 w-full items-center gap-3 rounded-sm px-3 text-left text-[14px] transition-colors duration-100',
                p.id === selected?.id ? 'bg-fg/[0.06] font-bold text-fg' : 'text-fg-muted hover:bg-fg/[0.035] hover:text-fg',
              )}
            >
              <PresetGlyph name={p.icon} className="size-4 shrink-0" />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
          {presets.length === 0 && <p className="px-3 py-5 text-[13px] text-fg-subtle">Aucun preset.</p>}
        </nav>

        {selected ? (
          <div className="min-w-0 flex-1 space-y-5">
            <Field label="Nom">
              <Input value={selected.name} onChange={(e) => patch(selected, { name: e.target.value })} />
            </Field>

            <Field label="Icône">
              <IconPicker value={selected.icon} onChange={(icon) => patch(selected, { icon })} />
            </Field>

            <Field label="Description">
              <Input
                value={selected.description}
                onChange={(e) => patch(selected, { description: e.target.value })}
                placeholder="À quoi sert ce preset ?"
              />
            </Field>

            <Field label="Instructions système" hint="Ce que le modèle doit savoir avant de répondre.">
              <Textarea
                rows={6}
                value={selected.system}
                onChange={(e) => patch(selected, { system: e.target.value })}
                placeholder="Tu es…"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Slider
                label="Température" value={selected.params.temperature} defaultValue={0.8} min={0} max={2} step={0.05}
                onChange={(v) => patch(selected, { params: { ...selected.params, temperature: v } })}
                format={(v) => v.toFixed(2)}
              />
              <Slider
                label="Top P" value={selected.params.top_p} defaultValue={0.9} min={0.05} max={1} step={0.01}
                onChange={(v) => patch(selected, { params: { ...selected.params, top_p: v } })}
                format={(v) => v.toFixed(2)}
              />
            </div>

            <div className="flex justify-end border-t border-line pt-4">
              <Button
                variant="quiet" size="sm" className="text-danger"
                onClick={async () => {
                  await db.presets.delete(selected.id)
                  setSelectedId(null)
                }}
              >
                <Trash2 size={16} /> Supprimer ce preset
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <Button variant="soft" size="sm" onClick={create}><Plus size={16} /> Créer un preset</Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
