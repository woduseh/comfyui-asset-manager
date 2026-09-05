import { join } from 'path'
import { mkdirSync } from 'fs'
import { get } from 'http'
import {
  initDatabase,
  flushDatabase,
  withTransaction,
  setBatchMode
} from '../../src/main/services/database'
import { downloadTaskImages, type TaskImageRecord } from '../../src/main/services/batch/task-output'
import { beginTaskOutputJournal } from '../../src/main/services/batch/output-journal'

async function main(): Promise<void> {
  const [directory, port, boundary] = process.argv.slice(2)
  const db = await initDatabase()
  setBatchMode(true)
  withTransaction(() => {
    db.run(
      "INSERT INTO batch_jobs (id, name, status, config) VALUES ('job', 'crash', 'running', '{}')"
    )
    db.run(
      "INSERT INTO batch_tasks (id, job_id, status, prompt_data, comfyui_prompt_id) VALUES ('task', 'job', 'running', '{}', 'prompt')"
    )
  })
  await flushDatabase()
  const output = join(directory, 'output')
  mkdirSync(output)
  const journal = beginTaskOutputJournal('task', 'prompt')
  const target = { savedPaths: [] as string[], imageRecords: [] as TaskImageRecord[] }
  await downloadTaskImages({
    outputs: {
      '1': {
        images: ['first.png', 'second.png'].map((filename) => ({
          filename,
          subfolder: '',
          type: 'output'
        }))
      }
    },
    outputRoot: output,
    outputDirectory: output,
    jobConfig: {
      name: 'crash',
      workflowId: '',
      moduleSelections: [],
      countPerCombination: 1,
      seedMode: 'fixed',
      fixedSeed: 1,
      outputFolderPattern: '',
      fileNamePattern: '{index}'
    },
    metadata: { combinationIndex: 0, imageIndex: 0, totalInCombination: 1 },
    promptData: { positive: '', negative: '', seed: 1, extraVariables: {} },
    promptId: 'prompt',
    taskId: 'task',
    jobId: 'job',
    target,
    journal,
    getImage: async (filename, subfolder, type) => {
      if (boundary === 'first-file' && target.savedPaths.length === 1) process.exit(71)
      // Avoid native fetch's Windows shutdown assertion; REST behavior is tested separately.
      const params = new URLSearchParams({ filename, subfolder, type })
      return new Promise<Buffer>((yes, no) => {
        get(`http://127.0.0.1:${port}/view?${params}`, { agent: false }, (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => chunks.push(chunk))
          response.on('error', no)
          response.on('end', () => {
            if (response.statusCode !== 200) no(new Error(`Image HTTP ${response.statusCode}`))
            else yes(Buffer.concat(chunks))
          })
        }).on('error', no)
      })
    }
  })
  if (boundary === 'all-files') process.exit(72)
  withTransaction(() => {
    for (const [index, record] of target.imageRecords.entries()) {
      db.run('INSERT INTO generated_images (id, task_id, job_id, file_path) VALUES (?, ?, ?, ?)', [
        `image-${index}`,
        'task',
        'job',
        record.file_path
      ])
    }
    db.run("UPDATE batch_tasks SET status = 'completed', result_path = ? WHERE id = 'task'", [
      target.savedPaths[0]
    ])
  })
  if (boundary === 'db-before-flush') process.exit(73)
  await flushDatabase()
  if (boundary === 'flush-before-discard') process.exit(74)
  throw new Error(`Unknown crash boundary: ${boundary}`)
}

void main().catch((error: unknown) => {
  process.stderr.write(String(error))
  process.exit(1)
})
