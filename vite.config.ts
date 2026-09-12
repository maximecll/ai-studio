import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** Cible Ollama — surchargeable via OLLAMA_HOST au lancement. */
const OLLAMA = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
