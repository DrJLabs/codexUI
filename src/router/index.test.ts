import { describe, expect, it } from 'vitest'

describe('router', () => {
  it('registers the Kanban hash route', async () => {
    installRouterGlobals()
    const { routes } = await import('./index')
    const route = routes.find((entry) => entry.name === 'kanban')

    expect(route?.path).toBe('/kanban')
  })

  it('registers the Automations hash route', async () => {
    installRouterGlobals()
    const { routes } = await import('./index')
    const route = routes.find((entry) => entry.name === 'automations')

    expect(route?.path).toBe('/automations')
  })
})

function installRouterGlobals(): void {
  Object.defineProperty(globalThis, 'location', {
    value: { host: 'localhost', pathname: '/', search: '', hash: '' },
    configurable: true,
  })
  Object.defineProperty(globalThis, 'history', {
    value: { state: null, replaceState: () => {}, pushState: () => {} },
    configurable: true,
  })
  Object.defineProperty(globalThis, 'window', {
    value: {
      location: globalThis.location,
      history: globalThis.history,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    configurable: true,
  })
  Object.defineProperty(globalThis, 'document', {
    value: {
      createElement: () => ({}),
      querySelector: () => null,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    configurable: true,
  })
}
