# AI Studio

Interface locale pour Ollama — conversations, réglages d'inférence, bibliothèque de modèles, génération d'images. Rien ne quitte la machine.

**macOS · Windows · Linux** — MIT

## Installation

```bash
git clone https://github.com/maximecll/ai-studio.git
```

Puis double-cliquez le lanceur de votre système :

| Système | Fichier |
| :-- | :-- |
| 🍎 macOS | `Lancer AI Studio.command` |
| 🪟 Windows | `Lancer AI Studio.bat` |
| 🐧 Linux | `lancer-ai-studio.sh` |

Aucune commande ensuite. Node.js et Ollama sont téléchargés dans `.runtime` s'ils manquent — archives portables, pas de droit administrateur, pas de `PATH` modifié.

**git** est le seul prérequis. Absent de Windows par défaut : [git-scm.com](https://git-scm.com/downloads).

Fermer la fenêtre du lanceur arrête le serveur et Ollama.

<details>
<summary>Options</summary>

| Commande | Effet |
| :-- | :-- |
| `bash scripts/install-app.sh` | Application sur le Bureau (macOS) |
| `bash scripts/install-daemons.sh` | Démarrage à l'ouverture de session |
| `bash scripts/install-daemons.sh --uninstall` | Retire les agents |

</details>

## Fonctionnalités

| | |
| :-- | :-- |
| **Conversations** | Renommage, épinglage, duplication, recherche plein texte, import/export Markdown et JSON. Titres générés par le modèle. |
| **Inférence** | Température, top-p/k, min-p, pénalités, contexte, graine, mirostat, mode réflexion — par conversation. |
| **Presets** | Instructions système et paramètres enregistrés, applicables en un clic. |
| **Modèles** | Recherche Hugging Face (GGUF) et bibliothèque Ollama. Téléchargement avec débit et temps restant, annulable. Chaque modèle installé dit s'il tient sur la carte graphique. |
| **Pièces jointes** | Images déposées, collées ou choisies, lues par les modèles `vision`. Badge cliquable sous le message. |
| **Images** | Génération locale, dans le fil de conversation. Moteur et modèles selon la machine. |
| **Chiffrement** | Conversations verrouillables, AES-GCM au repos. |
| **Mesures** | Entropie par jeton, perplexité, confiance, débit, latence, contexte. |
| **Mémoire** | Au-delà de 72 % du contexte, les vieux échanges sont fondus dans un mémo Markdown modifiable. |

### Compatibilité des modèles

Sur la page **Modèles**, chaque modèle de langage installé porte un verdict, calculé à partir de son empreinte estimée et de la mémoire réellement accessible à la carte.

| Verdict | Signification |
| :-- | :-- |
| 🟢 Supporté | Tient entièrement sur la carte graphique — vitesse maximale |
| 🟠 Supporté à moitié | Dépasse le GPU mais tient en mémoire vive : une partie des couches tourne sur le processeur |
| 🔴 Non supporté | Dépasse la mémoire de la machine — relecture depuis le disque à chaque jeton |

Les modèles de génération d'images, eux, ne sont proposés que sur les systèmes où leur moteur tourne : Windows et Linux partagent les mêmes.

### Selon le système

Tout ce qui précède fonctionne partout. Seule la génération d'images dépend du matériel.

| | 🍎 macOS Apple Silicon | 🪟 Windows · 🐧 Linux | 🍎 macOS Intel |
| :-- | :-: | :-: | :-: |
| Conversations, modèles, pièces jointes, chiffrement | ✅ | ✅ | ✅ |
| Génération d'images | mflux (MLX) | diffusers (PyTorch) | diffusers, processeur |
| Accélération | GPU intégré | NVIDIA, sinon processeur | processeur |
| LoRAs | ✅ | — | — |

### Raccourcis

| | |
| :-- | :-- |
| `⌘K` | Palette de commandes |
| `⌘N` | Nouvelle conversation |
| `⌘B` | Barre latérale |
| `⌘I` | Paramètres de la conversation |
| `⌘,` | Réglages |
| `Échap` | Arrêter la génération |

### Vues de transcription

| Mode | Raisonnement | Réponse |
| :-- | :-- | :-- |
| Normale | replié | dépliée |
| Réflexion | ouvert | repliée |
| Détaillée | ouvert | dépliée, mesures visibles |

## Mises à jour

Le serveur surveille le dépôt distant par `git ls-remote` et pousse l'information à l'application. Une version publiée ouvre la fenêtre d'installation en quelques secondes, sans recharger la page.

```
git merge --ff-only → npm install → npm run build → redémarrage
```

Le serveur sort avec le code `75`, le lanceur le relance, la page se recharge. L'état est consultable dans **Réglages → Mises à jour**, avec un bouton **Rafraîchir**.

## Génération d'images

Ollama ne fait pas de diffusion. Le moteur est installé depuis **Modèles → Génération d'images**, dans un environnement Python à part (`.venv-images`). Python 3.10 ou plus récent doit être présent sur la machine.

### 🍎 macOS Apple Silicon — mflux

| Modèle | Poids | Pas | 1024² sur M3 16 Go |
| :-- | --: | --: | :-- |
| FLUX.1 schnell · 4 bits | 9,6 Go | 4 | ≈ 4 min |
| FLUX.1 dev · 4 bits | 9,6 Go | 20 | ≈ 15 min |
| FLUX.1 dev · 8 bits | 18 Go | 20 | au-delà |

Mesuré : 27 s par pas à 768², pic mémoire 8,0 Go. Le temps suit la surface — la définition (640² · 1024² · 1280²) est le levier principal.

FLUX.1 dev est sous licence non commerciale, schnell sous Apache 2.0. Le cache Xet (≈ 10 Go) se vide depuis le panneau.

### 🪟 Windows · 🐧 Linux — diffusers

PyTorch est installé avec la roue CUDA si une carte NVIDIA est détectée, sinon en version processeur. Sans carte, la génération fonctionne mais se compte en minutes par image.

| Modèle | Poids | Pas | Pour |
| :-- | --: | --: | :-- |
| SDXL Turbo | 6,9 Go | 4 | Le plus rapide, et le seul tenable sans carte |
| SDXL 1.0 | 7,1 Go | 30 | Plus fin, demande une carte |
| Stable Diffusion 1.5 | 2,7 Go | 25 | Le plus léger |

Les LoRAs ne sont pas encore pris en charge sur ce moteur : la bibliothèque reste masquée.

## Sécurité

**Aucune authentification.** AI Studio est prévu pour `localhost`. Servi sur le réseau (`HOST=0.0.0.0`), toute personne y accède — API Ollama comprise. Jamais sur internet sans portail d'identité devant.

**Chiffrement et HTTPS.** Les navigateurs réservent WebCrypto aux contextes sécurisés. Hors `localhost` et sans HTTPS, le chiffrement des conversations devient indisponible, sans avertissement.

## Développement

| Commande | Port | Rôle |
| :-- | --: | :-- |
| `npm run dev` | `5273` | Vite, relais `/ollama/*` vers `127.0.0.1:11434` |
| `npm run build` | — | `tsc -b && vite build` |
| `node server.mjs` | `5300` | Production : statique + relais Ollama et Hugging Face |

### Routes

`/` accueil · `/c/<uuid>` conversation · `/settings` · `/presets`

L'UUID est attribué à l'envoi du premier message. Un identifiant inconnu renvoie une 404 — aucune conversation fantôme.

<details>
<summary>Architecture</summary>

```
src/lib/          types, client Ollama (NDJSON), IndexedDB, routeur, entropie
src/store/        interface, génération, inventaire des modèles, diffusion
src/components/   layout · chat · models · settings · ui
server.mjs        statique + relais Ollama et Hugging Face
server/           magasin Ollama, mémoire système, installation, mises à jour
scripts/          bootstrap · supervision · bundle macOS · worker d'images
```

Les conversations vivent dans IndexedDB (`ollama-studio`). Le streaming passe par un magasin séparé : les jetons ne touchent le disque qu'une fois la réponse terminée.

Les images occupent une table à part. Le serveur n'est qu'un sas — une image produite est récupérée par l'application puis effacée du disque, sans quoi le chiffrement des conversations verrouillées n'aurait aucun sens.

</details>

<details>
<summary>Direction visuelle</summary>

Sombre uniquement. Blanc cassé et bleu nuit anthracite, un seul accent. Trois rayons (pilule, 18 px, 10 px), trois graisses (400 · 500 · 700), huit tailles. Typographie Satoshi, icônes lucide.

</details>

## Licence

MIT — Maxime Claude
