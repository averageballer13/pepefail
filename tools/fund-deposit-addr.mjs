/* Derives a player's deposit address (house secret + player addr) and
   funds it with devnet SOL, so the live watcher on their open page can
   catch it and show the toast. */
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import bs58 from "bs58";
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction,
} from "@solana/web3.js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}

const playerAddr = process.argv[2];
const lamports = Number(process.argv[3] || 200_000_000);

const secret = bs58.decode(process.env.HOUSE_WALLET_SECRET);
const seed = createHmac("sha512", Buffer.from(secret))
  .update("deposit-v1:" + playerAddr)
  .digest()
  .subarray(0, 32);
const depositKp = Keypair.fromSeed(seed);
console.log("adresse de depot du joueur :", depositKp.publicKey.toBase58());

const conn = new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed");
const house = Keypair.fromSecretKey(secret);
const tx = new Transaction().add(
  SystemProgram.transfer({
    fromPubkey: house.publicKey,
    toPubkey: depositKp.publicKey,
    lamports,
  })
);
const sig = await sendAndConfirmTransaction(conn, tx, [house], { commitment: "confirmed" });
console.log("envoye :", lamports / 1e9, "SOL — tx", sig);
