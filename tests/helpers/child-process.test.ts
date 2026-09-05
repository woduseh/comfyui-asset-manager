import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { terminateChild, waitForChildExit } from './child-process'

describe('test child process lifecycle', () => {
  it('kills a hung child and waits for exit before reporting the timeout', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      windowsHide: true
    })
    try {
      await expect(waitForChildExit(child, 250)).rejects.toThrow('exceeded 250ms')
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
    } finally {
      await terminateChild(child)
    }
  })

  it('reports the actual exit code and complete stderr', async () => {
    const child = spawn(
      process.execPath,
      ['-e', "process.stderr.write('fixture error'); process.exitCode = 71"],
      { windowsHide: true }
    )
    try {
      expect(await waitForChildExit(child, 10000)).toEqual({ code: 71, stderr: 'fixture error' })
    } finally {
      await terminateChild(child)
    }
  }, 15000)
})
