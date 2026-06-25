'use strict'

/**
 * Preload script — runs in the renderer with Node access BEFORE the page loads.
 * contextBridge exposes a safe, minimal API to the React app.
 */

const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  /** true when running inside Electron (production or dev) */
  isElectron: true,
  /** App version from package.json */
  version: process.env.npm_package_version || '2.0.0',
  /** OS platform */
  platform: process.platform,
})
