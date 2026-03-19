import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'dashboard',
    component: () => import('@renderer/views/DashboardView.vue')
  },
  {
    path: '/workflows',
    name: 'workflows',
    component: () => import('@renderer/views/WorkflowView.vue')
  },
  {
    path: '/modules',
    name: 'modules',
    component: () => import('@renderer/views/ModuleView.vue')
  },
  {
    path: '/batch',
    name: 'batch',
    component: () => import('@renderer/views/BatchView.vue')
  },
  {
    path: '/queue',
    name: 'queue',
    component: () => import('@renderer/views/QueueView.vue')
  },
  {
    path: '/gallery',
    name: 'gallery',
    component: () => import('@renderer/views/GalleryView.vue')
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@renderer/views/SettingsView.vue')
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
