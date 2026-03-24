import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { NAV_ITEMS, type RouteName } from '../navigation'

const VIEW_COMPONENTS: Record<RouteName, () => Promise<unknown>> = {
  workflows: () => import('@renderer/views/WorkflowView.vue'),
  modules: () => import('@renderer/views/ModuleView.vue'),
  jobs: () => import('@renderer/views/JobsView.vue'),
  gallery: () => import('@renderer/views/GalleryView.vue'),
  terminal: () => import('@renderer/views/TerminalView.vue'),
  settings: () => import('@renderer/views/SettingsView.vue')
}

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/workflows' },
  ...NAV_ITEMS.map((item) => ({
    path: item.path,
    name: item.name,
    component: VIEW_COMPONENTS[item.name]
  }))
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
