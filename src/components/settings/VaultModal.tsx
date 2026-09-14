import { useEffect, useState } from 'react'
import { KeyRound, Lock, ShieldCheck, TriangleAlert } from 'lucide-react'
import { cryptoAvailable } from '../../lib/crypto'
import { useVault } from '../../store/vault'
import { useUI } from '../../store/ui'
import { Button, Field, Input, Modal } from '../ui/primitives'

/** Création et ouverture du coffre. */
export function VaultModal() {
  const { vaultOpen, setVaultOpen } = useUI()
  const { exists, unlocked, busy, error, create, unlock, load } = useVault()
  const [phrase, setPhrase] = useState('')
  const [confirm, setConfirm] = useState('')

  useEffect(() => { void load() }, [load])
  useEffect(() => { if (vaultOpen) { setPhrase(''); setConfirm('') } }, [vaultOpen])

  const creating = exists === false
  const mismatch = creating && confirm.length > 0 && phrase !== confirm
  const ready = phrase.length >= 8 && (!creating || phrase === confirm)

  const submit = async () => {
    if (!ready) return
    const ok = creating ? await create(phrase) : await unlock(phrase)
    if (ok) { setVaultOpen(false); setPhrase(''); setConfirm('') }
  }

  return (
    <Modal
      open={vaultOpen}
      onClose={() => setVaultOpen(false)}
      title={creating ? 'Créer le coffre' : unlocked ? 'Coffre ouvert' : 'Ouvrir le coffre'}
      description={
        creating
          ? 'Une phrase de passe protège les conversations que vous choisirez de verrouiller.'
          : unlocked
            ? 'Les conversations verrouillées sont lisibles jusqu’à la fermeture.'
            : 'Saisissez votre phrase de passe pour lire les conversations verrouillées.'
      }
      icon={creating ? <KeyRound className="size-4" /> : <Lock className="size-4" />}
      width="max-w-md"
      footer={
        unlocked ? (
          <Button variant="soft" size="sm" onClick={() => setVaultOpen(false)}>Fermer</Button>
        ) : (
          <>
            <Button variant="soft" size="sm" onClick={() => setVaultOpen(false)}>Annuler</Button>
            <Button variant="primary" size="sm" disabled={!ready || busy} onClick={submit}>
              {busy ? 'Un instant…' : creating ? 'Créer' : 'Ouvrir'}
            </Button>
          </>
        )
      }
    >
      {!cryptoAvailable ? (
        <div className="flex items-start gap-3 rounded-sm bg-caution-wash px-4 py-3.5">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-caution" />
          <p className="t-meta text-fg-muted">
            Le chiffrement exige une connexion sécurisée. Ouvrez l'application depuis
            <span className="font-mono"> 127.0.0.1</span> ou en HTTPS.
          </p>
        </div>
      ) : unlocked ? (
        <div className="flex items-start gap-3 rounded-sm bg-positive-wash px-4 py-3.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-positive" />
          <p className="t-meta text-fg-muted">
            La clé est en mémoire. Elle disparaît au rechargement de la page, ou après quinze
            minutes sans activité.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <Field label="Phrase de passe" hint="Huit caractères au minimum. Une phrase entière vaut mieux qu'un mot compliqué.">
            <Input
              type="password"
              autoFocus
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              placeholder="……………"
            />
          </Field>

          {creating && (
            <Field label="Confirmation" hint={mismatch ? undefined : 'Retapez la même phrase.'}>
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
                placeholder="……………"
              />
            </Field>
          )}

          {mismatch && <p className="t-caption text-negative">Les deux phrases diffèrent.</p>}
          {error && <p className="t-caption text-negative">{error}</p>}

          {creating && (
            <div className="flex items-start gap-3 rounded-sm bg-caution-wash px-4 py-3.5">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-caution" />
              <p className="t-caption text-fg-muted">
                Cette phrase n'est stockée nulle part et ne peut pas être retrouvée.
                Si vous l'oubliez, les conversations verrouillées sont définitivement illisibles.
              </p>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
