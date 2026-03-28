import { homedir } from 'os'
import { join } from 'path'

export interface OutputRootSettings {
  get(key: string): string | null
}

export function getDefaultOutputRoot(homeDirectory = homedir()): string {
  return join(homeDirectory, 'Pictures', 'ComfyUI_Output')
}

export function resolveConfiguredOutputRoot(
  settings: OutputRootSettings,
  fallbackRoot?: string,
  homeDirectory = homedir()
): string {
  return (
    settings.get('output_directory') ||
    settings.get('output.directory') ||
    fallbackRoot ||
    getDefaultOutputRoot(homeDirectory)
  )
}
