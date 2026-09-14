# Exposer Studio sur ai-studio.local

## Avertissement, à lire avant de commencer

Studio n'a **aucune authentification**. Le relais donne accès à l'API Ollama
complète : lire toutes les conversations, dialoguer avec les modèles, mais
aussi **en télécharger et en supprimer**. Publier `ai-studio.local` sans portail
d'identité revient à laisser cette machine ouverte à quiconque devine le
sous-domaine — et les sous-domaines se devinent (journaux de transparence des
certificats, balayages automatisés).

La configuration ci-dessous place donc **Cloudflare Access devant le tunnel**.
C'est l'étape non négociable ; le reste est du confort.

## Option retenue — Cloudflare Tunnel + Access

Aucun port ouvert sur la box, aucune IP publique exposée, certificat géré par
Cloudflare, et un portail d'identité devant l'application.

### 1. Installer et connecter

```bash
brew install cloudflared
cloudflared tunnel login
```

Le navigateur s'ouvre : choisir votre zone.

### 2. Créer le tunnel et la route DNS

```bash
cloudflared tunnel create lab-studio
cloudflared tunnel route dns lab-studio ai-studio.local
```

La première commande affiche un UUID et écrit
`~/.cloudflared/<UUID>.json`. La seconde crée l'enregistrement CNAME.

### 3. Configurer

Copier `deploy/cloudflared-config.yml` vers `~/.cloudflared/config.yml` et y
remplacer `<TUNNEL-UUID>` par l'identifiant obtenu.

```bash
cp deploy/cloudflared-config.yml ~/.cloudflared/config.yml
$EDITOR ~/.cloudflared/config.yml
```

### 4. Verrouiller l'accès — l'étape à ne pas sauter

Dans le tableau de bord Cloudflare Zero Trust :

1. **Access → Applications → Add an application → Self-hosted**
2. Domaine : `ai-studio.local`
3. **Policy** : *Allow*, règle `Emails` → votre adresse
4. Méthode de connexion : *One-time PIN* suffit (un code arrive par courriel)

Sans cette politique, le tunnel est public. Avec elle, toute requête non
authentifiée est rejetée par Cloudflare avant d'atteindre le Mac.

### 5. Lancer en permanence

```bash
sudo cloudflared service install
```

Le tunnel devient un service système et remonte au démarrage.

Pour un essai ponctuel, sans installation :

```bash
cloudflared tunnel run lab-studio
```

## Vérifier

```bash
# Doit répondre 302 vers le portail Cloudflare Access, pas 200
curl -sI https://ai-studio.local | head -3
```

Une réponse `200` signifie que la politique Access n'est pas appliquée :
reprendre l'étape 4 avant de continuer.

## Alternative — Tailscale

Si l'accès ne concerne que vos propres appareils, Tailscale est plus simple et
plus sûr : la machine n'est jamais exposée publiquement.

```bash
brew install --cask tailscale
tailscale cert ai-studio.local   # certificat pour le nom de domaine
```

L'application reste alors joignable depuis vos appareils connectés au réseau
privé, sans portail ni politique à maintenir. En contrepartie, rien n'est
accessible depuis une machine non enrôlée.

## À ne pas faire

Ouvrir le port 5300 sur la box et faire pointer un A record dessus. Cela expose
l'API Ollama à l'internet entier, sans chiffrement ni contrôle d'accès.

## Rappel

Le tunnel ne sert **que** l'accès à distance. Hors ligne — en avion, par
exemple — l'application fonctionne sans lui : les agents de session lancent
Ollama et le serveur local, et tout se passe sur la machine.
