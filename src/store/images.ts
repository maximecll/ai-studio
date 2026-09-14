/**
 * Génération d'images.
 *
 * Le pendant de `store/chat` pour la diffusion : une tâche par conversation,
 * suivie pas à pas, puis rangée en base. Les octets ne restent jamais sur le
 * disque du serveur — ils sont récupérés puis effacés du sas, pour que le
 * chiffrement des conversations verrouillées ait un sens.
 */
import { create } from 'zustand'
import { addMessage, db, getSettings, putImage, readImage } from '../lib/db'
import * as images from '../lib/images'
import { activeLoras, imageModelName, modelOf } from '../lib/images'
import type { ImageEngine, ImageParams, LoraChoice, LoraFile } from '../lib/types'
import { toast } from './ui'

export type Phase = 'starting' | 'loading' | 'diffusing' | 'saving' | 'revealing'

export interface Job {
  conversationId: string
  prompt: string
  /** Identifiant du catalogue, et libellé figé au lancement. */
  model: string
  modelName: string
  width: number
  height: number
  steps: number
  seed?: number
  /** Nombre de LoRAs réellement appliqués, tel que le serveur le confirme. */
  loras: number
  phase: Phase
  label: string
  /** Pas déjà franchis. */
  step: number
  startedAt: number
  /** Durée moyenne d'un pas, lissée — sert à estimer la fin. */
  stepMs: number
  /**
   * URL de l'image finie. Elle est donnée à la mosaïque avant que le message
   * n'existe en base : la révélation se joue donc d'un seul tenant, et le
   * message prend le relais sur la même image déjà chargée.
   */
  src?: string
  blobId?: string
  /** Guidage effectivement appliqué — nul sur un modèle distillé. */
  guidance?: number
  /** LoRAs transmis au moteur pour cette tâche. */
  applied?: LoraChoice[]
  result?: { seed: number; ms: number; bytes: number }
}

export interface Pull {
  model: string
  label: string
  completed: number
  total: number
  speed: number
  eta: number | null
  startedAt: number
  error?: string
}

interface State {
  engine: ImageEngine | null
  /** Contenu de la bibliothèque de LoRAs, relu à la demande. */
  library: LoraFile[]
  loraFolder: string
  refreshLoras: () => Promise<void>
  /** Vrai tant que le premier état n'est pas revenu — à distinguer d'un moteur absent. */
  probing: boolean
  jobs: Record<string, Job>
  pulls: Record<string, Pull>
  installing: { label: string; line: string } | null

  refresh: () => Promise<void>
  create: (conversationId: string, prompt: string, params: ImageParams, opts?: { resume?: boolean }) => Promise<void>
  /** Range le message une fois la révélation jouée. Idempotent. */
  finish: (conversationId: string) => Promise<void>
  cancel: (conversationId: string) => void
  install: () => Promise<void>
  pull: (model: string) => Promise<void>
  cancelPull: (model: string) => void
  remove: (model: string) => Promise<void>
}

const running = new Map<string, AbortController>()
const pulling = new Map<string, AbortController>()

/** Repli d'estimation avant toute mesure : un pas de FLUX sur cette classe de machine. */
const ASSUMED_STEP_MS = 12_000

export const useImages = create<State>((set, get) => {
  const patchJob = (id: string, patch: Partial<Job>) => {
    const cur = get().jobs[id]
    if (!cur) return
    set({ jobs: { ...get().jobs, [id]: { ...cur, ...patch } } })
  }

  const dropJob = (id: string) => {
    const jobs = { ...get().jobs }
    delete jobs[id]
    set({ jobs })
  }

  return {
    engine: null,
    library: [],
    loraFolder: '',
    probing: true,
    jobs: {},
    pulls: {},
    installing: null,

    async refresh() {
      try {
        set({ engine: await images.engineStatus(), probing: false })
      } catch {
        // Serveur injoignable : on ne prétend pas savoir, on dit qu'on ne sait pas.
        set({ engine: null, probing: false })
      }
      void get().refreshLoras()
    },

    async refreshLoras() {
      try {
        const { folder, items } = await images.loraLibrary()
        set({ library: items, loraFolder: folder })
      } catch {
        set({ library: [] })
      }
    },

    async create(conversationId, prompt, params, opts = {}) {
      if (get().jobs[conversationId]) return
      const body = prompt.trim()
      if (!body) return

      const entry = modelOf(get().engine?.catalog ?? [], params.model)
      const steps = params.steps ?? entry?.steps.default ?? 20

      /* En reprise, la description est déjà dans le fil : la réécrire
         dupliquerait le message. */
      if (!opts.resume) {
        await addMessage({ conversationId, role: 'user', content: body, imageRequest: { ...params, steps } })
      }

      set({
        jobs: {
          ...get().jobs,
          [conversationId]: {
            conversationId,
            prompt: body,
            model: params.model,
            modelName: imageModelName(entry),
            width: params.width,
            height: params.height,
            steps,
            loras: activeLoras(params.loras, get().library).length,
            phase: 'starting',
            label: 'Préparation',
            step: 0,
            startedAt: Date.now(),
            stepMs: ASSUMED_STEP_MS,
          },
        },
      })

      const controller = new AbortController()
      running.set(conversationId, controller)

      let produced: { id: string; seed: number; ms: number } | null = null
      let failure: string | null = null

      try {
        const loras = activeLoras(params.loras, get().library)
        patchJob(conversationId, { applied: loras })
        for await (const ev of images.generate(
          { ...params, loras, prompt: body, steps },
          controller.signal,
        )) {
          switch (ev.type) {
            case 'start':
              patchJob(conversationId, {
                seed: ev.seed, steps: ev.steps, width: ev.width, height: ev.height,
                // Valeur réellement appliquée, que l'appelant l'ait fixée ou non.
                guidance: ev.guidance ?? undefined,
                loras: ev.loras ?? 0,
              })
              break
            case 'phase':
              patchJob(conversationId, {
                phase: ev.phase === 'diffusing' ? 'diffusing' : 'loading',
                label: ev.label,
                ...(ev.steps ? { steps: ev.steps } : {}),
              })
              break
            case 'lora':
              /* Un fichier prévu pour une autre architecture se charge sans
                 erreur et n'adapte rien : l'image sortirait identique à celle
                 du modèle nu, sans que rien ne l'explique. */
              if (ev.layers === 0) {
                toast({
                  title: 'LoRA sans effet',
                  description: `${ev.file} n'a modifié aucune couche : il vise sans doute une autre architecture.`,
                  tone: 'danger',
                })
              }
              break
            case 'step': {
              const cur = get().jobs[conversationId]
              /* Le premier pas porte le coût de compilation des noyaux Metal :
                 l'inclure fausserait l'estimation pour tous les suivants. */
              const stepMs =
                ev.step <= 1 || !cur ? (cur?.stepMs ?? ASSUMED_STEP_MS) : cur.stepMs * 0.6 + ev.stepMs * 0.4
              patchJob(conversationId, { phase: 'diffusing', step: ev.step, steps: ev.steps, stepMs })
              break
            }
            case 'done':
              if (ev.id) produced = { id: ev.id, seed: ev.seed ?? 0, ms: ev.ms ?? 0 }
              break
            case 'cancelled':
              failure = null
              break
            case 'error':
              failure = ev.message
              break
          }
        }

        if (produced) {
          patchJob(conversationId, { phase: 'saving', label: 'Enregistrement' })
          const bytes = await images.collect(produced.id)
          const blobId = await putImage(conversationId, bytes)
          /* L'URL est mise en cache par identifiant : le message qui prendra le
             relais montrera la même image, sans la recharger ni clignoter. */
          const src = holdURL(blobId, new Blob([bytes as BlobPart], { type: 'image/png' }))

          patchJob(conversationId, {
            phase: 'revealing',
            label: 'Terminé',
            src,
            blobId,
            result: { seed: produced.seed, ms: produced.ms, bytes: bytes.byteLength },
          })
          /* Filet : si la vue est quittée avant la fin de l'animation, le
             message doit exister quand même. */
          setTimeout(() => void get().finish(conversationId), 8000)
          return
        } else if (failure) {
          await addMessage({
            conversationId,
            role: 'assistant',
            content: '',
            model: params.model,
            error: failure,
          })
          toast({ title: 'Génération impossible', description: failure, tone: 'danger' })
        }
      } catch (e) {
        const err = e as Error
        if (err.name !== 'AbortError') {
          await addMessage({ conversationId, role: 'assistant', content: '', model: params.model, error: err.message })
          toast({ title: 'Génération impossible', description: err.message, tone: 'danger' })
        }
      } finally {
        running.delete(conversationId)
        // Le chemin « révélation » garde sa tâche : `finish` la retirera.
        if (get().jobs[conversationId]?.phase !== 'revealing') dropJob(conversationId)
        void get().refresh()
      }
    },

    async finish(conversationId) {
      const job = get().jobs[conversationId]
      if (!job || job.phase !== 'revealing' || !job.blobId || !job.result) return
      // Retirée d'abord : deux appels concurrents ne doivent pas écrire deux messages.
      dropJob(conversationId)
      await addMessage({
        conversationId,
        role: 'assistant',
        content: '',
        model: job.model,
        image: {
          blobId: job.blobId,
          prompt: job.prompt,
          model: job.model,
          modelName: job.modelName,
          width: job.width,
          height: job.height,
          steps: job.steps,
          seed: job.result.seed,
          guidance: job.guidance,
          loras: job.applied?.length ? job.applied : undefined,
          ms: job.result.ms,
          bytes: job.result.bytes,
        },
      })
    },

    cancel(conversationId) {
      // Le serveur porte le processus Python : couper le flux ne suffit pas à l'arrêter.
      void images.cancel({})
      running.get(conversationId)?.abort()
    },

    async install() {
      if (get().installing) return
      set({ installing: { label: 'Préparation', line: '' } })
      try {
        for await (const ev of images.installEngine()) {
          if (ev.type === 'phase') set({ installing: { label: ev.label, line: '' } })
          if (ev.type === 'log') {
            set({ installing: { label: get().installing?.label ?? '', line: ev.line } })
          }
          if (ev.type === 'error') {
            toast({ title: "Installation du moteur d'images", description: ev.message, tone: 'danger' })
          }
          if (ev.type === 'done') {
            toast({ title: "Moteur d'images installé", description: 'mflux est prêt.', tone: 'success' })
          }
        }
      } catch (e) {
        toast({ title: "Installation du moteur d'images", description: (e as Error).message, tone: 'danger' })
      } finally {
        set({ installing: null })
        await get().refresh()
      }
    },

    async pull(model) {
      if (get().pulls[model]) return
      const controller = new AbortController()
      pulling.set(model, controller)
      set({
        pulls: {
          ...get().pulls,
          [model]: { model, label: 'Connexion…', completed: 0, total: 0, speed: 0, eta: null, startedAt: Date.now() },
        },
      })

      const patch = (p: Partial<Pull>) => {
        const cur = get().pulls[model]
        if (!cur) return
        set({ pulls: { ...get().pulls, [model]: { ...cur, ...p } } })
      }

      try {
        for await (const ev of images.pullModel(model, controller.signal)) {
          if (ev.type === 'phase') patch({ label: ev.label })
          if (ev.type === 'progress') {
            patch({
              label: 'Téléchargement',
              // Le serveur peut dépasser son propre total en fin de course ; on borne.
              completed: Math.min(ev.completed, ev.total || ev.completed),
              total: ev.total,
              speed: ev.speed,
              eta: ev.eta,
            })
          }
          if (ev.type === 'error') patch({ error: ev.message, label: 'Échec' })
          if (ev.type === 'done') {
            toast({ title: 'Modèle d’images installé', description: model, tone: 'success' })
          }
        }
      } catch (e) {
        const err = e as Error
        if (err.name !== 'AbortError') patch({ error: err.message, label: 'Échec' })
      } finally {
        pulling.delete(model)
        const failed = get().pulls[model]?.error
        if (!failed) {
          const pulls = { ...get().pulls }
          delete pulls[model]
          set({ pulls })
        }
        await get().refresh()
      }
    },

    cancelPull(model) {
      void images.cancel({ model })
      pulling.get(model)?.abort()
      const pulls = { ...get().pulls }
      delete pulls[model]
      set({ pulls })
    },

    async remove(model) {
      await images.removeModel(model)
      await get().refresh()
    },
  }
})

/* ── URL des images ───────────────────────────────────────────────── */

/**
 * Une URL d'objet par image, partagée entre la mosaïque qui la révèle et le
 * message qui l'affichera ensuite. Sans ce partage, le passage de l'une à
 * l'autre recréerait une URL, et le navigateur redessinerait l'image — un
 * clignotement au moment précis où l'animation vient de se terminer.
 */
const urls = new Map<string, string>()

export function holdURL(blobId: string, blob: Blob): string {
  const existing = urls.get(blobId)
  if (existing) return existing
  const url = URL.createObjectURL(blob)
  urls.set(blobId, url)
  return url
}

export function peekURL(blobId: string): string | undefined {
  return urls.get(blobId)
}

/** Charge l'image depuis la base, déchiffrée si le coffre est ouvert. */
export async function loadURL(blobId: string): Promise<string | null> {
  const cached = urls.get(blobId)
  if (cached) return cached
  const blob = await readImage(blobId)
  return blob ? holdURL(blobId, blob) : null
}

export function releaseURL(blobId: string): void {
  const url = urls.get(blobId)
  if (!url) return
  URL.revokeObjectURL(url)
  urls.delete(blobId)
}

/** Durée totale estimée d'une tâche, en millisecondes. */
export function estimatedDuration(job: Job): number {
  return job.steps * job.stepMs + 20_000
}

/** Ce qu'affiche la pastille de la mosaïque, selon l'étape en cours. */
export function jobCaption(job: Job): string {
  if (job.phase === 'diffusing' && job.step > 0) return `${job.label} ${job.step} / ${job.steps}`
  return job.label
}

/** Réglages de diffusion effectifs — ceux de la conversation, sinon ceux par défaut. */
export async function currentImageParams(): Promise<ImageParams> {
  return (await getSettings()).imageParams
}

/** Une image a-t-elle déjà été produite dans cette conversation ? */
export async function hasImages(conversationId: string): Promise<boolean> {
  return (await db.images.where('conversationId').equals(conversationId).count()) > 0
}
