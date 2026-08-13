/* ===================================================================
   pepe.fail — local dev server

   Serves the static site AND routes /api/* to the Vercel serverless
   handlers in api/ so the whole stack can be exercised locally with
   plain node, no Vercel CLI required.

   Usage:  node tools/dev-api.mjs        (listens on port 5178)

   Env comes from the shell first, then from .env.local at the repo
   root (parsed by hand on purpose: no dotenv dependency).
   =================================================================== */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Readable } from "node:stream";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 5178);
const MAX_BODY = 1024 * 1024; // 1 MB is plenty for JSON API calls

/* ------------------------- .env.local ------------------------------
   Shell env wins over the file so a one-off override on the command
   line never gets silently ignored. */
async function loadEnvLocal() {
  let raw;
  try {
    raw = await readFile(path.join(ROOT, ".env.local"), "utf8");
  } catch {
    return false; // no file: fine, demo mode still works
  }
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    // strip one pair of surrounding quotes, common in copied secrets
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
  return true;
}

/* ------------------------- API routing -----------------------------
   Mirrors Vercel's file routing: /api/auth/verify -> api/auth/verify.js
   (or .mjs, or a folder with index.js). Handlers are re-imported when
   their mtime changes so editing one does not require a restart; the
   _lib modules they import stay cached, which keeps the in-memory db
   alive across handler edits. */
const modCache = new Map(); // absolute file path -> { mtimeMs, mod }

function safeApiParts(pathname) {
  // reject anything that could escape the api/ directory
  const parts = pathname.split("/").filter(Boolean);
  for (const p of parts) {
    if (p === ".." || p === "." || p.includes("\\")) return null;
  }
  return parts;
}

async function resolveHandlerFile(pathname) {
  const parts = safeApiParts(pathname);
  if (!parts || parts[0] !== "api") return null;
  /* Route files live under api/_handlers/ since the Hobby-plan function
     cap forced everything behind one catch-all; URLs are unchanged. */
  const base = path.join(ROOT, "api", "_handlers", ...parts.slice(1));
  const candidates = [
    base + ".js",
    base + ".mjs",
    path.join(base, "index.js"),
    path.join(base, "index.mjs"),
  ];
  for (const file of candidates) {
    try {
      const st = await stat(file);
      if (st.isFile()) return { file, mtimeMs: st.mtimeMs };
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

async function loadHandler(found) {
  const cached = modCache.get(found.file);
  if (cached && cached.mtimeMs === found.mtimeMs) return cached.mod;
  // the mtime query string busts node's ESM cache for this file only
  const url = pathToFileURL(found.file).href + "?v=" + found.mtimeMs;
  const mod = await import(url);
  modCache.set(found.file, { mtimeMs: found.mtimeMs, mod });
  return mod;
}

/* --------------------- Vercel req/res shims ------------------------
   Handlers are written for Vercel's node runtime. Two habits must both
   keep working: reading req.body directly, and consuming the request
   as a stream (readBody in api/_lib/respond.js). So the raw body is
   buffered once, then exposed both ways through a fresh Readable. */
function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function makeVercelReq(req, url, bodyBuf) {
  const vreq = Readable.from(bodyBuf.length ? [bodyBuf] : []);
  vreq.method = req.method;
  vreq.headers = req.headers;
  vreq.url = req.url;
  vreq.socket = req.socket;
  vreq.query = Object.fromEntries(url.searchParams);
  if (bodyBuf.length) {
    try {
      vreq.body = JSON.parse(bodyBuf.toString("utf8"));
    } catch {
      vreq.body = undefined; // non-JSON bodies stay stream-only
    }
  }
  return vreq;
}

function decorateRes(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = (x) => {
    if (typeof x === "object" && x !== null) return res.json(x);
    res.end(String(x));
    return res;
  };
  return res;
}

async function handleApi(req, res, url) {
  const found = await resolveHandlerFile(url.pathname.replace(/\/+$/, ""));
  if (!found) {
    decorateRes(res).status(404).json({ error: "not_found", path: url.pathname });
    return;
  }
  let bodyBuf;
  try {
    bodyBuf = await collectBody(req);
  } catch {
    decorateRes(res).status(413).json({ error: "body_too_large" });
    return;
  }
  const vreq = makeVercelReq(req, url, bodyBuf);
  const vres = decorateRes(res);
  try {
    const mod = await loadHandler(found);
    if (typeof mod.default !== "function") {
      vres.status(500).json({ error: "handler_has_no_default_export" });
      return;
    }
    await mod.default(vreq, vres);
    if (!res.writableEnded) res.end(); // a handler that forgot to end
  } catch (err) {
    console.error("[api]", url.pathname, err);
    if (!res.headersSent) {
      vres.status(500).json({ error: "internal", message: String(err && err.message) });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}

/* ------------------------- static files --------------------------- */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
  ".wasm": "application/wasm",
};

async function pickStaticFile(pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (rel === "/") rel = "/index.html";
  const abs = path.normalize(path.join(ROOT, rel));
  // normalize + prefix check blocks ../ traversal out of the repo
  if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) return null;

  const tries = [abs];
  if (!path.extname(abs)) tries.push(abs + ".html", path.join(abs, "index.html"));
  for (const file of tries) {
    try {
      const st = await stat(file);
      if (st.isFile()) return { file, size: st.size };
    } catch {
      /* try next */
    }
  }
  return null;
}

async function handleStatic(req, res, url) {
  const found = await pickStaticFile(url.pathname);
  if (!found) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("404 — " + url.pathname);
    return;
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", MIME[path.extname(found.file).toLowerCase()] || "application/octet-stream");
  res.setHeader("Content-Length", found.size);
  /* Dev server: never let the browser cache anything. Stale JS has
     burned hours of "the fix does not work" that was never the fix. */
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Cache-Control", "no-store"); // dev: always fresh
  const stream = createReadStream(found.file);
  stream.on("error", () => {
    if (!res.writableEnded) res.destroy();
  });
  stream.pipe(res);
}

/* ------------------------- startup banner --------------------------
   The vault shown here is either VAULT_ADDRESS or, failing that, the
   address derived from HOUSE_WALLET_SECRET (last 32 bytes of an
   ed25519 secret key are the public key). Derivation is best-effort:
   if bs58 is not installed yet, the banner degrades instead of the
   server refusing to start. */
async function vaultLabel() {
  if (process.env.VAULT_ADDRESS) return process.env.VAULT_ADDRESS;
  const secret = process.env.HOUSE_WALLET_SECRET;
  if (!secret) return "(not set)";
  try {
    const bs58 = (await import("bs58")).default;
    const bytes = bs58.decode(secret.trim());
    if (bytes.length !== 64) return "(HOUSE_WALLET_SECRET: expected 64 bytes)";
    return bs58.encode(bytes.slice(32)) + " (derived)";
  } catch {
    return "(derived from HOUSE_WALLET_SECRET)";
  }
}

async function main() {
  const hadEnvFile = await loadEnvLocal();

  const network = process.env.NETWORK || "devnet";
  const dbMode =
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
      ? "upstash"
      : "memory (process-local, dev only)";
  const enabled = Boolean(process.env.SESSION_SECRET && process.env.HOUSE_WALLET_SECRET);
  const vault = await vaultLabel();

  const server = createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url, "http://localhost:" + PORT);
    res.on("finish", () => {
      console.log(
        req.method + " " + url.pathname + " -> " + res.statusCode + " (" + (Date.now() - started) + "ms)"
      );
    });
    try {
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url);
      } else {
        await handleStatic(req, res, url);
      }
    } catch (err) {
      console.error("[server]", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("internal error");
      }
    }
  });

  server.listen(PORT, () => {
    console.log("");
    console.log("pepe.fail dev api");
    console.log("  url      http://localhost:" + PORT);
    console.log("  root     " + ROOT);
    console.log("  env file " + (hadEnvFile ? ".env.local loaded" : "no .env.local"));
    console.log("  network  " + network);
    console.log("  vault    " + vault);
    console.log("  db       " + dbMode);
    console.log("  enabled  " + (enabled ? "true (real mode)" : "false (demo only)"));
    console.log("");
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
