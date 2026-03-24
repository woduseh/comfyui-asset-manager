import { join } from 'path'

export interface OutputRootSettings {
  get(key: string): string | null
}

export function resolveConfiguredOutputRoot(
  settings: OutputRootSettings,
  fallbackRoot = join(process.env.USERPROFILE || '', 'Pictures', 'ComfyUI_Output')
): string {
  return settings.get('output_directory') || settings.get('output.directory') || fallbackRoot
}
