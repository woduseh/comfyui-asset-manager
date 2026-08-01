import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/main/services/**/*.ts',
        'src/main/ipc/handlers.ts',
        'src/main/ipc/validators.ts',
        'src/main/utils/*.ts',
        'src/main/crash-handler.ts',
        'src/shared/**/*.ts',
        'src/renderer/src/utils/**/*.ts',
        'src/renderer/src/stores/connection.store.ts',
        'src/renderer/src/stores/settings.store.ts',
        'src/renderer/src/stores/terminal.store.ts'
      ],
      exclude: [
        // websocket.ts: depends on 'ws' native WebSocket — requires live server for meaningful tests
        'src/main/services/comfyui/websocket.ts'
      ],
      thresholds: {
        statements: 55,
        branches: 50,
        functions: 59,
        lines: 55,
        'src/main/services/batch/queue-manager.ts': {
          statements: 20,
          branches: 8,
          functions: 30,
          lines: 20
        },
        'src/main/ipc/validators.ts': {
          statements: 80,
          branches: 68,
          functions: 85,
          lines: 80
        },
        'src/main/services/comfyui/workflow-import.ts': {
          statements: 80,
          branches: 65,
          functions: 80,
          lines: 80
        },
        'src/main/services/mcp/tools/modules.ts': {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80
        }
      }
    }
  },
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
})
