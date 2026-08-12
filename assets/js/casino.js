/* ===================================================================
   pepe.fail — casino home page
   =================================================================== */

hydrateIcons();
bindScrollers();

/* Hero card icons */
const hcCasino = document.getElementById("hcCasino");
const hcLive = document.getElementById("hcLive");
if (hcCasino) hcCasino.insertAdjacentHTML("afterbegin", icon("chip", 1.9));
if (hcLive) hcLive.insertAdjacentHTML("afterbegin", icon("cards", 1.9));

/* Carousels */
fillRow("originals", ORIGINALS);
fillRow("slots", SLOTS);
fillRow("live", LIVE_GAMES);

/* ===================================================================
   Wallet entry points
   =================================================================== */

/* Starts the wallet creation flow when wallet.js is loaded. */
function startWallet() {
  if (window.PepeWallet && typeof window.PepeWallet.startCreateFlow === "function") {
    window.PepeWallet.startCreateFlow();
    return true;
  }
  return false;
}

["heroWallet", "ctaWallet"].forEach(function (id) {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener("click", startWallet);
});
