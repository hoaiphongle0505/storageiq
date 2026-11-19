// Test-only. Loaded with `electron -r` before the app's main script, so these listeners exist
// before the first window is created. It is never part of the build or the installer.
const path = require('node:path')
const { app, session } = require('electron')

const CSP_LISTENER_READY = '[e2e] securitypolicyviolation listener attached'

globalThis.__e2eConsoleErrors = []
globalThis.__e2eCspListenerReady = false

app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (details) => {
    if (details.message === CSP_LISTENER_READY) {
      globalThis.__e2eCspListenerReady = true
    } else if (details.level === 'error') {
      globalThis.__e2eConsoleErrors.push(details.message)
    }
  })
})

// This callback is registered before the app's own whenReady callbacks, so the preload below is
// in place before the main window is created and loads its first page.
void app.whenReady().then(() => {
  session.defaultSession.registerPreloadScript({
    type: 'frame',
    filePath: path.join(__dirname, 'csp-listener.cjs'),
  })
})
