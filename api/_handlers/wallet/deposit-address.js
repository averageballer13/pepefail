/* ===================================================================
   GET /api/wallet/deposit-address

   Every player gets their own deposit address, derived from the house
   secret and the player's wallet address. Deterministic, so nothing is
   stored: the same player always sees the same address, and the server
   can re-derive the key whenever it needs to sweep.

   Because the address belongs to the house, the player can fund it from
   anywhere — their own wallet, an exchange, a friend — and attribution
   is the address itself, not the sender.
   =================================================================== */

import { createHmac } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { ok, bad, methodGuard } from "../../_lib/respond.js";
import { requireAuth } from "../../_lib/auth.js";

export function deriveDepositKeypair(playerAddr) {
  const secret = bs58.decode(process.env.HOUSE_WALLET_SECRET);
  /* v1 tag keeps the door open for a future rotation scheme. */
  const seed = createHmac("sha512", Buffer.from(secret))
    .update("deposit-v1:" + playerAddr)
    .digest()
    .subarray(0, 32);
  return Keypair.fromSeed(seed);
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, "GET")) return;
  if (!process.env.SESSION_SECRET || !process.env.HOUSE_WALLET_SECRET) {
    return bad(res, 503, "real mode disabled");
  }

  const addr = await requireAuth(req);
  if (!addr) return bad(res, 401, "unauthorized");

  try {
    const kp = deriveDepositKeypair(addr);
    return ok(res, { address: kp.publicKey.toBase58() });
  } catch (e) {
    return bad(res, 500, "derivation failed");
  }
}
