/* ===================================================================
   pepe.fail — provably-fair seed management.

   Per address we keep a pair in db key fair:{addr}:
     { serverSeed, serverSeedHash, clientSeed }
   and a draw counter in its own key fairnonce:{addr} so it can be
   advanced with an atomic incrBy — two concurrent bets can never
   consume the same nonce.

   The player only ever sees serverSeedHash until rotate() reveals
   the seed, at which point every past draw can be re-computed and
   audited: floats[i] = first 8 hex chars of
   hmac_sha256(serverSeed, clientSeed + ":" + nonce + ":" + i) / 2^32.
   =================================================================== */

import crypto from "node:crypto";
import * as db from "./db.js";

const fairKey = (addr) => "fair:" + addr;
const nonceKey = (addr) => "fairnonce:" + addr;

function sha256hex(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function freshPair() {
  const serverSeed = crypto.randomBytes(32).toString("hex");
  return {
    serverSeed,
    serverSeedHash: sha256hex(serverSeed),
    // A default client seed the player can (and should) overwrite.
    clientSeed: crypto.randomBytes(8).toString("hex"),
  };
}

// Load the pair, creating one on first contact.
async function load(addr) {
  let f = await db.get(fairKey(addr));
  if (!f || !f.serverSeed) {
    f = freshPair();
    await db.set(fairKey(addr), f);
  }
  return f;
}

async function currentNonce(addr) {
  const v = await db.get(nonceKey(addr));
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/* Public state: never includes the raw serverSeed. `nonce` is the
   one the NEXT draw will use. */
export async function state(addr) {
  const f = await load(addr);
  return {
    serverSeedHash: f.serverSeedHash,
    clientSeed: f.clientSeed,
    nonce: await currentNonce(addr),
  };
}

export async function setClientSeed(addr, seed) {
  const s = String(seed);
  if (s.length < 1 || s.length > 64) return null;
  const f = await load(addr);
  f.clientSeed = s;
  await db.set(fairKey(addr), f);
  return { serverSeedHash: f.serverSeedHash, clientSeed: f.clientSeed };
}

/* Reveal the old server seed and start a fresh pair. The nonce is
   reset because it only has meaning within one seed pair. The client
   seed survives the rotation: it belongs to the player. */
export async function rotate(addr) {
  const f = await load(addr);
  const next = freshPair();
  next.clientSeed = f.clientSeed;
  await db.set(fairKey(addr), next);
  await db.del(nonceKey(addr));
  return {
    revealedServerSeed: f.serverSeed,
    newServerSeedHash: next.serverSeedHash,
  };
}

/* Draw `count` uniform floats in [0,1) for one bet. The nonce is
   reserved with an atomic incrBy BEFORE computing, so the value we
   use can never be reused by a concurrent request; the counter ends
   up incremented after the draw, as the client-facing docs promise. */
export async function draw(addr, count) {
  const f = await load(addr);
  const nonce = (await db.incrBy(nonceKey(addr), 1)) - 1;

  const floats = [];
  for (let i = 0; i < count; i++) {
    const hex = crypto
      .createHmac("sha256", f.serverSeed)
      .update(f.clientSeed + ":" + nonce + ":" + i)
      .digest("hex");
    // First 8 hex chars = 32 uniform bits.
    floats.push(parseInt(hex.slice(0, 8), 16) / 0x100000000);
  }
  return { floats, nonce };
}
