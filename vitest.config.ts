import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/main/services/**/*.ts'],
      exclude: ['src/main/services/comfyui/websocket.ts', 'src/main/services/batch/queue-manager.ts']
    }
  },
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main')
    }
  }
})
