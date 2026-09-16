import { useEffect, useRef, useState } from 'react'
import { FileText, FolderOpen, Layers, Loader2, Plus, Trash2, Upload } from 'lucide-react'
import { db } from '../../lib/db'
import { DEFAULT_EMBED_MODEL } from '../../lib/rag'
import type { Chunk, KnowledgeBase } from '../../lib/types'
import { useModels } from '../../store/models'
import { useKnowledge } from '../../store/knowledge'
import { Page } from '../layout/Page'
import { Button, ConfirmModal, Input } from '../ui/primitives'
import { cn } from '../../lib/utils'

/** Documents (regroupés par nom) d'une base, chargés à la demande. */
function useDocs(baseId: string, version: number) {
  const [docs, setDocs] = useState<Array<{ docId: string; name: string; chunks: number }>>([])
  useEffect(() => {
    let alive = true
    void db.chunks.where('knowledgeId').equals(baseId).toArray().then((rows: Chunk[]) => {
      const map = new Map<string, { docId: string; name: string; chunks: number }>()
      for (const c of rows) {
        const e = map.get(c.docId) ?? { docId: c.docId, name: c.docName, chunks: 0 }
        e.chunks++
        map.set(c.docId, e)
      }
      if (alive) setDocs([...map.values()])
    })
    return () => { alive = false }
  }, [baseId, version])
  return docs
}

function BaseCard({ base }: { base: KnowledgeBase }) {
  const counts = useKnowledge((s) => s.counts[base.id])
  const indexing = useKnowledge((s) => s.indexing)
  const addFiles = useKnowledge((s) => s.addFiles)
  const removeDoc = useKnowledge((s) => s.removeDoc)
  const remove = useKnowledge((s) => s.remove)
  const rename = useKnowledge((s) => s.rename)

  const fileRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [confirmDrop, setConfirmDrop] = useState(false)
  const docs = useDocs(base.id, counts?.chunks ?? 0)
  const busy = indexing?.base === base.id

  return (
    <section className="overflow-hidden rounded-lg bg-surface shadow-card">
      <header className="flex items-center gap-3 px-5 py-3.5">
        <Layers className="size-4 shrink-0 text-fg-subtle" />
        <input
          defaultValue={base.name}
          onBlur={(e) => { if (e.target.value.trim() !== base.name) void rename(base.id, e.target.value) }}
          className="min-w-0 flex-1 bg-transparent text-[15px] font-bold tracking-[-0.02em] text-fg outline-none"
          aria-label="Nom de la base"
        />
        <span className="t-caption shrink-0 text-fg-subtle">
          {counts?.docs ?? 0} doc{(counts?.docs ?? 0) > 1 ? 's' : ''} · {counts?.chunks ?? 0} morceaux
        </span>
        <div className="ml-1 flex shrink-0 items-center gap-1">
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => { void addFiles(base.id, [...(e.target.files ?? [])]); e.target.value = '' }}
          />
          <Button size="icon-sm" disabled={busy} onClick={() => fileRef.current?.click()} aria-label="Ajouter des documents">
            <Upload className="size-4" />
          </Button>
          <Button size="icon-sm" onClick={() => setConfirmDrop(true)} aria-label="Supprimer la base">
            <Trash2 className="size-4" />
          </Button>
        </div>
      </header>

      {busy && (
        <p className="t-caption flex items-center gap-2 border-t border-line px-5 py-3 text-fg-muted">
          <Loader2 className="size-4 shrink-0 animate-spin" />
          Indexation — {indexing.label} ({indexing.done + 1}/{indexing.total})
        </p>
      )}

      {(counts?.docs ?? 0) === 0 ? (
        <div
          className="border-t border-line px-5 py-6"
          onDragOver={(e) => { e.preventDefault() }}
          onDrop={(e) => { e.preventDefault(); void addFiles(base.id, [...e.dataTransfer.files]) }}
        >
          <p className="t-meta text-fg-muted">
            Déposez des fichiers texte ici (Markdown, code, <span className="font-mono">.txt</span>, JSON, CSV…).
            Ils sont découpés et vectorisés en local, puis le modèle s’appuiera dessus quand la base est activée
            dans une conversation.
          </p>
        </div>
      ) : (
        <>
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center gap-2 border-t border-line px-5 py-2.5 text-left transition-colors hover:bg-fg/[0.03]"
          >
            <FolderOpen className="size-3.5 text-fg-subtle" />
            <span className="t-caption text-fg-muted">{open ? 'Masquer' : 'Voir'} les documents</span>
          </button>
          {open && (
            <ul className="border-t border-line">
              {docs.map((d) => (
                <li key={d.docId} className="group/doc flex items-center gap-3 px-5 py-2.5">
                  <FileText className="size-4 shrink-0 text-fg-subtle" />
                  <span className="t-caption min-w-0 flex-1 truncate text-fg">{d.name}</span>
                  <span className="t-caption shrink-0 text-fg-subtle">{d.chunks} morceaux</span>
                  <button
                    onClick={() => void removeDoc(base.id, d.docId)}
                    aria-label={`Retirer ${d.name}`}
                    className="shrink-0 text-fg-subtle opacity-0 transition-opacity hover:text-negative group-hover/doc:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <ConfirmModal
        open={confirmDrop}
        onClose={() => setConfirmDrop(false)}
        onConfirm={() => void remove(base.id)}
        title={`Supprimer « ${base.name} » ?`}
        description="La base et tous ses documents indexés seront effacés."
        confirmLabel="Supprimer"
        danger
      />
    </section>
  )
}

export function KnowledgeView() {
  const bases = useKnowledge((s) => s.bases)
  const refresh = useKnowledge((s) => s.refresh)
  const create = useKnowledge((s) => s.create)
  const models = useModels((s) => s.models)
  const [name, setName] = useState('')

  useEffect(() => { void refresh() }, [refresh])

  const hasEmbed = models.some((m) => m.name.includes(DEFAULT_EMBED_MODEL))

  const ajouter = async () => {
    const n = name.trim()
    if (!n) return
    setName('')
    await create(n)
  }

  return (
    <Page
      title="Connaissances"
      subtitle="Documents locaux sur lesquels vos modèles s’appuient"
    >
      {!hasEmbed && (
        <p className="t-caption mb-6 flex items-start gap-2 rounded-sm bg-caution-wash px-4 py-3 text-fg-muted">
          <Layers className="mt-0.5 size-4 shrink-0 text-caution" />
          Le modèle d’embedding <span className="font-mono">{DEFAULT_EMBED_MODEL}</span> n’est pas installé — il
          vectorise les documents. Installez-le depuis la page Modèles (≈ 270 Mo) avant d’indexer.
        </p>
      )}

      <div className="mb-6 flex items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void ajouter() }}
          placeholder="Nom d’une nouvelle base — ex. « Doc React », « Mon code »"
          className="flex-1"
        />
        <Button variant="primary" size="sm" onClick={() => void ajouter()} disabled={!name.trim()}>
          <Plus className="size-4" />
          Créer
        </Button>
      </div>

      {bases.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line py-20 text-center">
          <Layers size={20} className="mx-auto text-fg-subtle" />
          <p className="mt-4 text-[15px] font-medium">Aucune base de connaissances</p>
          <p className="mt-1 text-[14px] text-fg-subtle">
            Créez-en une, déposez vos documents, activez-la dans une conversation.
          </p>
        </div>
      ) : (
        <div className={cn('space-y-5')}>
          {bases.map((b) => <BaseCard key={b.id} base={b} />)}
        </div>
      )}

      <p className="t-caption mt-6 text-fg-subtle">
        Tout reste sur la machine : le découpage, les vecteurs et la recherche se font en local.
        Formats texte pour l’instant (Markdown, code, txt, JSON, CSV) — le PDF viendra.
      </p>
    </Page>
  )
}
