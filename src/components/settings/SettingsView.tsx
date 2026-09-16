import { useEffect, useRef, useState } from 'react'
import { Download, MessageSquare, RotateCcw, Upload } from 'lucide-react'
import { db, deleteAllConversations, exportJSON, factoryReset, imagesWeight, importJSON, patchSettings } from '../../lib/db'
import { useSettings } from '../../lib/hooks'
import type { Transcript } from '../../lib/types'
import { cn, download, formatBytes } from '../../lib/utils'
import { prettyModel } from '../../lib/ollama'
import { href, navigate } from '../../lib/router'
import { useModels } from '../../store/models'
import { toast } from '../../store/ui'
import { Page } from '../layout/Page'
import { UpdateSettings } from './UpdateSettings'
import { WebSearchSettings } from './WebSearchSettings'
import { Button, ConfirmModal, Dropdown, Field, Input, Switch, Textarea } from '../ui/primitives'

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

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 break-inside-avoid overflow-hidden rounded-lg bg-surface shadow-card">
      <header className="border-b border-line px-5 py-3">
        <h2 className="t-label text-fg-subtle">{title}</h2>
      </header>
      <div className="space-y-5 px-5 py-5">{children}</div>
    </section>
  )
}

function Segmented<T extends string>({
  options, value, onChange,
}: { options: Array<{ value: T; label: string; icon?: React.ReactNode }>; value: T; onChange: (v: T) => void }) {
  return (
    // Cellules d'égale largeur : un choix orphelin ne s'étire pas sur sa ligne.
    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(4.5rem, 1fr))' }}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex h-10 items-center justify-center gap-2 rounded-full border text-[14px] font-medium transition-all duration-150',
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

export function SettingsView() {
  const settings = useSettings()
  const models = useModels((s) => s.models)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
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
  useEffect(() => { void loadCounts() }, [])

  return (
    <Page title="Réglages" subtitle="Tout est stocké sur cette machine.">
      <div className="columns-1 gap-6 lg:columns-2">
        <Group title="Apparence">
          <Field label="Nom d’affichage" hint="Utilisé pour vous saluer sur la page d’accueil.">
            <Input
              value={settings.displayName}
              onChange={(e) => void patchSettings({ displayName: e.target.value })}
              placeholder="Votre prénom ou pseudonyme"
              maxLength={32}
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
          <Field label="Vue de transcription par défaut" hint="Modifiable ensuite conversation par conversation.">
            <Segmented
              options={TRANSCRIPTS}
              value={settings.defaultTranscript}
              onChange={(v) => void patchSettings({ defaultTranscript: v })}
            />
          </Field>
          <Switch
            label="Compactage automatique"
            hint="Les échanges anciens sont résumés dans la mémoire quand le contexte se remplit. Ils restent lisibles."
            checked={settings.autoCompact}
            onChange={(v) => void patchSettings({ autoCompact: v })}
          />
          <Switch
            label="Mesurer l’incertitude (H₈)"
            hint="Entropie, perplexité et confiance, calculées depuis les log-probabilités."
            checked={settings.measureEntropy}
            onChange={(v) => void patchSettings({ measureEntropy: v })}
          />
          <Switch
            label="Titres automatiques"
            hint="Le modèle résume la conversation après le premier échange."
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
                ...models.map((m) => ({ value: m.name, label: prettyModel(m.name), hint: m.details?.parameter_size })),
              ]}
            />
          </Field>
          <Field label="Instructions système par défaut" hint="Appliquées à chaque nouvelle conversation.">
            <Textarea
              rows={4}
              value={settings.defaultSystem}
              onChange={(e) => void patchSettings({ defaultSystem: e.target.value })}
              placeholder="Tu es un assistant francophone…"
            />
          </Field>
          <Field label="Libérer la mémoire après" hint="Délai d’inactivité au bout duquel Ollama décharge le modèle.">
            <Segmented
              options={KEEP_ALIVE}
              value={settings.keepAlive}
              onChange={(v) => void patchSettings({ keepAlive: v })}
            />
            {settings.keepAlive === '-1' && (
              <p className="mt-2 rounded-sm bg-caution-wash px-3 py-2.5 text-[13px] leading-snug text-fg-muted">
                Ollama choisit au chargement combien de couches partent sur le GPU. Sous forte pression mémoire
                il n’en met aucune, et un modèle qui ne se décharge jamais garde ce choix : cinq fois plus lent,
                jusqu’au redémarrage d’Ollama.
              </p>
            )}
          </Field>
        </Group>

        <Group title="Recherche web">
          <WebSearchSettings />
        </Group>

        <Group title="Mises à jour">
          <UpdateSettings />
        </Group>

        <Group title="Données">
          <p className="text-[14px] text-fg-muted">
            {counts
              ? [
                  `${counts.conv} conversation${counts.conv > 1 ? 's' : ''}`,
                  `${counts.msg} message${counts.msg > 1 ? 's' : ''}`,
                  counts.img > 0 ? `${counts.img} image${counts.img > 1 ? 's' : ''} (${formatBytes(counts.imgBytes)})` : null,
                ].filter(Boolean).join(' · ')
              : '…'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="soft" size="sm"
              onClick={async () => {
                const bundle = await exportJSON()
                download(`ai-studio-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(bundle, null, 2), 'application/json')
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
              <MessageSquare size={16} /> Effacer les conversations
            </Button>
            <Button variant="soft" size="sm" className="text-danger" onClick={() => setConfirmReset(true)}>
              <RotateCcw size={16} /> Réinitialiser
            </Button>
          </div>
          <p className="t-caption leading-relaxed text-fg-subtle">
            AI Studio est une interface locale pour Ollama : les conversations vivent dans ce navigateur,
            l’inférence tourne sur votre machine. Aucun serveur, aucun compte, aucune télémétrie.
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
        description="Les presets, les réglages et le coffre sont conservés. Pensez à exporter avant."
        confirmLabel="Effacer les conversations"
        danger
        onConfirm={async () => {
          await deleteAllConversations()
          navigate(href.home())
          toast({ title: 'Conversations effacées', tone: 'success' })
        }}
      />

      <ConfirmModal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Réinitialiser AI Studio ?"
        description="Conversations, images, presets, réglages et coffre : tout est effacé. L'application redémarre comme au premier lancement. Les modèles téléchargés sur le disque ne sont pas touchés."
        confirmLabel="Tout réinitialiser"
        danger
        onConfirm={async () => {
          await factoryReset()
          // Rechargement complet : les magasins en mémoire repartent de zéro.
          location.replace('/')
        }}
      />
    </Page>
  )
}
