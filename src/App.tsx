import { useCallback, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { bootstrap } from './lib/db'
import { useConversations, useHotkey, useMediaQuery } from './lib/hooks'
import { href, navigate, useRoute } from './lib/router'
import { modKey } from './lib/utils'
import { useUI } from './store/ui'
import { useModels } from './store/models'
import { useChat } from './store/chat'
import { useVault } from './store/vault'
import { PanelLeft } from 'lucide-react'
import { Sidebar } from './components/layout/Sidebar'
import { Button, Tooltip } from './components/ui/primitives'
import { ChatView } from './components/chat/ChatView'
import { HomeView } from './components/home/HomeView'
import { ModelsView } from './components/models/ModelsView'
import { NotFound } from './components/NotFound'
import { ConversationInspector, DefaultsInspector } from './components/settings/Inspector'
import { MemoryModal } from './components/chat/MemoryModal'
import { VaultModal } from './components/settings/VaultModal'
import { SettingsView } from './components/settings/SettingsView'
import { PresetsView } from './components/settings/PresetsView'
import { CommandPalette } from './components/ui/CommandPalette'
import { ShortcutsModal } from './components/ui/ShortcutsModal'
import { Toasts } from './components/ui/Toasts'
import { Onboarding } from './components/ui/Onboarding'
import { UpdateGate } from './components/ui/UpdateGate'


/** Transition douce entre les vues, sans déplacer le châssis. */
function View({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={k}
        /* Opacité seule : translater une colonne pleine hauteur la fait
           déborder du châssis, et le bas du composeur se retrouve coupé. */
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

export function App() {
  const route = useRoute()
  const ui = useUI()
  const conversations = useConversations()
  const refresh = useModels((s) => s.refresh)
  const models = useModels((s) => s.models)
  const stop = useChat((s) => s.stop)

  const activeId = route.name === 'conversation' ? route.id : null
  const streaming = useChat((s) => (activeId ? !!s.streams[activeId] : false))

  const loadVault = useVault((s) => s.load)
  const vaultUnlocked = useVault((s) => s.unlocked)
  useEffect(() => { void loadVault() }, [loadVault])

  /* Hors ligne, on espace les sondages : chaque échec salit la console du
     navigateur et n'apprend rien de plus. */
  useEffect(() => {
    let vivant = true
    let timer: number
    const tick = async () => {
      await refresh(true)
      if (!vivant) return
      timer = window.setTimeout(() => void tick(), useModels.getState().status === 'offline' ? 60_000 : 15_000)
    }
    void refresh()
    timer = window.setTimeout(() => void tick(), 15_000)
    return () => { vivant = false; clearTimeout(timer) }
  }, [refresh])

  useEffect(() => {
    if (models.length) void bootstrap(models[0].name)
  }, [models])

  /* En passant sous 900 px, la barre latérale se referme : elle deviendrait
     une superposition couvrant l'écran. */
  const wide = useMediaQuery('(min-width: 901px)')
  useEffect(() => {
    if (!wide) useUI.setState({ sidebarOpen: false })
  }, [wide])

  const newConversation = useCallback(async () => {
    // Une conversation vide n'a pas besoin d'URL : on repasse par l'accueil.
    navigate(href.home())
  }, [])

  useHotkey('mod+k', (e) => { e.preventDefault(); ui.setPalette(!ui.paletteOpen) })
  useHotkey('mod+n', (e) => { e.preventDefault(); void newConversation() })
  useHotkey('mod+b', (e) => { e.preventDefault(); ui.toggleSidebar() })
  useHotkey('mod+i', (e) => { e.preventDefault(); ui.toggleInspector() })
  useHotkey('mod+,', (e) => { e.preventDefault(); navigate(href.settings()) })
  useHotkey('mod+/', (e) => { e.preventDefault(); ui.setShortcutsOpen(true) })
  useHotkey('mod+shift+l', (e) => { e.preventDefault(); useVault.getState().lock() })
  useHotkey('escape', () => {
    if (streaming && activeId && !ui.paletteOpen) stop(activeId)
  })

  const active = activeId && conversations ? conversations.find((c) => c.id === activeId) : undefined
  const loading = route.name === 'conversation' && conversations === undefined

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />

      {/* Bascule flottante : l'en-tête n'existe que dans une conversation,
          sans elle on reste enfermé hors de la barre latérale. */}
      {!ui.sidebarOpen && (
        <div className="fixed top-3 left-3 z-30">
          <Tooltip label="Afficher la barre latérale" kbd={`${modKey}B`} side="right">
            <Button
              size="icon"
              variant="soft"
              className="bg-surface shadow-card"
              onClick={ui.toggleSidebar}
              aria-label="Afficher la barre latérale"
            >
              <PanelLeft className="size-4" />
            </Button>
          </Tooltip>
        </div>
      )}

      {route.name === 'home' && <View k="home"><HomeView /></View>}
      {route.name === 'models' && <View k="models"><ModelsView /></View>}
      {route.name === 'settings' && <View k="settings"><SettingsView /></View>}
      {route.name === 'presets' && <View k="presets"><PresetsView /></View>}
      {route.name === 'notfound' && <View k="404"><NotFound path={route.path} /></View>}

      {route.name === 'conversation' && (
        loading ? (
          <div className="flex flex-1 items-center justify-center" />
        ) : active ? (
          <View k={active.id}><ChatView conv={active} /></View>
        ) : (
          <View k="404"><NotFound path={`/c/${route.id}`} /></View>
        )
      )}

      {/* Rien à régler sur une conversation qu'on ne peut pas lire. */}
      {route.name === 'conversation' && active && ui.inspectorOpen
        && !(active.locked === 1 && !vaultUnlocked) && <ConversationInspector conv={active} />}
      {route.name === 'home' && ui.inspectorOpen && <DefaultsInspector />}
      {active && <MemoryModal conv={active} />}
      <VaultModal />

      <CommandPalette />
      <ShortcutsModal />
      <Onboarding />
      <UpdateGate />
      <Toasts />
    </div>
  )
}
