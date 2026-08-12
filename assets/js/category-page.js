/* ===================================================================
   pepe.fail — category pages
   Each page sets window.CAT = "<key>" before loading this script.

   These lists are read from real state: what you played, what you
   pinned. Nothing is padded out with games that do not exist.
   =================================================================== */

const { History } = window.PepeEngine;

const CATS = {
  nouveautes: {
    title: "All Games",
    ic: "sparkle",
    sub: "Every game live on pepe.fail.",
    list: () => ALL_GAMES,
    empty: "No games yet.",
  },
  favoris: {
    title: "Favorites",
    ic: "star",
    sub: "The games you pinned.",
    list: () => History.favorites().map(gameByKey).filter(Boolean),
    empty:
      "You have not pinned anything yet.<br>" +
      '<a href="../casino.html#originals">Browse the games</a> and hit the star on a tile.',
  },
  recent: {
    title: "Recently Played",
    ic: "clock",
    sub: "Pick up where you left off.",
    list: () => History.recent().map((e) => gameByKey(e.k)).filter(Boolean),
    empty:
      "You have not played anything yet.<br>" +
      '<a href="../casino.html#originals">Pick a game</a> — it shows up here after your first round.',
  },
};

/* pages/slots.html and pages/live.html point here too: both categories
   are empty until such games exist, and say so rather than inventing a
   catalogue. */
CATS.slots = {
  title: "Slots",
  ic: "slot",
  sub: "Slot machines are not live yet.",
  list: () => [],
  empty:
    "No slots yet.<br>" +
    'In the meantime, the <a href="../casino.html#originals">originals</a> are all playable.',
};

CATS.live = {
  title: "Live Games",
  ic: "cards",
  sub: "Live dealer tables are not live yet.",
  list: () => [],
  empty:
    "No live tables yet.<br>" +
    'Try <a href="../games/blackjack.html">Blackjack</a> in the meantime.',
};

(function mountCategory() {
  const c = CATS[window.CAT];
  if (!c) return;

  document.getElementById("pageHead").innerHTML = `
    <h1><span style="display:inline-grid;place-items:center;width:34px;height:34px;vertical-align:-6px;color:var(--gold);margin-right:6px">${icon(c.ic)}</span>${c.title}</h1>
    <p>${c.sub}</p>`;

  const filters = document.getElementById("filters");
  if (filters) filters.remove();

  function render() {
    const list = c.list();
    const grid = document.getElementById("grid");
    grid.innerHTML = "";

    if (!list.length) {
      grid.classList.add("grid--empty");
      const box = document.createElement("div");
      box.className = "row-empty row-empty--page";
      box.innerHTML = c.empty;
      grid.appendChild(box);
      return;
    }

    grid.classList.remove("grid--empty");
    list.forEach((g) => grid.appendChild(gameCard(g, "../")));
  }

  render();
  document.addEventListener("pepe:recent", render);
  document.addEventListener("pepe:favorites", render);

  document.title = `${c.title} — pepe.fail`;
})();
