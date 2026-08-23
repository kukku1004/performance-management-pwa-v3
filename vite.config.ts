import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  base: command === 'build'
    ? process.env.VITE_BASE_PATH || '/performance-management-pwa-v3/'
    : '/',
  plugins: [react()],
}))
