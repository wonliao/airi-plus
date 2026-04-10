import type { FileLoggerHandle } from './app/file-logger'

import process, { env, platform } from 'node:process'

import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { electronApp } from '@electron-toolkit/utils'
import { Format, LogLevel, setGlobalFormat, setGlobalLogLevel, useLogg } from '@guiiai/logg'
import { initScreenCaptureForMain } from '@proj-airi/electron-screen-capture/main'
import { app, ipcMain } from 'electron'
import { injeca } from 'injeca'
import { isLinux } from 'std-env'

import icon from '../../resources/icon.png?asset'

import { openDebugger, setupDebugger } from './app/debugger'
import { nullFileLoggerHandle, setupFileLogger } from './app/file-logger'
import { setupShutdownManager } from './app/shutdown-manager'
import { setupSingleInstanceLock } from './app/single-instance'
import { startElectronApp } from './app/startup-manager'
import { emitAppBeforeQuit, emitAppWindowAllClosed } from './libs/bootkit/lifecycle'
import { setElectronMainDirname } from './libs/electron/location'

// TODO: once we refactored eventa to support window-namespaced contexts,
// we can remove the setMaxListeners call below since eventa will be able to dispatch and
// manage events within eventa's context system.
ipcMain.setMaxListeners(100)

function isBrokenPipeLikeError(error: unknown) {
  return error instanceof Error && error.message.includes('EIO')
}

function installSafeConsoleGuards() {
  for (const method of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[method].bind(console)

    console[method] = ((...args: unknown[]) => {
      try {
        const stream = method === 'error' || method === 'warn' ? process.stderr : process.stdout
        if (!stream || stream.destroyed || !stream.writable) {
          return
        }

        original(...args)
      }
      catch (error) {
        if (!isBrokenPipeLikeError(error)) {
          throw error
        }
      }
    }) as typeof console[typeof method]
  }
}

// NOTICE: When AIRI Electron is launched from a detached dev host, the main-process stdout/stderr
// can disappear before shutdown completes. `@guiiai/logg` and a few startup helpers still write
// through `console.*`, which otherwise crashes the Electron main process with `write EIO`.
// Guard console methods up front so broken pipes are ignored instead of surfacing as uncaught exceptions.
installSafeConsoleGuards()
const singleInstance = setupSingleInstanceLock()

if (!singleInstance.hasSingleInstanceLock) {
  app.quit()
  process.exit(0)
}

setElectronMainDirname(dirname(fileURLToPath(import.meta.url)))
setGlobalFormat(Format.Pretty)
setGlobalLogLevel(LogLevel.Log)
setupDebugger()

const log = useLogg('main').useGlobalConfig()

// Thanks to [@blurymind](https://github.com/blurymind),
//
// When running Electron on Linux, navigator.gpu.requestAdapter() fails.
// In order to enable WebGPU and process the shaders fast enough, we need the following
// command line switches to be set.
//
// https://github.com/electron/electron/issues/41763#issuecomment-2051725363
// https://github.com/electron/electron/issues/41763#issuecomment-3143338995
if (isLinux) {
  app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer')
  app.commandLine.appendSwitch('enable-unsafe-webgpu')
  app.commandLine.appendSwitch('enable-features', 'Vulkan')

  // NOTICE: we need UseOzonePlatform, WaylandWindowDecorations for working on Wayland.
  // Partially related to https://github.com/electron/electron/issues/41551, since X11 is deprecating now,
  // we can safely remove the feature flags for Electron once they made it default supported.
  // Fixes: https://github.com/moeru-ai/airi/issues/757
  // Ref: https://github.com/mmaura/poe2linuxcompanion/blob/90664607a147ea5ccea28df6139bd95fb0ebab0e/electron/main/index.ts#L28-L46
  if (env.XDG_SESSION_TYPE === 'wayland') {
    app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal')

    app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform')
    app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations')
  }
}

app.dock?.setIcon(icon)
electronApp.setAppUserModelId('ai.moeru.airi')

initScreenCaptureForMain()

let fileLogger: FileLoggerHandle = nullFileLoggerHandle

app.whenReady().then(async () => {
  fileLogger = await setupFileLogger()
  await startElectronApp({
    fileLogger,
    openDebugger,
  })
}).catch((err) => {
  log.withError(err).error('Error during app initialization')
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  emitAppWindowAllClosed()

  if (platform !== 'darwin') {
    app.quit()
  }
})

setupShutdownManager({
  app,
  fileLogger: () => fileLogger,
  emitAppBeforeQuit,
  stopInjeca: () => injeca.stop(),
  logError: (message, error) => {
    log.withError(error).error(message)
  },
})
