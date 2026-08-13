// POST /api/wallet/withdraw  { asset, amount, requestId }
// Debits the off-chain balance first (idempotent on requestId), then signs
// and broadcasts a house->player transfer. Refunds ONLY when we are certain
// the transaction never reached the network; otherwise the withdrawal is
// journaled as "unknown" for manual review, because refunding a transaction
// that may still land would let the player double-spend.
import { ok, bad, methodGuard, readBody } from "../../_lib/respond.js";
import { requireAuth } from "../../_lib/auth.js";
import { debitIfEnough, credit, getBalance, set } from "../../_lib/db.js";
import { rpc, sendRawTransaction, getLatestBlockhash } from "../../_lib/rpc.js";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";

// SPL program ids, hard-coded because @solana/spl-token is not an allowed
// dependency; the instruction layouts below are stable and documented.
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const CONFIRM_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 1500;

function realModeEnabled() {
  return Boolean(process.env.SESSION_SECRET && process.env.HOUSE_WALLET_SECRET);
}

function minWithdrawLamports() {
  const n = Number(process.env.MIN_WITHDRAW_LAMPORTS);
  return Number.isSafeInteger(n) && n > 0 ? n : 10000000;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function deriveAta(owner, mint) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID
  )[0];
}

// CreateIdempotent (discriminator 1): no-op when the ATA already exists, so
// we never race a concurrent creation of the player's token account.
function createAtaIdempotentIx(payer, ata, owner, mint) {
  return new TransactionInstruction({
    programId: ATA_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

// SPL Token Transfer (instruction 3): u8 discriminator + u64 LE amount.
function tokenTransferIx(source, dest, owner, amount) {
  const data = Buffer.alloc(9);
  data[0] = 3;
  data.writeBigUInt64LE(BigInt(amount), 1);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

async function signatureStatus(signature) {
  const r = await rpc("getSignatureStatuses", [
    [signature],
    { searchTransactionHistory: true },
  ]);
  return r && r.value ? r.value[0] : null;
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, "POST")) return;
  if (!realModeEnabled()) return bad(res, 503, "disabled");

  const addr = await requireAuth(req);
  if (!addr) return bad(res, 401, "unauthorized");

  const body = await readBody(req);
  const asset = body && body.asset;
  const amount = body && body.amount;
  const requestId = body && body.requestId;

  const failEnabled = Boolean(process.env.FAIL_MINT);
  if (asset !== "sol" && !(asset === "fail" && failEnabled)) {
    return bad(res, 400, "bad-asset");
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return bad(res, 400, "bad-amount");
  }
  if (asset === "sol" && amount < minWithdrawLamports()) {
    return bad(res, 400, "below-minimum");
  }
  if (typeof requestId !== "string" || requestId.length < 8 || requestId.length > 80) {
    return bad(res, 400, "bad-request-id");
  }

  let player;
  try {
    player = new PublicKey(addr);
  } catch (e) {
    return bad(res, 400, "bad-address");
  }

  const house = Keypair.fromSecretKey(bs58.decode(process.env.HOUSE_WALLET_SECRET));
  const wdKey = "wd:" + requestId;

  // Debit before signing: if anything fails past this point we either refund
  // (frank pre-broadcast failure) or freeze the funds for review.
  const debit = await debitIfEnough(addr, asset, amount, requestId);
  if (!debit.ok) {
    const code = debit.code || "insufficient";
    return bad(res, code === "duplicate" ? 409 : 400, code);
  }

  await set(wdKey, { addr, asset, amount, signature: null, status: "pending", at: Date.now() });

  async function refund(status) {
    // Refund uses a distinct refId so it stays idempotent and can never be
    // confused with the original debit reference.
    await credit(addr, asset, amount, requestId + ":refund");
    await set(wdKey, { addr, asset, amount, signature: null, status, at: Date.now() });
  }

  let signature;
  let raw;
  try {
    const tx = new Transaction();
    if (asset === "sol") {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: house.publicKey,
          toPubkey: player,
          lamports: amount,
        })
      );
    } else {
      const mint = new PublicKey(process.env.FAIL_MINT);
      const houseAta = deriveAta(house.publicKey, mint);
      const playerAta = deriveAta(player, mint);
      // Only pay for account creation when needed; the idempotent variant
      // keeps this safe even if the account appears in the meantime.
      const info = await rpc("getAccountInfo", [playerAta.toBase58(), { encoding: "base64" }]);
      if (!info || !info.value) {
        tx.add(createAtaIdempotentIx(house.publicKey, playerAta, player, mint));
      }
      tx.add(tokenTransferIx(houseAta, playerAta, house.publicKey, amount));
    }

    const bh = await getLatestBlockhash();
    tx.recentBlockhash = bh.blockhash || (bh.value && bh.value.blockhash);
    tx.feePayer = house.publicKey;
    tx.sign(house);
    raw = tx.serialize();
    signature = bs58.encode(tx.signatures[0].signature);
  } catch (e) {
    // Building or signing failed locally: nothing was broadcast, safe refund.
    await refund("failed");
    return bad(res, 502, "build-failed");
  }

  try {
    await sendRawTransaction(raw.toString("base64"));
  } catch (e) {
    // The send call failed, but a network hiccup can hide a successful
    // broadcast. Only refund when the cluster confirms it never saw the
    // signature; otherwise park the withdrawal for manual review.
    let seen = null;
    try {
      seen = await signatureStatus(signature);
    } catch (e2) {
      seen = null;
    }
    if (!seen) {
      await refund("failed");
      return bad(res, 502, "send-failed");
    }
    await set(wdKey, { addr, asset, amount, signature, status: "unknown", at: Date.now() });
  }

  // Poll until confirmed; past the deadline the outcome is unknown so the
  // funds stay debited and the record is left for review.
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    let st = null;
    try {
      st = await signatureStatus(signature);
    } catch (e) {
      st = null;
    }
    if (st && st.err) {
      // Confirmed on-chain failure: the transfer did not execute, refund.
      await refund("failed-onchain");
      return bad(res, 502, "tx-failed");
    }
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
      await set(wdKey, { addr, asset, amount, signature, status: "sent", at: Date.now() });
      const balance = await getBalance(addr, asset);
      return ok(res, { signature, balance });
    }
    await sleep(POLL_INTERVAL_MS);
  }

  await set(wdKey, { addr, asset, amount, signature, status: "unknown", at: Date.now() });
  return bad(res, 504, "confirm-timeout");
}
