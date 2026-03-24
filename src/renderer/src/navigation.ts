/** Single source of truth for shipped renderer navigation. */

export type RouteName = 'workflows' | 'modules' | 'jobs' | 'gallery' | 'terminal' | 'settings'

/** Routes present in the shipped product. */
export const SHIPPED_ROUTES = [
  'workflows',
  'modules',
  'jobs',
  'gallery',
  'terminal',
  'settings'
] as const satisfies RouteName[]

/** Legacy route names removed from the product (kept for documentation / guard use). */
export const LEGACY_ROUTES = ['dashboard', 'batch', 'queue'] as const
export type LegacyRouteName = (typeof LEGACY_ROUTES)[number]

export interface NavItem {
  name: RouteName
  path: string
  /** vue-i18n key, e.g. "nav.workflows" */
  labelKey: string
}

export const NAV_ITEMS: NavItem[] = [
  { name: 'workflows', path: '/workflows', labelKey: 'nav.workflows' },
  { name: 'modules', path: '/modules', labelKey: 'nav.modules' },
  { name: 'jobs', path: '/jobs', labelKey: 'nav.jobs' },
  { name: 'gallery', path: '/gallery', labelKey: 'nav.gallery' },
  { name: 'terminal', path: '/terminal', labelKey: 'nav.terminal' },
  { name: 'settings', path: '/settings', labelKey: 'nav.settings' }
]
