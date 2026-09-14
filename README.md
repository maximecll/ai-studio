<h1 align="center">AI Studio</h1>

<p align="center">
  Un laboratoire d'IA <strong>entièrement local</strong> : conversations, réglages
  d'inférence, bibliothèque de modèles et génération d'images.<br>
  Aucun compte, aucun cloud, aucune donnée qui sort de la machine.
</p>

<p align="center">
  <img alt="macOS · Windows · Linux" src="https://img.shields.io/badge/macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-1f2937">
  <img alt="Ollama" src="https://img.shields.io/badge/moteur-Ollama-1f2937">
  <img alt="Hors ligne" src="https://img.shields.io/badge/hors%20ligne-oui-16a34a">
  <img alt="Licence MIT" src="https://img.shields.io/badge/licence-MIT-1f2937">
</p>

---

## Démarrer

```bash
git clone https://github.com/maximecll/ai-studio.git
```

Puis **double-cliquez** sur le lanceur de votre système :

| Système | Fichier à ouvrir |
| :-- | :-- |
| 🍎 macOS | `Lancer AI Studio.command` |
| 🪟 Windows | `Lancer AI Studio.bat` |
| 🐧 Linux | `lancer-ai-studio.sh` |

> [!NOTE]
> Pas une ligne de commande à taper ensuite. **Node.js** et **Ollama** sont
> téléchargés automatiquement s'ils manquent, en archives portables dans
> `.runtime` : aucun droit administrateur, aucun `PATH` modifié. Supprimer ce
> dossier efface tout.

Au premier lancement, un didacticiel vous accueille et la page **Modèles**
détecte votre carte graphique pour vous proposer ce qui tient en mémoire.

<details>
<summary><strong>Options supplémentaires</strong></summary>

| Commande | Effet |
| :-- | :-- |
| `bash scripts/install-app.sh` | Application double-cliquable sur le Bureau (macOS) |
| `bash scripts/install-daemons.sh` | Ollama + serveur démarrés à l'ouverture de session, relancés s'ils tombent |
| `bash scripts/install-daemons.sh --uninstall` | Retire ces agents |

</details>

---

## Ce que ça fait

| | |
| :-- | :-- |
| 💬 **Conversations** | Renommage, épinglage, duplication, recherche plein texte, export Markdown/JSON, import. Titres générés par le modèle. |
| 🎛️ **Réglages d'inférence** | Température, top-p/k, min-p, pénalités, contexte, graine, mirostat, mode réflexion — par conversation. |
| 📚 **Presets** | Instructions système et paramètres enregistrés, applicables en un clic. |
| 📦 **Modèles** | Recherche Hugging Face (GGUF, par popularité) et bibliothèque Ollama. Téléchargement avec débit et temps restant, annulable. |
| 🖼️ **Images** | FLUX.1 en local, dans le fil de conversation. |
| 🔐 **Chiffrement** | Conversations verrouillables, chiffrées au repos (AES-GCM). |
| 📊 **Mesures** | Entropie par jeton, perplexité, confiance, débit, latence, jauge de contexte. |
| 🧠 **Mémoire** | Au-delà de 72 % du contexte, les vieux échanges sont fondus dans un mémo Markdown modifiable. |

<details>
<summary><strong>Vues de transcription</strong></summary>

Trois modes par conversation, via le menu « … » :

| Mode | Raisonnement | Réponse |
| :-- | :-- | :-- |
| Normale | replié | dépliée |
| Réflexion | ouvert | repliée |
| Détaillée | ouvert | dépliée, mesures visibles |

</details>

<details>
<summary><strong>Raccourcis clavier</strong></summary>

| Touches | Action |
| :-- | :-- |
| `⌘K` | Palette de commandes |
| `⌘N` | Nouvelle conversation |
| `⌘B` | Barre latérale |
| `⌘I` | Paramètres de la conversation |
| `⌘,` | Réglages |
| `Échap` | Arrêter la génération |

</details>

---

## Génération d'images

Ollama ne fait pas de diffusion : AI Studio s'appuie sur
**[mflux](https://github.com/filipstrand/mflux)**, le portage MLX de FLUX, qui
tourne nativement sur puce Apple. Installation depuis la page **Modèles →
Génération d'images** : un environnement Python dédié (`.venv-images`, ≈ 2 Go)
est créé sans rien toucher au système.

| Modèle | Poids | Pas | 1024² sur M3 16 Go |
| :-- | --: | --: | :-- |
| FLUX.1 schnell · 4 bits | 9,6 Go | 4 | ≈ 4 min |
| FLUX.1 dev · 4 bits | 9,6 Go | 20 | ≈ 15 min |
| FLUX.1 dev · 8 bits | 18 Go | 20 | plus lent encore |

Mesuré : **27 s par pas à 768²**, pic mémoire 8,0 Go. Le temps suit la surface
de l'image — la **définition** (Aperçu 640² · Standard 1024² · Détail 1280²)
est donc le levier le plus efficace.

> [!IMPORTANT]
> **FLUX.1 dev est sous licence non commerciale**, schnell sous Apache 2.0.
> Le disque paie deux fois : les poids, plus un cache Xet (≈ 10 Go) que le pied
> de page du panneau permet de vider.

---

## Sécurité

> [!WARNING]
> AI Studio n'a **aucune authentification** : il est prévu pour tourner sur
> votre machine. Servi sur le réseau (`HOST=0.0.0.0 node server.mjs`), toute
> personne sur ce réseau y accède — et l'API Ollama avec. Jamais sur internet
> sans portail d'identité devant.

> [!CAUTION]
> Les navigateurs réservent WebCrypto aux contextes sécurisés. Sur `localhost`
> tout fonctionne, mais servi à d'autres appareils **sans HTTPS**, le
> chiffrement des conversations devient indisponible sans le moindre
> avertissement.

---

## Développement

| Commande | Port | Rôle |
| :-- | --: | :-- |
| `npm run dev` | `5273` | Vite, relais `/ollama/*` → `127.0.0.1:11434` |
| `npm run build` | — | `tsc -b && vite build` |
| `node server.mjs` | `5300` | Production : statique + relais Ollama et Hugging Face |

**Adressage** — chaque conversation porte un UUID attribué à l'envoi du premier
message et sert d'URL (`/c/<uuid>`). Un identifiant inconnu renvoie une 404 :
aucune conversation fantôme. L'accueil `/` est une page à part entière — on y
écrit, la conversation naît ensuite. Réglages sur `/settings`, presets sur
`/presets`.

<details>
<summary><strong>Architecture</strong></summary>

```
src/
  lib/        types, client Ollama (NDJSON), IndexedDB, routeur, entropie,
              client du moteur d'images
  store/      interface, moteur de génération, inventaire des modèles,
              tâches de diffusion
  components/ layout · chat · models · settings · ui
server.mjs    production : statique + relais Ollama et Hugging Face
server/       magasin Ollama, mémoire système, installation, moteur d'images
scripts/      bootstrap · bundle macOS · flux_worker.py
```

Les conversations vivent dans IndexedDB (`ollama-studio`). Le streaming passe
par un magasin séparé : les jetons ne touchent le disque qu'une fois la réponse
terminée, et les rendus sont regroupés par frame.

Les images sont rangées dans une table à part pour qu'une liste de messages
reste légère. Le serveur n'est qu'un sas : une image produite est récupérée par
l'application puis effacée du disque — sans quoi le chiffrement des
conversations verrouillées n'aurait aucun sens.

</details>

<details>
<summary><strong>Direction visuelle</strong></summary>

Interface **sombre uniquement**. Blanc cassé neutre et bleu nuit anthracite, un
seul accent employé avec parcimonie. Trois rayons (pilule pour les actions,
18 px pour les cartes, 10 px pour les lignes), trois graisses (400 · 500 · 700),
huit tailles de texte. Typographie **Satoshi**, icônes **lucide** exclusivement.

</details>

---

<p align="center"><sub>MIT · Maxime Claude</sub></p>
