/** Chiffrement au repos des conversations verrouillées. */

export const KDF_ITERATIONS = 4_000_000
const PREFIX = 'enc:v1:'

export class VaultError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VaultError'
  }
}

/* ── Encodage ─────────────────────────────────────────────────────── */

const enc = new TextEncoder()
const dec = new TextDecoder()

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const b of view) s += String.fromCharCode(b)
  return btoa(s)
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/* ── Dérivation et scellement ─────────────────────────────────────── */

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function seal(key: CryptoKey, bytes: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes as BufferSource)
  return `${PREFIX}${toBase64(iv)}:${toBase64(ct)}`
}

async function unseal(key: CryptoKey, payload: string): Promise<Uint8Array> {
  const rest = payload.slice(PREFIX.length)
  const sep = rest.indexOf(':')
  if (sep === -1) throw new VaultError('Charge chiffrée mal formée.')
  const iv = fromBase64(rest.slice(0, sep)) as unknown as BufferSource
  const ct = fromBase64(rest.slice(sep + 1))
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct.slice().buffer)
    return new Uint8Array(pt)
  } catch {
    // AES-GCM est authentifié : un échec signifie mauvaise clé ou altération.
    throw new VaultError('Déchiffrement impossible : clé incorrecte ou donnée altérée.')
  }
}

/* ── Coffre ───────────────────────────────────────────────────────── */

export interface Vault {
  id: 'vault'
  version: 1
  salt: string
  iterations: number
  /** Clé maîtresse scellée par la clé dérivée de la phrase. */
  wrapped: string
  /** Témoin permettant de distinguer une mauvaise phrase d'une donnée corrompue. */
  check: string
  createdAt: number
}

const WITNESS = 'studio-vault-v1'

/** Crée un coffre neuf. La clé maîtresse ne quitte jamais la mémoire. */
export async function createVault(passphrase: string): Promise<{ vault: Vault; master: CryptoKey }> {
  if (passphrase.length < 8) throw new VaultError('La phrase de passe doit faire au moins 8 caractères.')

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const wrapping = await deriveKey(passphrase, salt, KDF_ITERATIONS)

  const raw = crypto.getRandomValues(new Uint8Array(32))
  const master = await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', true, ['encrypt', 'decrypt'])

  const vault: Vault = {
    id: 'vault',
    version: 1,
    salt: toBase64(salt),
    iterations: KDF_ITERATIONS,
    wrapped: await seal(wrapping, raw),
    check: await seal(wrapping, enc.encode(WITNESS)),
    createdAt: Date.now(),
  }
  raw.fill(0)
  return { vault, master }
}

/** Ouvre le coffre. Lève une erreur distincte si la phrase est fausse. */
export async function openVault(vault: Vault, passphrase: string): Promise<CryptoKey> {
  const wrapping = await deriveKey(passphrase, fromBase64(vault.salt), vault.iterations)

  let witness: Uint8Array
  try {
    witness = await unseal(wrapping, vault.check)
  } catch {
    throw new VaultError('Phrase de passe incorrecte.')
  }
  if (dec.decode(witness) !== WITNESS) throw new VaultError('Phrase de passe incorrecte.')

  const raw = await unseal(wrapping, vault.wrapped)
  const master = await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
  raw.fill(0)
  return master
}

/** Change la phrase sans toucher à la clé maîtresse : rien n'est à rechiffrer. */
export async function rekeyVault(vault: Vault, current: string, next: string): Promise<Vault> {
  const master = await openVault(vault, current)
  if (next.length < 8) throw new VaultError('La phrase de passe doit faire au moins 8 caractères.')

  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', master).catch(() => {
    throw new VaultError('Clé maîtresse non exportable.')
  }))
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const wrapping = await deriveKey(next, salt, KDF_ITERATIONS)
  const updated: Vault = {
    ...vault,
    salt: toBase64(salt),
    iterations: KDF_ITERATIONS,
    wrapped: await seal(wrapping, raw),
    check: await seal(wrapping, enc.encode(WITNESS)),
  }
  raw.fill(0)
  return updated
}

/* ── Chiffrement des champs ───────────────────────────────────────── */

export function isSealed(value: string | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

export async function sealText(master: CryptoKey, plain: string): Promise<string> {
  return seal(master, enc.encode(plain))
}

export async function openText(master: CryptoKey, payload: string): Promise<string> {
  if (!isSealed(payload)) return payload
  return dec.decode(await unseal(master, payload))
}

/* ── Chiffrement des pièces binaires ──────────────────────────────── */

/** Une image pèse un million de fois un titre : la passer en base64 comme le texte gonflerait la base d'un tiers pour rien. */
export interface SealedBytes {
  iv: string
  data: Uint8Array
}

export async function sealBytes(master: CryptoKey, bytes: Uint8Array): Promise<SealedBytes> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, master, bytes as BufferSource)
  return { iv: toBase64(iv), data: new Uint8Array(ct) }
}

export async function openBytes(master: CryptoKey, sealed: SealedBytes): Promise<Uint8Array> {
  const iv = fromBase64(sealed.iv) as unknown as BufferSource
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, master, sealed.data.slice().buffer)
    return new Uint8Array(pt)
  } catch {
    throw new VaultError('Image indéchiffrable : clé incorrecte ou donnée altérée.')
  }
}

/** Le chiffrement exige WebCrypto, donc un contexte sécurisé. */
export const cryptoAvailable =
  typeof window !== 'undefined' && window.isSecureContext && !!globalThis.crypto?.subtle
