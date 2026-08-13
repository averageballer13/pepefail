/* ===================================================================
   pepe.fail — rewards page

   One source of truth: the ranks come from engine.js, so the ladder,
   the sidebar bar and the referral share can never drift apart.
   =================================================================== */

const { Rank, fmt } = window.PepeEngine;

hydrateIcons();

/* =========================== RANK HERO =========================== */
function paintRank() {
  const cur = Rank.current();
  const nxt = Rank.next();
  const pct = Math.round(Rank.progress() * 100);

  document.getElementById("rwIco").innerHTML = icon(cur.ic, 2);
  document.getElementById("rwName").textContent = cur.n;
  document.getElementById("rwPct").textContent = pct + "%";
  document.getElementById("rwFill").style.width = pct + "%";
  document.getElementById("rwXp").textContent = fmt(Rank.xp()) + " XP";
  document.getElementById("rwNext").textContent = nxt
    ? fmt(nxt.at) + " XP → " + nxt.n
    : "Max rank reached";

  document.getElementById("rwRefPct").textContent = cur.ref + "%";
  document.getElementById("rwRefNext").textContent = nxt
    ? nxt.ref + "% at " + nxt.n
    : "Highest share";

  paintLadder();
}

/* =========================== LADDER =========================== */
function paintLadder() {
  const host = document.getElementById("rwLadder");
  if (!host) return;

  const cur = Rank.current();
  const xp = Rank.xp();

  host.innerHTML = Rank.ranks
    .map(function (r) {
      const state = r.k === cur.k ? " is-current" : xp >= r.at ? " is-done" : "";
      return (
        '<div class="rw-tier' + state + '">' +
          '<div class="rw-tier__head">' +
            '<span class="rw-tier__ico">' + icon(r.ic) + "</span>" +
            '<span class="rw-tier__n">' + r.n + "</span>" +
            (r.k === cur.k ? '<span class="rw-tier__tag">You</span>' : "") +
          "</div>" +
          '<div class="rw-tier__req">' + fmt(r.at) + " XP</div>" +
          '<div class="rw-tier__perks">' +
            '<div><span>Rakeback</span><b>' + r.rakeback + "%</b></div>" +
            '<div><span>Referral share</span><b>' + r.ref + "%</b></div>" +
          "</div>" +
        "</div>"
      );
    })
    .join("");
}

/* =========================== REFERRAL LINK =========================== */
(function () {
  const REF_KEY = "pepe.ref";
  let code = null;

  try {
    const w = window.PepeWallet && window.PepeWallet.get && window.PepeWallet.get();
    const addr = w ? w.address || w.publicKey || (typeof w === "string" ? w : null) : null;
    if (addr) code = addr.slice(0, 8).toUpperCase();
  } catch (e) { code = null; }

  if (!code) {
    try {
      code = window.localStorage.getItem(REF_KEY);
      if (!code) {
        const b = new Uint8Array(4);
        window.crypto.getRandomValues(b);
        code = Array.prototype.map
          .call(b, function (n) { return n.toString(16).padStart(2, "0"); })
          .join("")
          .toUpperCase();
        window.localStorage.setItem(REF_KEY, code);
      }
    } catch (e) { code = "PEPEFAIL"; }
  }

  const link = location.origin + "/?ref=" + code;
  document.getElementById("rwLink").textContent = link;

  document.getElementById("rwCopy").addEventListener("click", async function () {
    const btn = this;
    let ok = false;
    try { await navigator.clipboard.writeText(link); ok = true; }
    catch (e) {
      const ta = document.createElement("textarea");
      ta.value = link; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
      ta.remove();
    }
    const before = btn.textContent;
    btn.textContent = ok ? "Copied" : "Copy failed";
    window.setTimeout(function () { btn.textContent = before; }, 1400);
  });
})();

paintRank();
document.addEventListener("pepe:rank", paintRank);
