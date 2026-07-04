import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '../../src/shared/ipc-channels'

describe('IPC_CHANNELS', () => {
  it('assigns a unique wire name to every channel constant', () => {
    const channels = Object.values(IPC_CHANNELS)

    expect(new Set(channels).size).toBe(channels.length)
  })
})
