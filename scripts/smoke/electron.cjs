/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/no-require-imports -- Synchronous Electron bootstrap must isolate userData before loading the built app. */
// Test entrypoint only. The shipped application, preload, IPC handlers and DB remain unchanged.
const assert = require('node:assert/strict')
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { app } = require('electron')

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const labels = require(join(config.root, 'src/renderer/src/locales/ko.json'))
app.setPath('userData', config.profileDir)
app.setPath('sessionData', config.profileDir)
mkdirSync(join(config.runDir, 'app-logs'), { recursive: true })
app.setAppLogsPath(join(config.runDir, 'app-logs'))

const report = {
  phase: config.phase,
  status: 'running',
  steps: [],
  errors: [],
  quitObserved: false
}
const save = () => writeFileSync(config.reportPath, `${JSON.stringify(report, null, 2)}\n`)
save()
let window
let finishing = false
const deadline = setTimeout(
  () => void finish(new Error('Electron smoke deadline exceeded')),
  config.timeoutMs
)

async function screenshot(name) {
  if (!window || window.isDestroyed()) return
  let timer
  try {
    const image = await Promise.race([
      (async () => {
        // Let DOM changes reach the compositor before capturing a hidden window.
        await window.webContents.executeJavaScript(
          'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
        )
        return window.webContents.capturePage(undefined, { stayHidden: true })
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Electron screenshot timed out')), 3000)
      })
    ])
    assert(!image.isEmpty(), 'Electron returned an empty screenshot')
    writeFileSync(join(config.runDir, `${config.phase}-${name}.png`), image.toPNG())
  } finally {
    clearTimeout(timer)
  }
}

async function finish(error) {
  if (finishing) return
  finishing = true
  clearTimeout(deadline)
  if (error) {
    report.status = 'failed'
    report.error = String(error.stack ?? error)
    save()
    try {
      await screenshot('failure')
    } catch (captureError) {
      report.screenshotError = String(captureError)
    } finally {
      save()
      app.quit()
    }
  } else {
    report.status = 'passed'
    save()
    app.quit()
  }
}

app.on('will-quit', () => {
  report.quitObserved = true
  save()
  process.exitCode = report.status === 'passed' ? 0 : 1
})

async function step(name, action) {
  const item = { name, status: 'running' }
  report.steps.push(item)
  save()
  try {
    await action()
    item.status = 'passed'
  } catch (error) {
    item.status = 'failed'
    item.error = String(error)
    throw error
  } finally {
    save()
  }
}

const evaluate = (fn, ...args) =>
  window.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`)
async function waitFor(fn, ...args) {
  const end = Date.now() + 10_000
  while (Date.now() < end) {
    if (report.errors.length) throw new Error(report.errors.join('\n'))
    if (await evaluate(fn, ...args)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`UI condition timed out: ${fn.toString()}`)
}

async function click(selector, text) {
  await waitFor(
    (selector, text) =>
      [...document.querySelectorAll(selector)].some(
        (node) => node.getClientRects().length && node.textContent.trim() === text && !node.disabled
      ),
    selector,
    text
  )
  await evaluate(
    (selector, text) => {
      const nodes = [...document.querySelectorAll(selector)].filter(
        (node) => node.getClientRects().length && node.textContent.trim() === text
      )
      if (nodes.length !== 1)
        throw new Error(`Expected one UI target, got ${nodes.length}: ${text}`)
      nodes[0].click()
    },
    selector,
    text
  )
}

async function fill(placeholder, value) {
  await waitFor(
    (placeholder) =>
      [...document.querySelectorAll('input,textarea')].some(
        (node) => node.placeholder === placeholder && node.getClientRects().length
      ),
    placeholder
  )
  await evaluate(
    (placeholder, value) => {
      const nodes = [...document.querySelectorAll('input,textarea')].filter(
        (node) => node.placeholder === placeholder && node.getClientRects().length
      )
      if (nodes.length !== 1) throw new Error(`Expected one input: ${placeholder}`)
      const node = nodes[0]
      node.value = value
      node.dispatchEvent(new Event('input', { bubbles: true }))
    },
    placeholder,
    value
  )
}

async function run() {
  await step('renderer-preload-security', async () => {
    await waitFor(
      () => !!window.electron?.ipcRenderer?.invoke && !!document.querySelector('.production-header')
    )
    assert.equal(await evaluate(() => location.protocol), 'file:')
    assert.deepEqual(
      await evaluate(() => ({ require: typeof window.require, process: typeof window.process })),
      { require: 'undefined', process: 'undefined' },
      'Node globals must not be exposed in the renderer'
    )
    await waitFor(
      (connected) =>
        [...document.querySelectorAll('.service-status')].some(
          (node) => node.textContent.includes('ComfyUI') && node.textContent.includes(connected)
        ),
      labels.connection.connected
    )
    await screenshot('ready')
  })
  await step('open-library', async () => {
    await click('.n-menu-item-content', labels.nav.modules)
    await waitFor(() => !!document.querySelector('.module-toolbar'))
  })
  if (config.phase === 'create') {
    await step('create-module-through-ui', async () => {
      await click('.page-header button', labels.module.create)
      await fill(labels.common.name, 'Smoke module')
      await click('.n-modal button', labels.common.create)
      await waitFor(() =>
        [...document.querySelectorAll('.module-card__title')].some(
          (node) => node.textContent === 'Smoke module'
        )
      )
    })
  }
  await step(
    config.phase === 'create' ? 'create-item-through-ui' : 'persisted-item-after-restart',
    async () => {
      await click('.module-card__title', 'Smoke module')
      if (config.phase === 'create') {
        await click('.module-detail button', labels.module.addItem)
        await fill(labels.module.item.namePlaceholder, 'Smoke item')
        await fill(labels.module.item.promptPlaceholder, 'smoke prompt')
        await click('.n-modal button', labels.common.save)
      }
      await waitFor(
        () => document.querySelector('.module-item__name')?.textContent === 'Smoke item'
      )
      const persisted = await evaluate(async () => {
        const ipc = window.electron.ipcRenderer
        const modules = await ipc.invoke('module:list')
        const module = modules.find((module) => module.name === 'Smoke module')
        const items = await ipc.invoke('module-item:list', { moduleId: module.id })
        const preview = await ipc.invoke('prompt:preview', { moduleIds: [module.id] })
        return { prompt: items[0]?.prompt, positive: preview.positive, count: modules.length }
      })
      assert.equal(persisted.prompt, 'smoke prompt')
      assert(persisted.positive.includes('smoke prompt'))
      assert.equal(persisted.count, 1)
      await screenshot('library')
    }
  )
  if (config.phase === 'create') {
    await step('invalid-ipc-rejected-without-write', async () => {
      const rejected = await evaluate(async () => {
        try {
          await window.electron.ipcRenderer.invoke('module:create', { name: 42, type: 'custom' })
          return false
        } catch {
          return true
        }
      })
      assert.equal(rejected, true, 'Malformed IPC input was accepted')
      assert.equal(
        await evaluate(
          async () => (await window.electron.ipcRenderer.invoke('module:list')).length
        ),
        1
      )
    })
    await step('disconnect-and-reconnect-through-ui', async () => {
      await click('.app-header button', labels.connection.disconnect)
      await waitFor(
        (text) =>
          [...document.querySelectorAll('.service-status')].some(
            (node) => node.textContent.includes('ComfyUI') && node.textContent.includes(text)
          ),
        labels.connection.disconnected
      )
      await click('.app-header button', labels.connection.connect)
      await waitFor(
        (text) =>
          [...document.querySelectorAll('.service-status')].some(
            (node) => node.textContent.includes('ComfyUI') && node.textContent.includes(text)
          ),
        labels.connection.connected
      )
    })
    if (config.injectFailure)
      await step('injected-assertion', () => {
        assert.fail('Intentional smoke assertion failure; the command must exit nonzero')
      })
  }
  assert.deepEqual(report.errors, [], 'Unexpected renderer/preload failure')
}

app.on('browser-window-created', (_, created) => {
  window = created
  // Capture the real Chromium UI without leaving an interactive window behind.
  window.webContents.backgroundThrottling = false
  window.on('show', () => window.hide())
  window.webContents.on('preload-error', (_event, _path, error) => {
    report.errors.push(`preload: ${error.message}`)
    save()
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    report.errors.push(`renderer: ${details.reason}`)
    save()
  })
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') {
      report.errors.push(details.message)
      save()
    }
  })
  window.webContents.on('did-fail-load', (_event, code, description) => {
    report.errors.push(`load: ${code} ${description}`)
    save()
  })
  window.webContents.once('did-finish-load', () => {
    void run().then(
      () => finish(),
      (error) => finish(error)
    )
  })
})

try {
  require(join(config.bundleDir, 'main/index.js'))
} catch (error) {
  void finish(error)
}
