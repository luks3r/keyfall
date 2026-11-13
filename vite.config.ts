import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const ROOM_SERVER = 'http://localhost:7777'

/** Cross-origin isolation unlocks SharedArrayBuffer for the audio command ring. Mirrors crates/room. */
const ISOLATION = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    headers: ISOLATION,
    watch: { ignored: ['**/src-tauri/**', '**/crates/**', '**/target/**'] },
    proxy: { '/ws': { target: ROOM_SERVER, ws: true }, '/health': ROOM_SERVER },
  },
  preview: { headers: ISOLATION },
  build: { target: 'es2022' },
  worker: { format: 'es' },
})
