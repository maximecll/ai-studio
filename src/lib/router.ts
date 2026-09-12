import { useEffect, useState } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'conversation'; id: string }
  | { name: 'models' }
  | { name: 'notfound'; path: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parse(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return { name: 'home' }
  if (path === '/models') return { name: 'models' }

  const conv = /^\/c\/([^/]+)$/.exec(path)
  // Un identifiant mal formé est un 404 immédiat : inutile d'interroger la base.
  if (conv) {
    return UUID.test(conv[1]) ? { name: 'conversation', id: conv[1] } : { name: 'notfound', path }
  }
  return { name: 'notfound', path }
}

export const href = {
  home: () => '/',
  conversation: (id: string) => `/c/${id}`,
  models: () => '/models',
}

type Listener = (r: Route) => void
const listeners = new Set<Listener>()

export function navigate(path: string, opts: { replace?: boolean } = {}) {
  if (path === location.pathname) return
  history[opts.replace ? 'replaceState' : 'pushState'](null, '', path)
  const route = parse(path)
  for (const l of listeners) l(route)
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const route = parse(location.pathname)
    for (const l of listeners) l(route)
  })
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(location.pathname))
  useEffect(() => {
    listeners.add(setRoute)
    return () => { listeners.delete(setRoute) }
  }, [])
  return route
}
