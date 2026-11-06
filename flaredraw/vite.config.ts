import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare({ inspectorPort: false }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
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
  ssr: {
    noExternal: ['better-auth'],
  },
})
