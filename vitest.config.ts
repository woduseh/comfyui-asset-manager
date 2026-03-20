import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/main/services/**/*.ts', 'src/main/ipc/validators.ts'],
      exclude: [
        // websocket.ts: depends on 'ws' native WebSocket — requires live server for meaningful tests
        'src/main/services/comfyui/websocket.ts',
        // queue-manager.ts: orchestrates ComfyUI REST + WebSocket + fs writes — integration-heavy
        'src/main/services/batch/queue-manager.ts'
      ]
    }
  },
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main')
    }
  }
})
