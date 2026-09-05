import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { basename, dirname, extname, join } from 'path'
import { MAX_DUPLICATE_FILE_SUFFIX } from '../../constants'
import type { BatchConfig } from '@shared/ipc-contract'
import { resolveOutputPath } from './task-generator'
import { resolveFileName, type TaskMetadata, type TaskPromptData } from './queue-utils'
import { resolveSafeOutputDirectory, resolveSafeOutputFile } from './output-path'
import type { TaskOutputJournal } from './output-journal'

interface ComfyImage {
  filename: string
  type: string
  subfolder: string
}

export interface TaskImageRecord {
  task_id: string
  job_id: string
  file_path: string
  file_size: number
  generation_params: string
  prompt_text: string
  negative_text: string
  character_name?: string
  outfit_name?: string
  emotion_name?: string
  style_name?: string
}

export function createTaskOutputDirectory(
  outputRoot: string,
  jobConfig: BatchConfig,
  metadata: TaskMetadata
): string {
  const pattern = jobConfig.outputFolderPattern || '{job}/{character}/{outfit}/{emotion}'
  const relPath = resolveOutputPath(pattern, {
    job: jobConfig.name || 'unnamed',
    character: metadata.characterName || 'default',
    outfit: metadata.outfitName || 'default',
    emotion: metadata.emotionName || 'default',
    style: metadata.styleName || 'default',
    date: new Date().toISOString().split('T')[0]
  })
  const fullPath = resolveSafeOutputDirectory(outputRoot, relPath)
  if (!existsSync(fullPath)) mkdirSync(fullPath, { recursive: true })
  return fullPath
}

export function allocateUniqueOutputPath(filePath: string): string {
  if (!existsSync(filePath)) return filePath
  const dir = dirname(filePath)
  const ext = extname(filePath)
  const name = basename(filePath, ext)
  for (let i = 1; i <= MAX_DUPLICATE_FILE_SUFFIX; i++) {
    const candidate = join(dir, `${name}_${String(i).padStart(3, '0')}${ext}`)
    if (!existsSync(candidate)) return candidate
  }
  throw new Error(
    `Unable to allocate a unique output filename after ${MAX_DUPLICATE_FILE_SUFFIX} attempts`
  )
}

export async function downloadTaskImages(options: {
  outputs?: Record<string, unknown>
  outputRoot: string
  outputDirectory: string
  jobConfig: BatchConfig
  metadata: TaskMetadata
  promptData: TaskPromptData
  promptId: string
  taskId: string
  jobId: string
  getImage: (filename: string, subfolder: string, type: string) => Promise<Buffer>
  target: { savedPaths: string[]; imageRecords: TaskImageRecord[] }
  journal?: TaskOutputJournal
}): Promise<void> {
  for (const nodeOutput of Object.values(options.outputs ?? {})) {
    const images = (nodeOutput as { images?: ComfyImage[] }).images ?? []
    for (const image of images) {
      const imageData = await options.getImage(image.filename, image.subfolder, image.type)
      const fileName = resolveFileName(
        options.jobConfig.fileNamePattern || '{character}_{outfit}_{emotion}_{index}',
        options.metadata,
        options.promptData.seed,
        image.filename
      )
      const savePath = allocateUniqueOutputPath(
        resolveSafeOutputFile(options.outputRoot, options.outputDirectory, fileName)
      )
      options.journal?.plan(savePath)
      const descriptor = openSync(savePath, 'wx')
      options.target.savedPaths.push(savePath)
      try {
        writeFileSync(descriptor, imageData)
        fsyncSync(descriptor)
      } finally {
        closeSync(descriptor)
      }
      options.target.imageRecords.push({
        task_id: options.taskId,
        job_id: options.jobId,
        file_path: savePath,
        file_size: imageData.byteLength,
        generation_params: JSON.stringify({
          seed: options.promptData.seed,
          promptId: options.promptId
        }),
        prompt_text: options.promptData.positive,
        negative_text: options.promptData.negative,
        character_name: options.metadata.characterName,
        outfit_name: options.metadata.outfitName,
        emotion_name: options.metadata.emotionName,
        style_name: options.metadata.styleName
      })
    }
  }
}

export function cleanupPartialOutputFiles(savedPaths: readonly string[]): Array<{
  path: string
  error: unknown
}> {
  const failures: Array<{ path: string; error: unknown }> = []
  for (const savedPath of savedPaths) {
    try {
      if (existsSync(savedPath)) unlinkSync(savedPath)
    } catch (error) {
      failures.push({ path: savedPath, error })
    }
  }
  return failures
}
