import { describe, it, expect } from 'vitest'
import {
  SHIPPED_ROUTES,
  LEGACY_ROUTES,
  NAV_ITEMS,
  type RouteName
} from '../../src/renderer/src/navigation'

const EXPECTED_SHIPPED: RouteName[] = [
  'workflows',
  'modules',
  'jobs',
  'gallery',
  'terminal',
  'settings'
]
const EXPECTED_LEGACY = ['dashboard', 'batch', 'queue'] as const

describe('navigation', () => {
  it('SHIPPED_ROUTES contains exactly the 6 shipped screens in order', () => {
    expect([...SHIPPED_ROUTES]).toEqual(EXPECTED_SHIPPED)
  })

  it('LEGACY_ROUTES contains all removed screens', () => {
    for (const name of EXPECTED_LEGACY) {
      expect(LEGACY_ROUTES).toContain(name)
    }
  })

  it('NAV_ITEMS names align exactly with SHIPPED_ROUTES', () => {
    const navNames = NAV_ITEMS.map((item) => item.name)
    expect(navNames).toEqual([...SHIPPED_ROUTES])
  })

  it('NAV_ITEMS paths start with / and match the route name', () => {
    for (const item of NAV_ITEMS) {
      expect(item.path).toBe(`/${item.name}`)
    }
  })

  it('NAV_ITEMS labelKeys all start with "nav."', () => {
    for (const item of NAV_ITEMS) {
      expect(item.labelKey).toMatch(/^nav\./)
    }
  })

  it('no legacy screen name appears in NAV_ITEMS', () => {
    const navNames = NAV_ITEMS.map((item) => item.name as string)
    for (const legacy of LEGACY_ROUTES) {
      expect(navNames).not.toContain(legacy)
    }
  })

  it('menu keys and route keys are in sync (no orphan keys)', () => {
    const navNames = new Set(NAV_ITEMS.map((item) => item.name))
    const shippedSet = new Set<string>(SHIPPED_ROUTES)
    expect(navNames).toEqual(shippedSet)
  })
})
