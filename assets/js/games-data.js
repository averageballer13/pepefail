/* ===================================================================
   pepe.fail — game catalogue + thumbnail factory

   One entry per game that actually exists and can be played. Nothing is
   listed here as a placeholder: an empty row is honest, a row full of
   games that open nothing is not.

   ac = accent : "gold" (default) or "orange"
   =================================================================== */

const ORIGINALS = [
  { k: "plinko", n: "Frog Plinko", p: "pepe.fail", ic: "plinko", tag: "ORIGINAL", hot: true, ac: "gold", href: "games/plinko", img: "assets/img/games/plinko.jpg" },
  { k: "mines", n: "Mines", p: "pepe.fail", ic: "bomb", tag: "ORIGINAL", ac: "orange", href: "games/mines", img: "assets/img/games/mines.jpg" },
  { k: "dice", n: "Dice", p: "pepe.fail", ic: "dice", tag: "ORIGINAL", ac: "gold", href: "games/dice", img: "assets/img/games/dice.jpg" },
  { k: "crash", n: "Crash", p: "pepe.fail", ic: "rocket", tag: "ORIGINAL", hot: true, ac: "orange", href: "games/crash", img: "assets/img/games/crash.jpg" },
  { k: "limbo", n: "Limbo", p: "pepe.fail", ic: "chart", tag: "ORIGINAL", ac: "gold", href: "games/limbo", img: "assets/img/games/limbo.jpg" },
  { k: "wheel", n: "Wheel", p: "pepe.fail", ic: "wheel", tag: "ORIGINAL", ac: "orange", href: "games/wheel", img: "assets/img/games/wheel.jpg" },
  { k: "blackjack", n: "Blackjack", p: "pepe.fail", ic: "spade", tag: "ORIGINAL", ac: "gold", href: "games/blackjack", img: "assets/img/games/blackjack.jpg" },
];

/* Every playable game, keyed for history and favourites lookups. */
const ALL_GAMES = ORIGINALS.slice();

function gameByKey(k) {
  for (let i = 0; i < ALL_GAMES.length; i++) if (ALL_GAMES[i].k === k) return ALL_GAMES[i];
  return null;
}

/* --- Builds a single game thumbnail ---
   A game with `img` shows its poster; the others fall back to the icon
   treatment, so both can sit in the same row while artwork is produced. */
function gameCard(g, base) {
  const b = base || "";
  const href = g.href ? b + g.href : "#";
  const el = document.createElement("a");
  el.className = "game";
  el.href = href;

  const art = g.img
    ? `<img class="game__poster" src="${b + g.img}" alt="${g.n}" loading="lazy" />`
    : `<div class="game__icon">${icon(g.ic)}</div>`;

  el.innerHTML = `
    <div class="game__art game__art--${g.ac || "gold"}${g.img ? " has-poster" : ""}">
      ${g.tag ? `<span class="game__tag">${g.tag}</span>` : ""}
      ${g.hot ? `<span class="game__hot">${iconSolid("flame")}</span>` : ""}
      ${art}
      <div class="game__play"><button class="btn btn--gold">Play ▶</button></div>
    </div>
    <div class="game__meta">
      <div class="game__name">${g.n}</div>
      <div class="game__prov">${g.p}</div>
    </div>`;
  return el;
}

/* --- Fills a container with thumbnails ---
   An empty list renders the empty-state message instead of nothing at
   all, so a blank row never looks like a loading failure. */
function fillRow(id, list, base, emptyMsg) {
  const row = document.getElementById(id);
  if (!row) return;
  row.innerHTML = "";

  if (!list.length) {
    row.classList.add("game-row--empty");
    const box = document.createElement("div");
    box.className = "row-empty";
    box.innerHTML = emptyMsg || "Nothing here yet.";
    row.appendChild(box);
    return;
  }

  row.classList.remove("game-row--empty");
  list.forEach((g) => row.appendChild(gameCard(g, base)));
}

/* --- Injects icons marked with data-ico --- */
function hydrateIcons() {
  document.querySelectorAll("[data-ico]").forEach((el) => {
    el.innerHTML = icon(el.dataset.ico, el.dataset.sw || 1.9);
  });
}

/* --- Carousel arrows --- */
function bindScrollers() {
  document.querySelectorAll("[data-scroll]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = document.getElementById(btn.dataset.scroll);
      if (row) row.scrollBy({ left: 360 * Number(btn.dataset.dir), behavior: "smooth" });
    });
  });
}
