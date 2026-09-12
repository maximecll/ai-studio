# Plan de travail

Tenu à jour à chaque échange. Ce qui est demandé entre ici, et on avance dans
l'ordre.

## Corrigé à l'instant

- [x] Composeur coupé en bas — l'animation de vue translatait la colonne
      pleine hauteur hors du châssis. Opacité seule désormais.
- [x] Responsive — barre latérale en superposition sous 900 px, bouton d'envoi
      qui ne déborde plus, puces tronquées au lieu de dépasser.
- [x] Mesures (débit, sortie, latence, total) au survol uniquement, en même
      temps que les icônes, dans toutes les vues.
- [x] Vue « normale » qui ne repliait pas le raisonnement, et bascule de vue
      sans effet sur les messages déjà affichés. Deux causes : l'état n'était
      pas resynchronisé, et `AnimatePresence` ne retirait pas l'enfant faute de
      clé explicite.
- [x] Menu déroulant des modèles inopérant — un `overflow-hidden` ajouté pour
      le responsive rognait le panneau.
- [x] Dernier `<select>` natif remplacé par un menu maison.
- [x] Alignement des cartes de modèles : en-tête et zone de badges à hauteur
      réservée, pied collé en bas, quel que soit le nombre de badges.
- [x] Composeur coupé en fenêtre réduite, vue détaillée — `min-height: auto`
      empêchait la colonne de conversation de se contraindre à son parent.
      Chaîne de colonnes flex verrouillée (`min-h-0` + `overflow-hidden`).

## Corrigé — réponses coupées et sélection de modèle

- [x] `time: missing unit in duration "-1"` — le réglage « Jamais » envoyait
      `keep_alive` en chaîne ; Ollama l'analyse avec le parseur de durées de Go,
      qui refuse « -1 ». Les valeurs numériques partent désormais en nombre.
- [x] Modèle choisi réécrasé par le défaut — l'inventaire est rafraîchi toutes
      les 15 s et l'effet de la page d'accueil se redéclenchait à chaque
      sondage. La sélection n'est plus remplacée que si le modèle a disparu.
      L'inventaire conserve aussi sa référence quand rien n'a changé.
- [x] Contexte adapté au modèle à la création (jusqu'à 16 384 au lieu de 8 192),
      et ramené dans ses bornes quand on change de modèle.
- [x] Réponse tronquée : bandeau explicite et bouton « Continuer » qui recolle
      la suite au même message.

## Contexte et mémoire — mesuré sur la machine

- [x] Plafond de contexte porté de 16 384 à 32 768 (mesures ci-dessous).
- [x] Estimation d'empreinte mémoire dans le panneau Paramètres, calculée depuis
      les métadonnées GGUF : `2 × couches × têtes KV × dimension × 2 octets`.
      Prédit 57 Mo par millier de jetons, 58 constatés.

Relevés sur MacBook Pro M3 / 16 Go (plafond GPU ≈ 12 Go) :

| Modèle | 4 096 | 16 384 | 32 768 | 65 536 |
|---|---|---|---|---|
| Qwen2.5-Coder 7B Q4 | 4,74 Go | 5,46 Go | 6,41 Go | — (max du modèle) |
| Qwen3.8 9B NVFP4 | 5,74 Go | 6,17 Go | 6,79 Go · 8,2 jet./s | bascule CPU · 2,2 jet./s |

## Chiffrement au repos — fait

- [x] Clé maîtresse aléatoire, scellée par une clé dérivée de la phrase de
      passe. PBKDF2-SHA256 à **4 000 000 d'itérations**, calibré sur la machine
      (le M3 accélère SHA-256 : les 600 000 recommandés ne prenaient que 51 ms,
      soit une protection illusoire). Compte mémorisé dans le coffre pour
      pouvoir être relevé plus tard.
- [x] Verrouillage par conversation : titre, instructions, mémoire, messages et
      raisonnements chiffrés en AES-GCM. Le reste demeure en clair et cherchable.
- [x] Coffre fermé : le titre devient « Conversation verrouillée », les contenus
      restent opaques, la recherche ne les traverse plus.
- [x] Clé en mémoire seulement — perdue au rechargement, et fermeture
      automatique après quinze minutes sans activité (⌘⇧L pour fermer aussitôt).
- [x] Changement de phrase sans rechiffrer les conversations : seule l'enveloppe
      de la clé maîtresse est refaite.

## Génération et mémoire — ce tour

- [x] **Chien de garde sur le flux.** Un flux peut cesser d'émettre sans fermer
      la connexion : l'application attendait indéfiniment. Abandon automatique
      après 90 s de silence (180 s avant le premier fragment, le chargement d'un
      gros modèle étant long), avec conservation de ce qui a été produit.
- [x] **Compteur de jetons en direct** pendant la génération, réflexion comptée
      à part — Ollama émet un fragment par jeton.
- [x] **Jauge de contexte lisible et vivante.** Elle affichait 0 % : un échange
      sur 262 144 jetons s'arrondit à zéro. Elle montre désormais des jetons
      (« 12,4 k / 262 k »), flux en cours compris.
- [x] **Avertissement mémoire.** Le serveur relève `vm_stat` et `sysctl` — le
      navigateur n'y a pas accès. Le panneau compare l'empreinte estimée à la
      mémoire réellement disponible et alerte avant que la machine ne bascule
      sur le disque.
- [x] **Conversation verrouillée, coffre fermé** : plus de bloc chiffré affiché
      à l'écran. Un panneau explique, ouvre la modale du coffre de lui-même,
      retire le composeur et le panneau de paramètres.

## En cours

- [ ] **Déverrouillage par Touch ID** — l'authentificateur de plateforme est
      disponible sur cette machine ; reste à vérifier la prise en charge de
      l'extension PRF de WebAuthn, qui permet de sceller la clé maîtresse
      derrière l'Enclave sécurisée. La phrase de passe resterait le recours.

## À faire — demandé au dernier échange

- [x] **Paramètres accessibles dès l'accueil.** Le panneau y agit sur les
      valeurs par défaut, qui deviennent celles de la conversation créée.
      L'Inspecteur est devenu pilotable par une cible générique, avec deux
      enveloppes : conversation ou valeurs par défaut. Le modèle choisi sur
      l'accueil est désormais celui des nouvelles conversations — une seule
      source, partagée avec le panneau.
- [x] Bascule de la barre latérale accessible partout. Elle n'existait que dans
      l'en-tête d'une conversation : repliée depuis l'accueil, l'écran Modèles
      ou une 404, on restait enfermé.

## À faire

- [ ] **Éprouver la mémoire sémantique sur une vraie conversation longue** — le
      mécanisme est écrit et branché, mais jamais vu tourner de bout en bout
      (le compactage exige un appel au modèle, lent sur la machine).
- [ ] **DNS local `lab.cm-it.fr`** — bail statique, entrée DNS sur la box,
      certificat `mkcert`. Marche à suivre écrite dans `deploy/RESEAU-LOCAL.md`,
      reste à exécuter. Sans HTTPS, pas de WebCrypto, donc pas de chiffrement.
- [ ] **Agents de session** — `bash scripts/install-daemons.sh` pour qu'Ollama
      et Studio démarrent à l'ouverture de session. Écrit, pas encore lancé
      (configuration persistante de la machine).
- [ ] **Pièces jointes** — le modèle installé sait lire les images ; le bouton
      trombone est en place mais inactif.

## Fait

- [x] Interface React + Tailwind, conversations persistantes (IndexedDB)
- [x] Direction visuelle : `#0C090A` / `#FEFEFA` uniformes, DM Sans 500/700,
      trois rayons, un seul accent employé avec parcimonie
- [x] Boutons animés : morph au survol, secousse, rotation
- [x] Badges à deux variantes (contour / fond teinté)
- [x] Routage par UUID, page d'accueil, 404 sur identifiant inconnu
- [x] Transcription éditoriale : utilisateur à droite, modèle à gauche
- [x] Trois vues de transcription — normale, réflexion, détaillée
- [x] Mesures d'incertitude réelles : H₈, perplexité, confiance (log-probabilités)
- [x] Mémoire sémantique : compactage à 72 % du contexte, mémo Markdown
      modifiable, messages repliés et consultables
- [x] Réglages d'inférence complets, presets, gestion des modèles
- [x] Recherche Hugging Face intégrée : dépôts GGUF, quantisations et poids
- [x] Téléchargements : progression globale, débit, temps restant, annulation
- [x] `Studio.app` sur le Bureau : instance unique, nettoyage à la fermeture
- [x] Serveur de production avec HTTPS facultatif, relais Ollama et Hugging Face
