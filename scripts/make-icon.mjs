/**
 * Génère l'icône de l'application — sans dépendance, en écrivant le PNG à la main.
 * Squircle façon macOS, dégradé violet monday, étoile blanche à quatre branches.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const SIZE = 1024
const SS = 2 // sur-échantillonnage pour l'anticrénelage

/** Superellipse : |x|^n + |y|^n <= 1, n≈5 donne le galet d'Apple. */
const inSquircle = (x, y, r, n = 5) => Math.abs(x / r) ** n + Math.abs(y / r) ** n <= 1
/** Astroïde : |x|^(2/3) + |y|^(2/3) <= r^(2/3) — une étoile à quatre branches. */
const inStar = (x, y, r) => Math.abs(x) ** (2 / 3) + Math.abs(y) ** (2 / 3) <= r ** (2 / 3)

const lerp = (a, b, t) => a + (b - a) * t

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))

/* Deux teintes de dégradé, passées en argument : l'application de production
   porte l'encre du thème, celle de développement porte l'accent. */
const FROM = hex(process.argv[3] ?? '#1b2030')
const TO = hex(process.argv[4] ?? '#0e1118')
/* Une pastille dans le coin distingue la variante de développement. */
const MARK = process.argv[5] === 'dev'

function render() {
  const n = SIZE * SS
  const acc = new Float32Array(SIZE * SIZE * 4)
  const inset = n * 0.09 // marge des icônes macOS
  const half = n / 2
  const radius = half - inset

  for (let py = 0; py < n; py++) {
    for (let px = 0; px < n; px++) {
      const x = px - half + 0.5
      const y = py - half + 0.5
      let r = 0, g = 0, b = 0, a = 0

      if (inSquircle(x, y, radius)) {
        // Dégradé diagonal violet → ultra-violet
        const t = (px / n) * 0.45 + (py / n) * 0.55
        r = lerp(FROM[0], TO[0], t)
        g = lerp(FROM[1], TO[1], t)
        b = lerp(FROM[2], TO[2], t)
        a = 255

        // Étoile principale, légèrement décalée vers le haut-gauche
        if (inStar(x + n * 0.045, y + n * 0.03, n * 0.235)) { r = g = b = 255 }
        // Petite étoile secondaire — cède la place à la pastille sur la variante dev
        else if (!MARK && inStar(x - n * 0.2, y - n * 0.215, n * 0.085)) { r = g = b = 255 }
        // Pastille d'angle : marque la variante de développement
        else if (MARK && (x - half * 0.52) ** 2 + (y - half * 0.52) ** 2 < (n * 0.085) ** 2) {
          r = g = b = 255
        }
      }

      const i = (Math.floor(py / SS) * SIZE + Math.floor(px / SS)) * 4
      acc[i] += r; acc[i + 1] += g; acc[i + 2] += b; acc[i + 3] += a
    }
  }

  const px = Buffer.alloc(SIZE * SIZE * 4)
  const per = SS * SS
  for (let i = 0; i < acc.length; i++) px[i] = Math.round(acc[i] / per)
  return px
}

function png(rgba, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filtre « none »
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6 // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const TABLE = (() => {
  const t = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c
  }
  return t
})()
function crc32(buf) {
  let c = -1
  for (const byte of buf) c = TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return c ^ -1
}

const out = process.argv[2] ?? 'icon.png'
writeFileSync(out, png(render(), SIZE))
console.log(`icône écrite : ${out} (${SIZE}×${SIZE})`)
