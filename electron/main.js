'use strict'

/**
 * RetailTec Analytics — Electron Main Process
 *
 * Production flow:
 *   1. Spawn backend.exe  (PyInstaller bundle, windowsHide=true — completely silent)
 *   2. Start a local HTTP server on FRONTEND_PORT that:
 *        - Serves frontend/dist/ static files
 *        - Proxies /api/* → FastAPI on BACKEND_PORT (SSE streaming preserved)
 *   3. Open BrowserWindow → http://localhost:FRONTEND_PORT
 *
 * Dev flow: just open http://localhost:3000 (Vite dev server already running)
 */

const { app, BrowserWindow, shell } = require('electron')
const path   = require('path')
const http   = require('http')
const fs     = require('fs')
const { spawn } = require('child_process')

const isDev         = !app.isPackaged
const BACKEND_PORT  = 8000
const FRONTEND_PORT = 3001   // production HTTP server port

let mainWindow     = null
let backendProcess = null
let frontendServer = null

// ── Backend ────────────────────────────────────────────────────────────────

function startBackend () {
  if (isDev) return  // dev: run `uvicorn main:app` separately

  const exe = path.join(process.resourcesPath, 'backend', 'backend.exe')
  if (!fs.existsSync(exe)) { console.error('backend.exe not found:', exe); return }

  backendProcess = spawn(exe, [], {
    windowsHide: true,   // NO console window ever
    detached: false,
    stdio: 'ignore',
  })
  backendProcess.on('error', (e) => console.error('Backend spawn error:', e))
  backendProcess.on('exit',  (c) => console.log('Backend exited:', c))
}

// Poll until FastAPI responds — gives up after maxMs and opens app anyway
function waitForBackend (maxMs = 30000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + maxMs
    const try_ = () => {
      const req = http.get(
        `http://127.0.0.1:${BACKEND_PORT}/api/cache/status`,
        { timeout: 1500 },
        () => resolve()
      )
      req.on('error', () => {
        if (Date.now() < deadline) setTimeout(try_, 1000)
        else resolve()   // timeout — open app anyway
      })
      req.on('timeout', () => { req.destroy(); setTimeout(try_, 1000) })
    }
    try_()
  })
}

// ── Frontend HTTP server ────────────────────────────────────────────────────
// Serves built React app + proxies /api → FastAPI (SSE streams work fine)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
}

function startFrontendServer (distDir) {
  frontendServer = http.createServer((req, res) => {

    // Proxy all /api/* calls straight to FastAPI (preserves SSE chunked streams)
    if (req.url.startsWith('/api')) {
      const opts = {
        hostname: '127.0.0.1',
        port: BACKEND_PORT,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${BACKEND_PORT}` },
      }
      const proxy = http.request(opts, (pr) => {
        res.writeHead(pr.statusCode, pr.headers)
        pr.pipe(res, { end: true })
      })
      proxy.on('error', () => {
        if (!res.headersSent) res.writeHead(502).end('Backend unavailable')
      })
      req.pipe(proxy, { end: true })
      return
    }

    // Static file serving with SPA fallback
    const urlPath = req.url.split('?')[0]
    let   file    = path.join(distDir, urlPath === '/' ? 'index.html' : urlPath)
    if (!fs.existsSync(file)) file = path.join(distDir, 'index.html')

    const mime = MIME[path.extname(file)] || 'application/octet-stream'
    res.setHeader('Content-Type', mime)
    fs.createReadStream(file).on('error', () => {
      res.writeHead(404).end('Not found')
    }).pipe(res)
  })

  frontendServer.listen(FRONTEND_PORT, '127.0.0.1')
}

// ── BrowserWindow ───────────────────────────────────────────────────────────

function createWindow () {
  const iconPath = path.join(__dirname, 'assets', 'icon.ico')

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'RetailTec Analytics',
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    backgroundColor: '#0f172a',
    show: false,   // reveal after paint to avoid white flash
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })

  mainWindow.setMenuBarVisibility(false)

  const url = isDev
    ? 'http://localhost:3000'                    // Vite dev server
    : `http://localhost:${FRONTEND_PORT}`        // our HTTP server

  mainWindow.loadURL(url)

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.maximize()
  })

  // External links → default browser, not a new Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => {
    if (u.startsWith('http')) shell.openExternal(u)
    return { action: 'deny' }
  })
}

// ── App lifecycle ───────────────────────────────────────────────────────────

async function main () {
  await app.whenReady()

  if (!isDev) {
    startBackend()

    const distDir = path.join(__dirname, '..', 'frontend', 'dist')
    startFrontendServer(distDir)

    await waitForBackend(30000)
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.on('window-all-closed', () => {
  if (backendProcess) { backendProcess.kill(); backendProcess = null }
  if (frontendServer) { frontendServer.close(); frontendServer = null }
  if (process.platform !== 'darwin') app.quit()
})

main().catch(console.error)
