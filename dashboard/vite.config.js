import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const timestamp = Date.now();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 3000 },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash]-${timestamp}.js`,
        chunkFileNames: `assets/[name]-[hash]-${timestamp}.js`,
        assetFileNames: `assets/[name]-[hash]-${timestamp}[extname]`
      }
    }
  }
})
