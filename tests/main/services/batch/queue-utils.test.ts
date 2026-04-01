import { describe, expect, it } from 'vitest'
import { MAX_DURATION_SAMPLES } from '../../../../src/main/constants'
import {
  computeEta,
  isBatchConfig,
  isModuleDataSnapshot,
  isTaskMetadata,
  isTaskPromptData,
  parseRequiredJson,
  pushDuration,
  resolveFileName
} from '../../../../src/main/services/batch/queue-utils'

describe('queue-utils', () => {
  it('accepts valid batch configs and rejects invalid ones', () => {
    expect(
      isBatchConfig({
        name: 'Job',
        workflowId: 'wf-1',
        moduleSelections: [],
        countPerCombination: 1,
        seedMode: 'fixed',
        outputFolderPattern: '{date}',
        fileNamePattern: '{index}'
      })
    ).toBe(true)

    expect(
      isBatchConfig({
        name: 'Job',
        workflowId: 'wf-1',
        moduleSelections: [],
        countPerCombination: 1,
        seedMode: 'bad-mode',
        outputFolderPattern: '{date}',
        fileNamePattern: '{index}'
      })
    ).toBe(false)
  })

  it('validates module snapshots, prompt data, and task metadata shapes', () => {
    expect(isModuleDataSnapshot([])).toBe(true)
    expect(isModuleDataSnapshot({})).toBe(false)

    expect(
      isTaskPromptData({
        positive: 'good',
        negative: 'bad',
        seed: 42,
        extraVariables: { width: 1024 },
        slotMappings: [],
        slotPrompts: {},
        variableOverrides: []
      })
    ).toBe(true)
    expect(isTaskPromptData({ positive: 'good', negative: 'bad', seed: '42' })).toBe(false)

    expect(
      isTaskMetadata({
        combinationIndex: 0,
        imageIndex: 1,
        totalInCombination: 2,
        characterName: 'Alice'
      })
    ).toBe(true)
    expect(isTaskMetadata({ combinationIndex: 0, imageIndex: '1', totalInCombination: 2 })).toBe(
      false
    )
  })

  it('parses required JSON when shape is valid', () => {
    expect(
      parseRequiredJson(
        '{"combinationIndex":0,"imageIndex":1,"totalInCombination":2,"characterName":"Alice"}',
        'Task metadata',
        isTaskMetadata,
        'Task metadata has an invalid shape'
      )
    ).toEqual({
      combinationIndex: 0,
      imageIndex: 1,
      totalInCombination: 2,
      characterName: 'Alice'
    })
  })

  it('throws when required JSON has an invalid shape', () => {
    expect(() =>
      parseRequiredJson(
        '{"combinationIndex":0,"imageIndex":"1","totalInCombination":2}',
        'Task metadata',
        isTaskMetadata,
        'Task metadata has an invalid shape'
      )
    ).toThrow('Task metadata has an invalid shape')
  })

  it('keeps only the most recent duration samples', () => {
    const durations = Array.from({ length: MAX_DURATION_SAMPLES }, (_, index) => index + 1)

    pushDuration(durations, 999)

    expect(durations).toHaveLength(MAX_DURATION_SAMPLES)
    expect(durations[0]).toBe(2)
    expect(durations.at(-1)).toBe(999)
  })

  it('computes ETA from the moving average and returns undefined without samples', () => {
    expect(computeEta([1000, 2000, 3000], 2)).toBe(4000)
    expect(computeEta([], 2)).toBeUndefined()
  })

  it('builds sanitized filenames and preserves the original extension', () => {
    const date = new Date().toISOString().split('T')[0]

    expect(
      resolveFileName(
        '{character}_{index}_{seed}_{date}',
        {
          characterName: 'A<B>',
          combinationIndex: 0,
          imageIndex: 1,
          totalInCombination: 3
        },
        42,
        'image.jpg'
      )
    ).toBe(`A_B__0002_42_${date}.jpg`)
  })
})
