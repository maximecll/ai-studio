import {
  Binoculars, BookOpen, Braces, Calculator, Compass, FlaskConical, Gavel, Languages,
  Lightbulb, PenLine, Scale, Sparkles, Target, Terminal, Wand2,
  type LucideIcon,
} from 'lucide-react'

/** Jeu d'icônes fermé, une seule bibliothèque, un seul trait, une seule taille. */
export const PRESET_ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  terminal: Terminal,
  braces: Braces,
  pen: PenLine,
  book: BookOpen,
  lightbulb: Lightbulb,
  compass: Compass,
  target: Target,
  flask: FlaskConical,
  scale: Scale,
  gavel: Gavel,
  languages: Languages,
  calculator: Calculator,
  binoculars: Binoculars,
  wand: Wand2,
}

export const PRESET_ICON_KEYS = Object.keys(PRESET_ICONS)

export function PresetGlyph({ name, className = 'size-4' }: { name: string; className?: string }) {
  const Icon = PRESET_ICONS[name] ?? Sparkles
  return <Icon className={className} strokeWidth={1.75} />
}
