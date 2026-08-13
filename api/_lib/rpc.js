/* Solana JSON-RPC access plus house-wallet helpers.

   Plain fetch is used for RPC calls instead of web3.js Connection: each
   serverless invocation is short-lived, so a hand-rolled request with an
   explicit 10s timeout is both lighter and easier to reason about.
   web3.js is still used where it earns its keep: building and signing
   transfer transactions. */

import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

const RPC_TIMEOUT_MS = 10000;

const DEFAULT_RPC = {
  devnet: "https://api.devnet.solana.com",
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
};

export function network() {
  return process.env.NETWORK === "mainnet-beta" ? "mainnet-beta" : "devnet";
}

export function rpcUrl() {
  return process.env.RPC_URL || DEFAULT_RPC[network()];
}

function rpcError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export async function rpc(method, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(rpcUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params || [] }),
      signal: controller.signal,
    });
  } catch (err) {
    const timedOut = err && err.name === "AbortError";
    throw rpcError("network", timedOut ? "RPC timeout" : "RPC unreachable");
  } finally {
    clearTimeout(timer);
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw rpcError("bad-response", "RPC returned a non-JSON response");
  }
  if (data && data.error) {
    throw rpcError(data.error.code, data.error.message || "RPC error");
  }
  return data ? data.result : null;
}

/* jsonParsed keeps deposit verification simple: lamport/token deltas are
   readable in pre/postBalances without decoding raw instructions. */
export async function getTransactionParsed(signature) {
  return rpc("getTransaction", [
    signature,
    { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
  ]);
}

export async function getBalanceLamports(addr) {
  const result = await rpc("getBalance", [addr, { commitment: "confirmed" }]);
  return result ? Number(result.value) : 0;
}

export async function sendRawTransaction(base64) {
  return rpc("sendTransaction", [
    base64,
    { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 },
  ]);
}

export async function getLatestBlockhash() {
  const result = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
  return result ? result.value : null; /* { blockhash, lastValidBlockHeight } */
}

/* ================= House wallet ================= */

/* Returns null instead of throwing on a missing or malformed secret so
   /api/config can report enabled:false rather than crash. */
export function houseKeypair() {
  const secret = process.env.HOUSE_WALLET_SECRET;
  if (!secret) return null;
  try {
    const bytes = bs58.decode(secret);
    if (bytes.length !== 64) return null;
    return Keypair.fromSecretKey(bytes);
  } catch (e) {
    return null;
  }
}

/* Deposits land here. Falls back to the house address so a single env
   variable is enough to run the whole thing on devnet. */
export function vaultAddress() {
  if (process.env.VAULT_ADDRESS) return process.env.VAULT_ADDRESS;
  const kp = houseKeypair();
  return kp ? kp.publicKey.toBase58() : null;
}

/* Builds an unsigned SOL transfer. lamports must be a safe integer. */
export function buildTransferTx(fromBase58, toBase58, lamports, blockhash) {
  if (!Number.isSafeInteger(lamports) || lamports <= 0) {
    throw rpcError("bad-amount", "lamports must be a positive integer");
  }
  const from = new PublicKey(fromBase58);
  const tx = new Transaction({ feePayer: from, recentBlockhash: blockhash });
  tx.add(
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: new PublicKey(toBase58),
      lamports,
    })
  );
  return tx;
}

/* Signs with the house key and returns what the caller needs to both
   broadcast and reference the transaction. */
export function signWithHouse(tx) {
  const kp = houseKeypair();
  if (!kp) throw rpcError("no-house-wallet", "HOUSE_WALLET_SECRET is not configured");
  tx.sign(kp);
  return {
    base64: tx.serialize().toString("base64"),
    signature: bs58.encode(tx.signature),
  };
}
