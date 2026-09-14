#!/bin/bash
# Double-cliquez ce fichier depuis le Finder.
# Le Finder démarre dans le dossier personnel : on se replace d'abord ici.
cd "$(dirname "$0")" || exit 1
exec bash scripts/bootstrap.sh
