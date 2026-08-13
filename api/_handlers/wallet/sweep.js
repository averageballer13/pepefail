/* ===================================================================
   POST /api/wallet/sweep

   Checks the player's derived deposit address; if funds have arrived,
   moves them to the vault and credits the casino balance. The client
   polls this while waiting for a deposit, so detection feels live.

   Crediting rules:
   - the player is credited the FULL amount that arrived; the 5000
     lamport sweep fee is paid out of the swept sum, so the vault
     absorbs it (a rounding cost, and far better UX than explaining
     network fees inside a deposit screen);
   - idempotency is keyed on the sweep signature, and a per-player lock
     stops two concurrent polls from double-sweeping;
   - if the sweep lands but the process dies before the credit, the
     retry path re-credits from the recorded sweep, never twice.
   =================================================================== */

import { SystemProgram, Transaction, PublicKey } from "@solana/web3.js";
import { ok, bad, methodGuard } from "../../_lib/respond.js";
import { requireAuth } from "../../_lib/auth.js";
import * as db from "../../_lib/db.js";
import { rpc, getBalanceLamports, sendRawTransaction, getLatestBlockhash, vaultAddress } from "../../_lib/rpc.js";
import { deriveDepositKeypair } from "./deposit-address.js";

const SWEEP_FEE = 5000;           /* one signature, one transfer */
const MIN_SWEEP = 1_000_000;      /* 0.001 SOL: below this, wait for more */

export default async function handler(req, res) {
  if (!methodGuard(req, res, "POST")) return;
  if (!process.env.SESSION_SECRET || !process.env.HOUSE_WALLET_SECRET) {
    return bad(res, 503, "real mode disabled");
  }

  const addr = await requireAuth(req);
  if (!addr) return bad(res, 401, "unauthorized");

  const vault = vaultAddress();
  if (!vault) return bad(res, 503, "vault unavailable");

  let kp;
  try {
    kp = deriveDepositKeypair(addr);
  } catch (e) {
    return bad(res, 500, "derivation failed");
  }
  const depositAddr = kp.publicKey.toBase58();

  /* One sweep at a time per player; the poll just sees "pending". */
  const lockKey = "sweeplock:" + addr;
  const locked = await db.setnx(lockKey, 1, 30);
  if (!locked) {
    return ok(res, { credited: 0, pending: true, depositAddress: depositAddr });
  }

  try {
    let lamports;
    try {
      lamports = await getBalanceLamports(depositAddr);
    } catch (e) {
      return bad(res, 502, "rpc-error");
    }

    if (lamports < MIN_SWEEP) {
      return ok(res, {
        credited: 0,
        waiting: lamports,
        depositAddress: depositAddr,
        balance: await db.getBalance(addr, "sol"),
      });
    }

    /* Build and sign the sweep with the derived key. */
    let signature;
    try {
      const bh = await getLatestBlockhash();
      const blockhash = bh && (bh.blockhash || (bh.value && bh.value.blockhash));
      if (!blockhash) return bad(res, 502, "rpc-error");

      const tx = new Transaction();
      tx.recentBlockhash = blockhash;
      tx.feePayer = kp.publicKey;
      tx.add(
        SystemProgram.transfer({
          fromPubkey: kp.publicKey,
          toPubkey: new PublicKey(vault),
          lamports: lamports - SWEEP_FEE,
        })
      );
      tx.sign(kp);
      signature = await sendRawTransaction(tx.serialize().toString("base64"));
    } catch (e) {
      return bad(res, 502, "sweep-failed");
    }

    /* Confirm briefly; a pending sweep is retried by the next poll and
       the signature-keyed credit keeps it single. */
    let confirmed = false;
    for (let i = 0; i < 10 && !confirmed; i++) {
      await new Promise((r) => setTimeout(r, 1200));
      try {
        const st = await rpc("getSignatureStatuses", [[signature]]);
        const s = st && st.value && st.value[0];
        if (s && !s.err && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) {
          confirmed = true;
        }
        if (s && s.err) return bad(res, 502, "sweep-failed-onchain");
      } catch (e) { /* keep polling */ }
    }
    if (!confirmed) {
      return ok(res, { credited: 0, pending: true, depositAddress: depositAddr });
    }

    /* Credit the full arrival; the fee comes out of the vault's share. */
    const cr = await db.credit(addr, "sol", lamports, "sweep:" + signature);
    const balance = cr && cr.ok ? cr.balance : await db.getBalance(addr, "sol");
    await db.set("sweep:" + addr + ":" + signature, { lamports, at: Date.now() }, 7 * 86400);

    return ok(res, { credited: lamports, signature, depositAddress: depositAddr, balance });
  } finally {
    try { await db.del(lockKey); } catch (e) { /* lock expires on its own */ }
  }
}
