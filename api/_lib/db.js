/* Key-value store with two backends:
   - Upstash Redis over REST when UPSTASH_REDIS_REST_URL/TOKEN are set.
     This is the only backend safe in production: serverless instances do
     not share memory, and money movements need real atomicity (Lua EVAL).
   - An in-process Map otherwise, for local development only. Its critical
     sections are plain synchronous code: Node runs one request handler at
     a time between awaits, so a check-then-write with no await in between
     cannot interleave.

   All monetary amounts are integers (lamports / raw token units). Floats
   are rejected outright rather than rounded, because a rounded debit and
   a rounded credit could disagree. */

const REF_TTL_SEC = 7 * 24 * 60 * 60; /* dedupe markers live 7 days */

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const useUpstash = !!(UPSTASH_URL && UPSTASH_TOKEN);

/* ================= Upstash REST ================= */

async function upstash(command) {
  const res = await fetch(UPSTASH_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + UPSTASH_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (data && data.error) {
    throw new Error("upstash: " + data.error);
  }
  return data ? data.result : null;
}

/* Atomic credit: refuse if the ref marker exists, otherwise increment and
   set the marker in the same script so a retry can never double-credit. */
const CREDIT_LUA = [
  "if redis.call('EXISTS', KEYS[2]) == 1 then return {0, 'duplicate'} end",
  "local nb = redis.call('INCRBY', KEYS[1], ARGV[1])",
  "redis.call('SET', KEYS[2], '1', 'EX', ARGV[2])",
  "return {1, nb}",
].join("\n");

/* Atomic conditional debit: dedupe check, balance check, decrement and
   marker write all inside one script so two concurrent bets cannot both
   spend the same lamports. */
const DEBIT_LUA = [
  "if redis.call('EXISTS', KEYS[2]) == 1 then return {0, 'duplicate'} end",
  "local bal = tonumber(redis.call('GET', KEYS[1]) or '0')",
  "local amt = tonumber(ARGV[1])",
  "if bal < amt then return {0, 'insufficient'} end",
  "local nb = redis.call('DECRBY', KEYS[1], amt)",
  "redis.call('SET', KEYS[2], '1', 'EX', ARGV[2])",
  "return {1, nb}",
].join("\n");

/* ================= In-memory backend ================= */

/* Map of key -> { v: value, exp: epochMs | 0 }. Exported for tests. */
const memory = new Map();

function memGet(key) {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.exp && entry.exp <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.v;
}

function memSet(key, value, ttlSec) {
  memory.set(key, { v: value, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 });
}

/* Synchronous on purpose: callers use it inside critical sections. Keeps
   the existing TTL like Redis INCRBY does. */
function memIncr(key, n) {
  const entry = memory.get(key);
  const now = Date.now();
  let cur = 0;
  let exp = 0;
  if (entry && (!entry.exp || entry.exp > now)) {
    cur = Math.trunc(Number(entry.v)) || 0;
    exp = entry.exp;
  }
  const next = cur + n;
  memory.set(key, { v: next, exp });
  return next;
}

/* ================= Public API ================= */

export async function get(key) {
  if (useUpstash) {
    const raw = await upstash(["GET", key]);
    if (raw === null || raw === undefined) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return raw; /* value written outside JSON conventions */
    }
  }
  return memGet(key);
}

export async function set(key, value, ttlSec) {
  if (useUpstash) {
    const cmd = ["SET", key, JSON.stringify(value)];
    if (ttlSec) cmd.push("EX", String(ttlSec));
    await upstash(cmd);
    return;
  }
  memSet(key, value, ttlSec);
}

export async function del(key) {
  if (useUpstash) {
    await upstash(["DEL", key]);
    return;
  }
  memory.delete(key);
}

/* Set only if absent. Returns true when this call won the key. */
export async function setnx(key, value, ttlSec) {
  if (useUpstash) {
    const cmd = ["SET", key, JSON.stringify(value), "NX"];
    if (ttlSec) cmd.push("EX", String(ttlSec));
    const r = await upstash(cmd);
    return r === "OK";
  }
  if (memGet(key) !== null) return false;
  memSet(key, value, ttlSec);
  return true;
}

export async function incrBy(key, n) {
  if (!Number.isSafeInteger(n)) throw new Error("incrBy: integer required");
  if (useUpstash) {
    return Number(await upstash(["INCRBY", key, String(n)]));
  }
  return memIncr(key, n);
}

function balKey(addr, asset) {
  return "bal:" + addr + ":" + asset;
}

export async function getBalance(addr, asset) {
  const v = await get(balKey(addr, asset));
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : 0;
}

/* Idempotent credit. refId is mandatory by convention (deposits, refunds
   and win payouts all carry one); when it is missing we still credit but
   without dedupe, which callers must only do for trusted internal flows. */
export async function credit(addr, asset, amount, refId) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, code: "bad-amount" };
  }
  const bKey = balKey(addr, asset);
  const rKey = refId ? "ref:" + refId : null;

  if (useUpstash) {
    if (!rKey) {
      const b = await upstash(["INCRBY", bKey, String(amount)]);
      return { ok: true, balance: Number(b) };
    }
    const r = await upstash([
      "EVAL", CREDIT_LUA, "2", bKey, rKey, String(amount), String(REF_TTL_SEC),
    ]);
    if (!r || Number(r[0]) !== 1) return { ok: false, code: "duplicate" };
    return { ok: true, balance: Number(r[1]) };
  }

  /* Memory: no await between check and write, so this cannot interleave. */
  if (rKey && memGet(rKey) !== null) return { ok: false, code: "duplicate" };
  const balance = memIncr(bKey, amount);
  if (rKey) memSet(rKey, 1, REF_TTL_SEC);
  return { ok: true, balance };
}

/* Atomic debit-if-enough. Same refId marker family as credit so a replayed
   request never spends twice. */
export async function debitIfEnough(addr, asset, amount, refId) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, code: "bad-amount" };
  }
  if (!refId) return { ok: false, code: "missing-ref" };
  const bKey = balKey(addr, asset);
  const rKey = "ref:" + refId;

  if (useUpstash) {
    const r = await upstash([
      "EVAL", DEBIT_LUA, "2", bKey, rKey, String(amount), String(REF_TTL_SEC),
    ]);
    if (!r || Number(r[0]) !== 1) {
      return { ok: false, code: r && r[1] ? String(r[1]) : "error" };
    }
    return { ok: true, balance: Number(r[1]) };
  }

  /* Memory: single synchronous critical section. */
  if (memGet(rKey) !== null) return { ok: false, code: "duplicate" };
  const bal = Math.trunc(Number(memGet(bKey))) || 0;
  if (bal < amount) return { ok: false, code: "insufficient" };
  const balance = memIncr(bKey, -amount);
  memSet(rKey, 1, REF_TTL_SEC);
  return { ok: true, balance };
}

/* Test hook: inspect or reset the memory backend directly. */
export const __memory = memory;
