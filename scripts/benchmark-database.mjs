import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const options = {
  label: 'current',
  rows: 50000,
  samples: 9,
  warmup: 3,
  scenario: 'all',
  source: root
}
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index].replace(/^--/, '')
  const value = process.argv[index + 1]
  if (!(name in options) || value === undefined) throw new Error(`Unknown argument: ${name}`)
  options[name] = typeof options[name] === 'number' ? Number(value) : value
}
if (!/^[a-z0-9-]+$/i.test(options.label)) throw new Error('Use a simple label without paths')
for (const name of ['rows', 'samples', 'warmup']) {
  if (!Number.isSafeInteger(options[name]) || options[name] < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
}
if (options.rows < 500 || options.rows > 100000 || options.samples > 50 || options.warmup > 20) {
  throw new Error('Supported bounds: rows 500..100000, samples 1..50, warmup 1..20')
}
if (!['all', 'snapshot', 'cleanup'].includes(options.scenario)) throw new Error('Invalid scenario')
options.source = resolve(options.source)

const directory = join(root, '.reports', 'performance', options.label)
mkdirSync(directory, { recursive: true })
const require = createRequire(import.meta.url)
const requireFromVite = createRequire(require.resolve('vite/package.json'))
const esbuild = requireFromVite('esbuild')
const worker = join(directory, 'worker.cjs')
try {
  await esbuild.build({
    entryPoints: [join(root, 'scripts/performance/database-worker.mjs')],
    outfile: worker,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    alias: {
      '@benchmark/database': join(options.source, 'src/main/services/database/index.ts'),
      '@benchmark/repositories': join(
        options.source,
        'src/main/services/database/repositories/index.ts'
      )
    },
    plugins: [
      {
        name: 'isolated-electron',
        setup(build) {
          build.onResolve({ filter: /^(electron|electron-log\/main)$/ }, ({ path }) => ({
            path,
            namespace: 'benchmark'
          }))
          build.onLoad({ filter: /.*/, namespace: 'benchmark' }, () => ({
            contents: `
              export const app = { getPath() {
                if (!process.env.BENCH_USER_DATA) throw new Error('Missing benchmark directory');
                return process.env.BENCH_USER_DATA;
              }};
              export default {
                transports: { file: {}, console: {} },
                info() {}, warn() {}, error() {}, debug() {}
              };
            `,
            loader: 'js'
          }))
        }
      }
    ]
  })
} finally {
  esbuild.stop()
}

// Preserve the exact tested implementation even when the checkout is edited afterwards.
const sources = [
  'src/main/services/database/index.ts',
  'src/main/services/database/repositories/index.ts',
  'src/main/constants.ts'
].map((path) => ({
  path,
  sha256: createHash('sha256')
    .update(readFileSync(join(options.source, path)))
    .digest('hex')
}))
writeFileSync(join(directory, 'source-hashes.json'), JSON.stringify(sources, null, 2))
const child = spawn(process.execPath, ['--expose-gc', worker, JSON.stringify(options), directory], {
  cwd: root,
  windowsHide: true,
  stdio: 'inherit'
})
child.on('error', (error) => {
  throw error
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
