# Nom local : lab.cm-it.fr sur le réseau de la box

## Le point à régler en premier

Les navigateurs réservent `crypto.subtle` et `crypto.randomUUID` aux
**contextes sécurisés** : `https://`, `localhost` ou `127.0.0.1`. Un nom local
servi en clair — `http://lab/` — n'en est pas un.

Conséquence directe : **le chiffrement au repos ne fonctionnera pas** depuis un
nom local en `http://`. L'API WebCrypto y est tout simplement absente.

(Studio sait maintenant générer ses UUID sans `crypto.randomUUID`, donc le
reste de l'application fonctionne en clair. Mais le coffre, lui, exige
WebCrypto : pas de contexte sécurisé, pas de chiffrement.)

Il faut donc du HTTPS, même sur le réseau local.

## Configuration retenue

### 1. Faire écouter le serveur sur le réseau

```bash
HOST=0.0.0.0 node server.mjs
```

Dans l'agent de session, ajouter la variable :

```bash
launchctl setenv HOST 0.0.0.0    # puis relancer l'agent
```

### 2. Pointer le nom vers le Mac

Sur la Livebox : **Réseau → DHCP → Baux statiques**, réserver l'adresse du Mac
(par exemple `192.168.1.42`), puis **DNS local** (ou « Noms d'hôtes »), associer
`lab.cm-it.fr` à cette adresse.

Toutes les box ne proposent pas d'entrée DNS locale arbitraire. Si la vôtre s'y
refuse, deux solutions :

- un serveur DNS local sur le Mac (`dnsmasq` via Homebrew), la box le désignant
  comme résolveur ;
- ou l'entrée `192.168.1.42  lab.cm-it.fr` dans le fichier `hosts` de chaque
  appareil — suffisant pour deux ou trois machines.

### 3. Certificat de confiance locale

`cm-it.fr` étant un domaine que vous possédez, une autorité publique ne
délivrera pas de certificat pour une adresse privée. On crée donc une autorité
locale, installée sur vos appareils :

```bash
brew install mkcert nss
mkcert -install                      # installe l'autorité dans le trousseau
mkcert lab.cm-it.fr 192.168.1.42     # produit le certificat et sa clé
```

Puis lancer le serveur en HTTPS :

```bash
STUDIO_CERT=./lab.cm-it.fr.pem \
STUDIO_KEY=./lab.cm-it.fr-key.pem \
HOST=0.0.0.0 PORT=443 node server.mjs
```

Sur iPhone ou iPad, il faut transférer le fichier `rootCA.pem`
(`mkcert -CAROOT` indique où il se trouve), l'installer, puis l'activer dans
**Réglages → Général → Informations → Certificats de confiance**.

### 4. Vérifier

```bash
curl -sI https://lab.cm-it.fr | head -1     # doit répondre 200
```

Dans le navigateur, la console doit donner `window.isSecureContext === true`.
C'est la condition du chiffrement.

## Variante sans certificat à gérer

Tailscale délivre de vrais certificats reconnus pour les noms de votre réseau
privé, sans autorité à installer sur chaque appareil :

```bash
brew install --cask tailscale
tailscale cert lab.cm-it.fr
```

L'accès fonctionne alors depuis n'importe où, pas seulement à la maison, et
sans jamais rien exposer publiquement.

## Rappel

Rien de tout cela n'est nécessaire hors ligne. En avion, les agents de session
lancent Ollama et le serveur, et l'application répond sur `http://127.0.0.1:5300`
— qui est, lui, un contexte sécurisé.
