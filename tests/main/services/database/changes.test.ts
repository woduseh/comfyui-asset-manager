import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataChangedEvent } from '@shared/ipc-contract'
import { onDatabaseChanged } from '@main/services/database/changes'
import {
  GeneratedImageRepository,
  ModuleItemRepository,
  ModuleRepository,
  WorkflowRepository
} from '@main/services/database/repositories'
import { openTestDatabase } from '../../../helpers/database'

const state = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.directory } }))
vi.mock('@main/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

let fixture: Awaited<ReturnType<typeof openTestDatabase>>
let unsubscribe: () => void
let events: DataChangedEvent[]
const modules = new ModuleRepository()
const items = new ModuleItemRepository()
const workflows = new WorkflowRepository()
const images = new GeneratedImageRepository()

beforeEach(async () => {
  fixture = await openTestDatabase((directory) => {
    state.directory = directory
  })
  events = []
  unsubscribe = onDatabaseChanged((event) => events.push(event))
})

afterEach(async () => {
  unsubscribe()
  await fixture.close()
})

describe('repository change notifications', () => {
  it('coalesces successful mutations by scope after the outer transaction commits', async () => {
    const result = fixture.database.withTransaction(() => {
      const moduleId = modules.create({ name: 'Character', type: 'character' })
      items.bulkCreate([{ module_id: moduleId, name: 'Alice', prompt: 'alice' }])
      const copy = modules.duplicate(moduleId, 'Copy')!
      const workflowId = workflows.create({
        name: 'Workflow',
        category: 'generation',
        api_json: '{}'
      })
      workflows.setVariables(workflowId, [
        { node_id: '1', field_name: 'text', display_name: 'Prompt', var_type: 'text' }
      ])
      const imageId = images.create({ file_path: '/retained/image.png' })
      images.updateRating(imageId, 5)
      images.updateFavorite(imageId, true)
      expect(events).toEqual([])
      return { copy, workflowId, imageId }
    })
    await Promise.resolve()

    expect(events).toHaveLength(1)
    expect(events[0].scopes.sort()).toEqual(['gallery', 'modules', 'workflows'])
    expect(items.count(result.copy.newModuleId)).toBe(1)
    expect(workflows.getVariables(result.workflowId)).toHaveLength(1)
    expect(images.get(result.imageId)).toMatchObject({ rating: 5, is_favorite: 1 })
  })

  it('discards rolled-back scopes, including a nested savepoint in a committed transaction', async () => {
    let rolledBackWorkflow = ''
    fixture.database.withTransaction(() => {
      modules.create({ name: 'Kept', type: 'custom' })
      expect(() =>
        fixture.database.withTransaction(() => {
          rolledBackWorkflow = workflows.create({
            name: 'Rolled back',
            category: 'generation',
            api_json: '{}'
          })
          throw new Error('reject nested write')
        })
      ).toThrow('reject nested write')
    })
    await Promise.resolve()
    expect(events).toEqual([{ scopes: ['modules'] }])
    expect(workflows.get(rolledBackWorkflow)).toBeNull()

    events.length = 0
    let rolledBackImage = ''
    expect(() =>
      fixture.database.withTransaction(() => {
        rolledBackImage = images.create({ file_path: '/retained/not-committed.png' })
        throw new Error('reject outer write')
      })
    ).toThrow('reject outer write')
    await Promise.resolve()
    expect(events).toEqual([])
    expect(images.get(rolledBackImage)).toBeNull()
  })

  it('notifies direct mutations and ignores failed writes', async () => {
    const moduleId = modules.create({ name: 'Before', type: 'custom' })
    await Promise.resolve()
    events.length = 0
    modules.update(moduleId, { name: 'After' })
    expect(() =>
      items.create({ module_id: 'missing', name: 'Orphan', prompt: 'rejected' })
    ).toThrow()
    await Promise.resolve()

    expect(events).toEqual([{ scopes: ['modules'] }])
    expect(modules.get(moduleId)?.name).toBe('After')
  })
})
