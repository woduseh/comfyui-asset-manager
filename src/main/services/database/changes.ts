import { EventEmitter } from 'node:events'
import type { DataChangedEvent, DataChangeScope } from '@shared/ipc-contract'

const changes = new EventEmitter()
const pendingScopes = new Set<DataChangeScope>()

/** In-memory data invalidation only; this is not evidence of a durable snapshot. */
export function notifyDatabaseChanged(scopes: Iterable<DataChangeScope>): void {
  const scheduled = pendingScopes.size > 0
  for (const scope of scopes) pendingScopes.add(scope)
  if (scheduled || pendingScopes.size === 0) return

  queueMicrotask(() => {
    const event: DataChangedEvent = { scopes: [...pendingScopes] }
    pendingScopes.clear()
    changes.emit('changed', event)
  })
}

export function onDatabaseChanged(listener: (event: DataChangedEvent) => void): () => void {
  changes.on('changed', listener)
  return () => changes.off('changed', listener)
}
