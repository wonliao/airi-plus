import type { App } from 'electron'

import type { FileLoggerHandle } from './file-logger'

import process from 'node:process'

/**
 * Coordinates AIRI Electron shutdown so we do not recursively log while
 * windows, services, and stdio are already disappearing.
 */
export function setupShutdownManager(params: {
  app: App
  fileLogger: () => FileLoggerHandle
  emitAppBeforeQuit: () => unknown
  stopInjeca: () => unknown
  logError: (message: string, error: unknown) => void
}) {
  let appExiting = false

  /**
   * Safely execute fn and log any errors that occur, marking the exit as abnormal
   * if an error is caught.
   *
   * @param operation - A verb phrase describing the operation.
   * @param fn - Any function to execute. It can be either sync or async.
   * @returns A promise that resolves when the operation is complete.
   */
  async function handleAppExit() {
    if (appExiting)
      return

    appExiting = true

    let exitedNormally = true

    async function logIfError(operation: string, fn: () => unknown): Promise<void> {
      try {
        await fn()
      }
      catch (error) {
        exitedNormally = false
        params.logError(`[app-exit] Failed to ${operation}:`, error)
      }
    }

    await Promise.all([
      logIfError('execute onAppBeforeQuit hooks', () => params.emitAppBeforeQuit()),
      logIfError('stop injeca', () => params.stopInjeca()),
    ])

    // Prevent the global log hook from trying to write to the file after close() is called,
    // which would cause a recursive failure if close() itself throws.
    params.fileLogger().setPhase('shutdown')
    await logIfError('flush file logs', () => params.fileLogger().close())

    params.app.exit(exitedNormally ? 0 : 1)
  }

  process.on('SIGINT', () => {
    void handleAppExit()
  })

  params.app.on('before-quit', (event) => {
    event.preventDefault()
    void handleAppExit()
  })

  return {
    handleAppExit,
    isShuttingDown: () => appExiting,
  }
}
