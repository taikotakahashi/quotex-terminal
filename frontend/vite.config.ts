import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/ws': {
        // http + ws:true is the supported Vite pattern (ws:// target can EPIPE on close)
        target: 'http://127.0.0.1:8000',
        ws: true,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            const code = (err as NodeJS.ErrnoException).code
            // Benign: browser/API closed the socket while Vite was still writing.
            if (code === 'EPIPE' || code === 'ECONNRESET' || code === 'ECONNREFUSED') return
            console.error('[vite] ws proxy error:', err.message)
          })
        },
      },
    },
  },
})
