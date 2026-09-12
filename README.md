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
- **Raccourcis** — ⌘K palette de commandes, ⌘N nouvelle conversation,
  ⌘B barre latérale, ⌘I paramètres, ⌘, réglages, Échap arrête la génération.

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
  lib/        types, client Ollama (NDJSON), base IndexedDB, routeur, entropie
  store/      état d'interface, moteur de génération, inventaire des modèles
  components/ layout · chat · models · settings · ui
server.mjs    serveur de production : statique + relais Ollama et Hugging Face
scripts/      génération de l'icône et du bundle macOS
```

Les conversations vivent dans IndexedDB (`ollama-studio`). Le streaming passe
par un magasin séparé : les jetons ne touchent le disque qu'une fois la réponse
terminée, et les rendus sont regroupés par frame.

## Direction visuelle

Blanc cassé neutre et bleu nuit anthracite, un seul accent employé avec
parcimonie. Trois rayons (pilule pour les actions, 18px pour les cartes, 10px
pour les lignes), trois graisses (400 · 500 · 700), huit tailles de texte,
icônes exclusivement lucide. Le mode sombre reprend les mêmes rôles, pas une
palette parallèle.
