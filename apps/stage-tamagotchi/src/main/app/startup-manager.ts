import type { FileLoggerHandle } from './file-logger'

import messages from '@proj-airi/i18n/locales'

import { optimizer } from '@electron-toolkit/utils'
import { setGlobalHookPostLog, useLogg } from '@guiiai/logg'
import { app } from 'electron'
import { noop } from 'es-toolkit'
import { createLoggLogger, injeca, lifecycle } from 'injeca'

import { createGlobalAppConfig } from '../configs/global'
import { emitAppReady } from '../libs/bootkit/lifecycle'
import { createI18n } from '../libs/i18n'
import { setupServerChannel } from '../services/airi/channel-server'
import { setupMcpStdioManager } from '../services/airi/mcp-servers'
import { setupPluginHost } from '../services/airi/plugins'
import { setupAutoUpdater } from '../services/electron/auto-updater'
import { setupTray } from '../tray'
import { setupAboutWindowReusable } from '../windows/about'
import { setupBeatSync } from '../windows/beat-sync'
import { setupCaptionWindowManager } from '../windows/caption'
import { setupChatWindowReusableFunc } from '../windows/chat'
import { setupDevtoolsWindow } from '../windows/devtools'
import { setupMainWindow } from '../windows/main'
import { setupNoticeWindowManager } from '../windows/notice'
import { setupOnboardingWindowManager } from '../windows/onboarding'
import { setupSettingsWindowReusableFunc } from '../windows/settings'
import { setupWidgetsWindowManager } from '../windows/widgets'

/**
 * Bootstraps the Electron main-process dependency graph after `app.whenReady()`.
 *
 * Keeping this in a dedicated module makes the entry file responsible only for
 * lifecycle wiring, while the startup manager owns service/window composition.
 */
export async function startElectronApp(params: {
  fileLogger: FileLoggerHandle
  openDebugger: () => void
}) {
  setGlobalHookPostLog((_, formatted) => {
    if (!params.fileLogger.shouldCapturePostLog() || params.fileLogger.logFileFd === null)
      return

    void params.fileLogger.appendLog(formatted)
  })

  injeca.setLogger(createLoggLogger(useLogg('injeca').useGlobalConfig()))

  const appConfig = injeca.provide('configs:app', () => createGlobalAppConfig())
  const electronApp = injeca.provide('host:electron:app', () => app)
  const autoUpdater = injeca.provide('services:auto-updater', () => setupAutoUpdater())

  const i18n = injeca.provide('libs:i18n', {
    dependsOn: { appConfig },
    build: ({ dependsOn }) => createI18n({ messages, locale: dependsOn.appConfig.get()?.language }),
  })

  const serverChannel = injeca.provide('modules:channel-server', {
    dependsOn: { app: electronApp, lifecycle },
    build: async ({ dependsOn }) => setupServerChannel(dependsOn),
  })

  const mcpStdioManager = injeca.provide('modules:mcp-stdio-manager', {
    build: async () => setupMcpStdioManager(),
  })

  const pluginHost = injeca.provide('modules:plugin-host', {
    dependsOn: { serverChannel },
    build: () => setupPluginHost(),
  })

  const beatSync = injeca.provide('windows:beat-sync', () => setupBeatSync())
  const devtoolsMarkdownStressWindow = injeca.provide('windows:devtools:markdown-stress', () => setupDevtoolsWindow())

  const onboardingWindowManager = injeca.provide('windows:onboarding', {
    dependsOn: { serverChannel, i18n },
    build: ({ dependsOn }) => setupOnboardingWindowManager(dependsOn),
  })

  const noticeWindow = injeca.provide('windows:notice', {
    dependsOn: { i18n, serverChannel },
    build: ({ dependsOn }) => setupNoticeWindowManager(dependsOn),
  })

  const widgetsManager = injeca.provide('windows:widgets', {
    dependsOn: { serverChannel, i18n },
    build: ({ dependsOn }) => setupWidgetsWindowManager(dependsOn),
  })

  const aboutWindow = injeca.provide('windows:about', {
    dependsOn: { autoUpdater, i18n, serverChannel },
    build: ({ dependsOn }) => setupAboutWindowReusable(dependsOn),
  })

  const chatWindow = injeca.provide('windows:chat', {
    dependsOn: { widgetsManager, serverChannel, mcpStdioManager, i18n },
    build: ({ dependsOn }) => setupChatWindowReusableFunc(dependsOn),
  })

  const settingsWindow = injeca.provide('windows:settings', {
    dependsOn: { widgetsManager, beatSync, autoUpdater, devtoolsMarkdownStressWindow, serverChannel, mcpStdioManager, i18n },
    build: async ({ dependsOn }) => setupSettingsWindowReusableFunc(dependsOn),
  })

  const mainWindow = injeca.provide('windows:main', {
    dependsOn: { settingsWindow, chatWindow, widgetsManager, noticeWindow, beatSync, autoUpdater, serverChannel, mcpStdioManager, i18n, onboardingWindowManager },
    build: async ({ dependsOn }) => setupMainWindow(dependsOn),
  })

  const captionWindow = injeca.provide('windows:caption', {
    dependsOn: { mainWindow, serverChannel, i18n },
    build: async ({ dependsOn }) => setupCaptionWindowManager(dependsOn),
  })

  const tray = injeca.provide('app:tray', {
    dependsOn: { mainWindow, settingsWindow, captionWindow, widgetsWindow: widgetsManager, serverChannel, beatSyncBgWindow: beatSync, aboutWindow, i18n },
    build: async ({ dependsOn }) => setupTray(dependsOn),
  })

  injeca.invoke({
    dependsOn: { mainWindow, tray, serverChannel, pluginHost, mcpStdioManager, onboardingWindow: onboardingWindowManager },
    callback: noop,
  })

  injeca.start().catch(err => console.error(err))

  params.fileLogger.setPhase('running')
  emitAppReady()
  params.openDebugger()

  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
}
