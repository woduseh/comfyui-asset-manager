import { EventEmitter } from 'node:events'

const changes = new EventEmitter()
let pending = false

/** UI invalidation only. Durable execution evidence remains in the database and output journal. */
export function notifyBatchChanged(): void {
  if (pending) return
  pending = true
  queueMicrotask(() => {
    pending = false
    changes.emit('changed')
  })
}

export function onBatchChanged(listener: () => void): () => void {
  changes.on('changed', listener)
  return () => {
    changes.off('changed', listener)
  }
}
