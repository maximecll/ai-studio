# Studio — interface locale pour Ollama

Une interface privée pour discuter avec vos modèles Ollama : conversations
persistantes, réglages d'inférence complets, gestion des modèles.
Tout reste sur la machine — aucune donnée ne sort du navigateur.

## Démarrer

Double-cliquez sur **Studio.app** (dans `~/Applications`). Il démarre Ollama,
construit l'interface si nécessaire, lance le serveur local et ouvre
l'application dans une fenêtre dédiée.

Pour (re)créer le lanceur après un changement de machine ou de version de Node :

```bash
bash scripts/install-app.sh
```

## Développement

```bash
npm run dev
```

Le serveur de développement écoute sur `http://localhost:5273` et relaie
`/ollama/*` vers `http://127.0.0.1:11434` — aucune configuration CORS n'est
nécessaire côté Ollama.

L'application de production, elle, écoute sur le port **5300** (`node server.mjs`).

## Adressage

Chaque conversation porte un UUID attribué à l'envoi du premier message et
sert d'URL : `/c/<uuid>`. Un identifiant inconnu ou mal formé renvoie une
page 404 — aucune conversation fantôme n'est créée. L'accueil (`/`) est une
page à part entière : on y écrit, la conversation naît ensuite.

## Ce que ça fait

- **Conversations** — création, renommage (double-clic), épinglage, duplication,
  recherche plein texte, export Markdown ou JSON, import de sauvegarde.
  Titres générés automatiquement par le modèle après le premier échange.
- **Réglages d'inférence** — température, top-p, top-k, min-p, pénalité et
  fenêtre de répétition, taille de contexte, longueur de réponse, graine,
  séquences d'arrêt, mirostat, mode réflexion. Par conversation.
- **Presets** — instructions système et paramètres enregistrés, applicables
  en un clic, avec modèle associé facultatif.
- **Modèles** — recherche intégrée sur **Hugging Face** (dépôts GGUF, triés par
  popularité) avec le choix de la quantisation et son poids réel, bibliothèque
  Ollama en accès direct, ou référence collée telle quelle. Téléchargement avec
  progression globale, débit et temps restant, annulable. Suppression,
  libération de la mémoire, capacités et taille de contexte.
- **Mesures d'incertitude** — Ollama renvoie les log-probabilités : Studio
  calcule l'entropie de Shannon par jeton sur la distribution top-8 (H₈, en
  bits), la perplexité et la confiance moyenne. S'y ajoutent le débit, la
  latence du premier jeton, la durée totale et la jauge de contexte.
- **Vues de transcription** — trois modes par conversation, via le menu « … » :
  *Normale* (raisonnement replié), *Réflexion* (raisonnement ouvert, réponse
  repliée), *Détaillée* (tout déplié, mesures affichées en permanence).
- **Mémoire de conversation** — au-delà de 72 % du contexte, les échanges
  anciens sont fondus dans un mémo Markdown à sections fixes puis « repliés » :
  ils restent en base et consultables d'un clic, mais laissent la place dans la
  fenêtre. Le mémo est lisible et modifiable à la main.
- **Génération d'images** — FLUX.1, en local, dans le fil de conversation.
  Une bascule texte/image dans le composeur ; format et définition réglables là
  où l'on écrit, pas de débruitage, guidage et graine dans le panneau. Pendant
  le calcul, une mosaïque se subdivise puis révèle l'image. Les images sont
  rangées dans la base et chiffrées comme le texte si la conversation est
  verrouillée. Voir plus bas.
- **Raccourcis** — ⌘K palette de commandes, ⌘N nouvelle conversation,
  ⌘B barre latérale, ⌘I paramètres, ⌘, réglages, Échap arrête la génération.

## Génération d'images

Ollama est un moteur de modèles de langage : il ne sait pas faire de diffusion.
Studio s'appuie donc sur **[mflux](https://github.com/filipstrand/mflux)**, le
portage MLX de FLUX, qui tourne nativement sur la puce Apple.

L'installation se fait depuis l'application, page **Modèles** → *Génération
d'images*. Elle crée un environnement Python dédié (`.venv-images`, ≈ 2 Go) sans
rien toucher au système, puis télécharge les poids du modèle choisi.

| Modèle | Poids | Pas | 1024² sur M3 16 Go |
|---|---|---|---|
| FLUX.1 dev · 4 bits | 9,6 Go | 20 | ≈ 15 min |
| FLUX.1 schnell · 4 bits | 9,6 Go | 4 | ≈ 4 min |
| FLUX.1 dev · 8 bits | 18 Go | 20 | plus lent encore |

Mesuré : 27 s par pas à 768², pic mémoire 8,0 Go. Le temps suit la surface de
l'image, d'où le réglage de **définition** (Aperçu 640² · Standard 1024² ·
Détail 1280²), qui est le levier le plus efficace. L'estimation affichée dans
l'interface est calculée sur ces mesures.

Les dépôts de Black Forest Labs sont sous licence à acceptation préalable
(`gated`) et répondent 401 sans jeton Hugging Face ; le catalogue passe donc par
les redistributions déjà quantifiées pour mflux — mêmes poids, trois fois moins
à télécharger. **FLUX.1 dev est sous licence non commerciale**, schnell sous
Apache 2.0.

Le disque paie deux fois : les poids, plus un cache de morceaux Xet
(≈ 10 Go) que le pied de page du panneau permet de vider.

## Toujours disponible, même hors ligne

```bash
bash scripts/install-daemons.sh
```

Installe deux agents de session : Ollama et le serveur Studio démarrent à
l'ouverture de session et redémarrent s'ils tombent. Plus rien à lancer, et
aucune connexion réseau n'est nécessaire. Pour retirer : `--uninstall`.

## Accès depuis le réseau local ou l'extérieur

- `deploy/RESEAU-LOCAL.md` — nom local sur la box, avec HTTPS. **À lire** :
  sans contexte sécurisé, les navigateurs coupent WebCrypto, donc le
  chiffrement.
- `deploy/TUNNEL.md` — accès depuis l'extérieur. En résumé : tunnel Cloudflare vers le port 5300,
**avec une politique Cloudflare Access devant**. Studio n'a pas
d'authentification : exposer le tunnel sans portail d'identité livre l'API
Ollama à quiconque devine le sous-domaine.

## Architecture

```
src/
  lib/        types, client Ollama (NDJSON), base IndexedDB, routeur, entropie,
              client du moteur d'images
  store/      état d'interface, moteur de génération, inventaire des modèles,
              tâches de diffusion
  components/ layout · chat · models · settings · ui
server.mjs    serveur de production : statique + relais Ollama et Hugging Face
server/       modules serveur : entretien du magasin Ollama, mémoire système,
              moteur d'images
scripts/      icône et bundle macOS · flux_worker.py (ouvrier de diffusion)
```

Les conversations vivent dans IndexedDB (`ollama-studio`). Le streaming passe
par un magasin séparé : les jetons ne touchent le disque qu'une fois la réponse
terminée, et les rendus sont regroupés par frame.

Les images sont rangées dans une table à part, pour qu'une liste de messages
reste légère. Le serveur n'est qu'un sas : dès qu'une image est produite, elle
est récupérée par l'application puis effacée du disque — sans quoi le
chiffrement des conversations verrouillées n'aurait aucun sens.

## Direction visuelle

Blanc cassé neutre et bleu nuit anthracite, un seul accent employé avec
parcimonie. Trois rayons (pilule pour les actions, 18px pour les cartes, 10px
pour les lignes), trois graisses (400 · 500 · 700), huit tailles de texte,
icônes exclusivement lucide. Le mode sombre reprend les mêmes rôles, pas une
palette parallèle.
