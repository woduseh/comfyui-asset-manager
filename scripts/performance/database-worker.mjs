/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone Node benchmark. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, promises as fs, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, release, tmpdir, totalmem } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import initSqlJs from 'sql.js'
import {
  closeDatabase,
  flushDatabase,
  initDatabase,
  saveDatabase,
  setBatchMode,
  withTransaction
} from '@benchmark/database'
import { BatchTaskRepository, GeneratedImageRepository } from '@benchmark/repositories'

const [serializedOptions, reportDirectory] = process.argv.slice(2)
const options = JSON.parse(serializedOptions)
const directory = mkdtempSync(join(tmpdir(), 'comfyui-db-benchmark-'))
process.env.BENCH_USER_DATA = directory
const tasks = new BatchTaskRepository()
const gallery = new GeneratedImageRepository()
const prompt = JSON.stringify({
  positive: 'detailed portrait, '.repeat(64),
  negative: 'blur',
  seed: 42
})
const report = {
  options,
  environment: {
    node: process.version,
    sqlJs: JSON.parse(readFileSync('node_modules/sql.js/package.json', 'utf8')).version,
    platform: process.platform,
    release: release(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(),
    tempRoot: tmpdir()
  },
  startedAt: new Date().toISOString(),
  results: {}
}

function summarize(samples) {
  const result = {}
  for (const key of Object.keys(samples[0])) {
    const values = samples.map((sample) => sample[key]).sort((a, b) => a - b)
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    result[key] = {
      median: values[Math.floor(values.length / 2)],
      min: values[0],
      max: values.at(-1),
      mean,
      standardDeviation: Math.sqrt(
        values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
      )
    }
  }
  return result
}

async function measure(name, setup, run) {
  const samples = []
  for (let index = 0; index < 1 + options.warmup + options.samples; index++) {
    await setup()
    global.gc()
    const result = await run()
    if (index === 0) report.results[name] = { firstInvocation: result }
    else if (index > options.warmup) samples.push(result)
  }
  Object.assign(report.results[name], { samples, summary: summarize(samples) })
  process.stdout.write(`${name}: ${JSON.stringify(report.results[name].summary)}\n`)
}

function seed(db) {
  const createdAt = '2026-01-01 00:00:00'
  withTransaction(() => {
    db.run(
      'INSERT INTO batch_jobs (id, name, config, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
      ['job', 'Large batch', '{}', createdAt, 'other', 'Other batch', '{}', createdAt]
    )
    const task = db.prepare(
      `INSERT INTO batch_tasks (id, job_id, status, prompt_data, sort_order, metadata, created_at)
       VALUES (?, 'job', 'completed', '{}', ?, '{}', ?)`
    )
    const image = db.prepare(
      `INSERT INTO generated_images
       (id, job_id, file_path, prompt_text, negative_text, generation_params, created_at)
       VALUES (?, 'job', ?, ?, ?, ?, ?)`
    )
    try {
      for (let index = 0; index < options.rows; index++) {
        task.run([`task-${index}`, index, createdAt])
        image.run([
          `image-${index}`,
          `/benchmark/output/image-${index}.png`,
          'detailed portrait, '.repeat(64),
          'blur, artifacts, '.repeat(16),
          JSON.stringify({ seed: index, promptId: `prompt-${index}` }),
          createdAt
        ])
      }
    } finally {
      task.free()
      image.free()
    }
    for (const status of ['pending', 'retrying', 'running', 'submitting', 'uncertain', 'failed']) {
      db.run(
        'INSERT INTO batch_tasks (id, job_id, status, prompt_data, created_at) VALUES (?, ?, ?, ?, ?)',
        [status, 'job', status, prompt, createdAt]
      )
    }
    db.run(
      "INSERT INTO batch_tasks (id, job_id, status, prompt_data, created_at) VALUES ('other', 'other', 'completed', ?, ?)",
      [prompt, createdAt]
    )
  })
}

async function main() {
  const db = await initDatabase()
  setBatchMode(true)
  seed(db)
  await flushDatabase()
  report.fixtureBytes = readFileSync(join(directory, 'data', 'comfyui_asset_manager.db')).byteLength
  const fingerprint = (target = db) =>
    createHash('sha256')
      .update(JSON.stringify(target.exec('SELECT * FROM batch_tasks ORDER BY id')))
      .update(JSON.stringify(target.exec('SELECT * FROM generated_images ORDER BY id')))
      .digest('hex')
  report.fixtureDataSha256 = fingerprint()

  if (options.scenario !== 'cleanup') {
    const originalOpen = fs.open.bind(fs)
    const originalExport = db.export.bind(db)
    const originalFrom = Buffer.from
    const exports = new WeakSet()
    let copiedSnapshotBytes = 0
    let memoryAtWrite
    db.export = () => {
      const snapshot = originalExport()
      exports.add(snapshot)
      return snapshot
    }
    Buffer.from = (value, ...args) => {
      const result = originalFrom(value, ...args)
      if (exports.has(value) && result.buffer !== value.buffer)
        copiedSnapshotBytes += result.byteLength
      return result
    }
    fs.open = (...args) => {
      memoryAtWrite = process.memoryUsage()
      return originalOpen(...args)
    }
    try {
      await measure(
        'durableSnapshot',
        async () => {},
        async () => {
          const memoryBefore = process.memoryUsage()
          copiedSnapshotBytes = 0
          saveDatabase()
          const cpuBefore = process.cpuUsage()
          const started = performance.now()
          const pending = flushDatabase()
          const synchronousMs = performance.now() - started
          await pending
          const elapsedMs = performance.now() - started
          const cpu = process.cpuUsage(cpuBefore)
          return {
            elapsedMs,
            synchronousMs,
            copiedSnapshotBytes,
            cpuMs: (cpu.user + cpu.system) / 1000,
            arrayBuffersAtWriteDelta: memoryAtWrite.arrayBuffers - memoryBefore.arrayBuffers,
            rssAtWriteDelta: memoryAtWrite.rss - memoryBefore.rss
          }
        }
      )
    } finally {
      fs.open = originalOpen
      db.export = originalExport
      Buffer.from = originalFrom
    }
    const SQL = await initSqlJs()
    const persisted = new SQL.Database(
      readFileSync(join(directory, 'data', 'comfyui_asset_manager.db'))
    )
    try {
      assert.deepEqual(persisted.exec('SELECT COUNT(*) FROM generated_images')[0].values, [
        [options.rows]
      ])
      assert.deepEqual(persisted.exec('PRAGMA integrity_check')[0].values, [['ok']])
      assert.equal(fingerprint(persisted), report.fixtureDataSha256)
    } finally {
      persisted.close()
    }
    assert.equal(fingerprint(), report.fixtureDataSha256)
  }

  if (options.scenario !== 'snapshot') {
    let cleanupSql
    const originalRun = db.run.bind(db)
    db.run = (sql, ...args) => {
      if (sql.startsWith("UPDATE batch_tasks SET prompt_data = '{}'")) cleanupSql = sql
      return originalRun(sql, ...args)
    }
    const restoreChunk = async () => {
      db.run('UPDATE batch_tasks SET prompt_data = ? WHERE job_id = ? AND sort_order >= ?', [
        prompt,
        'job',
        options.rows - 250
      ])
    }
    const runCleanup = async () => {
      const cpuBefore = process.cpuUsage()
      const started = performance.now()
      tasks.clearPromptDataForCompleted('job')
      const elapsedMs = performance.now() - started
      const changedRows = db.getRowsModified()
      const cpu = process.cpuUsage(cpuBefore)
      return { elapsedMs, changedRows, cpuMs: (cpu.user + cpu.system) / 1000 }
    }
    try {
      await measure('completedPromptCleanup', restoreChunk, runCleanup)
      report.cleanupQueryPlan = db.exec(`EXPLAIN QUERY PLAN ${cleanupSql}`, ['job'])
      await measure('alreadyCleaned', async () => {}, runCleanup)
      await measure(
        'completeAndCleanChunk',
        async () => {
          await restoreChunk()
          db.run("UPDATE batch_tasks SET status = 'pending' WHERE job_id = ? AND sort_order >= ?", [
            'job',
            options.rows - 250
          ])
        },
        async () => {
          const started = performance.now()
          // Isolate the index maintenance cost of the queue's per-task primary-key updates.
          // GPU work, completion timestamps, gallery writes and per-task flushes are excluded.
          const complete = db.prepare("UPDATE batch_tasks SET status = 'completed' WHERE id = ?")
          try {
            withTransaction(() => {
              for (let index = options.rows - 250; index < options.rows; index++) {
                complete.run([`task-${index}`])
              }
            })
          } finally {
            complete.free()
          }
          const completeMs = performance.now() - started
          const cleanup = await runCleanup()
          return {
            completeMs,
            elapsedMs: performance.now() - started,
            cleanupMs: cleanup.elapsedMs
          }
        }
      )
    } finally {
      db.run = originalRun
    }
    assert.equal(
      fingerprint(),
      report.fixtureDataSha256,
      'Cleanup must preserve every other field/row'
    )
  }

  await measure(
    'galleryFirstPage',
    async () => {},
    async () => {
      const started = performance.now()
      const result = gallery.list({ page: 1, pageSize: 50 })
      const elapsedMs = performance.now() - started
      assert.equal(result.items.length, 50)
      assert.equal(result.total, options.rows)
      return { elapsedMs }
    }
  )
  report.correctness =
    'passed: full fixture fingerprint, gallery page/count, snapshot integrity when selected'
  await closeDatabase()
  report.finishedAt = new Date().toISOString()
  writeFileSync(join(reportDirectory, 'results.json'), `${JSON.stringify(report, null, 2)}\n`)
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack}\n`)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeDatabase()
    const inside = relative(resolve(tmpdir()), resolve(directory))
    if (
      !inside ||
      inside === '..' ||
      inside.startsWith(`..${sep}`) ||
      isAbsolute(inside) ||
      !basename(directory).startsWith('comfyui-db-benchmark-')
    ) {
      throw new Error(`Refusing to remove non-benchmark directory: ${directory}`)
    }
    rmSync(directory, { recursive: true, force: true })
  })
