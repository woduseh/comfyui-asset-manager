import { toRaw, isRef } from 'vue'
import type {
  IpcEventChannel,
  IpcEventPayload,
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeResult
} from '@shared/ipc-contract'

/**
 * Strip Vue reactivity from data before sending through Electron IPC.
 * Electron uses structuredClone() which cannot handle Vue proxy objects.
 */
function toPlain<T>(data: T): T {
  if (data === null || data === undefined) return data
  if (isRef(data)) return toPlain(toRaw(data).value) as T
  if (typeof data === 'object') return JSON.parse(JSON.stringify(data))
  return data
}

type InvokeParameters<K extends IpcInvokeChannel> =
  undefined extends IpcInvokeArgs<K> ? [args?: IpcInvokeArgs<K>] : [args: IpcInvokeArgs<K>]

export function invokeIpc<K extends IpcInvokeChannel>(
  channel: K,
  ...args: InvokeParameters<K>
): Promise<IpcInvokeResult<K>> {
  const payload = args.length > 0 ? toPlain(args[0]) : undefined
  return window.electron.ipcRenderer.invoke(channel, payload) as Promise<IpcInvokeResult<K>>
}

export function onIpc<K extends IpcEventChannel>(
  channel: K,
  listener: (payload: IpcEventPayload<K>) => void
): () => void {
  const wrapped = (_event: unknown, payload: IpcEventPayload<K>): void => {
    listener(payload)
  }

  window.electron.ipcRenderer.on(channel, wrapped)
  return () => {
    window.electron.ipcRenderer.removeListener(channel, wrapped)
  }
}
