#!/usr/bin/env node
/**
 * Serveur local de Studio.
 * - sert le build statique de `dist/`
 * - relaie `/ollama/*` vers Ollama (évite toute configuration CORS)
 * Aucune dépendance : Node seul suffit.
 */
import { createServer, request as httpRequest } from 'node:http'
import { createServer as createSecureServer, request as httpsRequest } from 'node:https'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handle as handleBlobs } from './server/blobs.mjs'
import { handle as handleMemory } from './server/system.mjs'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)))
const DIST = join(ROOT, 'dist')
// 5300 pour l'application ; 5273 reste réservé au serveur de développement.
const PORT = Number(process.env.PORT ?? 5300)
// 127.0.0.1 par défaut ; HOST=0.0.0.0 pour exposer sur le réseau local.
const HOST = process.env.HOST ?? '127.0.0.1'
const OLLAMA = new URL(process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434')

/**
 * HTTPS facultatif. Indispensable dès qu'on sort de localhost : les
 * navigateurs réservent WebCrypto — donc le chiffrement — aux contextes
 * sécurisés. Certificat local recommandé : `mkcert lab.cm-it.fr`.
 */
const CERT = process.env.STUDIO_CERT
const KEY = process.env.STUDIO_KEY

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
}

/** Relais vers l'API Hugging Face — son CORS interdit l'appel direct. */
function proxyHuggingFace(req, res) {
  const path = req.url.replace(/^\/hf/, '') || '/'
  const upstream = httpsRequest(
    {
      hostname: 'huggingface.co',
      port: 443,
      path,
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': 'ollama-studio' },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, {
        'Content-Type': up.headers['content-type'] ?? 'application/json',
        'Cache-Control': 'no-cache',
      })
      up.pipe(res)
    },
  )
  upstream.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: `Hugging Face injoignable : ${err.message}` }))
  })
  upstream.end()
}

function proxy(req, res) {
  const path = req.url.replace(/^\/ollama/, '') || '/'
  const upstream = httpRequest(
    {
      hostname: OLLAMA.hostname,
      port: OLLAMA.port || 11434,
      path,
      method: req.method,
      headers: { ...req.headers, host: OLLAMA.host },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    },
  )
  upstream.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: `Ollama injoignable : ${err.message}` }))
  })
  req.pipe(upstream)
}

function serveFile(res, file, status = 200) {
  const type = TYPES[extname(file)] ?? 'application/octet-stream'
  // Les fichiers versionnés de Vite (assets/) sont immuables ; le reste, jamais en cache.
  const immutable = file.includes(`${join('dist', 'assets')}`) || file.includes('/fonts/')
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(file).pipe(res)
}

function handle(req, res) {
  if (req.url.startsWith('/ollama')) return proxy(req, res)
  if (req.url.startsWith('/hf')) return proxyHuggingFace(req, res)
  if (req.url.startsWith('/maintenance/blobs')) return void handleBlobs(req, res)
  if (req.url.startsWith('/maintenance/memory')) return void handleMemory(req, res)

  const url = new URL(req.url, `http://${HOST}`)
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
  const file = join(DIST, rel)

  if (file.startsWith(DIST) && existsSync(file) && statSync(file).isFile()) return serveFile(res, file)

  const index = join(DIST, 'index.html')
  if (existsSync(index)) return serveFile(res, index)

  res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end("Build introuvable. Lancez `npm run build`.")
}

const secure = CERT && KEY
if (secure && !(existsSync(CERT) && existsSync(KEY))) {
  console.error(`Certificat introuvable : ${CERT} / ${KEY}`)
  process.exit(1)
}

const server = secure
  ? createSecureServer({ cert: readFileSync(CERT), key: readFileSync(KEY) }, handle)
  : createServer(handle)

server.listen(PORT, HOST, () => {
  const scheme = secure ? 'https' : 'http'
  console.log(`Studio → ${scheme}://${HOST}:${PORT}  (Ollama : ${OLLAMA.origin})`)
  if (!secure && HOST !== '127.0.0.1' && HOST !== 'localhost') {
    console.warn(
      "Attention : sans HTTPS, les navigateurs désactivent WebCrypto hors localhost.\n" +
      '           Le chiffrement des conversations sera indisponible. Voir deploy/RESEAU-LOCAL.md.',
    )
  }
})
