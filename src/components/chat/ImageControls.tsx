/** Commandes de diffusion — les mêmes dans le composeur et sur l'accueil. */
import { useEffect } from 'react'
import {
  Check, ChevronDown, FolderOpen, Image as ImageIcon, Layers, Maximize2,
  Ratio as RatioIcon, RefreshCw, Type,
} from 'lucide-react'
import {
  DEFAULT_LORA_SCALE, DEFINITIONS, RATIOS, activeLoras, describeSize, dimensions,
  estimate, imageModelName, loraMismatch, modelOf, revealLoras, roughly,
} from '../../lib/images'
import type { ImageModel, ImageParams, LoraFile } from '../../lib/types'
import { cn, formatBytes } from '../../lib/utils'
import { useImages } from '../../store/images'
import { Button, Chip, Menu, MenuItem, MenuLabel, MenuSeparator, Tooltip } from '../ui/primitives'
import { href, navigate } from '../../lib/router'

/** Sonde le moteur au montage : sans lui, le mode image n'a rien à proposer. */
export function useImageEngine() {
  const engine = useImages((s) => s.engine)
  const probing = useImages((s) => s.probing)
  const refresh = useImages((s) => s.refresh)
  useEffect(() => { if (probing) void refresh() }, [probing, refresh])
  return { engine, probing }
}

/** Bascule entre le texte et l'image, à gauche des réglages. */
export function ModeToggle({ mode, onChange, ready }: { mode: 'text' | 'image'; onChange: (m: 'text' | 'image') => void; ready: boolean }) {
  const next = mode === 'text' ? 'image' : 'text'
  const label = mode === 'text' ? 'Passer en génération d’images' : 'Revenir à la conversation'

  if (!ready && mode === 'text') {
    return (
      <Tooltip label="Aucun modèle d’images installé — à faire depuis « Modèles »" side="top">
        <Chip as="button" className="shrink-0 opacity-50" onClick={() => navigate(href.models())}>
          <ImageIcon className="size-3.5" />
          <span className="hidden sm:inline">Image</span>
        </Chip>
      </Tooltip>
    )
  }

  return (
    <Tooltip label={label} side="top">
      <Chip as="button" active={mode === 'image'} className="shrink-0" onClick={() => onChange(next)}>
        {mode === 'image' ? <Type className="size-3.5" /> : <ImageIcon className="size-3.5" />}
        <span className="hidden sm:inline">{mode === 'image' ? 'Texte' : 'Image'}</span>
      </Chip>
    </Tooltip>
  )
}

/* ── LoRAs ────────────────────────────────────────────────────────── */

/** Une ligne de la bibliothèque : l'interrupteur décide de l'accès, le curseur du dosage. */
function LoraRow({ lora, model, scale, onToggle, onScale }: {
  lora: LoraFile
  model: ImageModel | undefined
  scale: number | null
  onToggle: (on: boolean) => void
  onScale: (v: number) => void
}) {
  const on = scale !== null
  const why = loraMismatch(lora, model)
  return (
    <div className={cn('rounded-sm px-2.5 py-2 transition-colors', on && 'bg-fg/[0.04]')}>
      <div className="flex items-center gap-2.5">
        <button
          role="switch"
          aria-checked={on}
          onClick={() => onToggle(!on)}
          className={cn(
            'relative h-4 w-7 shrink-0 cursor-pointer rounded-full transition-colors duration-150',
            on ? 'bg-fg' : 'bg-fg/20',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 size-3 rounded-full bg-bg transition-transform duration-150',
              on ? 'translate-x-3.5' : 'translate-x-0.5',
            )}
          />
        </button>

        <button onClick={() => onToggle(!on)} className="min-w-0 flex-1 cursor-pointer text-left">
          <span className="t-meta block truncate font-medium text-fg">{lora.name}</span>
          <span className="t-caption block truncate text-fg-subtle">
            {lora.expert && (
              <span className="text-fg-muted">{lora.expert === 'high' ? 'bruit élevé' : 'bruit faible'} · </span>
            )}
            {lora.rank ? `rang ${lora.rank} · ` : ''}{formatBytes(lora.bytes)}
            {why && <span className="text-caution"> · {why}</span>}
          </span>
        </button>

        {on && (
          <span className="shrink-0 rounded-sm bg-fg/[0.07] px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums text-fg">
            {scale.toFixed(2)}
          </span>
        )}
      </div>

      {on && (
        <>
          <input
            type="range"
            min={0} max={1.5} step={0.05} value={scale}
            onChange={(e) => onScale(Number(e.target.value))}
            className="slider-input mt-2"
            style={{ '--pct': `${(scale / 1.5) * 100}%` } as React.CSSProperties}
          />
          {lora.trigger && (
            <p className="t-caption mt-1.5 text-fg-subtle">
              Placez <span className="font-mono text-fg-muted">{lora.trigger}</span> dans votre description.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function LoraChip({ params, model, onPatch }: {
  params: ImageParams
  model: ImageModel | undefined
  onPatch: (p: Partial<ImageParams>) => void
}) {
  const library = useImages((s) => s.library)
  const folder = useImages((s) => s.loraFolder)
  const refreshLoras = useImages((s) => s.refreshLoras)

  const chosen = activeLoras(params.loras, library)
  const scaleOf = (file: string) => chosen.find((c) => c.file === file)?.scale ?? null

  const set = (next: typeof chosen) => onPatch({ loras: next })
  const toggle = (file: string, on: boolean) =>
    set(on ? [...chosen, { file, scale: DEFAULT_LORA_SCALE }] : chosen.filter((c) => c.file !== file))
  const rescale = (file: string, scale: number) =>
    set(chosen.map((c) => (c.file === file ? { ...c, scale } : c)))

  return (
    <Menu
      side="top" width="w-[22rem]"
      trigger={({ open }) => (
        <Chip as="span" active={open || chosen.length > 0} className="shrink-0">
          <Layers className="size-3.5 shrink-0 text-fg-subtle" />
          <span>{chosen.length > 0 ? `${chosen.length} LoRA${chosen.length > 1 ? 's' : ''}` : 'LoRA'}</span>
          <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
        </Chip>
      )}
    >
      <div className="flex items-center gap-2 px-2.5 pt-2 pb-1.5">
        <span className="t-label flex-1 text-fg-subtle">Bibliothèque</span>
        <Tooltip label="Relire le dossier" side="top">
          <Button size="icon-sm" onClick={() => void refreshLoras()} aria-label="Relire">
            <RefreshCw className="size-3.5" />
          </Button>
        </Tooltip>
        <Tooltip label={folder || 'Ouvrir le dossier'} side="top">
          <Button size="icon-sm" onClick={() => void revealLoras()} aria-label="Ouvrir le dossier">
            <FolderOpen className="size-3.5" />
          </Button>
        </Tooltip>
      </div>

      {library.length === 0 ? (
        <p className="t-caption px-2.5 pb-3 text-fg-muted">
          La bibliothèque est vide. Déposez des fichiers <span className="font-mono">.safetensors</span> dans
          le dossier, puis relisez-le.
        </p>
      ) : (
        <div className="max-h-[min(52vh,26rem)] space-y-0.5 overflow-y-auto scroll-thin">
          {library.map((l) => (
            <LoraRow
              key={l.file}
              lora={l}
              model={model}
              scale={scaleOf(l.file)}
              onToggle={(on) => toggle(l.file, on)}
              onScale={(v) => rescale(l.file, v)}
            />
          ))}
        </div>
      )}

      {chosen.length > 0 && (
        <>
          <MenuSeparator />
          <button
            onClick={() => set([])}
            className="t-caption w-full cursor-pointer rounded-sm px-2.5 py-2 text-left text-fg-muted transition-colors hover:bg-fg/[0.05] hover:text-fg"
          >
            Tout désactiver
          </button>
        </>
      )}
    </Menu>
  )
}

/* ── Barre de commandes ───────────────────────────────────────────── */

export function ImageControls({ params, onPatch }: {
  params: ImageParams
  onPatch: (p: Partial<ImageParams>) => void
}) {
  const { engine } = useImageEngine()
  const catalog = engine?.catalog ?? []
  const installed = catalog.filter((m) => m.installed)
  const current = modelOf(catalog, params.model)
  const { ratio, def } = describeSize(params.width, params.height)

  const steps = params.steps ?? current?.steps.default ?? 20
  const perStep = current?.msPerStep768 ?? 27_000
  const fixed = current?.loadMs ?? 20_000
  const wait = roughly(estimate(steps, params.width, params.height, perStep, fixed))

  return (
    <>
      <Menu
        side="top" width="w-80"
        trigger={({ open }) => (
          <Chip as="span" active={open} className="min-w-0 max-w-[min(40vw,220px)]">
            <ImageIcon className="size-3.5 shrink-0 text-fg-subtle" />
            <span className="truncate">{imageModelName(current)}</span>
            <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
          </Chip>
        )}
      >
        <MenuLabel>Modèle d’images</MenuLabel>
        {installed.length === 0 && (
          <p className="t-caption px-2.5 py-3 text-fg-muted">Aucun modèle d’images téléchargé.</p>
        )}
        {installed.map((m) => (
          <MenuItem
            key={m.id}
            active={m.id === params.model}
            icon={m.id === params.model ? <Check className="size-4 text-fg" /> : null}
            onClick={() => onPatch({ model: m.id, steps: undefined, guidance: undefined })}
          >
            <span className="flex items-center gap-2">
              <span className="truncate">{m.name}</span>
              <span className="shrink-0 font-mono text-[11px] text-fg-subtle">{m.variant}</span>
            </span>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onClick={() => navigate(href.models())}>Gérer les modèles d’images…</MenuItem>
      </Menu>

      <LoraChip params={params} model={current} onPatch={onPatch} />

      <Menu
        side="top" width="w-56"
        trigger={({ open }) => (
          <Chip as="span" active={open} className="shrink-0">
            <RatioIcon className="size-3.5 shrink-0 text-fg-subtle" />
            <span>{ratio.hint}</span>
            <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
          </Chip>
        )}
      >
        <MenuLabel>Format</MenuLabel>
        {RATIOS.map((r) => (
          <MenuItem
            key={r.id}
            active={r.id === ratio.id}
            icon={r.id === ratio.id ? <Check className="size-4 text-fg" /> : null}
            onClick={() => onPatch(dimensions(r, def))}
          >
            <span className="flex items-center gap-2">
              <span>{r.label}</span>
              <span className="font-mono text-[11px] text-fg-subtle">{r.hint}</span>
            </span>
          </MenuItem>
        ))}
      </Menu>

      <Menu
        side="top" width="w-72"
        trigger={({ open }) => (
          <Chip as="span" active={open} className="min-w-0 shrink">
            <Maximize2 className="size-3.5 shrink-0 text-fg-subtle" />
            <span className="truncate">{def.label}</span>
            <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
          </Chip>
        )}
      >
        <MenuLabel>Définition</MenuLabel>
        {DEFINITIONS.map((d) => {
          const size = dimensions(ratio, d)
          return (
            <MenuItem
              key={d.id}
              active={d.id === def.id}
              icon={d.id === def.id ? <Check className="size-4 text-fg" /> : null}
              onClick={() => onPatch(size)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0">{d.label}</span>
                <span className="shrink-0 font-mono text-[11px] text-fg-subtle">
                  {size.width}×{size.height}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-fg-subtle">
                  {roughly(estimate(steps, size.width, size.height, perStep, fixed))}
                </span>
              </span>
            </MenuItem>
          )
        })}
      </Menu>

      {/* Le temps attendu remplace la jauge de contexte, qui n'a pas de sens ici. */}
      <Tooltip
        label={
          current?.measured
            ? `Estimation pour ${steps} pas en ${params.width} × ${params.height}, mesurée sur cette machine`
            : `Estimation pour ${steps} pas en ${params.width} × ${params.height}, déduite de la taille du modèle — pas encore chronométrée`
        }
        side="top"
      >
        <span className="ml-auto hidden shrink-0 cursor-default pr-1 font-mono text-[11px] tabular-nums text-fg-subtle sm:block">
          {wait}
        </span>
      </Tooltip>
    </>
  )
}
