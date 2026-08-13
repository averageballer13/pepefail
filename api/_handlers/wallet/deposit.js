// POST /api/wallet/deposit  { signature }
// Verifies a confirmed on-chain transfer to the vault and credits the
// player's off-chain balance. Idempotent per transaction signature so a
// client can safely retry until the transaction is confirmed.
import { ok, bad, methodGuard, readBody } from "../../_lib/respond.js";
import { requireAuth } from "../../_lib/auth.js";
import { credit } from "../../_lib/db.js";
import { getTransactionParsed } from "../../_lib/rpc.js";
import nacl from "tweetnacl";
import bs58 from "bs58";

const DAY_MS = 24 * 60 * 60 * 1000;

function realModeEnabled() {
  return Boolean(process.env.SESSION_SECRET && process.env.HOUSE_WALLET_SECRET);
}

function vaultAddress() {
  if (process.env.VAULT_ADDRESS) return process.env.VAULT_ADDRESS;
  // Default vault is the house wallet itself, derived from its secret key so
  // deposits and withdrawals share one address without extra configuration.
  const kp = nacl.sign.keyPair.fromSecretKey(bs58.decode(process.env.HOUSE_WALLET_SECRET));
  return bs58.encode(kp.publicKey);
}

// jsonParsed account keys come back as { pubkey, signer, writable } objects,
// but stay defensive in case a raw string slips through.
function keyPubkey(k) {
  return typeof k === "string" ? k : k && k.pubkey;
}
function keyIsSigner(k) {
  return Boolean(k && typeof k === "object" && k.signer);
}

// Raw token amounts are strings in RPC responses; they fit in a JS number
// for any realistic supply but go through Number() explicitly.
function tokenDelta(meta, vault, mint) {
  const post = (meta.postTokenBalances || []).find(
    (b) => b && b.owner === vault && b.mint === mint
  );
  if (!post) return 0;
  const pre = (meta.preTokenBalances || []).find(
    (b) => b && b.accountIndex === post.accountIndex
  );
  const postAmt = Number(post.uiTokenAmount && post.uiTokenAmount.amount);
  const preAmt = pre ? Number(pre.uiTokenAmount && pre.uiTokenAmount.amount) : 0;
  return postAmt - preAmt;
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, "POST")) return;
  if (!realModeEnabled()) return bad(res, 503, "disabled");

  const addr = await requireAuth(req);
  if (!addr) return bad(res, 401, "unauthorized");

  const body = await readBody(req);
  const signature = body && body.signature;
  if (typeof signature !== "string" || signature.length < 32 || signature.length > 128) {
    return bad(res, 400, "bad-signature");
  }

  const vault = vaultAddress();

  let tx;
  try {
    tx = await getTransactionParsed(signature);
  } catch (e) {
    return bad(res, 502, "rpc-error");
  }

  // Not confirmed yet: the client is expected to retry with the same
  // signature until the transaction lands.
  if (!tx) return bad(res, 404, "not-found");
  if (tx.meta && tx.meta.err) return bad(res, 400, "tx-failed");

  // Refuse stale transactions so an old deposit signature cannot be replayed
  // long after the fact (the ref key also blocks exact duplicates).
  if (typeof tx.blockTime === "number" && Date.now() - tx.blockTime * 1000 > DAY_MS) {
    return bad(res, 400, "too-old");
  }

  const message = tx.transaction && tx.transaction.message;
  const keys = (message && message.accountKeys) || [];

  // The authenticated player must have signed the deposit, otherwise anyone
  // could claim credit for someone else's transfer to the vault.
  const playerSigned = keys.some((k) => keyPubkey(k) === addr && keyIsSigner(k));
  if (!playerSigned) return bad(res, 403, "wrong-signer");

  let asset = null;
  let amount = 0;

  // SOL first: credit whatever lamports the vault actually gained, which is
  // robust against multi-instruction transactions.
  const vi = keys.findIndex((k) => keyPubkey(k) === vault);
  if (vi >= 0 && tx.meta) {
    const pre = Number((tx.meta.preBalances || [])[vi] || 0);
    const post = Number((tx.meta.postBalances || [])[vi] || 0);
    const delta = post - pre;
    if (delta > 0) {
      asset = "sol";
      amount = delta;
    }
  }

  // Fall back to the FAIL token delta when enabled.
  if (!asset && process.env.FAIL_MINT && tx.meta) {
    const delta = tokenDelta(tx.meta, vault, process.env.FAIL_MINT);
    if (delta > 0) {
      asset = "fail";
      amount = delta;
    }
  }

  if (!asset) return bad(res, 400, "wrong-destination");

  const r = await credit(addr, asset, amount, "dep:" + signature);
  if (!r.ok) return bad(res, 409, r.code || "duplicate");

  return ok(res, { credited: amount, asset, balance: r.balance });
}
