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

## 7. Bascule mainnet — checklist sérieuse

Ne pas basculer tant que chaque case n'est pas cochée :

- [ ] Le test e2e passe sur devnet, plusieurs fois, sans aucun FAIL.
- [ ] Nouveau hot wallet **de prod** généré sur une machine saine (pas celui des tests).
- [ ] Sauvegarde du secret : deux copies hors ligne vérifiées (relire la clé, la retaper).
- [ ] Bankroll dédiée et limitée sur le hot wallet : uniquement ce qu'on accepte de
      perdre en cas de pépin (les dépôts s'y accumulent ensuite).
- [ ] Seuils revus à la baisse pour le lancement : `MAX_BET_LAMPORTS`,
      `MAX_PAYOUT_LAMPORTS` cohérents avec la bankroll (le max payout doit rester
      une petite fraction de la caisse).
- [ ] `RPC_URL` Helius posée (le RPC public mainnet ne tiendra pas).
- [ ] Upstash actif — jamais la db mémoire en prod.
- [ ] Monitoring : alerte sur le solde on-chain du hot wallet (Helius webhooks ou
      un simple cron qui appelle getBalance), et un œil sur les logs Vercel.
- [ ] `SESSION_SECRET` régénéré pour la prod (invalide toutes les sessions de test).
- [ ] Plan d'incident écrit : qui coupe quoi, comment (supprimer `SESSION_SECRET`
      = mode réel coupé, le site retombe en démo).
- [ ] Premier test réel : dépôt minime, un pari, un retrait, vérifiés sur un explorer.

Puis : `NETWORK=mainnet-beta`, redéployer, refaire le test manuel petit montant.

## La vérité sur ce backend

Ce qu'il fait :
- Comptabilité en entiers (lamports), débits atomiques et idempotents.
- Dépôts vérifiés on-chain, retraits signés par le hot wallet, refund si l'envoi échoue.
- Résultats provably fair (seed serveur committée par hash, seed client, nonce).
- Les maths des jeux côté serveur sont le miroir exact du client — la maison ne
  peut pas tricher sans casser le hash révélé.

Ce qu'il ne fait pas encore :
- **Pas de sweep multi-adresses** : une seule adresse de dépôt partagée ; un dépôt
  est attribué au compte via la signature de la transaction envoyée par le joueur.
  Un virement direct depuis un exchange vers le vault sans passer par le site ne
  sera pas crédité automatiquement.
- **Un seul hot wallet** : caisse et signature des retraits au même endroit. Pas de
  cold storage, pas de multisig. Si la clé fuit, la caisse part.
- **Rate limit basique** : par adresse authentifiée seulement (30 req/10 s sur
  `bet/*`). Pas de limite par IP, pas de protection DDoS au-delà de Vercel.
- **Pas de géoblocage, pas de KYC, pas de limites de jeu responsable.** À traiter
  avant toute ouverture sérieuse — c'est un sujet légal, pas technique.
- **Pas de file de retraits ni de revue manuelle** : un retrait valide part
  immédiatement, borné uniquement par le solde du compte et `MIN_WITHDRAW_LAMPORTS`.
- Sans Upstash, la base mémoire perd tout à chaque redémarrage — dev local uniquement.
