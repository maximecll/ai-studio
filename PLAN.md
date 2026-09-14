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

## Lanceur — l'application ne démarrait plus après un redémarrage

`env: node: No such file or directory`, en fin de `dev.log`.

Node n'existe que dans nvm sur cette machine — ni Homebrew, ni `/usr/local/bin`.
Le lanceur figeait pourtant les chemins absolus de `node` et `npm` à
l'installation, ce qui semblait suffire. Ça ne l'était pas : `npm` est un lien
vers `npm-cli.js`, dont la première ligne est `#!/usr/bin/env node`. **npm
relance donc node lui-même, en le cherchant dans le PATH** — et une application
lancée depuis le Finder reçoit `/usr/bin:/bin:/usr/sbin:/sbin`, sans nvm.

Le défaut était là depuis toujours ; il ne s'était jamais manifesté parce que le
serveur avait toujours été lancé depuis un terminal, où nvm est chargé.

- [x] Le lanceur remet le dossier de Node en tête du PATH avant tout appel.
      Vérifié en reproduisant l'environnement exact du Finder (`env -i`).
- [x] Repli automatique : si le chemin figé a disparu (mise à jour nvm), Node est
      recherché dans les versions nvm — la plus récente d'abord —, Volta,
      Homebrew, `/usr/local/bin`. Vérifié avec un chemin volontairement cassé.
- [x] Les boîtes d'erreur citent les dernières lignes du journal au lieu de
      renvoyer à un fichier. Échappement AppleScript au passage : un extrait
      contenant un guillemet cassait la boîte au lieu de s'y afficher.
- [x] `install-app.sh` signale quand Node vient d'un gestionnaire de versions.

## Wan2.2 A14B et correction de la détection des LoRAs

Un relevé sur de vrais LoRAs A14B a révélé deux défauts dans ce que j'avais
construit.

- [x] **Convention kohya manquante.** Mes signatures ne connaissaient que
      `diffusion_model.blocks.` ; les LoRAs Wan entraînés à la main emploient
      `lora_unet_blocks_N_…`. Ces fichiers ressortaient sans famille reconnue.
      Le contrôle de largeur les rejetait quand même, mais par chance.
- [x] **Métadonnées trompeuses, deuxième cas.** Un LoRA Wan 5 B déclarait
      `sd_1.5`, un A14B déclare `wan2.1/lora`. L'architecture est désormais
      déduite des noms de tenseurs ; la déclaration n'est plus qu'une
      information grisée.
- [x] **Expert visé.** Wan2.2 A14B sépare le bruit élevé du bruit faible en deux
      transformeurs. Un adaptateur ne vaut que pour l'un des deux, et rien dans
      ses tenseurs ne le dit — seuls `ss_sd_model_name`, le titre ou le nom de
      fichier le trahissent. Détecté, affiché, et transmis à `loras_high` /
      `loras_low` plutôt qu'aux deux.
- [x] **Refus avant lancement.** Un adaptateur de la mauvaise famille ou de la
      mauvaise largeur est rejeté immédiatement, avec le chiffre exact. Sans ce
      contrôle, l'échec ne surviendrait qu'au chargement du transformeur, après
      deux minutes d'encodage du texte — et sous forme d'erreur de dimensions
      MLX, puisque le chargeur ne vérifie aucune forme.

Vérifié : un LoRA Wan sur un modèle FLUX et un LoRA FLUX sur le modèle Wan sont
tous deux refusés en 400 avec un message explicite ; un LoRA Wan sur le modèle
Wan est accepté.

### L'entrée A14B

`SceneWorks/wan2.2-t2v-a14b-mlx`, sous-dossier **q4** : 8,4 Go par expert, soit
**28,6 Go** au lieu de 42,7 en q8 — et le dépôt complet pèse 209 Go, d'où le
filtre `allow_patterns` qui ne récupère que la quantification retenue.

Largeur 5120 (contre 3072 pour le 5 B) : c'est ce qui sépare les deux modèles à
noms de couches identiques.

Non mesuré, et volontairement : deux experts de 8,4 Go sur 16 Go de mémoire
dépassent ce que cette machine peut tenir. L'entrée est marquée « Lourd », la
note le dit franchement.

## Wan2.2 en génération d'images — fait

Wan2.2 est un modèle vidéo. Réglé sur une seule image (`--num-frames 1`, la
contrainte 4n+1 étant satisfaite par n = 0), il rend une image fixe. J'avais
d'abord écarté la piste ; c'était une erreur.

Le moteur est **[mlx-video](https://github.com/Blaizzy/mlx-video)** — MLX natif,
Apple Silicon, MIT. Pas de ComfyUI, pas de PyTorch à l'exécution. Installé dans
le même environnement que mflux après vérification qu'aucune dépendance n'était
déclassée.

- [x] Septième entrée du catalogue, avec un `runner` distinct : c'est le seul
      point où les deux moteurs diffèrent.
- [x] Le worker route la famille vers `generate_video()`, extrait la première
      image du mp4, et traduit la barre tqdm en pas NDJSON — même progression
      que pour mflux.
- [x] LoRAs Wan transmis à `generate_video()`, qui les accepte nativement.
- [x] Coût fixe par modèle en plus du coût par pas : les deux moteurs n'ont pas
      le même profil, une estimation unique aurait menti sur l'un ou l'autre.

Mesuré deux fois, 768², 6 pas, q8 :

| Étape | 1ᵉʳ passage | 2ᵉ passage |
|---|---|---|
| Encodage UMT5-XXL | 164,8 s | **123,5 s** |
| Chargement du transformeur | 1,7 s | 1,9 s |
| Débruitage (6 pas) | 28,2 s | 27,2 s → **4,5 s/pas** |
| Décodage VAE | 18,1 s | 18,8 s |
| **Total** | 214,7 s | **172,3 s** |

L'écart entre les deux passages est le tokenizer, téléchargé la première fois.

**Le débruitage est six fois plus rapide que FLUX** — 4,5 s contre 27 s par pas
à la même taille. La séquence latente ne fait que 576 jetons contre 2 304 : le
VAE de Wan compresse bien davantage. Tout le coût est dans l'encodeur de texte,
onze milliards de paramètres chargés puis relâchés à chaque génération.

Net en 1024², 20 pas : **≈ 5 min contre ≈ 15 min pour FLUX.1 dev**.

### Hors ligne

- [x] Vérifié avec `HF_HUB_OFFLINE=1` : le tokenizer UMT5 (21 Mo) se charge
      depuis le cache, sans réseau. Le bouton « vider le cache de transfert »
      ne touche que le cache Xet, pas celui-là.

## LoRAs et bibliothèque de modèles d'images — fait

- [x] **Bibliothèque de LoRAs** : un dossier, `~/.studio/loras`. On y dépose des
      `.safetensors`, l'application les lit. Pas de base, pas d'import.
      L'en-tête safetensors donne le titre, l'architecture, le rang et le mot
      déclencheur — le reste des métadonnées (parfois huit mille mots de journal
      d'entraînement) est ignoré.
- [x] **Choix par conversation** : les réglages de diffusion descendent au niveau
      de la conversation, comme ceux du modèle de langage. Changer de format ou
      de LoRA dans un fil ne touche plus aux autres.
- [x] Adaptateurs appliqués **à l'exécution** plutôt que fondus dans les poids.
      Fusionner obligerait mflux à déquantifier puis requantifier en 8 bits les
      couches touchées — un delta de rang faible passe sous le pas d'un q4 — et
      la mémoire grimperait d'autant.
- [x] Compatibilité vérifiée **par famille** : un LoRA FLUX affiché sur Z-Image
      est signalé avant la génération. Si aucune couche n'est adaptée, un
      avertissement le dit — sans quoi l'image sortirait identique au modèle nu,
      sans explication.
- [x] LoRAs consignés dans les métadonnées de l'image, avec la graine : c'est ce
      qui la rend reproductible.

Mesuré : FLUX.1 dev 4 bits, 640², 8 pas, même graine.

| | durée | pic mémoire |
|---|---|---|
| sans LoRA | 124,5 s | 8,16 Go |
| avec LoRA | 144,8 s | 8,04 Go |

912 clés sur 1128 appliquées à 494 couches. Les 216 restantes visaient
l'encodeur de texte, que mflux n'adapte pas — l'effet est donc un peu plus
faible que sous ComfyUI.

### Catalogue élargi

Les familles mflux partagent le même constructeur et la même signature de
génération : un aiguillage suffit. Ajoutés, sans rien télécharger :

| Modèle | Poids | Pas | 1024² |
|---|---|---|---|
| Z-Image Turbo | 5,9 Go | 8 | ~4 min · estimé |
| FLUX.2 Klein 4B | 4,6 Go | 4 | ~2 min · estimé |
| Krea 2 Turbo | 15,8 Go | 8 | ~7 min · estimé |

Les estimations non chronométrées sont marquées « estimé » : elles viennent du
nombre de paramètres, pas d'une mesure.

### Téléchargements visibles, d'où qu'ils viennent

- [x] Le serveur repère un transfert aux fichiers `.incomplete` laissés par
      huggingface_hub, et à leur date de modification. Un téléchargement lancé
      hors de l'application, ou survivant à son redémarrage, s'affiche donc
      quand même — avec reprise possible s'il a été interrompu.

## Génération d'images — fait

Ollama est un moteur de modèles de langage : il ne sait pas faire de diffusion.
FLUX passe donc par **mflux**, le portage MLX de FLUX, qui tourne nativement sur
la puce Apple. Studio l'installe, le pilote et range ses images.

- [x] `scripts/flux_worker.py` — ouvrier Python. Trois commandes (`info`, `pull`,
      `generate`), tâche en JSON sur l'entrée standard, compte rendu en NDJSON.
      Le descripteur 1 est redirigé vers stderr dès le démarrage : la sortie
      standard ne transporte que du NDJSON, quoi qu'écrivent les bibliothèques.
- [x] `server/images.mjs` — routes `/images/{status,install,pull,generate,cancel,remove,file}`.
      Une seule génération à la fois : deux modèles de 10 Go se disputeraient la
      mémoire. Fermer l'onglet coupe le processus.
- [x] Installation du moteur depuis l'application : environnement Python dédié
      (`.venv-images`), sans rien toucher au système.
- [x] Téléchargement des poids avec progression, débit et temps restant — même
      grammaire que les téléchargements Ollama.
- [x] Catalogue : FLUX.1 dev en 4 et 8 bits, FLUX.1 schnell en 4 bits. Les dépôts
      de Black Forest Labs sont sous licence à acceptation préalable (401 sans
      jeton) ; on passe par les redistributions déjà quantifiées, trois fois plus
      légères à télécharger.
- [x] Animation de révélation (`GridReveal`, rareui.com) — reprise telle quelle,
      aux imports et aux couleurs près. La mosaïque tient la place de l'image
      puis la révèle, d'un seul tenant : le message définitif ne prend le relais
      qu'une fois l'animation jouée, sur la même image déjà chargée.
- [x] Bascule texte / image dans le composeur et sur l'accueil, mémorisée par
      conversation.
- [x] Format et définition comme réglages distincts : changer de format ne change
      rien au temps de calcul, doubler la définition le quadruple.
- [x] Réglages fins (modèle, pas, guidage, graine) dans le panneau Paramètres.
- [x] Images chiffrées au repos comme le texte, dès que la conversation est
      verrouillée. Le serveur n'est qu'un sas : les octets sont récupérés puis
      effacés du disque.
- [x] Actions au survol : copier, enregistrer, régénérer (nouvelle graine),
      supprimer. Mesures : taille, pas, guidage, graine, durée, poids.

### Ce que ça coûte sur cette machine — mesuré

MacBook Pro M3, 16 Go. FLUX.1 dev en 4 bits, 768 × 768, 12 pas :
**407 s**, soit ≈ 27 s par pas, pic mémoire **8,0 Go**.

Le temps suit la surface de l'image. Pour FLUX.1 dev :

| Définition | 8 pas | 20 pas |
|---|---|---|
| Aperçu 640² | ≈ 3 min | ≈ 7 min |
| Standard 1024² | ≈ 7 min | ≈ 15 min |
| Détail 1280² | ≈ 11 min | ≈ 25 min |

Ce n'est pas un défaut de réglage : FLUX.1 dev est un transformeur de 12
milliards de paramètres, et le GPU du M3 est à sa limite. Le gardien mémoire
(libération des encodeurs de texte après l'encodage, décodage du VAE par tuiles)
fait passer de 31 à 27 s par pas — utile, mais il ne change pas l'ordre de
grandeur.

**FLUX.1 schnell** est le vrai levier : distillé, il travaille en 4 pas au lieu
de 20, soit environ **4 min en 1024²** — ou **1 min 30 en 640²**. Un cran en
dessous en finesse, cinq fois plus rapide. Il est dans le catalogue, à un clic.

### Reste à faire

- [ ] Image d'entrée (img2img) et retouche par description — mflux sait le faire
      (`image_path`, `image_strength`, variante Kontext), l'interface pas encore.
- [ ] Les images ne partent pas dans la sauvegarde JSON : elle ne transporte que
      du texte. À reprendre si la sauvegarde doit être complète.

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

## Recopie après changement de modèle

Signalé : recoller dans une conversation le prompt qu'un premier modèle venait
de produire fait que le second le recrache mot pour mot au lieu de l'exécuter.

Mesuré contre Ollama, hors application :

| Situation | Recopie |
|---|---|
| Prompt seul, conversation neuve | non — réponse correcte |
| Même texte présent comme réponse précédente | **oui** |
| + consigne système courte | oui |
| + consigne système explicite | oui |
| + consigne placée en fin de contexte | oui |
| + consigne accolée au message | oui |

Conclusion : effet de complétion de motif, **insensible à toute consigne**.
Seul un contexte vierge y échappe. La note de relais que j'avais ajoutée a donc
été retirée plutôt que livrée.

- [x] Action « Rejouer seul, dans une conversation neuve » sur les messages
      utilisateur : même modèle, mêmes réglages, historique vierge.
- [x] Détection au moment de l'envoi : si le texte reprend une réponse déjà
      présente, une modale explique et propose de le rejouer à part.

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
- [ ] **DNS local `ai-studio.local`** — bail statique, entrée DNS sur la box,
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
