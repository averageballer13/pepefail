/* ===================================================================
   pepe.fail — game catalogue + shared thumbnail factory
   ac = accent : "gold" (default) or "orange"
   =================================================================== */

const ORIGINALS = [
  { n: "Frog Plinko", p: "pepe.fail", ic: "plinko", tag: "ORIGINAL", hot: true, ac: "gold", href: "games/plinko.html" },
  { n: "Mines", p: "pepe.fail", ic: "bomb", tag: "ORIGINAL", ac: "orange", href: "games/mines.html" },
  { n: "Dice", p: "pepe.fail", ic: "dice", tag: "ORIGINAL", ac: "gold", href: "games/dice.html" },
  { n: "Crash", p: "pepe.fail", ic: "rocket", tag: "ORIGINAL", hot: true, ac: "orange", href: "games/crash.html" },
  { n: "Limbo", p: "pepe.fail", ic: "chart", tag: "ORIGINAL", ac: "gold", href: "games/limbo.html" },
  { n: "Wheel", p: "pepe.fail", ic: "wheel", tag: "ORIGINAL", ac: "orange", href: "games/wheel.html" },
  { n: "Hilo", p: "pepe.fail", ic: "cards", tag: "ORIGINAL", ac: "gold", href: "games/dice.html" },
  { n: "Keno", p: "pepe.fail", ic: "grid", tag: "ORIGINAL", ac: "gold", href: "games/dice.html" },
];

const SLOTS = [
  { n: "Golden Frog", p: "pepe.fail", ic: "frog", tag: "HOT", hot: true, ac: "gold" },
  { n: "Sweet Bonanza", p: "Pragmatic", ic: "candy", ac: "orange" },
  { n: "Gates of Olympus", p: "Pragmatic", ic: "bolt", ac: "gold" },
  { n: "Duck Hunters", p: "Nolimit", ic: "target", tag: "NEW", ac: "orange" },
  { n: "Ze Zeus", p: "Hacksaw", ic: "bolt", ac: "gold" },
  { n: "Dusty Duel", p: "BGaming", ic: "cactus", ac: "orange" },
  { n: "Blood Suckers", p: "Red Tiger", ic: "spade", ac: "gold" },
  { n: "Lucky Caiman", p: "Peter & Sons", ic: "star", tag: "HOT", hot: true, ac: "gold" },
  { n: "Sugar Rush", p: "Pragmatic", ic: "candy", ac: "orange" },
  { n: "Wild West Gold", p: "Pragmatic", ic: "cactus", ac: "gold" },
  { n: "Book of Frogs", p: "pepe.fail", ic: "book", tag: "NEW", ac: "gold" },
  { n: "Diamond Rush", p: "Hacksaw", ic: "diamond", ac: "orange" },
];

const LIVE_GAMES = [
  { n: "Frog Baccarat", p: "pepe.fail", ic: "cards", tag: "LIVE", ac: "gold" },
  { n: "Lightning Roulette", p: "Evolution", ic: "wheel", tag: "LIVE", hot: true, ac: "orange" },
  { n: "Crazy Time", p: "Evolution", ic: "star", tag: "LIVE", hot: true, ac: "gold" },
  { n: "Blackjack VIP", p: "pepe.fail", ic: "spade", tag: "LIVE", ac: "gold", href: "games/blackjack.html" },
  { n: "Mega Wheel", p: "Pragmatic", ic: "wheel", tag: "LIVE", ac: "orange" },
  { n: "Dream Catcher", p: "Evolution", ic: "sparkle", tag: "LIVE", ac: "gold" },
  { n: "Monopoly Live", p: "Evolution", ic: "tophat", tag: "LIVE", ac: "gold" },
  { n: "Gold Bar Roulette", p: "Evolution", ic: "coin", tag: "LIVE", ac: "orange" },
];

/* --- Builds a single game thumbnail --- */
function gameCard(g, base) {
  const b = base || "";
  const href = g.href ? b + g.href : "#";
  const el = document.createElement("a");
  el.className = "game";
  el.href = href;
  el.innerHTML = `
    <div class="game__art game__art--${g.ac || "gold"}">
      ${g.tag ? `<span class="game__tag">${g.tag}</span>` : ""}
      ${g.hot ? `<span class="game__hot">${iconSolid("flame")}</span>` : ""}
      <div class="game__icon">${icon(g.ic)}</div>
      <div class="game__play"><button class="btn btn--gold">Play ▶</button></div>
    </div>
    <div class="game__meta">
      <div class="game__name">${g.n}</div>
      <div class="game__prov">${g.p}</div>
    </div>`;
  return el;
}

/* --- Fills a container with thumbnails --- */
function fillRow(id, list, base) {
  const row = document.getElementById(id);
  if (!row) return;
  row.innerHTML = "";
  list.forEach((g) => row.appendChild(gameCard(g, base)));
}

/* --- Injects the icons flagged with data-ico --- */
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
      if (!row) return;
      row.scrollBy({ left: 360 * Number(btn.dataset.dir), behavior: "smooth" });
    });
  });
}
