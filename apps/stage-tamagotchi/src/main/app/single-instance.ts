import { app, BrowserWindow } from 'electron'

/**
 * Keeps AIRI Electron as a single desktop app instance.
 *
 * The Electron dev loop can relaunch the app quickly while a previous process is
 * still winding down. Without the explicit lock, macOS happily leaves multiple
 * AIRI Dock entries and top-level windows alive at the same time.
 */
export function setupSingleInstanceLock() {
  const hasSingleInstanceLock = app.requestSingleInstanceLock()

  function focusPrimaryWindow() {
    const [primaryWindow] = BrowserWindow.getAllWindows()
    if (!primaryWindow)
      return

    if (primaryWindow.isMinimized())
      primaryWindow.restore()

    primaryWindow.show()
    primaryWindow.focus()
  }

  if (!hasSingleInstanceLock) {
    return {
      hasSingleInstanceLock,
      focusPrimaryWindow,
    }
  }

  app.on('second-instance', () => {
    focusPrimaryWindow()
  })

  app.on('activate', () => {
    focusPrimaryWindow()
  })

  return {
    hasSingleInstanceLock,
    focusPrimaryWindow,
  }
}
