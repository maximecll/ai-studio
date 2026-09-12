import { useEffect, useState } from 'react'
import { db } from '../../lib/db'
import type { Conversation } from '../../lib/types'
import { cn, uid } from '../../lib/utils'
import { PRESET_ICON_KEYS, PresetGlyph } from '../../lib/preset-icons'
import { toast } from '../../store/ui'
import { Button, Field, Input, Modal, Switch, Textarea } from '../ui/primitives'

/** Sélecteur d'icône — jeu fermé, une seule bibliothèque. */
export function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PRESET_ICON_KEYS.map((key) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          aria-label={key}
          className={cn(
            'flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors duration-150',
            key === value ? 'bg-solid text-solid-fg' : 'text-fg-muted hover:bg-fg/[0.06] hover:text-fg',
          )}
        >
          <PresetGlyph name={key} />
        </button>
      ))}
    </div>
  )
}

export function SavePresetModal({
  open, onClose, conv,
}: { open: boolean; onClose: () => void; conv: Conversation }) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('sparkles')
  const [description, setDescription] = useState('')
  const [pinModel, setPinModel] = useState(false)

  useEffect(() => {
    if (open) { setName(''); setDescription(''); setIcon('sparkles'); setPinModel(false) }
  }, [open])

  const save = async () => {
    if (!name.trim()) return
    await db.presets.add({
      id: uid(),
      name: name.trim(),
      icon,
      description: description.trim(),
      model: pinModel ? conv.model : null,
      system: conv.system,
      params: { ...conv.params },
      createdAt: Date.now(),
    })
    toast({ title: 'Preset enregistré', description: name.trim(), tone: 'success' })
    onClose()
  }

  return (
    <Modal
      open={open} onClose={onClose}
      title="Enregistrer comme preset"
      description="Les instructions et paramètres actuels seront réutilisables en un clic."
      footer={
        <>
          <Button variant="soft" size="sm" onClick={onClose}>Annuler</Button>
          <Button variant="primary" size="sm" onClick={save} disabled={!name.trim()}>Enregistrer</Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Nom" htmlFor="preset-name">
          <Input id="preset-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Correcteur juridique" />
        </Field>

        <Field label="Icône">
          <IconPicker value={icon} onChange={setIcon} />
        </Field>

        <Field label="Description" hint="Affichée sous le nom dans la liste des presets.">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="À quoi sert ce preset ?" />
        </Field>

        <Field label="Instructions système incluses">
          <Textarea value={conv.system} readOnly rows={4} className="bg-surface-2 text-fg-muted" placeholder="(aucune)" />
        </Field>

        <Switch
          label="Associer le modèle courant"
          hint="Le preset imposera ce modèle à chaque application."
          checked={pinModel}
          onChange={setPinModel}
        />
      </div>
    </Modal>
  )
}
