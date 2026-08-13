/* Shared HTTP helpers for the Vercel serverless functions.
   Every endpoint answers JSON through these so the client can rely on a
   single error shape: { error: "message" } with a meaningful status. */

export function ok(res, data) {
  res.status(200).json(data || {});
}

export function bad(res, code, msg) {
  res.status(code).json({ error: msg });
}

/* Vercel parses JSON bodies when the Content-Type header is right, but the
   client may send text/plain (beacon-style calls) and local dev servers may
   hand us the raw stream. Accept all three shapes and never throw: a bad
   body becomes an empty object and endpoint validation rejects it. */
export async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "object") return req.body;
    if (typeof req.body === "string") {
      try {
        return JSON.parse(req.body);
      } catch (e) {
        return {};
      }
    }
  }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

/* Returns true when the method matches; otherwise answers 405 itself so the
   endpoint can simply early-return. */
export function methodGuard(req, res, method) {
  if (req.method === method) return true;
  res.setHeader("Allow", method);
  bad(res, 405, "method not allowed");
  return false;
}
