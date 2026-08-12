/* ===================================================================
   pepe.fail — catalogue de jeux + fabrique de vignettes (partagé)
   ac = accent : "gold" (défaut) ou "orange"
   =================================================================== */

const ORIGINALS = [
  { n: "Frog Plinko", p: "pepe.fail", ic: "plinko", tag: "ORIGINAL", hot: true, ac: "gold", href: "jeux/plinko.html" },
  { n: "Mines", p: "pepe.fail", ic: "bomb", tag: "ORIGINAL", ac: "orange", href: "jeux/mines.html" },
  { n: "Dice", p: "pepe.fail", ic: "dice", tag: "ORIGINAL", ac: "gold", href: "jeux/dice.html" },
  { n: "Crash", p: "pepe.fail", ic: "rocket", tag: "ORIGINAL", hot: true, ac: "orange", href: "jeux/crash.html" },
  { n: "Limbo", p: "pepe.fail", ic: "chart", tag: "ORIGINAL", ac: "gold", href: "jeux/limbo.html" },
  { n: "Wheel", p: "pepe.fail", ic: "wheel", tag: "ORIGINAL", ac: "orange", href: "jeux/wheel.html" },
  { n: "Hilo", p: "pepe.fail", ic: "cards", tag: "ORIGINAL", ac: "gold", href: "jeux/dice.html" },
  { n: "Keno", p: "pepe.fail", ic: "grid", tag: "ORIGINAL", ac: "gold", href: "jeux/dice.html" },
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
  { n: "Blackjack VIP", p: "Evolution", ic: "spade", tag: "LIVE", ac: "gold" },
  { n: "Mega Wheel", p: "Pragmatic", ic: "wheel", tag: "LIVE", ac: "orange" },
  { n: "Dream Catcher", p: "Evolution", ic: "sparkle", tag: "LIVE", ac: "gold" },
  { n: "Monopoly Live", p: "Evolution", ic: "tophat", tag: "LIVE", ac: "gold" },
  { n: "Gold Bar Roulette", p: "Evolution", ic: "coin", tag: "LIVE", ac: "orange" },
];

/* --- Fabrique une vignette de jeu --- */
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
      <div class="game__play"><button class="btn btn--gold">Jouer ▶</button></div>
    </div>
    <div class="game__meta">
      <div class="game__name">${g.n}</div>
      <div class="game__prov">${g.p}</div>
    </div>`;
  return el;
}

/* --- Remplit un conteneur --- */
function fillRow(id, list, base) {
  const row = document.getElementById(id);
  if (!row) return;
  row.innerHTML = "";
  list.forEach((g) => row.appendChild(gameCard(g, base)));
}

/* --- Injecte les icônes marquées data-ico --- */
function hydrateIcons() {
  document.querySelectorAll("[data-ico]").forEach((el) => {
    el.innerHTML = icon(el.dataset.ico, el.dataset.sw || 1.9);
  });
}

/* --- Flèches de carrousel --- */
function bindScrollers() {
  document.querySelectorAll("[data-scroll]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = document.getElementById(btn.dataset.scroll);
      row.scrollBy({ left: 360 * Number(btn.dataset.dir), behavior: "smooth" });
    });
  });
}
