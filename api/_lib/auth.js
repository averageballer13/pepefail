/* Wallet-signature authentication.

   Flow: the client asks for a challenge, signs the message with its
   ed25519 key (the address IS the public key in base58, same convention
   as assets/js/wallet.js), and trades the signature for a stateless HMAC
   token. Stateless because serverless instances share nothing but Redis:
   verifying a token must not need a database round-trip. */

import crypto from "node:crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import * as db from "./db.js";

const NONCE_TTL_SEC = 300; /* challenge validity window */
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; /* sessions last one day */

function hmacHex(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function b64url(text) {
  return Buffer.from(text, "utf8").toString("base64url");
}

/* Creates and stores a single-use nonce for this address. The message
   embeds the domain name so a signature for pepe.fail cannot be replayed
   against another service asking the wallet to sign look-alike text. */
export async function makeChallenge(addr) {
  const nonce = crypto.randomBytes(16).toString("hex");
  await db.set("nonce:" + addr, nonce, NONCE_TTL_SEC);
  return {
    message: "pepe.fail login\n" + addr + "\n" + nonce,
    nonce,
  };
}

/* Returns a session token, or null on any failure. Never throws: callers
   translate null into a 401 without leaking which check failed. */
export async function verifySignature(addr, signatureB58, nonce) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  if (typeof addr !== "string" || typeof signatureB58 !== "string" || typeof nonce !== "string") {
    return null;
  }

  /* The nonce must be the one we issued and still fresh. */
  const stored = await db.get("nonce:" + addr);
  if (!stored || String(stored) !== nonce) return null;

  let pubkey;
  let sig;
  try {
    pubkey = bs58.decode(addr);
    sig = bs58.decode(signatureB58);
  } catch (e) {
    return null;
  }
  if (pubkey.length !== 32 || sig.length !== 64) return null;

  const message = new TextEncoder().encode("pepe.fail login\n" + addr + "\n" + nonce);
  let valid = false;
  try {
    valid = nacl.sign.detached.verify(message, sig, pubkey);
  } catch (e) {
    valid = false;
  }
  if (!valid) return null;

  /* Burn the nonce only after a successful verification so a mistyped
     signature does not force a new challenge round-trip. */
  await db.del("nonce:" + addr);

  const payload = b64url(JSON.stringify({ a: addr, e: Date.now() + TOKEN_TTL_MS }));
  return payload + "." + hmacHex(secret, payload);
}

/* Extracts and validates the bearer token. Returns the address or null. */
export function requireAuth(req) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;

  const header = (req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();

  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  /* Constant-time comparison: a plain string compare would let an attacker
     forge the HMAC byte by byte from response timings. */
  const expected = hmacHex(secret, payload);
  let macBuf;
  let expBuf;
  try {
    macBuf = Buffer.from(mac, "hex");
    expBuf = Buffer.from(expected, "hex");
    if (macBuf.length !== expBuf.length || macBuf.length === 0) return null;
    if (!crypto.timingSafeEqual(macBuf, expBuf)) return null;
  } catch (e) {
    return null;
  }

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch (e) {
    return null;
  }
  if (!data || typeof data.a !== "string" || typeof data.e !== "number") return null;
  if (Date.now() > data.e) return null;
  return data.a;
}
