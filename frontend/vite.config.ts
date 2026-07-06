import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',        // bind to all interfaces — enables VPN/remote access
    port: 7383,
    proxy: {
      '/api': {
        // 127.0.0.1 (not localhost): Node 17+ resolves localhost to ::1 first,
        // but uvicorn binds IPv4 only — proxying to localhost 500s on some machines
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        timeout: 0,          // no proxy timeout — required for long SSE streams
        proxyTimeout: 0,     // no upstream timeout
      },
    },
  },
})
