import {
  createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState,
  type ComponentType, type InputHTMLAttributes, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, type HTMLMotionProps } from 'framer-motion'
import { Check, ChevronDown, X, type LucideIcon } from 'lucide-react'
import { cn } from '../../lib/utils'

// ═══════════════════════════════════════════════════════════════════ Boutons, capsule systématique, 13px medium, réaction au survol et à l'appui.

type Variant = 'primary' | 'soft' | 'quiet' | 'danger'
type Size = 'sm' | 'md' | 'lg' | 'icon-sm' | 'icon' | 'icon-lg'

const VARIANTS: Record<Variant, string> = {
  /* L'action principale est encrée, pas colorée : l'accent reste rare. */
  primary: 'bg-solid text-solid-fg hover:bg-solid-hover border border-transparent',
  soft: 'bg-fg/[0.04] hover:bg-fg/[0.07] text-fg border border-fg/[0.07]',
  quiet: 'text-fg-muted hover:text-fg hover:bg-fg/[0.05] border border-transparent',
  danger: 'bg-negative/[0.07] hover:bg-negative/[0.11] text-negative border border-negative/15',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-4 text-[13px] gap-2',
  md: 'h-9 px-6 text-[13px] gap-2.5',
  lg: 'h-11 px-7 text-[15px] gap-2.5',
  'icon-sm': 'h-7 w-7',
  icon: 'h-9 w-9',
  'icon-lg': 'h-11 w-11',
}

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'ref'> {
  variant?: Variant
  size?: Size
  active?: boolean
}

export function Button({ variant = 'quiet', size = 'md', active, className, ...props }: ButtonProps) {
  return (
    <motion.button
      whileHover={props.disabled ? undefined : { scale: 1.02 }}
      whileTap={props.disabled ? undefined : { scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      {...props}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full',
        'font-medium tracking-tight transition-colors duration-150',
        'disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        active && 'bg-fg/[0.07] text-fg',
        className,
      )}
    />
  )
}

/** Icône qui se métamorphose au survol (Copier → Coché, Télécharger → Coché). */
function MorphIcon({ idle: Idle, hover: Hover, hovered, className }: {
  idle: LucideIcon
  hover: LucideIcon
  hovered: boolean
  className?: string
}) {
  return (
    <span className="relative flex size-4 shrink-0 items-center justify-center">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={hovered ? 'hover' : 'idle'}
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 25 }}
          className="absolute inset-0 flex items-center justify-center"
        >
          {hovered ? <Hover className={cn('size-4', className)} /> : <Idle className={cn('size-4', className)} />}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

/** Bouton dont l'icône se métamorphose au survol, et se fige sur l'état « fait ». */
export function MorphButton({
  idle, hover, label, onClick, done, variant = 'soft', size = 'md', tone, className, iconClassName, disabled, title,
}: {
  idle: LucideIcon
  hover: LucideIcon
  label?: string
  onClick?: () => void | Promise<void>
  done?: boolean
  variant?: Variant
  size?: Size
  tone?: string
  className?: string
  /** Ajustement optique de l'icône (certains glyphes ne sont pas centrés). */
  iconClassName?: string
  disabled?: boolean
  title?: string
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <Button
      variant={variant}
      size={label ? size : size.startsWith('icon') ? size : 'icon'}
      disabled={disabled}
      title={title}
      aria-label={title ?? label}
      onClick={onClick}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className={cn(tone, className)}
    >
      <MorphIcon idle={idle} hover={hover} hovered={hovered || !!done} className={iconClassName} />
      {label && <span>{label}</span>}
    </Button>
  )
}

/** Bouton destructif : l'icône tressaille au survol, prévenant du geste. */
export function ShakeButton({
  icon: Icon, label, onClick, size = 'md', title, disabled, className,
}: {
  icon: LucideIcon
  label?: string
  onClick?: () => void
  size?: Size
  title?: string
  disabled?: boolean
  className?: string
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <Button
      variant="quiet"
      size={label ? size : 'icon'}
      disabled={disabled}
      title={title}
      aria-label={title ?? label}
      onClick={onClick}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className={cn('text-negative hover:bg-negative/[0.08] hover:text-negative', className)}
    >
      <motion.span
        className="flex size-4 shrink-0 items-center justify-center"
        animate={{
          y: hovered ? [0, -2, 0, -2, 0] : 0,
          rotate: hovered ? [0, -10, 10, -10, 0] : 0,
        }}
        transition={{ duration: 0.4 }}
      >
        <Icon className="size-4" />
      </motion.span>
      {label && <span>{label}</span>}
    </Button>
  )
}

/** Bouton de rafraîchissement : l'icône pivote d'un demi-tour au survol. */
export function SpinButton({
  icon: Icon, label, onClick, size = 'md', title, spinning, variant = 'quiet', className,
}: {
  icon: LucideIcon
  label?: string
  onClick?: () => void | Promise<void>
  size?: Size
  title?: string
  spinning?: boolean
  variant?: Variant
  className?: string
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <Button
      variant={variant}
      size={label ? size : 'icon'}
      title={title}
      aria-label={title ?? label}
      onClick={onClick}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className={className}
    >
      <motion.span
        className="flex size-4 shrink-0 items-center justify-center"
        animate={spinning ? { rotate: 360 } : { rotate: hovered ? 180 : 0 }}
        transition={
          spinning
            ? { repeat: Infinity, ease: 'linear', duration: 0.9 }
            : { type: 'spring', stiffness: 400, damping: 25 }
        }
      >
        <Icon className="size-4" />
      </motion.span>
      {label && <span>{label}</span>}
    </Button>
  )
}

/** Capsule cliquable : la brique de navigation et de sélection. */
export function Chip({
  children, active, onClick, className, as: As = 'button', ...rest
}: {
  children: ReactNode
  active?: boolean
  onClick?: () => void
  className?: string
  as?: ComponentType<Record<string, unknown>> | 'button' | 'span'
} & Record<string, unknown>) {
  const El = As as 'button'
  return (
    <El
      onClick={onClick}
      {...rest}
      className={cn(
        'inline-flex h-8 cursor-pointer items-center gap-2 rounded-full px-3.5',
        'text-[13px] font-medium tracking-tight transition-colors duration-150',
        active ? 'bg-fg/[0.07] text-fg' : 'text-fg-muted hover:bg-fg/[0.05] hover:text-fg',
        className,
      )}
    >
      {children}
    </El>
  )
}

// ═══════════════════════════════════════════════════════════════════ Surfaces ═══════════════════════════════════════════════════════════════════

export function Card({ children, className, float }: { children: ReactNode; className?: string; float?: boolean }) {
  return (
    <div className={cn('rounded-lg bg-surface', float ? 'shadow-float' : 'shadow-card', className)}>
      {children}
    </div>
  )
}

/** Badge, deux variantes seulement : · outline : fond transparent, contour d'un pixel · soft : fond teinté, aucun contour Géométrie fixe h-6 / px-3 /… */
type BadgeTone = 'neutral' | 'positive' | 'caution' | 'negative'

const BADGE_SOFT: Record<BadgeTone, string> = {
  neutral: 'bg-fg/[0.06] text-fg-muted',
  positive: 'bg-positive-wash text-positive',
  caution: 'bg-caution-wash text-caution',
  negative: 'bg-negative-wash text-negative',
}

const BADGE_OUTLINE: Record<BadgeTone, string> = {
  neutral: 'border-line text-fg-muted',
  positive: 'border-positive/35 text-positive',
  caution: 'border-caution/35 text-caution',
  negative: 'border-negative/35 text-negative',
}

export function Badge({
  children, tone = 'neutral', variant = 'soft', className,
}: {
  children: ReactNode
  tone?: BadgeTone
  variant?: 'outline' | 'soft'
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1.5 rounded-sm px-3 py-1',
        'border text-[12px] font-medium tracking-tight whitespace-nowrap',
        variant === 'outline' ? cn('bg-transparent', BADGE_OUTLINE[tone]) : cn('border-transparent', BADGE_SOFT[tone]),
        className,
      )}
    >
      {children}
    </span>
  )
}

// ═══════════════════════════════════════════════════════════════════ Info-bulle ═══════════════════════════════════════════════════════════════════

export function Tooltip({
  label, children, side = 'bottom', kbd,
}: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; kbd?: string }) {
  const pos = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  }[side]
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-70 flex items-center gap-2 whitespace-nowrap rounded-sm px-2.5 py-1.5',
          'bg-fg text-[12px] leading-none font-medium tracking-tight text-bg opacity-0',
          'transition-opacity duration-150 group-hover/tt:opacity-100 group-hover/tt:delay-500',
          pos,
        )}
      >
        {label}
        {kbd && <span className="font-mono text-[11px] opacity-55">{kbd}</span>}
      </span>
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-line bg-surface-2 px-2 font-sans text-[11px] leading-none font-medium text-fg-muted">
      {children}
    </kbd>
  )
}

// ═══════════════════════════════════════════════════════════════════ Modale ═══════════════════════════════════════════════════════════════════

export function Modal({
  open, onClose, title, description, children, footer, width = 'max-w-lg', icon,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: string
  icon?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-60 flex items-start justify-center overflow-y-auto p-6 sm:p-10">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/65 backdrop-blur-[2px]"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal
            initial={{ opacity: 0, y: 10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            className={cn('relative my-auto w-full rounded-lg bg-surface shadow-float', width)}
          >
            <header className="flex items-start gap-3 px-6 pt-6 pb-5">
              {icon && <span className="mt-0.5 shrink-0 text-fg-muted">{icon}</span>}
              <div className="min-w-0 flex-1">
                <h2 className="t-heading-sm truncate">{title}</h2>
                {description && <p className="t-caption mt-1 text-fg-muted">{description}</p>}
              </div>
              <Button size="icon-sm" onClick={onClose} aria-label="Fermer"><X className="size-4" /></Button>
            </header>
            <div className="max-h-[min(68vh,660px)] overflow-y-auto scroll-thin px-6 pb-6">{children}</div>
            {footer && (
              <footer className="flex items-center justify-end gap-2 rounded-b-lg border-t border-line bg-surface-2 px-6 py-4">
                {footer}
              </footer>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

export function ConfirmModal({
  open, onClose, onConfirm, title, description, confirmLabel = 'Confirmer', danger,
}: {
  open: boolean; onClose: () => void; onConfirm: () => void
  title: string; description?: ReactNode; confirmLabel?: string; danger?: boolean
}) {
  return (
    <Modal
      open={open} onClose={onClose} title={title} description={description} width="max-w-md"
      footer={
        <>
          <Button variant="soft" size="sm" onClick={onClose}>Annuler</Button>
          <Button
            variant={danger ? 'danger' : 'primary'} size="sm"
            onClick={() => { onConfirm(); onClose() }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="t-caption text-fg-muted">Cette action est définitive.</p>
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════ Menu ═══════════════════════════════════════════════════════════════════

const MenuCtx = createContext<{ close: () => void }>({ close: () => {} })

export function Menu({
  trigger, children, align = 'start', width = 'w-60', side = 'bottom',
}: {
  trigger: (p: { open: boolean }) => ReactNode
  children: ReactNode
  align?: 'start' | 'end'
  width?: string
  side?: 'bottom' | 'top'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen((o) => !o)}>{trigger({ open })}</div>
      <AnimatePresence>
        {open && (
          <MenuCtx.Provider value={{ close: () => setOpen(false) }}>
            <motion.div
              role="menu"
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
              className={cn(
                'absolute z-50 rounded-lg bg-surface p-1.5 shadow-float',
                width,
                side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2',
                align === 'start' ? 'left-0' : 'right-0',
              )}
            >
              {children}
            </motion.div>
          </MenuCtx.Provider>
        )}
      </AnimatePresence>
    </div>
  )
}

export function MenuItem({
  icon, children, onClick, danger, shortcut, disabled, active,
}: {
  icon?: ReactNode; children: ReactNode; onClick?: () => void
  danger?: boolean; shortcut?: string; disabled?: boolean; active?: boolean
}) {
  const { close } = useContext(MenuCtx)
  return (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={() => { onClick?.(); close() }}
      className={cn(
        'flex min-h-9 w-full cursor-pointer items-center gap-3 rounded-sm px-2.5 py-1.5 text-left',
        'text-[13px] font-medium tracking-tight transition-colors duration-100',
        'disabled:pointer-events-none disabled:opacity-40',
        danger ? 'text-negative hover:bg-negative/[0.07]' : 'text-fg hover:bg-fg/[0.05]',
        active && !danger && 'bg-fg/[0.05]',
      )}
    >
      {icon && <span className={cn('flex w-4 shrink-0 justify-center', danger ? 'text-negative' : 'text-fg-subtle')}>{icon}</span>}
      <span className="min-w-0 flex-1">{children}</span>
      {shortcut && <span className="shrink-0 font-mono text-[11px] text-fg-subtle">{shortcut}</span>}
    </button>
  )
}

export function MenuSeparator() {
  return <div className="my-1.5 h-px bg-line" />
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="t-label px-2.5 pt-2 pb-1.5 text-fg-subtle">{children}</div>
}

// ═══════════════════════════════════════════════════════════════════ Formulaires ═══════════════════════════════════════════════════════════════════

export function Field({
  label, hint, children, htmlFor, action,
}: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string; action?: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex min-h-5 items-center justify-between gap-3">
        <label htmlFor={htmlFor} className="t-ui leading-none text-fg">{label}</label>
        {action}
      </div>
      {children}
      {hint && <p className="text-[12px] leading-snug text-fg-subtle">{hint}</p>}
    </div>
  )
}

const CONTROL =
  'w-full rounded-sm border border-line bg-surface text-[14px] text-fg placeholder:text-fg-subtle ' +
  'transition-[border-color,box-shadow] duration-150 ' +
  'focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-ring)] focus:outline-none'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(CONTROL, 'h-10 px-3', className)} />
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(CONTROL, 'resize-none px-3 py-2.5 leading-relaxed scroll-thin', className)} />
}

/** Liste déroulante maison, rien de natif : même rayon, même graisse, mêmes teintes que le reste, et le panneau suit la largeur du champ. */
export function Dropdown<T extends string>({
  value, onChange, options, placeholder = 'Choisir…', className,
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: string; hint?: string }>
  placeholder?: string
  className?: string
}) {
  const current = options.find((o) => o.value === value)
  return (
    <Menu
      width="w-full"
      trigger={({ open }) => (
        <button
          type="button"
          className={cn(
            CONTROL, 'flex h-10 cursor-pointer items-center gap-2 px-3 text-left',
            open && 'border-accent shadow-[0_0_0_3px_var(--accent-ring)]',
            className,
          )}
        >
          <span className={cn('min-w-0 flex-1 truncate', !current && 'text-fg-subtle')}>
            {current?.label ?? placeholder}
          </span>
          <ChevronDown className={cn('size-4 shrink-0 text-fg-muted transition-transform duration-200', open && 'rotate-180')} />
        </button>
      )}
    >
      {options.map((o) => (
        <MenuItem
          key={o.value}
          active={o.value === value}
          icon={o.value === value ? <Check className="size-4" /> : null}
          onClick={() => onChange(o.value)}
        >
          <span className="flex flex-col gap-0.5">
            <span className="leading-none">{o.label}</span>
            {o.hint && <span className="text-[11px] leading-none font-medium text-fg-subtle">{o.hint}</span>}
          </span>
        </MenuItem>
      ))}
    </Menu>
  )
}

export function Switch({
  checked, onChange, label, hint, id,
}: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; id?: string }) {
  const auto = useId()
  const key = id ?? auto
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <label htmlFor={key} className="t-ui cursor-pointer leading-tight text-fg">{label}</label>
        {hint && <p className="mt-1 text-[12px] leading-snug text-fg-subtle">{hint}</p>}
      </div>
      <button
        id={key}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-10 shrink-0 cursor-pointer rounded-full transition-colors duration-200',
          checked ? 'bg-accent' : 'bg-fg/[0.12]',
        )}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 700, damping: 34 }}
          className={cn(
            'absolute top-1 size-4 rounded-full bg-white shadow-sm',
            checked ? 'left-5' : 'left-1',
          )}
        />
      </button>
    </div>
  )
}

export function Slider({
  label, value, onChange, min, max, step, hint, defaultValue, format,
}: {
  label: ReactNode
  value: number | undefined
  onChange: (v: number | undefined) => void
  min: number; max: number; step: number
  hint?: ReactNode
  defaultValue: number
  format?: (v: number) => string
}) {
  const v = value ?? defaultValue
  const isDefault = value === undefined || value === defaultValue
  const pct = ((v - min) / (max - min)) * 100
  return (
    <div className="group/sl">
      <div className="flex h-5 items-center justify-between gap-3">
        <label className="t-ui leading-none text-fg">{label}</label>
        <div className="flex items-center gap-2">
          {!isDefault && (
            <button
              onClick={() => onChange(undefined)}
              className="cursor-pointer text-[11px] leading-none font-medium text-fg-subtle opacity-0 transition-opacity hover:text-fg group-hover/sl:opacity-100"
            >
              réinit.
            </button>
          )}
          <span
            className={cn(
              'rounded-sm px-2 py-0.5 font-mono text-[12px] leading-none tabular-nums',
              isDefault ? 'text-fg-subtle' : 'bg-fg/[0.07] font-bold text-fg',
            )}
          >
            {format ? format(v) : v}
          </span>
        </div>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={v}
        onChange={(e) => onChange(Number(e.target.value))}
        className="slider-input mt-1.5"
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
      />
      {hint && <p className="mt-0.5 text-[12px] leading-snug text-fg-subtle">{hint}</p>}
    </div>
  )
}

/** Bouton de copie : icône qui se métamorphose, état « copié » pendant 1,5 s. */
export function CopyAction({
  text, label, size = 'icon-sm',
}: { text: string; label?: string; size?: Size }) {
  const [done, setDone] = useState(false)
  return (
    <MorphButton
      idle={useCopyIcon()} hover={Check} done={done} label={label} size={size}
      variant="quiet" title={done ? 'Copié' : 'Copier'}
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
    />
  )
}

/* Import différé pour éviter une dépendance circulaire de lisibilité. */
import { Copy as CopyIcon } from 'lucide-react'
function useCopyIcon() { return CopyIcon }

/** Ancre le défilement en bas tant que l'utilisateur n'a pas remonté. */
export function useStickToBottom(deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 90
      stuck.current = near
      setAtBottom(near)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    const el = ref.current
    if (el && stuck.current) el.scrollTop = el.scrollHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return {
    ref,
    atBottom,
    scrollToBottom: () => {
      const el = ref.current
      if (el) { stuck.current = true; el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }) }
    },
  }
}
