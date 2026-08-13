/* Generates the two mainnet secrets and writes them to mainnet-secrets.txt
   (gitignored) WITHOUT printing them, so they never appear in a terminal
   scrollback, a chat log, or a screen share. Only the house PUBLIC address
   is printed.

   Run:  node tools/gen-mainnet-secrets.mjs
   Then: open mainnet-secrets.txt, paste the values into Vercel
         (Settings > Environment Variables), and DELETE the file. */

import { writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";

const OUT = new URL("../mainnet-secrets.txt", import.meta.url);

if (existsSync(OUT)) {
  console.error("mainnet-secrets.txt existe deja — supprime-le d'abord si tu veux regenerer.");
  process.exit(1);
}

const pair = nacl.sign.keyPair();
const address = bs58.encode(pair.publicKey);
const houseSecret = bs58.encode(pair.secretKey);
const sessionSecret = randomBytes(48).toString("hex");

const body = [
  "pepe.fail — SECRETS MAINNET (a coller dans Vercel puis SUPPRIMER CE FICHIER)",
  "=============================================================================",
  "",
  "HOUSE_WALLET_SECRET=" + houseSecret,
  "",
  "SESSION_SECRET=" + sessionSecret,
  "",
  "NETWORK=mainnet-beta",
  "",
  "Adresse publique du house wallet (pour l'alimenter en SOL) :",
  address,
  "",
  "RAPPELS :",
  " - Ne partage ces valeurs avec PERSONNE (aucun humain, aucune IA, aucun site).",
  " - Colle-les dans Vercel > Settings > Environment Variables (Production).",
  " - Garde une copie offline (papier / cle USB chiffree), puis supprime ce fichier.",
  " - Quiconque detient HOUSE_WALLET_SECRET controle la banque du casino.",
  "",
].join("\n");

writeFileSync(OUT, body, { encoding: "utf8" });

console.log("");
console.log("Secrets mainnet generes -> mainnet-secrets.txt (NON affiches ici)");
console.log("");
console.log("Adresse publique du house wallet (a alimenter en SOL) :");
console.log("  " + address);
console.log("");
console.log("Etapes :");
console.log("  1. Ouvre mainnet-secrets.txt et colle les 3 variables dans Vercel");
console.log("  2. Alimente l'adresse ci-dessus avec ta bankroll SOL");
console.log("  3. SUPPRIME mainnet-secrets.txt");
console.log("");
