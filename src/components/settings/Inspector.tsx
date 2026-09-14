import { useEffect, useState } from 'react'
import { ChevronRight, Dices, Info, RotateCcw, Save, X } from 'lucide-react'
import { DEFAULT_IMAGE_PARAMS, DEFAULT_PARAMS, imageParamsOf, patchSettings, updateConversation } from '../../lib/db'
import type { Conversation, ImageParams, Params } from '../../lib/types'
import { cn, formatBytes, formatNumber } from '../../lib/utils'
import { estimateMemory, hasCapability, prettyModel } from '../../lib/ollama'
import { findModel, useModels } from '../../store/models'
import { toast, useUI } from '../../store/ui'
import { useSettings, useSystemMemory } from '../../lib/hooks'
import { Badge, Button, Dropdown, Field, Input, Slider, Switch, Textarea, Tooltip } from '../ui/primitives'
import { SavePresetModal } from './SavePresetModal'
import { DEFINITIONS, RATIOS, describeSize, dimensions, estimate, modelOf, roughly } from '../../lib/images'
import { useImages } from '../../store/images'

/** Coût mémoire du contexte choisi. */
function MemoryHint({
  weights, shape, numCtx,
}: { weights: number; shape: Parameters<typeof estimateMemory>[1]; numCtx: number }) {
  const est = estimateMemory(weights, shape, numCtx)
  const system = useSystemMemory()
  if (!est) return null

  // Marge de sécurité : le système a besoin de respirer à côté du modèle.
  const budget = system ? system.available * 0.9 : null
  const tight = budget !== null && est.total > budget

  return (
    <div className={cn('rounded-sm px-3 py-2.5', tight ? 'bg-caution-wash' : 'bg-surface-2')}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-caption text-fg-muted">Empreinte estimée</span>
        <span className={cn('font-mono text-[13px] font-bold tabular-nums', tight ? 'text-caution' : 'text-fg')}>
          ≈ {formatBytes(est.total)}
        </span>
      </div>

      {system && (
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <span className="t-caption text-fg-muted">Mémoire disponible</span>
          <span className="font-mono text-[13px] tabular-nums text-fg-muted">{formatBytes(system.available)}</span>
        </div>
      )}

      <p className="t-caption mt-1.5 text-fg-subtle">
        {tight ? (
          <>
            Ce contexte dépasse ce que la machine peut offrir. Une partie du modèle serait relue
            depuis le disque à chaque jeton : la génération deviendrait extrêmement lente.
            Réduisez le contexte, ou fermez des applications.
          </>
        ) : (
          <>
            {formatBytes(est.weights)} de poids + {formatBytes(est.cache)} de cache d'attention.
          </>
        )}
      </p>

      {system?.swapping && !tight && (
        <p className="t-caption mt-1.5 text-caution">
          La machine utilise déjà massivement le disque comme mémoire ({formatBytes(system.swap.used)} d'échange).
        </p>
      )}
    </div>
  )
}

/** Réglages de diffusion. */
function ImageSection({ params, onPatch }: { params: ImageParams; onPatch: (p: Partial<ImageParams>) => void }) {
  const engine = useImages((s) => s.engine)
  const refresh = useImages((s) => s.refresh)
  const probing = useImages((s) => s.probing)

  useEffect(() => { if (probing) void refresh() }, [probing, refresh])

  const catalog = engine?.catalog ?? []
  const installed = catalog.filter((m) => m.installed)
  const model = modelOf(catalog, params.model)
  const { ratio, def } = describeSize(params.width, params.height)
  const steps = params.steps ?? model?.steps.default ?? 20

  const set = onPatch

  if (!engine?.ready || installed.length === 0) {
    return (
      <p className="text-[13px] text-fg-subtle">
        Aucun modèle d'images installé. Rendez-vous dans « Modèles » pour en télécharger un.
      </p>
    )
  }

  return (
    <>
      <Field label="Modèle">
        <Dropdown
          value={params.model}
          onChange={(v) => set({ model: v, steps: undefined, guidance: undefined })}
          options={installed.map((m) => ({ value: m.id, label: `${m.name} · ${m.variant}`, hint: m.note }))}
        />
      </Field>

      <Field label="Format">
        <Dropdown
          value={ratio.id}
          onChange={(v) => {
            const r = RATIOS.find((x) => x.id === v)
            if (r) set(dimensions(r, def))
          }}
          options={RATIOS.map((r) => ({ value: r.id, label: r.label, hint: r.hint }))}
        />
      </Field>

      <Field
        label="Définition"
        hint={`${params.width} × ${params.height} — environ ${roughly(estimate(steps, params.width, params.height, model?.msPerStep768, model?.loadMs))} par image sur cette machine.`}
      >
        <Dropdown
          value={def.id}
          onChange={(v) => {
            const d = DEFINITIONS.find((x) => x.id === v)
            if (d) set(dimensions(ratio, d))
          }}
          options={DEFINITIONS.map((d) => {
            const size = dimensions(ratio, d)
            return { value: d.id, label: d.label, hint: `${size.width} × ${size.height} — ${d.note}` }
          })}
        />
      </Field>

      {model && (
        <Slider
          label="Pas de débruitage"
          value={params.steps}
          defaultValue={model.steps.default}
          min={model.steps.min}
          max={model.steps.max}
          step={1}
          onChange={(v) => set({ steps: v })}
          hint="Chaque pas affine l'image. Au-delà d'une vingtaine, le gain devient difficile à voir — le temps, lui, continue de monter."
        />
      )}

      {model?.guidance && (
        <Slider
          label="Guidage"
          value={params.guidance}
          defaultValue={model.guidance.default}
          min={model.guidance.min}
          max={model.guidance.max}
          step={0.1}
          onChange={(v) => set({ guidance: v })}
          format={(v) => v.toFixed(1)}
          hint="Fidélité à la description. Trop haut, l'image se rigidifie ; trop bas, elle dérive."
        />
      )}

      {model && !model.guidance && (
        <p className="text-[12px] leading-snug text-fg-subtle">
          Ce modèle est distillé : il n'a pas de branche de guidage, le réglage n'aurait aucun effet.
        </p>
      )}

      <Field
        label="Graine"
        hint="Vide, elle est tirée au hasard à chaque image. Fixée, la même description redonne exactement la même image."
        action={
          <Tooltip label="Tirer une graine au hasard">
            <Button size="icon-sm" onClick={() => set({ seed: Math.floor(Math.random() * 2 ** 31) })}>
              <Dices size={16} />
            </Button>
          </Tooltip>
        }
      >
        <Input
          type="number"
          min={0}
          value={params.seed ?? ''}
          placeholder="Aléatoire"
          onChange={(e) => set({ seed: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
        />
      </Field>
    </>
  )
}

function Section({
  title, children, defaultOpen = true, hint,
}: { title: string; children: React.ReactNode; defaultOpen?: boolean; hint?: string }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-line last:border-0">
      <button onClick={() => setOpen((o) => !o)} className="flex h-12 w-full items-center gap-2 px-5 text-left">
        <ChevronRight size={14} className={cn('shrink-0 text-fg-subtle transition-transform duration-200', open && 'rotate-90')} />
        <span className="t-label flex-1 text-fg-muted">{title}</span>
        {hint && (
          <Tooltip label={hint} side="left"><Info size={14} className="text-fg-subtle" /></Tooltip>
        )}
      </button>
      {open && <div className="animate-fade-up space-y-5 px-5 pb-6">{children}</div>}
    </section>
  )
}

/** Ce sur quoi le panneau agit : une conversation, ou les valeurs par défaut. */
export interface InspectorTarget {
  model: string
  system: string
  params: Params
  think?: boolean
  /** Réglages de diffusion de la même cible — conversation, ou valeurs par défaut. */
  imageParams?: ImageParams
}

function Inspector({
  target, onPatch, heading, footer,
}: {
  target: InspectorTarget
  onPatch: (patch: Partial<InspectorTarget>) => void
  heading: string
  footer?: React.ReactNode
}) {
  const toggleInspector = useUI((s) => s.toggleInspector)
  const models = useModels((s) => s.models)
  const model = findModel(models, target.model)
  const shape = useModels((s) => s.shapes[target.model])
  const loadShape = useModels((s) => s.loadShape)
  const [savePreset, setSavePreset] = useState(false)

  useEffect(() => { if (target.model) void loadShape(target.model) }, [target.model, loadShape])

  const p = target.params
  const set = (patch: Partial<Params>) => onPatch({ params: { ...p, ...patch } })

  const maxCtx = model?.details?.context_length ?? 32768
  const ctxStep = maxCtx > 65536 ? 4096 : maxCtx > 16384 ? 1024 : 256

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-nav">
      <div className="flex h-16 shrink-0 items-center gap-1 border-b border-line px-5">
        <h2 className="flex-1 text-[15px] font-bold tracking-[-0.02em]">{heading}</h2>
        <Tooltip label="Enregistrer comme preset">
          <Button size="icon-sm" onClick={() => setSavePreset(true)}><Save size={16} /></Button>
        </Tooltip>
        <Tooltip label="Tout réinitialiser">
          <Button
            size="icon-sm"
            onClick={() => onPatch({ params: { ...DEFAULT_PARAMS } })}
          >
            <RotateCcw size={16} />
          </Button>
        </Tooltip>
        <Button size="icon-sm" onClick={toggleInspector} aria-label="Fermer"><X size={16} /></Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <Section title="Instructions système" hint="Message caché placé en tête de conversation. Définit le rôle et le ton du modèle.">
          <Textarea
            value={target.system}
            onChange={(e) => onPatch({ system: e.target.value })}
            placeholder="Tu es un assistant…"
            rows={5}
            className="min-h-28"
          />
        </Section>

        <Section title="Échantillonnage">
          <Slider
            label="Température" value={p.temperature} defaultValue={0.8} min={0} max={2} step={0.05}
            onChange={(v) => set({ temperature: v })} format={(v) => v.toFixed(2)}
            hint="Basse = factuel et répétable. Haute = créatif et imprévisible."
          />
          <Slider
            label="Top P" value={p.top_p} defaultValue={0.9} min={0.05} max={1} step={0.01}
            onChange={(v) => set({ top_p: v })} format={(v) => v.toFixed(2)}
            hint="Ne considère que les jetons cumulant cette probabilité."
          />
          <Slider
            label="Top K" value={p.top_k} defaultValue={40} min={1} max={120} step={1}
            onChange={(v) => set({ top_k: v })}
            hint="Nombre de candidats retenus à chaque jeton."
          />
          <Slider
            label="Min P" value={p.min_p} defaultValue={0} min={0} max={0.5} step={0.01}
            onChange={(v) => set({ min_p: v })} format={(v) => v.toFixed(2)}
            hint="Seuil relatif au meilleur candidat. 0 = désactivé."
          />
        </Section>

        <Section title="Répétition">
          <Slider
            label="Pénalité de répétition" value={p.repeat_penalty} defaultValue={1.1} min={0.8} max={2} step={0.01}
            onChange={(v) => set({ repeat_penalty: v })} format={(v) => v.toFixed(2)}
            hint="Au-dessus de 1, décourage les redites."
          />
          <Slider
            label="Fenêtre de répétition" value={p.repeat_last_n} defaultValue={64} min={-1} max={512} step={1}
            onChange={(v) => set({ repeat_last_n: v })} format={(v) => (v === -1 ? 'contexte' : String(v))}
            hint="Nombre de jetons récents surveillés. -1 = tout le contexte."
          />
        </Section>

        <Section title="Contexte et longueur">
          <Slider
            label="Fenêtre de contexte" value={p.num_ctx} defaultValue={8192} min={512} max={maxCtx} step={ctxStep}
            onChange={(v) => set({ num_ctx: v })} format={(v) => formatNumber(v)}
            hint={`Maximum du modèle : ${formatNumber(maxCtx)} jetons.`}
          />
          <MemoryHint weights={model?.size ?? 0} shape={shape ?? null} numCtx={p.num_ctx ?? 8192} />
          <Field label="Longueur maximale de réponse" hint="-1 pour laisser le modèle décider quand s'arrêter.">
            <Input
              type="number" min={-1} value={p.num_predict ?? -1}
              onChange={(e) => set({ num_predict: Number(e.target.value) })}
            />
          </Field>
        </Section>

        <Section title="Avancé" defaultOpen={false}>
          <Field
            label="Graine (seed)"
            hint="Une graine fixe rend les réponses reproductibles."
            action={
              <div className="flex items-center gap-2">
                <Tooltip label="Graine aléatoire">
                  <button onClick={() => set({ seed: Math.floor(Math.random() * 1e6) })} className="text-fg-subtle transition-colors hover:text-fg">
                    <Dices size={14} />
                  </button>
                </Tooltip>
                {p.seed !== undefined && (
                  <button onClick={() => set({ seed: undefined })} className="text-[11px] font-medium text-fg-subtle hover:text-fg">
                    réinit.
                  </button>
                )}
              </div>
            }
          >
            <Input
              type="number" placeholder="aléatoire" value={p.seed ?? ''}
              onChange={(e) => set({ seed: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          </Field>

          <Field label="Séquences d'arrêt" hint="Séparées par des virgules. La génération s'arrête si l'une apparaît.">
            <Input
              placeholder="###, Fin, Utilisateur:"
              defaultValue={(p.stop ?? []).join(', ')}
              onBlur={(e) => {
                const arr = e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                set({ stop: arr.length ? arr : undefined })
              }}
            />
          </Field>

          <Slider
            label="Mirostat" value={p.mirostat} defaultValue={0} min={0} max={2} step={1}
            onChange={(v) => set({ mirostat: v as 0 | 1 | 2 })}
            format={(v) => (v === 0 ? 'désactivé' : `v${v}`)}
            hint="Contrôle adaptatif de la perplexité. Remplace température et top-p."
          />
          {(p.mirostat ?? 0) > 0 && (
            <>
              <Slider label="Mirostat τ" value={p.mirostat_tau} defaultValue={5} min={0} max={10} step={0.1}
                onChange={(v) => set({ mirostat_tau: v })} format={(v) => v.toFixed(1)} />
              <Slider label="Mirostat η" value={p.mirostat_eta} defaultValue={0.1} min={0.01} max={1} step={0.01}
                onChange={(v) => set({ mirostat_eta: v })} format={(v) => v.toFixed(2)} />
            </>
          )}

          {hasCapability(model, 'thinking') && (
            <Switch
              label="Mode réflexion"
              hint="Le modèle raisonne avant de répondre. Plus lent, plus fiable."
              checked={target.think ?? true}
              onChange={(v) => onPatch({ think: v })}
            />
          )}
        </Section>

        <Section
          title="Image"
          defaultOpen={false}
          hint="Réglages de la génération d'images par diffusion. Ils sont communs à toutes les conversations."
        >
          <ImageSection
            params={target.imageParams ?? DEFAULT_IMAGE_PARAMS}
            onPatch={(patch) =>
              onPatch({ imageParams: { ...(target.imageParams ?? DEFAULT_IMAGE_PARAMS), ...patch } })
            }
          />
        </Section>

        <Section title="Modèle" defaultOpen={false}>
          {model ? (
            <>
              <dl className="space-y-2.5 text-[13px]">
                {([
                  ['Nom', prettyModel(model.name)],
                  ['Famille', model.details?.family ?? '—'],
                  ['Paramètres', model.details?.parameter_size ?? '—'],
                  ['Quantisation', model.details?.quantization_level ?? '—'],
                  ['Contexte max', formatNumber(model.details?.context_length ?? 0)],
                  ['Taille sur disque', formatBytes(model.size)],
                ] as const).map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3">
                    <dt className="shrink-0 text-fg-subtle">{k}</dt>
                    <dd className="truncate text-right font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
              {!!model.capabilities?.length && (
                <div className="flex flex-wrap gap-1.5">
                  {model.capabilities.map((c) => <Badge key={c} variant="outline">{c}</Badge>)}
                </div>
              )}
            </>
          ) : (
            <p className="text-[13px] text-fg-subtle">Modèle introuvable dans Ollama.</p>
          )}
        </Section>

        {footer}
      </div>

      <SavePresetModal open={savePreset} onClose={() => setSavePreset(false)} conv={target} />
    </aside>
  )
}


/** Panneau branché sur une conversation existante. */
export function ConversationInspector({ conv }: { conv: Conversation }) {
  const settings = useSettings()
  return (
    <Inspector
      heading="Paramètres"
      target={{ ...conv, imageParams: imageParamsOf(conv, settings) }}
      onPatch={(patch) => void updateConversation(conv.id, { ...patch, presetId: null })}
      footer={
        <div className="p-5">
          <Button
            variant="soft" size="sm" className="w-full"
            onClick={async () => {
              await patchSettings({
                defaultParams: { ...conv.params },
                defaultSystem: conv.system,
                defaultModel: conv.model,
              })
              toast({ title: 'Réglages par défaut mis à jour', tone: 'success' })
            }}
          >
            Définir comme valeurs par défaut
          </Button>
        </div>
      }
    />
  )
}

/** Panneau de l'accueil : il agit sur les valeurs par défaut, qui deviennent celles de la conversation créée. */
export function DefaultsInspector() {
  const settings = useSettings()
  return (
    <Inspector
      heading="Paramètres par défaut"
      target={{
        model: settings.defaultModel,
        system: settings.defaultSystem,
        params: settings.defaultParams,
        imageParams: settings.imageParams,
      }}
      onPatch={(patch) =>
        void patchSettings({
          ...(patch.params ? { defaultParams: patch.params } : {}),
          ...(patch.system !== undefined ? { defaultSystem: patch.system } : {}),
          ...(patch.imageParams ? { imageParams: patch.imageParams } : {}),
        })
      }
      footer={
        <p className="t-caption p-5 text-fg-subtle">
          Ces réglages s'appliqueront à la conversation que vous allez ouvrir, et aux suivantes.
        </p>
      }
    />
  )
}
