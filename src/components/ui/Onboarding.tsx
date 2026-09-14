import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight, Boxes, Image as ImageIcon, Layers, MessageSquare, Shield, Sparkles, X,
} from 'lucide-react'
import { patchSettings } from '../../lib/db'
import { useSettings } from '../../lib/hooks'
import { Button, Input } from '../ui/primitives'

interface Step {
  icon: React.ReactNode
  title: string
  body: string
}

const STEPS: Step[] = [
  {
    icon: <MessageSquare className="size-5" />,
    title: 'Vos conversations restent ici',
    body: "Tout vit dans ce navigateur et l'inférence tourne sur votre machine. Aucun serveur, aucun compte, aucune télémétrie — et ça fonctionne sans connexion.",
  },
  {
    icon: <Boxes className="size-5" />,
    title: 'Choisissez vos modèles',
    body: "La page Modèles cherche sur Hugging Face et dans la bibliothèque Ollama. Vous voyez le poids, la quantification et la place occupée avant de télécharger.",
  },
  {
    icon: <Sparkles className="size-5" />,
    title: 'Les presets gardent vos réglages',
    body: "Des combinaisons d'instructions et de paramètres, applicables en un clic. Cinq sont fournis ; les vôtres s'ajoutent à côté.",
  },
  {
    icon: <ImageIcon className="size-5" />,
    title: 'Générez des images',
    body: "FLUX tourne en local, sans passer par Ollama qui n'en est pas capable. Le temps attendu est affiché avant de lancer, mesuré sur votre machine.",
  },
  {
    icon: <Layers className="size-5" />,
    title: 'Enrichissez-les avec des LoRAs',
    body: "Déposez des fichiers .safetensors dans la bibliothèque, activez-les conversation par conversation. Les incompatibles sont refusés avant de perdre du temps.",
  },
  {
    icon: <Shield className="size-5" />,
    title: 'Verrouillez ce qui compte',
    body: "Une conversation verrouillée est chiffrée au repos, texte et images compris. Sans la phrase de passe, la base n'est qu'un bloc inerte.",
  },
]

export function Onboarding() {
  const settings = useSettings()
  const [index, setIndex] = useState(-1)
  const [name, setName] = useState('')

  if (settings.onboarded) return null

  const done = () => void patchSettings({ onboarded: true })
  const step = STEPS[index]

  const start = () => {
    const clean = name.trim()
    if (clean) void patchSettings({ displayName: clean })
    setIndex(0)
  }

  return (
    <div className="fixed inset-0 z-90 flex items-center justify-center bg-fg/25 p-6 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        className="relative w-full max-w-lg rounded-lg bg-surface p-8 shadow-float"
      >
        <button
          onClick={done}
          aria-label="Ignorer le didacticiel"
          className="absolute top-4 right-4 flex size-8 cursor-pointer items-center justify-center rounded-full text-fg-subtle transition-colors hover:bg-fg/[0.06] hover:text-fg"
        >
          <X className="size-4" />
        </button>

        <AnimatePresence mode="wait">
          {index < 0 ? (
            <motion.div
              key="bienvenue"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              <h2 className="t-title">Bienvenue dans AI Studio</h2>
              <p className="t-body mt-3 text-fg-muted">
                Une interface locale pour vos modèles. Six écrans pour faire le tour, ou la croix pour filer directement.
              </p>
              <div className="mt-6">
                <label htmlFor="pseudo" className="t-ui block text-fg">Comment vous appeler&nbsp;?</label>
                <Input
                  id="pseudo"
                  className="mt-2"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') start() }}
                  placeholder="Prénom ou pseudonyme"
                  maxLength={32}
                  autoFocus
                />
                <p className="t-caption mt-2 text-fg-subtle">
                  Sert uniquement à vous saluer sur l’accueil. Modifiable dans les réglages.
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key={index}
              initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.18 }}
            >
              <span className="flex size-10 items-center justify-center rounded-full bg-fg/[0.06] text-fg">
                {step.icon}
              </span>
              <h2 className="t-title mt-4">{step.title}</h2>
              <p className="t-body mt-3 text-fg-muted">{step.body}</p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-8 flex items-center gap-3">
          <div className="flex flex-1 gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1 w-5 rounded-full transition-colors duration-200 ${i <= index ? 'bg-fg' : 'bg-fg/15'}`}
              />
            ))}
          </div>
          <Button variant="primary" size="sm" onClick={index < 0 ? start : index === STEPS.length - 1 ? done : () => setIndex(index + 1)}>
            {index < 0 ? 'Commencer' : index === STEPS.length - 1 ? 'Terminer' : 'Suivant'}
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
