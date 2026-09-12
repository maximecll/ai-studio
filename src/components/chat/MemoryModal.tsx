import { useEffect, useState } from 'react'
import { Brain, RefreshCw, RotateCcw } from 'lucide-react'
import { updateConversation } from '../../lib/db'
import { useMessages } from '../../lib/hooks'
import { contextUsage, emptyMemory, isEmptyMemory } from '../../lib/memory'
import type { Conversation } from '../../lib/types'
import { fullDate } from '../../lib/utils'
import { useChat } from '../../store/chat'
import { toast, useUI } from '../../store/ui'
import { Button, Modal, SpinButton, Textarea } from '../ui/primitives'

/**
 * La mémoire est lisible et modifiable : c'est le contrat de confiance.
 * L'utilisateur doit pouvoir vérifier — et corriger — ce que le modèle a retenu.
 */
export function MemoryModal({ conv }: { conv: Conversation }) {
  const { memoryOpen, setMemoryOpen } = useUI()
  const messages = useMessages(conv.id)
  const compact = useChat((s) => s.compact)
  const compacting = useChat((s) => !!s.compacting[conv.id])
  const [draft, setDraft] = useState(conv.memory)

  useEffect(() => { if (memoryOpen) setDraft(conv.memory) }, [memoryOpen, conv.memory])

  const folded = messages.filter((m) => m.folded).length
  const empty = isEmptyMemory(draft)
  const ratio = contextUsage(conv, messages)

  return (
    <Modal
      open={memoryOpen}
      onClose={() => setMemoryOpen(false)}
      title="Mémoire de la conversation"
      description="Ce mémo remplace les échanges repliés dans le contexte envoyé au modèle."
      icon={<Brain className="size-4" />}
      width="max-w-2xl"
      footer={
        <>
          <Button
            variant="quiet" size="sm"
            onClick={() => setDraft(emptyMemory())}
            disabled={empty}
          >
            <RotateCcw className="size-4" /> Vider
          </Button>
          <div className="flex-1" />
          <Button variant="soft" size="sm" onClick={() => setMemoryOpen(false)}>Fermer</Button>
          <Button
            variant="primary" size="sm"
            disabled={draft === conv.memory}
            onClick={async () => {
              await updateConversation(conv.id, { memory: draft, memoryUpdatedAt: Date.now() })
              toast({ title: 'Mémoire enregistrée', tone: 'success' })
            }}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-3 gap-3">
          {[
            ['Messages repliés', String(folded)],
            ['Contexte occupé', `${Math.round(ratio * 100)} %`],
            ['Dernière mise à jour', conv.memoryUpdatedAt ? fullDate(conv.memoryUpdatedAt) : 'jamais'],
          ].map(([k, v]) => (
            <div key={k} className="rounded-sm bg-surface-2 px-3 py-2.5">
              <dt className="t-caption text-fg-subtle">{k}</dt>
              <dd className="t-meta mt-0.5 font-bold text-fg">{v}</dd>
            </div>
          ))}
        </dl>

        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={16}
          className="font-mono text-[13px] leading-relaxed"
          placeholder={emptyMemory()}
        />

        <div className="flex items-center gap-3">
          <SpinButton
            icon={RefreshCw} variant="soft" size="sm" label="Compacter maintenant"
            spinning={compacting} onClick={() => void compact(conv.id)}
          />
          <p className="t-caption text-fg-subtle">
            Replie les échanges anciens dans ce mémo et libère du contexte.
          </p>
        </div>
      </div>
    </Modal>
  )
}
