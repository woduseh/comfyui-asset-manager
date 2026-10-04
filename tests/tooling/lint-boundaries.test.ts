import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint()
const rendererPath = 'src/renderer/src/stores/lint-example.ts'
const mainPath = 'src/main/services/mcp/lint-example.ts'

async function boundaryMessages(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath })
  if (result.fatalErrorCount > 0) {
    throw new Error(result.messages.map((message) => message.message).join('\n'))
  }
  return result.messages
    .filter((message) =>
      ['no-restricted-imports', 'no-restricted-syntax'].includes(message.ruleId ?? '')
    )
    .map((message) => message.message)
}

describe('lint process and database ownership guards', () => {
  it.each(['@main/services/comfyui/types', '../../../main/services/comfyui/types'])(
    'rejects renderer imports of main implementation via %s',
    async (source) => {
      expect(
        await boundaryMessages(`import type { ComfyUINode } from '${source}'`, rendererPath)
      ).toEqual([expect.stringContaining('Renderer code must use shared contracts and IPC')])
    }
  )

  it.each(['window.electron.ipcRenderer', 'window["electron"]["ipcRenderer"]'])(
    'rejects direct renderer IPC access via %s',
    async (access) => {
      expect(await boundaryMessages(`${access}.invoke('workflow:list')`, rendererPath)).toEqual([
        expect.stringContaining('Use invokeIpc/onIpc')
      ])
    }
  )

  it('rejects destructured direct renderer IPC access', async () => {
    expect(
      await boundaryMessages('const { ipcRenderer: renderer } = window.electron', rendererPath)
    ).toEqual([expect.stringContaining('Use invokeIpc/onIpc')])
  })

  it.each([
    "import { getDatabase as rawDb } from '@main/services/database'",
    "import { saveDatabase } from '../database'",
    "import { saveDatabaseSync } from '../database/index.ts'",
    "import * as database from '../database'"
  ])('rejects raw database writer imports outside database internals: %s', async (code) => {
    expect(await boundaryMessages(code, mainPath)).toEqual([
      expect.stringContaining('Raw database access belongs to database internals')
    ])
  })

  it.each([
    ["import type { WorkflowRecord } from '@shared/ipc-contract'", rendererPath],
    ["import { invokeIpc } from '@renderer/utils/ipc'", rendererPath],
    ["import type { ElectronAPI } from '@electron-toolkit/preload'", 'src/preload/index.ts'],
    ["window.electron.ipcRenderer.invoke('workflow:list')", 'src/renderer/src/utils/ipc.ts'],
    [
      "import { getDatabaseReadVersion, flushDatabase, initDatabase, closeDatabase, withTransaction } from '../database'",
      mainPath
    ],
    ["import { WorkflowRepository } from '../database/repositories'", mainPath],
    [
      "import { getDatabase, saveDatabase } from '../index'",
      'src/main/services/database/repositories/lint-example.ts'
    ],
    [
      "import { getDatabase, saveDatabaseSync } from '@main/services/database'",
      'tests/main/lint-example.test.ts'
    ]
  ])('preserves allowed access: %s', async (code, filePath) => {
    expect(await boundaryMessages(code, filePath)).toEqual([])
  })
})
