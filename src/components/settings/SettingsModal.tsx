import { useRef, useState } from 'react'
import { Download, Monitor, Moon, Sun, Trash2, Upload } from 'lucide-react'
import { db, deleteAllConversations, exportJSON, imagesWeight, importJSON, patchSettings } from '../../lib/db'
import { useSettings } from '../../lib/hooks'
import type { Theme, Transcript, UIFont } from '../../lib/types'
import { cn, download, formatBytes } from '../../lib/utils'
import { useModels } from '../../store/models'
import { toast, useUI } from '../../store/ui'
import { Button, ConfirmModal, Dropdown, Field, Modal, Switch, Textarea } from '../ui/primitives'
import { prettyModel } from '../../lib/ollama'
import { href, navigate } from '../../lib/router'

const THEMES: Array<{ value: Theme; label: string; icon: React.ReactNode }> = [
  { value: 'light', label: 'Clair', icon: <Sun size={16} /> },
  { value: 'dark', label: 'Sombre', icon: <Moon size={16} /> },
  { value: 'system', label: 'Système', icon: <Monitor size={16} /> },
]

const FONTS: Array<{ value: UIFont; label: string; sample: string }> = [
  { value: 'dm', label: 'DM Sans', sample: "'DM Sans', sans-serif" },
  { value: 'satoshi', label: 'Satoshi', sample: "'Satoshi', sans-serif" },
  { value: 'inter', label: 'Inter', sample: "'Inter', sans-serif" },
]

const TRANSCRIPTS: Array<{ value: Transcript; label: string }> = [
  { value: 'normal', label: 'Normale' },
  { value: 'thinking', label: 'Réflexion' },
  { value: 'detailed', label: 'Détaillée' },
]

const KEEP_ALIVE = [
  { value: '0', label: 'Aussitôt' },
  { value: '5m', label: '5 min' },
  { value: '10m', label: '10 min' },
  { value: '1h', label: '1 h' },
  { value: '-1', label: 'Jamais' },
]

/** Groupe de réglages — rythme vertical constant de 24px. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line py-6 first:pt-2 last:border-0 last:pb-0">
      <h3 className="t-label mb-4 text-fg-subtle">{title}</h3>
      <div className="space-y-5">{children}</div>
    </section>
  )
}

/** Groupe de boutons segmentés, pilule, hauteur 40px. */
function Segmented<T extends string>({
  options, value, onChange,
}: { options: Array<{ value: T; label: string; icon?: React.ReactNode; style?: React.CSSProperties }>; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={o.style}
          className={cn(
            'flex h-10 flex-1 items-center justify-center gap-2 rounded-full border text-[14px] font-medium transition-all duration-150',
            value === o.value
              ? 'border-transparent bg-solid text-solid-fg'
              : 'border-line bg-surface text-fg-muted hover:bg-fg/[0.04] hover:text-fg',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function SettingsModal() {
  const { settingsOpen, setSettingsOpen } = useUI()
  const settings = useSettings()
  const models = useModels((s) => s.models)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [counts, setCounts] = useState<{ conv: number; msg: number; img: number; imgBytes: number } | null>(null)

  const loadCounts = async () => {
    const pictures = await imagesWeight()
    setCounts({
      conv: await db.conversations.count(),
      msg: await db.messages.count(),
      img: pictures.count,
      imgBytes: pictures.bytes,
    })
  }

  return (
    <Modal
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      title="Réglages"
      description="Tout est stocké localement, rien ne quitte cette machine."
      width="max-w-2xl"
    >
      <div onMouseEnter={() => !counts && void loadCounts()}>
        <Group title="Apparence">
          <Field label="Thème">
            <Segmented options={THEMES} value={settings.theme} onChange={(v) => void patchSettings({ theme: v })} />
          </Field>
          <Field label="Typographie" hint="DM Sans par défaut. Aucune graisse fine : le texte est en médium, les titres en gras.">
            <Segmented
              options={FONTS.map((f) => ({ value: f.value, label: f.label, style: { fontFamily: f.sample } }))}
              value={settings.fontFamily}
              onChange={(v) => void patchSettings({ fontFamily: v })}
            />
          </Field>
          <Switch
            label="Afficher les statistiques"
            hint="Vitesse, nombre de jetons et latence sous chaque réponse."
            checked={settings.showStats}
            onChange={(v) => void patchSettings({ showStats: v })}
          />
        </Group>

        <Group title="Conversation">
          <Switch
            label="Entrée envoie le message"
            hint="Désactivé : Entrée saute une ligne, ⌘/Ctrl+Entrée envoie."
            checked={settings.sendOnEnter}
            onChange={(v) => void patchSettings({ sendOnEnter: v })}
          />
          <Field label="Vue de transcription par défaut" hint="Modifiable ensuite conversation par conversation, via le menu « … ».">
            <Segmented
              options={TRANSCRIPTS}
              value={settings.defaultTranscript}
              onChange={(v) => void patchSettings({ defaultTranscript: v })}
            />
          </Field>
          <Switch
            label="Compactage automatique"
            hint="Quand le contexte se remplit, les échanges anciens sont résumés dans la mémoire de la conversation. Ils restent lisibles."
            checked={settings.autoCompact}
            onChange={(v) => void patchSettings({ autoCompact: v })}
          />
          <Switch
            label="Mesurer l'incertitude (H₈)"
            hint="Demande les log-probabilités à Ollama pour calculer entropie, perplexité et confiance."
            checked={settings.measureEntropy}
            onChange={(v) => void patchSettings({ measureEntropy: v })}
          />
          <Switch
            label="Titres automatiques"
            hint="Le modèle résume la conversation en un titre après le premier échange."
            checked={settings.autoTitle}
            onChange={(v) => void patchSettings({ autoTitle: v })}
          />
        </Group>

        <Group title="Valeurs par défaut">
          <Field label="Modèle des nouvelles conversations">
            <Dropdown
              value={settings.defaultModel}
              onChange={(v) => void patchSettings({ defaultModel: v })}
              placeholder="— Aucun —"
              options={[
                { value: '', label: '— Aucun —' },
                ...models.map((m) => ({
                  value: m.name,
                  label: prettyModel(m.name),
                  hint: m.details?.parameter_size,
                })),
              ]}
            />
          </Field>
          <Field label="Instructions système par défaut" hint="Appliquées à chaque nouvelle conversation.">
            <Textarea
              rows={3}
              value={settings.defaultSystem}
              onChange={(e) => void patchSettings({ defaultSystem: e.target.value })}
              placeholder="Tu es un assistant francophone…"
            />
          </Field>
          <Field
            label="Libérer la mémoire après"
            hint="Délai d'inactivité au bout duquel Ollama décharge le modèle."
          >
            <Segmented
              options={KEEP_ALIVE}
              value={settings.keepAlive}
              onChange={(v) => void patchSettings({ keepAlive: v })}
            />
            {/* Ce choix a coûté un facteur cinq sur le débit : autant dire
                pourquoi, là où on le fait. */}
            {settings.keepAlive === '-1' && (
              <p className="mt-2 rounded-sm bg-caution-wash px-3 py-2.5 text-[13px] leading-snug text-fg-muted">
                Ollama décide au chargement combien de couches partent sur le GPU. Si la mémoire
                est saturée à cet instant, il n'en met aucune — et un modèle qui ne se décharge
                jamais garde cette décision pour de bon. Le débit reste alors cinq fois plus faible
                jusqu'au redémarrage d'Ollama. « 1 h » garde le modèle chaud sans ce risque.
              </p>
            )}
          </Field>
        </Group>

        <Group title="Données">
          <p className="text-[14px] text-fg-muted">
            {counts
              ? [
                  `${counts.conv} conversation${counts.conv > 1 ? 's' : ''}`,
                  `${counts.msg} message${counts.msg > 1 ? 's' : ''}`,
                  /* Les images pèsent mille fois un message : leur poids mérite
                     d'être dit, pas seulement leur nombre. */
                  counts.img > 0 ? `${counts.img} image${counts.img > 1 ? 's' : ''} (${formatBytes(counts.imgBytes)})` : null,
                  'IndexedDB « ollama-studio »',
                ].filter(Boolean).join(' · ')
              : 'IndexedDB « ollama-studio »'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="soft" size="sm"
              onClick={async () => {
                const bundle = await exportJSON()
                download(`studio-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(bundle, null, 2), 'application/json')
                toast({ title: 'Sauvegarde exportée', tone: 'success' })
              }}
            >
              <Download size={16} /> Tout exporter
            </Button>
            <Button variant="soft" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload size={16} /> Importer
            </Button>
            <input
              ref={fileRef} type="file" accept="application/json" className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                try {
                  const n = await importJSON(JSON.parse(await file.text()))
                  toast({ title: `${n} conversation${n > 1 ? 's' : ''} importée${n > 1 ? 's' : ''}`, tone: 'success' })
                  await loadCounts()
                } catch (err) {
                  toast({ title: 'Import impossible', description: (err as Error).message, tone: 'danger' })
                }
                e.target.value = ''
              }}
            />
            <Button variant="soft" size="sm" className="text-danger" onClick={() => setConfirmWipe(true)}>
              <Trash2 size={16} /> Tout effacer
            </Button>
          </div>
        </Group>

        <Group title="À propos">
          <p className="text-[14px] leading-relaxed text-fg-muted">
            Studio est une interface locale pour Ollama : les conversations vivent dans ce navigateur,
            l'inférence tourne sur votre machine. Aucun serveur, aucun compte, aucune télémétrie.
          </p>
          <p className="font-mono text-[12px] text-fg-subtle">
            {models.length} modèle{models.length > 1 ? 's' : ''} · {formatBytes(models.reduce((n, m) => n + m.size, 0))} sur disque
          </p>
        </Group>
      </div>

      <ConfirmModal
        open={confirmWipe}
        onClose={() => setConfirmWipe(false)}
        title="Effacer toutes les conversations ?"
        description="Les presets et réglages sont conservés. Pensez à exporter avant."
        confirmLabel="Tout effacer"
        danger
        onConfirm={async () => {
          await deleteAllConversations()
          navigate(href.home())
          await loadCounts()
          toast({ title: 'Conversations effacées', tone: 'success' })
        }}
      />
    </Modal>
  )
}
