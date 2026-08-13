/* Exercises the derived-address deposit flow end to end on devnet:
   auth -> deposit-address -> real SOL sent there -> sweep -> credit. */
import { readFileSync } from "node:fs";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction,
} from "@solana/web3.js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}

const BASE = process.env.API_BASE || "http://localhost:5178";
const AMOUNT = 50_000_000; /* 0.05 SOL */

async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(method + " " + path + " -> " + res.status + " " + JSON.stringify(data));
  return data;
}

const kp = nacl.sign.keyPair();
const addr = bs58.encode(kp.publicKey);
console.log("joueur      :", addr);

const ch = await api("POST", "/api/auth/challenge", { address: addr });
const sig = nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey);
const ver = await api("POST", "/api/auth/verify", { address: addr, nonce: ch.nonce, signature: bs58.encode(sig) });
const token = ver.token;
console.log("auth        : OK");

const da = await api("GET", "/api/wallet/deposit-address", null, token);
console.log("adresse dep :", da.address);

/* stable derivation check */
const da2 = await api("GET", "/api/wallet/deposit-address", null, token);
if (da2.address !== da.address) throw new Error("derivation instable !");
console.log("derivation  : stable");

const conn = new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed");
const house = Keypair.fromSecretKey(bs58.decode(process.env.HOUSE_WALLET_SECRET));
const tx = new Transaction().add(
  SystemProgram.transfer({
    fromPubkey: house.publicKey,
    toPubkey: new PublicKey(da.address),
    lamports: AMOUNT,
  })
);
const txSig = await sendAndConfirmTransaction(conn, tx, [house], { commitment: "confirmed" });
console.log("envoi 0.05  :", txSig.slice(0, 16) + "...");

/* poll sweep like the client watcher does */
let credited = 0, balance = 0;
for (let i = 0; i < 20 && !credited; i++) {
  const r = await api("POST", "/api/wallet/sweep", {}, token);
  if (r.credited > 0) { credited = r.credited; balance = r.balance; break; }
  process.stdout.write("  poll " + (i + 1) + ": " + (r.pending ? "pending" : "waiting " + (r.waiting || 0)) + "\n");
  await new Promise((z) => setTimeout(z, 3000));
}

if (credited !== AMOUNT) {
  console.log("ECHEC: credite " + credited + " != " + AMOUNT);
  process.exit(1);
}
console.log("credite     :", credited, "lamports (montant PLEIN, frais absorbes) — solde casino", balance);

/* the derived address must now be (near) empty, funds in the vault */
const left = await conn.getBalance(new PublicKey(da.address));
console.log("reste sur l adresse de depot :", left, "lamports");

/* replay safety: sweeping again credits nothing */
const again = await api("POST", "/api/wallet/sweep", {}, token);
if (again.credited > 0) { console.log("ECHEC: double credit !"); process.exit(1); }
console.log("re-sweep    : aucun double credit");
console.log("\nTOUT EST VERT");
