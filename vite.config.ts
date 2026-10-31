import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-ethers": ["ethers"],
          "vendor-query": ["@tanstack/react-query"],
          "vendor-react": ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
  server: { host: '127.0.0.1', port: Number(process.env.PORT) || 4173 },
  preview: { host: '127.0.0.1', port: Number(process.env.PORT) || 4173 },
})
