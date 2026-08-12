/* ===================================================================
   pepe.fail — casino home page
   =================================================================== */

hydrateIcons();
bindScrollers();

/* Carousels */
fillRow("originals", ORIGINALS);

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
