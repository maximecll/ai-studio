#!/bin/bash
# Démarrage d'AI Studio — macOS et Linux.
#
# Objectif : un double-clic depuis un dépôt fraîchement cloné, et rien d'autre.
# Pas de terminal à ouvrir, pas de commande à taper, pas de mot de passe.
#
# Node.js est la seule dépendance de démarrage. S'il manque, on ne demande pas
# à l'utilisateur de l'installer : on récupère l'archive officielle dans un
# sous-dossier du projet. Aucun droit administrateur, aucun PATH modifié, rien
# qui déborde sur le reste de la machine — et `rm -rf` du dossier suffit à
# tout effacer.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

NODE_VERSION="22.12.0"
RUNTIME="$ROOT/.runtime"
PORT="${PORT:-5300}"
URL="http://127.0.0.1:$PORT"

# ── Présentation ──────────────────────────────────────────────────────
bold=$'\033[1m'; dim=$'\033[2m'; red=$'\033[31m'; green=$'\033[32m'; off=$'\033[0m'
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s▸ %s%s\n' "$bold" "$*" "$off"; }
note() { printf '%s  %s%s\n' "$dim" "$*" "$off"; }
die()  {
  printf '\n%s✗ %s%s\n\n' "$red" "$*" "$off"
  printf 'Fenêtre laissée ouverte pour que vous puissiez lire. Fermez-la quand vous voulez.\n'
  # Sans cette pause, un double-clic qui échoue referme la fenêtre aussitôt
  # et l'utilisateur ne voit jamais la raison.
  read -r _ 2>/dev/null || sleep 30
  exit 1
}

say "${bold}AI Studio${off}"
note "$ROOT"

# ── 1 ── Node.js ──────────────────────────────────────────────────────
platform() {
  case "$(uname -s)" in
    Darwin) printf 'darwin' ;;
    Linux)  printf 'linux' ;;
    *)      printf 'inconnu' ;;
  esac
}

architecture() {
  case "$(uname -m)" in
    arm64|aarch64) printf 'arm64' ;;
    x86_64|amd64)  printf 'x64' ;;
    *)             printf 'inconnu' ;;
  esac
}

# Node embarqué déjà présent ? Il prime, pour rester reproductible.
if [ -x "$RUNTIME/node/bin/node" ]; then
  export PATH="$RUNTIME/node/bin:$PATH"
fi

if command -v node >/dev/null 2>&1 && node -e 'process.exit(process.versions.node.split(".")[0] >= 20 ? 0 : 1)' 2>/dev/null; then
  note "Node.js $(node --version) — déjà présent"
else
  step "Installation de Node.js"
  os="$(platform)"; arch="$(architecture)"
  if [ "$os" = inconnu ] || [ "$arch" = inconnu ]; then
    die "Système non reconnu ($(uname -s) $(uname -m)). Installez Node.js 20 ou plus depuis nodejs.org, puis relancez."
  fi

  ext="tar.gz"; [ "$os" = linux ] && ext="tar.xz"
  name="node-v$NODE_VERSION-$os-$arch"
  note "$name — environ 50 Mo, dans ./.runtime (rien en dehors du projet)"

  mkdir -p "$RUNTIME" || die "Impossible d'écrire dans $RUNTIME"
  if ! curl -fL --progress-bar "https://nodejs.org/dist/v$NODE_VERSION/$name.$ext" -o "$RUNTIME/node.$ext"; then
    die "Téléchargement de Node.js impossible. Vérifiez votre connexion, puis relancez."
  fi

  rm -rf "$RUNTIME/node"
  mkdir -p "$RUNTIME/node"
  tar -xf "$RUNTIME/node.$ext" -C "$RUNTIME/node" --strip-components=1 \
    || die "Archive Node.js illisible. Supprimez le dossier .runtime et relancez."
  rm -f "$RUNTIME/node.$ext"

  export PATH="$RUNTIME/node/bin:$PATH"
  command -v node >/dev/null 2>&1 || die "Node.js installé mais introuvable. Signalez-le."
  note "Node.js $(node --version) installé"
fi

# npm relance node via `#!/usr/bin/env node` : son dossier doit rester en tête
# du PATH, sinon il ne retrouve pas son propre interpréteur.
export PATH="$(dirname "$(command -v node)"):$PATH"

# ── 2 ── Dépendances ──────────────────────────────────────────────────
if [ ! -d node_modules ]; then
  step "Installation des dépendances"
  note "Quelques minutes la première fois, puis jamais plus."
  npm install --no-audit --no-fund || die "npm install a échoué. Faites défiler pour voir la cause."
fi

# ── 3 ── Interface ────────────────────────────────────────────────────
# On reconstruit seulement si les sources ont bougé depuis le dernier build :
# le démarrage quotidien reste instantané.
needs_build=0
[ -f dist/index.html ] || needs_build=1
if [ "$needs_build" = 0 ] && [ -n "$(find src index.html package.json vite.config.ts -newer dist/index.html -print -quit 2>/dev/null)" ]; then
  needs_build=1
fi
if [ "$needs_build" = 1 ]; then
  step "Construction de l'interface"
  npm run build || die "La construction a échoué. Faites défiler pour voir la cause."
fi

# ── 4 ── Git ──────────────────────────────────────────────────────────
# Non bloquant : l'application tourne sans git, mais ne peut plus se mettre à
# jour. Mieux vaut le dire au démarrage qu'après des mois de retard.
if ! command -v git >/dev/null 2>&1; then
  note "git est introuvable — les mises à jour seront indisponibles."
  note "Installez-le depuis https://git-scm.com/downloads, puis relancez."
fi

# ── 5 ── Serveur ──────────────────────────────────────────────────────
listening() { curl -fsS --max-time 2 "$URL" >/dev/null 2>&1; }

if listening; then
  note "AI Studio tourne déjà sur $URL"
else
  step "Démarrage du serveur"
  # Le contrôle de tâches donne à la boucle son propre groupe de processus :
  # `kill -- -$SERVER` emporte alors le node qu'elle a lancé.
  set -m
  (
    while :; do
      AI_STUDIO_SUPERVISED=1 node server.mjs
      # 75 : le serveur vient d'appliquer une mise à jour et veut repartir.
      [ $? -eq 75 ] || break
      printf '\n▸ Mise à jour appliquée — redémarrage\n'
    done
  ) &
  SERVER=$!
  set +m
  # Le serveur meurt avec cette fenêtre : fermer la fenêtre arrête tout.
  trap 'kill -- -"$SERVER" 2>/dev/null; kill "$SERVER" 2>/dev/null; exit 0' EXIT INT TERM
  for _ in $(seq 1 60); do listening && break; sleep 0.5; done
  listening || die "Le serveur n'a pas démarré."
fi

# ── 6 ── Navigateur ───────────────────────────────────────────────────
step "Ouverture de $URL"
case "$(platform)" in
  darwin) open "$URL" >/dev/null 2>&1 ;;
  linux)  (xdg-open "$URL" >/dev/null 2>&1 &) ;;
esac

printf '\n%s✓ AI Studio est ouvert dans votre navigateur.%s\n\n' "$green" "$off"
note "Fermez cette fenêtre pour arrêter AI Studio."

# `wait` plutôt qu'un `sleep` bloquant : bash diffère les signaux tant qu'une
# commande de premier plan tourne, et le nettoyage ne partirait jamais.
while :; do sleep 3600 & wait $!; done
