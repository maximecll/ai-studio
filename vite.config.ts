import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** Cible Ollama — surchargeable via OLLAMA_HOST au lancement. */
const OLLAMA = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434'

/** L'entretien du magasin Ollama et la génération d'images touchent au système de fichiers : ils vivent côté serveur. */
function maintenance(): PluginOption {
  return {
    name: 'studio-maintenance',
    configureServer(server) {
      server.middlewares.use('/maintenance/blobs', async (req, res) => {
        // @ts-expect-error — module serveur en JavaScript, sans types
        const { handle } = await import('./server/blobs.mjs')
        await handle(req, res)
      })
      server.middlewares.use('/maintenance/memory', async (req, res) => {
        // @ts-expect-error — module serveur en JavaScript, sans types
        const { handle } = await import('./server/system.mjs')
        await handle(req, res)
      })
      // La génération d'images sort d'Ollama : elle pilote un processus Python.
      server.middlewares.use('/images', async (req, res) => {
        // @ts-expect-error — module serveur en JavaScript, sans types
        const { handle } = await import('./server/images.mjs')
        await handle(req, res)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), maintenance()],
  server: {
    port: 5273,
    host: true,
    // Le proxy évite toute config CORS côté Ollama : le front n'appelle que /ollama/*
    proxy: {
      '/ollama': {
        target: OLLAMA,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/ollama/, ''),
      },
      // L'API Hugging Face restreint son CORS : on la relaie côté serveur.
      '/hf': {
        target: 'https://huggingface.co',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/hf/, ''),
      },
    },
  },
  preview: {
    port: 5273,
    proxy: {
      '/ollama': { target: OLLAMA, changeOrigin: true, rewrite: (p) => p.replace(/^\/ollama/, '') },
      '/hf': { target: 'https://huggingface.co', changeOrigin: true, rewrite: (p) => p.replace(/^\/hf/, '') },
    },
  },
})
