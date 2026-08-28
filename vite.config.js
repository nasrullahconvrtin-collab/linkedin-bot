import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const timestamp = Date.now();

export default defineConfig({
  root: './dashboard',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../dashboard/dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash]-${timestamp}.js`,
        chunkFileNames: `assets/[name]-[hash]-${timestamp}.js`,
        assetFileNames: `assets/[name]-[hash]-${timestamp}[extname]`
      }
    }
  }
})
