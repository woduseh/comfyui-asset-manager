import { toRaw, isRef, isReactive } from 'vue'

/**
 * Strip Vue reactivity from data before sending through Electron IPC.
 * Electron uses structuredClone() which cannot handle Vue proxy objects.
 */
export function toPlain<T>(data: T): T {
  if (data === null || data === undefined) return data
  if (isRef(data)) return toPlain(toRaw(data).value) as T
  if (isReactive(data)) return JSON.parse(JSON.stringify(data))
  if (typeof data === 'object') return JSON.parse(JSON.stringify(data))
  return data
}
