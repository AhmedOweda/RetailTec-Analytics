import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',        // bind to all interfaces — enables VPN/remote access
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        timeout: 0,          // no proxy timeout — required for long SSE streams
        proxyTimeout: 0,     // no upstream timeout
      },
    },
  },
})
