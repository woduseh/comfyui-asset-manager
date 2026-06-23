import { describe, expect, it } from 'vitest'
import {
  getJobStatusType,
  getServiceStatusType
} from '../../src/renderer/src/utils/status-presentation'

describe('status presentation', () => {
  it('uses semantic colors for job states', () => {
    expect(getJobStatusType('running')).toBe('warning')
    expect(getJobStatusType('completed')).toBe('success')
    expect(getJobStatusType('failed')).toBe('error')
    expect(getJobStatusType('unknown')).toBe('default')
  })

  it('distinguishes active, inactive, and pending services', () => {
    expect(getServiceStatusType(true)).toBe('success')
    expect(getServiceStatusType(false)).toBe('default')
    expect(getServiceStatusType(false, true)).toBe('warning')
  })
})
