import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// The localisation server runs over plain HTTP; the dev server is HTTPS (for
// camera access). Proxy the API routes so the browser talks same-origin HTTPS
// and avoids mixed-content blocking.
const API = 'http://localhost:8787'

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: true,
    proxy: {
      '/localise':  { target: API, changeOrigin: true },
      '/status':    { target: API, changeOrigin: true },
      '/test-clip': { target: API, changeOrigin: true },
    },
  },
})
