/* ===================================================================
   pepe.fail — category pages (UI only)
   Each page sets window.CAT = "<key>" before loading this script.
   =================================================================== */

const CATS = {
  slots: {
    title: "Slots",
    ic: "slot",
    sub: "Hundreds of slots from the best studios.",
    filters: ["All", "Popular", "New", "Jackpots", "Megaways", "Bonus Buy"],
    list: () => SLOTS.concat(SLOTS.slice(0, 6)),
  },
  live: {
    title: "Live Games",
    ic: "cards",
    sub: "Live dealers around the clock — roulette, blackjack and game shows.",
    filters: ["All", "Roulette", "Blackjack", "Baccarat", "Game Shows"],
    list: () => LIVE_GAMES.concat(LIVE_GAMES.slice(0, 4)),
  },
  nouveautes: {
    title: "New Releases",
    ic: "sparkle",
    sub: "The latest games added to pepe.fail.",
    filters: ["All", "This Week", "This Month", "Originals"],
    list: () => ORIGINALS.concat(SLOTS.slice(0, 8)),
  },
  favoris: {
    title: "Favorites",
    ic: "star",
    sub: "The games you pinned.",
    filters: ["All", "Originals", "Slots", "Live"],
    list: () => ORIGINALS.slice(0, 6).concat(SLOTS.slice(0, 4)),
  },
  recent: {
    title: "Recently Played",
    ic: "clock",
    sub: "Pick up where you left off.",
    filters: ["All", "Today", "This Week"],
    list: () => ORIGINALS.slice(0, 4).concat(SLOTS.slice(2, 10)),
  },
};

(function mountCategory() {
  const c = CATS[window.CAT];
  if (!c) return;

  document.getElementById("pageHead").innerHTML = `
    <h1><span style="display:inline-grid;place-items:center;width:34px;height:34px;vertical-align:-6px;color:var(--gold);margin-right:6px">${icon(c.ic)}</span>${c.title}</h1>
    <p>${c.sub}</p>`;

  document.getElementById("filters").innerHTML = c.filters
    .map((f, i) => `<button class="${i === 0 ? "active" : ""}">${f}</button>`)
    .join("");

  const grid = document.getElementById("grid");
  c.list().forEach((g) => grid.appendChild(gameCard(g, "../")));

  document.title = `${c.title} — pepe.fail`;

  document.querySelectorAll("#filters button").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#filters button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
    });
  });
})();
