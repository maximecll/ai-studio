/** Images jointes à un message : rangement, relecture, garde-fous. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { putImage, readImage } from './db'
import { toast } from '../store/ui'
import type { Attachment } from './types'
import { uid } from './utils'

export const MAX_FICHIERS = 6
export const MAX_OCTETS = 20 * 1024 * 1024

/** Message d'erreur si le fichier ne peut pas être joint, sinon `null`. */
export function refus(file: File): string | null {
  if (!file.type.startsWith('image/')) return `${file.name} n’est pas une image.`
  if (file.size > MAX_OCTETS) return `${file.name} dépasse ${MAX_OCTETS / 1048576} Mo.`
  return null
}

/** Range les octets dans la base, chiffrés comme le reste de la conversation. */
export async function storeAttachments(conversationId: string, files: File[]): Promise<Attachment[]> {
  const jointes: Attachment[] = []
  for (const file of files) {
    const type = file.type || 'image/png'
    const blobId = await putImage(conversationId, new Uint8Array(await file.arrayBuffer()), type)
    jointes.push({ blobId, name: file.name, type, size: file.size })
  }
  return jointes
}

/** Ollama attend du base64 nu, sans en-tête `data:`. */
export async function toBase64(blobId: string): Promise<string | null> {
  const blob = await readImage(blobId)
  if (!blob) return null
  const octets = new Uint8Array(await blob.arrayBuffer())
  // `String.fromCharCode` déborde la pile au-delà de quelques dizaines de
  // milliers d'arguments : on avance par tranches.
  let binaire = ''
  const PAS = 0x8000
  for (let i = 0; i < octets.length; i += PAS) {
    binaire += String.fromCharCode(...octets.subarray(i, i + PAS))
  }
  return btoa(binaire)
}

/** Base64 des images d'un message, dans l'ordre, les illisibles écartées. */
export async function imagesOf(attachments: Attachment[] | undefined): Promise<string[] | undefined> {
  if (!attachments?.length) return undefined
  const brutes = await Promise.all(attachments.map((a) => toBase64(a.blobId)))
  const gardees = brutes.filter((b): b is string => !!b)
  return gardees.length ? gardees : undefined
}

/* ── Fichiers en attente d'envoi ──────────────────────────────────── */

export interface Pending {
  id: string
  file: File
  /** URL d'objet, révoquée au retrait : sans ça la mémoire ne se rend pas. */
  url: string
}

/** Une image tronquée passerait le contrôle de type puis ferait échouer
    chaque tour suivant, l'historique la renvoyant à chaque fois. */
async function decodable(file: File): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(file)
    bitmap.close()
    return true
  } catch {
    return false
  }
}

export function useAttachments() {
  const [items, setItems] = useState<Pending[]>([])
  const vivants = useRef<Pending[]>([])
  vivants.current = items

  useEffect(() => () => { for (const p of vivants.current) URL.revokeObjectURL(p.url) }, [])

  const add = useCallback(async (files: FileList | File[] | null) => {
    const entrants = [...(files ?? [])]
    if (!entrants.length) return
    const gardes: Pending[] = []
    for (const file of entrants) {
      if (vivants.current.length + gardes.length >= MAX_FICHIERS) {
        toast({ title: 'Trop de pièces jointes', description: `${MAX_FICHIERS} images au maximum.`, tone: 'danger' })
        break
      }
      const motif = refus(file)
      if (motif) { toast({ title: 'Pièce jointe refusée', description: motif, tone: 'danger' }); continue }
      if (!(await decodable(file))) {
        toast({ title: 'Image illisible', description: `${file.name} n’a pas pu être décodée.`, tone: 'danger' })
        continue
      }
      gardes.push({ id: uid(), file, url: URL.createObjectURL(file) })
    }
    if (gardes.length) setItems((actuels) => [...actuels, ...gardes])
  }, [])

  const remove = useCallback((id: string) => {
    setItems((actuels) => {
      const parti = actuels.find((p) => p.id === id)
      if (parti) URL.revokeObjectURL(parti.url)
      return actuels.filter((p) => p.id !== id)
    })
  }, [])

  const clear = useCallback(() => {
    setItems((actuels) => { for (const p of actuels) URL.revokeObjectURL(p.url); return [] })
  }, [])

  return { items, files: items.map((p) => p.file), add, remove, clear }
}
