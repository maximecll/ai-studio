import { useCallback, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { bootstrap } from './lib/db'
import { useConversations, useHotkey, useMediaQuery, useSettings } from './lib/hooks'
import { href, navigate, useRoute } from './lib/router'
import { useUI } from './store/ui'
import { useModels } from './store/models'
import { useChat } from './store/chat'
import { Sidebar } from './components/layout/Sidebar'
import { ChatView } from './components/chat/ChatView'
import { HomeView } from './components/home/HomeView'
import { ModelsView } from './components/models/ModelsView'
import { NotFound } from './components/NotFound'
import { Inspector } from './components/settings/Inspector'
import { MemoryModal } from './components/chat/MemoryModal'
import { SettingsModal } from './components/settings/SettingsModal'
import { PresetsModal } from './components/settings/PresetsModal'
import { CommandPalette } from './components/ui/CommandPalette'
import { ShortcutsModal } from './components/ui/ShortcutsModal'
import { Toasts } from './components/ui/Toasts'

const UI_FONTS: Record<string, string> = { dm: "'DM Sans'", satoshi: "'Satoshi'", inter: "'Inter'" }

function useThemeSync() {
  const { theme, fontFamily } = useSettings()

  useEffect(() => {
    localStorage.setItem('studio.font', fontFamily)
    document.documentElement.style.setProperty('--ui-font', UI_FONTS[fontFamily] ?? UI_FONTS.dm)
  }, [fontFamily])

  useEffect(() => {
    localStorage.setItem('studio.theme', theme)
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.classList.toggle('dark', dark)
      document.documentElement.style.backgroundColor = dark ? '#0c090a' : '#fefefa'
    }
    apply()
    const mq = matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}

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
  useThemeSync()

  const activeId = route.name === 'conversation' ? route.id : null
  const streaming = useChat((s) => (activeId ? !!s.streams[activeId] : false))

  useEffect(() => {
    void refresh()
    const id = setInterval(() => void refresh(true), 15_000)
    return () => clearInterval(id)
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
  useHotkey('mod+,', (e) => { e.preventDefault(); ui.setSettingsOpen(true) })
  useHotkey('mod+/', (e) => { e.preventDefault(); ui.setShortcutsOpen(true) })
  useHotkey('escape', () => {
    if (streaming && activeId && !ui.paletteOpen && !ui.settingsOpen && !ui.presetsOpen) stop(activeId)
  })

  const active = activeId && conversations ? conversations.find((c) => c.id === activeId) : undefined
  const loading = route.name === 'conversation' && conversations === undefined

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />

      {route.name === 'home' && <View k="home"><HomeView /></View>}
      {route.name === 'models' && <View k="models"><ModelsView /></View>}
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

      {route.name === 'conversation' && active && ui.inspectorOpen && <Inspector conv={active} />}
      {active && <MemoryModal conv={active} />}

      <CommandPalette />
      <SettingsModal />
      <PresetsModal />
      <ShortcutsModal />
      <Toasts />
    </div>
  )
}
