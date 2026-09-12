import {
  AlignLeft, Brain, Check, Download, FileJson, LayoutList, Lightbulb, Lock, LockOpen,
  MoreHorizontal, RefreshCw, SlidersHorizontal, Trash2,
} from 'lucide-react'
import { deleteConversation, exportJSON, exportMarkdown, setConversationLocked, updateConversation } from '../../lib/db'
import type { Conversation, Transcript } from '../../lib/types'
import { cn, download, modKey, slugify } from '../../lib/utils'
import { useModels } from '../../store/models'
import { useUI } from '../../store/ui'
import { Button, Menu, MenuItem, MenuLabel, MenuSeparator, SpinButton, Tooltip } from '../ui/primitives'
import { useChat } from '../../store/chat'
import { useVault } from '../../store/vault'
import { toast } from '../../store/ui'
import { href, navigate } from '../../lib/router'

const VIEWS: Array<{ value: Transcript; label: string; icon: React.ReactNode; hint: string }> = [
  { value: 'normal', label: 'Normale', icon: <AlignLeft className="size-4" />, hint: 'Raisonnement replié' },
  { value: 'thinking', label: 'Réflexion', icon: <Lightbulb className="size-4" />, hint: 'Raisonnement ouvert, réponse repliée' },
  { value: 'detailed', label: 'Détaillée', icon: <LayoutList className="size-4" />, hint: 'Tout est déplié' },
]

/**
 * En-tête en trois zones de largeur égale : le titre est centré
 * mathématiquement, quel que soit le nombre d'actions de part et d'autre.
 */
export function TopBar({ conv }: { conv: Conversation }) {
  const { sidebarOpen, inspectorOpen, toggleInspector, setMemoryOpen } = useUI()
  const refresh = useModels((s) => s.refresh)
  const compact = useChat((s) => s.compact)
  const { unlocked, exists } = useVault()
  const setVaultOpen = useUI((s) => s.setVaultOpen)

  /* Verrouiller suppose un coffre ouvert : sinon on y mène d'abord. */
  const toggleLock = async () => {
    if (!unlocked || exists === false) { setVaultOpen(true); return }
    try {
      await setConversationLocked(conv.id, conv.locked !== 1)
      toast({
        title: conv.locked ? 'Conversation déverrouillée' : 'Conversation verrouillée',
        description: conv.locked
          ? 'Son contenu est de nouveau stocké en clair.'
          : 'Titre, instructions et messages sont désormais chiffrés au repos.',
        tone: 'success',
      })
    } catch (e) {
      toast({ title: 'Opération impossible', description: (e as Error).message, tone: 'danger' })
    }
  }

  return (
    <header className="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-line px-3">
      {/* Décalage quand la bascule flottante occupe le coin. */}
      <div className={cn('flex items-center gap-1', !sidebarOpen && 'pl-12')} />

      <h1 className="t-ui min-w-0 truncate text-center text-fg">{conv.title}</h1>

      <div className="flex items-center justify-end gap-1">
        <SpinButton icon={RefreshCw} size="icon" title="Rafraîchir Ollama" onClick={() => void refresh()} />
        <Tooltip label="Paramètres du modèle" kbd={`${modKey}I`}>
          <Button size="icon" active={inspectorOpen} onClick={toggleInspector} aria-label="Paramètres du modèle">
            <SlidersHorizontal className="size-4" />
          </Button>
        </Tooltip>
        <Menu
          align="end"
          width="w-64"
          trigger={() => (
            <Button size="icon" aria-label="Autres actions"><MoreHorizontal className="size-4" /></Button>
          )}
        >
          <MenuLabel>Vue de transcription</MenuLabel>
          {VIEWS.map((v) => (
            <MenuItem
              key={v.value}
              active={conv.transcript === v.value}
              icon={conv.transcript === v.value ? <Check className="size-4 text-fg" /> : v.icon}
              onClick={() => void updateConversation(conv.id, { transcript: v.value })}
            >
              <span className="flex flex-col gap-0.5">
                <span className="leading-none">{v.label}</span>
                <span className="text-[11px] leading-none font-medium text-fg-subtle">{v.hint}</span>
              </span>
            </MenuItem>
          ))}

          <MenuSeparator />
          <MenuItem
            icon={conv.locked ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
            onClick={() => void toggleLock()}
          >
            {conv.locked ? 'Déverrouiller' : 'Verrouiller cette conversation'}
          </MenuItem>
          <MenuItem icon={<Brain className="size-4" />} onClick={() => setMemoryOpen(true)}>
            Mémoire de la conversation
          </MenuItem>
          <MenuItem icon={<RefreshCw className="size-4" />} onClick={() => void compact(conv.id)}>
            Compacter maintenant
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={<Download className="size-4" />}
            onClick={async () => download(`${slugify(conv.title)}.md`, await exportMarkdown(conv.id), 'text/markdown')}
          >
            Exporter en Markdown
          </MenuItem>
          <MenuItem
            icon={<FileJson className="size-4" />}
            onClick={async () =>
              download(`${slugify(conv.title)}.json`, JSON.stringify(await exportJSON([conv.id]), null, 2), 'application/json')
            }
          >
            Exporter en JSON
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={<Trash2 className="size-4" />}
            danger
            onClick={async () => { await deleteConversation(conv.id); navigate(href.home()) }}
          >
            Supprimer la conversation
          </MenuItem>
        </Menu>
      </div>
    </header>
  )
}
