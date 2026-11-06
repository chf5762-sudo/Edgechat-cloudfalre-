import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  base: '/flaredraw/',
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: path.resolve(__dirname, '../frontend/public/flaredraw'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          excalidraw: ['@excalidraw/excalidraw'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'better-auth/react'],
    esbuildOptions: {
      target: 'es2022',
    },
  },
})
