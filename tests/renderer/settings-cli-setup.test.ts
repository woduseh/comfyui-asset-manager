// @vitest-environment happy-dom

import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { NButton, NMessageProvider } from 'naive-ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import SettingsView from '@renderer/views/SettingsView.vue'
import ko from '@renderer/locales/ko.json'
import en from '@renderer/locales/en.json'

const invokeIpc = vi.hoisted(() => vi.fn())
vi.mock('@renderer/utils/ipc', () => ({ invokeIpc }))

describe('settings CLI setup', () => {
  let wrapper: VueWrapper | undefined
  let configured: boolean
  const setup = vi.fn()
  const vueError = vi.fn()

  beforeEach(() => {
    configured = false
    setup.mockReset()
    vueError.mockReset()
    invokeIpc.mockReset()
    invokeIpc.mockImplementation(async (channel: string) => {
      if (channel === IPC_CHANNELS.SETTINGS_GET_ALL) return {}
      if (channel === IPC_CHANNELS.MCP_STATUS) {
        return {
          isRunning: true,
          port: 39464,
          url: 'http://localhost:39464/mcp',
          authRequired: true
        }
      }
      if (channel === IPC_CHANNELS.MCP_AUTH_STATUS) return { required: true, token: '' }
      if (channel === IPC_CHANNELS.MCP_CONFIG_STATUS) {
        return {
          claudeCode: configured,
          copilotCli: false,
          geminiCli: false,
          codexCli: false,
          authReady: {
            claudeCode: configured,
            copilotCli: false,
            geminiCli: false,
            codexCli: false
          },
          configPath: configured ? '.mcp.json' : ''
        }
      }
      if (channel === IPC_CHANNELS.MCP_SETUP_CLI) return setup()
      throw new Error(`Unexpected IPC call: ${channel}`)
    })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
  })

  async function setupButton(locale: 'ko' | 'en'): Promise<VueWrapper> {
    wrapper = mount(
      defineComponent({
        components: { SettingsView, NMessageProvider },
        template: '<NMessageProvider><SettingsView /></NMessageProvider>'
      }),
      {
        attachTo: document.body,
        global: {
          plugins: [createPinia(), createI18n({ legacy: false, locale, messages: { ko, en } })],
          config: { errorHandler: vueError }
        }
      }
    )
    await flushPromises()
    const advancedTab = wrapper.findAll('.n-tabs-tab').at(3)!
    await advancedTab.trigger('click')
    await flushPromises()
    invokeIpc.mockClear()
    return wrapper
      .findAllComponents(NButton)
      .find(
        (button) =>
          button.text() === (locale === 'ko' ? ko : en).settings.mcp.cliSetup.setupClaudeCode
      )!
  }

  it('keeps connection edits when switching sections without writing CLI configuration', async () => {
    await setupButton('en')
    await wrapper!.findAll('.n-tabs-tab')[0].trigger('click')
    await flushPromises()
    const hostInput = wrapper!.find(`[aria-label="${en.settings.server.host}"] input`)
    await hostInput.setValue('render-server.local')
    await wrapper!.findAll('.n-tabs-tab')[1].trigger('click')
    await flushPromises()
    expect(wrapper!.find('.output-example').text()).toContain(
      'Portraits/Alice/Casual/Smile/Alice_Casual_Smile_0001.png'
    )
    await wrapper!.findAll('.n-tabs-tab')[0].trigger('click')
    await flushPromises()
    expect((hostInput.element as HTMLInputElement).value).toBe('render-server.local')
    expect(invokeIpc).not.toHaveBeenCalled()
    expect(vueError).not.toHaveBeenCalled()
  })

  it('refreshes managed configuration once after successful setup', async () => {
    setup.mockImplementation(() => {
      configured = true
      return { success: true, configPath: '.mcp.json' }
    })
    const button = await setupButton('en')
    await button.trigger('click')
    await flushPromises()
    expect(invokeIpc.mock.calls).toEqual([
      [IPC_CHANNELS.MCP_SETUP_CLI],
      [IPC_CHANNELS.MCP_CONFIG_STATUS]
    ])
    expect(wrapper!.text()).toContain('Claude Code ✓')
    expect(vueError).not.toHaveBeenCalled()
  })

  it.each([
    { locale: 'ko' as const, rejects: false },
    { locale: 'en' as const, rejects: false },
    { locale: 'ko' as const, rejects: true },
    { locale: 'en' as const, rejects: true }
  ])('shows setup failures in $locale (throws: $rejects)', async ({ locale, rejects }) => {
    const error = 'Invalid JSON in .mcp.json'
    if (rejects) setup.mockRejectedValue(new Error(error))
    else setup.mockResolvedValue({ success: false, error })
    const button = await setupButton(locale)
    await button.trigger('click')
    await flushPromises()
    const expected =
      locale === 'ko'
        ? `CLI 설정 생성 실패: ${error}`
        : `Failed to generate CLI configuration: ${error}`
    expect(document.body.textContent).toContain(expected)
    expect(invokeIpc.mock.calls).toEqual([[IPC_CHANNELS.MCP_SETUP_CLI]])
    expect(vueError).not.toHaveBeenCalled()
  })
})
