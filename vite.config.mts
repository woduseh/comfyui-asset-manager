import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron/simple'
import { notBundle } from 'vite-plugin-electron/plugin'

const projectRoot = dirname(fileURLToPath(import.meta.url))
const outputRoot = resolve(process.env.COMFYUI_ASSET_BUILD_DIR ?? resolve(projectRoot, 'out'))
const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
}
const runtimeDependencies = Object.keys(packageJson.dependencies ?? {})

function dependencyPattern(dependency: string): RegExp {
  const escaped = dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped}(?:/|$)`)
}

const runtimeDependencyPatterns = runtimeDependencies.map(dependencyPattern)
const preloadExternalPatterns = runtimeDependencies
  .filter((dependency) => dependency !== '@electron-toolkit/preload')
  .map(dependencyPattern)

export default defineConfig({
  base: './',
  root: resolve(projectRoot, 'src/renderer'),
  plugins: [
    vue(),
    electron({
      main: {
        entry: resolve(projectRoot, 'src/main/index.ts'),
        onstart: async ({ startup }) => {
          await startup(['.'])
        },
        vite: {
          root: projectRoot,
          plugins: [notBundle({ filter: runtimeDependencyPatterns })],
          resolve: {
            alias: {
              '@shared': resolve(projectRoot, 'src/shared')
            }
          },
          build: {
            outDir: resolve(outputRoot, 'main'),
            emptyOutDir: true
          }
        }
      },
      preload: {
        input: resolve(projectRoot, 'src/preload/index.ts'),
        vite: {
          root: projectRoot,
          plugins: [notBundle({ filter: preloadExternalPatterns })],
          build: {
            outDir: resolve(outputRoot, 'preload'),
            emptyOutDir: true
          }
        }
      }
    })
  ],
  resolve: {
    alias: {
      '@renderer': resolve(projectRoot, 'src/renderer/src'),
      '@shared': resolve(projectRoot, 'src/shared')
    }
  },
  build: {
    outDir: resolve(outputRoot, 'renderer'),
    emptyOutDir: true
  }
})
