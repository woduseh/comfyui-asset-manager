export type StatusTagType = 'default' | 'info' | 'warning' | 'success' | 'error'

const JOB_STATUS_TYPES: Record<string, StatusTagType> = {
  draft: 'default',
  queued: 'info',
  running: 'warning',
  paused: 'default',
  completed: 'success',
  failed: 'error',
  cancelled: 'default'
}

export function getJobStatusType(status: string): StatusTagType {
  return JOB_STATUS_TYPES[status] ?? 'default'
}

export function getServiceStatusType(active: boolean, pending = false): StatusTagType {
  if (pending) return 'warning'
  return active ? 'success' : 'default'
}
