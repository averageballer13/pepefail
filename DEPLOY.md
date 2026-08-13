# Déploiement du backend pepe.fail

Le site reste statique sur Vercel. Le dossier `api/` ajoute des fonctions serverless
qui rendent les paris réels en SOL. Tant que les variables d'environnement ne sont
pas posées, le mode réel est inactif et le site continue en démo — zéro risque.

## Prérequis

- Node 18+ installé en local
- Le repo déjà branché sur Vercel (c'est le cas)
- `npm install` à la racine (dépendances : `@solana/web3.js`, `tweetnacl`, `bs58`)

## 1. Créer la base Upstash (gratuit)

Sans Upstash, la base est en mémoire : ça marche en local mais tout est perdu à
chaque redémarrage. Obligatoire pour la prod.

1. https://upstash.com → compte gratuit → **Create Database** (Redis).
2. Région : au plus près de la région Vercel (par défaut `iad1`, donc US-East).
3. Dans l'onglet **REST API**, copier :
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

## 2. Choisir le RPC Solana

- **Devnet (tests)** : rien à faire, le défaut `https://api.devnet.solana.com` suffit.
- **Mainnet (prod)** : le RPC public est trop limité. Créer une clé gratuite sur
  https://helius.dev → copier l'URL RPC (`https://mainnet.helius-rpc.com/?api-key=...`)
  dans `RPC_URL`.

## 3. Générer le hot wallet de la maison

```
node tools/gen-wallet.mjs
```

Le script affiche :
- l'**adresse publique** → c'est le vault (les dépôts arrivent dessus)
- la **clé secrète base58** → `HOUSE_WALLET_SECRET`

**La clé secrète signe tous les retraits. Qui la possède possède la caisse.**
- Deux copies hors ligne (papier ou clé USB chiffrée), jamais dans le repo,
  jamais dans un chat ou un mail.
- Ne jamais réutiliser ce wallet pour autre chose.

## 4. Poser les variables d'environnement sur Vercel

Dashboard Vercel → projet → **Settings → Environment Variables**.

| Variable | Valeur | Obligatoire |
|---|---|---|
| `NETWORK` | `devnet` puis `mainnet-beta` | non (défaut devnet) |
| `RPC_URL` | URL Helius en mainnet | non sur devnet, oui en mainnet |
| `SESSION_SECRET` | chaîne aléatoire longue (ex. sortie de `openssl rand -hex 32`) | **oui** |
| `HOUSE_WALLET_SECRET` | clé base58 de l'étape 3 | **oui** |
| `VAULT_ADDRESS` | adresse de dépôt si différente du hot wallet | non |
| `UPSTASH_REDIS_REST_URL` | étape 1 | oui en prod |
| `UPSTASH_REDIS_REST_TOKEN` | étape 1 | oui en prod |
| `FAIL_MINT` | mint du token $FAIL | non (active l'actif "fail") |
| `MAX_BET_LAMPORTS` | défaut 500000000 (0.5 SOL) | non |
| `MAX_PAYOUT_LAMPORTS` | défaut 5000000000 (5 SOL) | non |
| `MIN_WITHDRAW_LAMPORTS` | défaut 10000000 (0.01 SOL) | non |

Le mode réel s'active dès que `SESSION_SECRET` **et** `HOUSE_WALLET_SECRET` sont
posés (`GET /api/config` → `enabled: true`). Pour couper le mode réel en urgence :
supprimer `SESSION_SECRET` et redéployer.

## 5. Tester en local sur devnet

Créer `.env.local` à la racine (jamais commité) :

```
NETWORK=devnet
SESSION_SECRET=une-chaine-aleatoire-longue
HOUSE_WALLET_SECRET=la-cle-base58-de-test
```

Utiliser un wallet de **test** généré exprès (`node tools/gen-wallet.mjs`), pas
celui de prod. Puis :

```
node tools/dev-api.mjs      # terminal 1 — sert le site + /api/* sur :5178
node tools/test-e2e.mjs     # terminal 2 — scénario complet
```

Le test e2e : airdrop devnet → login signé → dépôt réel 0.2 SOL → 20 dice →
mines → blackjack → crash → retrait 0.05 SOL, avec vérification du solde en
lamports à chaque étape (tolérance zéro). Code sortie 0 = tout est bon.

Note : le faucet devnet rate-limite souvent. Si l'airdrop échoue, le test le dit
et saute les étapes qui dépendent du solde — relancer plus tard ou alimenter
l'adresse affichée via https://faucet.solana.com.

## 6. Déployer

```
git push
```

Vercel détecte `api/` automatiquement. Vérifier ensuite :
- `https://pepe.fail/api/config` → `enabled: true`, `network` correct, vault attendu.
- Un cycle complet dépôt → pari → retrait avec un petit montant réel.

## 7. Bascule mainnet — runbook exact

Le code est prêt : les clés Redis sont préfixées par réseau (`mainnet-beta:*`),
donc la même base Upstash sert les deux mondes sans qu'un solde devnet puisse
devenir une dette en vrais SOL. Il reste les actions ci-dessous, dans l'ordre.

**1. Générer les secrets de prod (local, jamais partagés) :**

```
node tools/gen-mainnet-secrets.mjs
```

Écrit `mainnet-secrets.txt` (gitignoré, rien d'affiché à l'écran) avec
`HOUSE_WALLET_SECRET`, `SESSION_SECRET`, `NETWORK=mainnet-beta`, et imprime
seulement l'adresse publique de la maison. Copies offline, puis suppression
du fichier une fois Vercel rempli. Le secret devnet qui a circulé pendant les
tests ne doit JAMAIS servir en prod.

**2. Vercel → Settings → Environment Variables (Production) :**

- `HOUSE_WALLET_SECRET` → la nouvelle valeur
- `SESSION_SECRET` → la nouvelle valeur
- `NETWORK` → `mainnet-beta`
- `RPC_URL` → l'URL **mainnet** Helius : `https://mainnet.helius-rpc.com/?api-key=<ta clé>`
  (la même clé Helius marche, c'est l'URL qui change)
- `UPSTASH_REDIS_REST_URL` / `TOKEN` → inchangés
- `PUBLIC_RPC_URL` (recommandé) → une **deuxième** clé Helius mainnet, restreinte
  au domaine pepe.fail dans le dashboard Helius. Elle est envoyée au navigateur
  pour lire les soldes et envoyer le dépôt 1-clic — le RPC public mainnet
  rate-limite ces appels. Ne JAMAIS mettre la clé serveur ici.
- Seuils de lancement prudents, cohérents avec la bankroll :
  `MAX_BET_LAMPORTS` (ex. `100000000` = 0.1 SOL),
  `MAX_PAYOUT_LAMPORTS` (ex. `2000000000` = 2 SOL, à garder ≤ 5 % de la caisse),
  `MIN_WITHDRAW_LAMPORTS` (ex. `10000000` = 0.01 SOL)

**3. Alimenter la maison :** envoyer la bankroll SOL sur l'adresse publique
imprimée à l'étape 1 — uniquement ce qu'on accepte de perdre.

**4. Redéployer** (push ou Redeploy) et vérifier `GET /api/config` :
`enabled:true`, `network:"mainnet-beta"`, le bon vault.

**5. Premier test réel, petit :** créer un wallet neuf sur le site, déposer
~0.02 SOL depuis un wallet perso, jouer un pari minime, retirer, tout vérifier
sur Solscan (sans `?cluster=devnet` cette fois).

**6. Ensuite :** surveiller le solde du hot wallet et les logs Vercel les
premiers jours. Couper le mode réel en urgence = supprimer `SESSION_SECRET`
sur Vercel (le site retombe en démo, les fonds ne bougent plus).

## La vérité sur ce backend

Ce qu'il fait :
- Comptabilité en entiers (lamports), débits atomiques et idempotents.
- Une adresse de dépôt dérivée **par joueur** (HMAC du secret maison, rien à
  stocker) : tout ce qui y arrive est balayé vers la caisse et crédité plein
  montant, détection en direct côté client.
- Dépôts vérifiés on-chain, retraits signés par le hot wallet, refund si l'envoi échoue.
- Résultats provably fair (seed serveur committée par hash, seed client, nonce).
- Les maths des jeux côté serveur sont le miroir exact du client — la maison ne
  peut pas tricher sans casser le hash révélé.

Ce qu'il ne fait pas encore :
- **Un seul hot wallet** : caisse et signature des retraits au même endroit. Pas de
  cold storage, pas de multisig. Si la clé fuit, la caisse part.
- **Rate limit basique** : par adresse authentifiée seulement (30 req/10 s sur
  `bet/*`). Pas de limite par IP, pas de protection DDoS au-delà de Vercel.
- **Pas de géoblocage, pas de KYC, pas de limites de jeu responsable.** À traiter
  avant toute ouverture sérieuse — c'est un sujet légal, pas technique.
- **Pas de file de retraits ni de revue manuelle** : un retrait valide part
  immédiatement, borné uniquement par le solde du compte et `MIN_WITHDRAW_LAMPORTS`.
- Sans Upstash, la base mémoire perd tout à chaque redémarrage — dev local uniquement.
