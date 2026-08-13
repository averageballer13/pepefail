/* One-off: fund a player wallet with devnet SOL from the test house wallet. */
import { readFileSync } from "node:fs";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}

const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const house = Keypair.fromSecretKey(bs58.decode(process.env.HOUSE_WALLET_SECRET));
const to = new PublicKey(process.argv[2]);

const bal = await conn.getBalance(house.publicKey);
console.log("maison avant :", (bal / 1e9).toFixed(4), "SOL");

const tx = new Transaction().add(
  SystemProgram.transfer({ fromPubkey: house.publicKey, toPubkey: to, lamports: 500_000_000 })
);
const sig = await sendAndConfirmTransaction(conn, tx, [house], { commitment: "confirmed" });
console.log("envoye : 0.5 SOL ->", to.toBase58());
console.log("signature :", sig);
console.log("dest apres :", ((await conn.getBalance(to)) / 1e9).toFixed(4), "SOL");
