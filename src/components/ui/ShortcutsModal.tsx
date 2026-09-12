import { Keyboard } from 'lucide-react'
import { modKey } from '../../lib/utils'
import { useUI } from '../../store/ui'
import { Kbd, Modal } from './primitives'

const GROUPS: Array<{ title: string; items: Array<[string, string[]]> }> = [
  {
    title: 'Général',
    items: [
      ['Palette de commandes', [modKey, 'K']],
      ['Nouvelle conversation', [modKey, 'N']],
      ['Réglages', [modKey, ',']],
      ['Ce panneau', [modKey, '/']],
    ],
  },
  {
    title: 'Affichage',
    items: [
      ['Barre latérale', [modKey, 'B']],
      ['Paramètres du modèle', [modKey, 'I']],
    ],
  },
  {
    title: 'Conversation',
    items: [
      ['Envoyer', ['Entrée']],
      ['Nouvelle ligne', ['Maj', 'Entrée']],
      ['Arrêter la génération', ['Échap']],
      ['Renommer (double-clic dans la liste)', ['⌥', 'clic']],
    ],
  },
]

export function ShortcutsModal() {
  const { shortcutsOpen, setShortcutsOpen } = useUI()
  return (
    <Modal
      open={shortcutsOpen}
      onClose={() => setShortcutsOpen(false)}
      title="Raccourcis clavier"
      icon={<Keyboard size={16} />}
      width="max-w-md"
    >
      <div className="space-y-5">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-2 text-[11px] font-bold tracking-wider text-fg-subtle uppercase">{g.title}</h3>
            <ul className="space-y-1.5">
              {g.items.map(([label, keys]) => (
                <li key={label} className="flex items-center justify-between gap-4">
                  <span className="text-[13px] text-fg-muted">{label}</span>
                  <span className="flex shrink-0 gap-1">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  )
}
