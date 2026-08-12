/* ===================================================================
   pepe.fail — bibliothèque d'icônes maison
   Tracées en currentColor → colorées en or / orange fluo via le CSS.
   Usage : icon("frog")  →  chaîne SVG
   =================================================================== */
const ICONS = {
  /* --- Marque / jeux --- */
  frog: '<path d="M3 11c0-4 4-6.5 9-6.5S21 7 21 11c0 4.2-4 7.2-9 7.2S3 15.2 3 11Z"/><circle cx="8" cy="8.4" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="8.4" r="1.5" fill="currentColor" stroke="none"/><path d="M8.4 13.4c1 .8 2.2 1.2 3.6 1.2s2.6-.4 3.6-1.2"/>',
  candy: '<circle cx="11" cy="8" r="5.5"/><path d="M11 4.2a3.8 3.8 0 1 0 3.8 3.8"/><path d="M11 13.5V20"/><path d="M8.5 20h5"/>',
  bolt: '<path d="M13 2 4 13.5h6L9 22l9-11.5h-6L13 2Z"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="15" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="1.3" fill="currentColor" stroke="none"/>',
  bomb: '<circle cx="11" cy="14.5" r="6"/><path d="M15.2 10.3 17.5 8M17.5 8l1-1.4M17.5 8l1.6.4M17.5 8l-.4-1.7"/><path d="M19.5 4.5h.01M21 6.5h.01"/>',
  rocket: '<path d="M12 3c3 2.2 5 5.2 5 9.2L15 16H9l-2-3.8C7 8.2 9 5.2 12 3Z"/><circle cx="12" cy="10" r="1.7"/><path d="M9 16l-2 4.5M15 16l2 4.5M10.5 19.5h3"/>',
  cards: '<rect x="6.5" y="4" width="11" height="16" rx="2.2"/><path d="M12 8.3 13.7 11 12 13.7 10.3 11 12 8.3Z" fill="currentColor" stroke="none"/>',
  spade: '<path d="M12 3.5C9.2 7.4 5 9.3 5 13.2a3.4 3.4 0 0 0 6 2.2c0 2.2-.6 3.7-1.6 4.6h5.2c-1-.9-1.6-2.4-1.6-4.6a3.4 3.4 0 0 0 6-2.2C19 9.3 14.8 7.4 12 3.5Z"/>',
  wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.2"/><path d="M12 3v3.8M12 17.2V21M3 12h3.8M17.2 12H21M5.6 5.6l2.7 2.7M15.7 15.7l2.7 2.7M18.4 5.6l-2.7 2.7M8.3 15.7l-2.7 2.7"/>',
  chip: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v3.2M12 17.8V21M3 12h3.2M17.8 12H21M5.6 5.6 7.9 7.9M16.1 16.1l2.3 2.3M18.4 5.6 16.1 7.9M7.9 16.1 5.6 18.4"/>',
  crown: '<path d="M4 8.5 7.6 12 12 5.5 16.4 12 20 8.5 18.4 18H5.6L4 8.5Z"/><path d="M5.6 18h12.8"/>',
  trophy: '<path d="M8 4h8v4.5a4 4 0 0 1-8 0V4Z"/><path d="M8 5.2H5.2v1a3 3 0 0 0 3 3M16 5.2h2.8v1a3 3 0 0 1-3 3"/><path d="M12 12.5v3M9.5 20h5M10 15.5h4l.6 4.5H9.4l.6-4.5Z"/>',
  diamond: '<path d="M6 4h12l3 4.8-9 11.2L3 8.8 6 4Z"/><path d="M3 8.8h18M9 4 6.2 8.8 12 20M15 4l2.8 4.8L12 20"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  gift: '<rect x="4" y="9" width="16" height="4" rx="1"/><path d="M5 13v7h14v-7M12 9v11"/><path d="M12 9S10.6 4.2 8.2 4.2A2.4 2.4 0 0 0 8.2 9M12 9s1.4-4.8 3.8-4.8A2.4 2.4 0 0 1 15.8 9"/>',
  star: '<path d="m12 3 2.6 5.6 6 .8-4.4 4.1 1.1 6L12 16.6 6.7 19.5l1.1-6L3.4 9.4l6-.8L12 3Z"/>',
  sparkle: '<path d="M12 3c.6 4.4 1.6 5.4 5.8 6-4.2.6-5.2 1.6-5.8 6-.6-4.4-1.6-5.4-5.8-6 4.2-.6 5.2-1.6 5.8-6Z"/>',
  plinko: '<circle cx="12" cy="5" r="1.1" fill="currentColor" stroke="none"/><circle cx="8.5" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="5" cy="15" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="15" r="1.1" fill="currentColor" stroke="none"/><circle cx="19" cy="15" r="1.1" fill="currentColor" stroke="none"/><path d="M4 20h16"/>',
  grid: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/>',
  lock: '<rect x="4.8" y="10.5" width="14.4" height="9.5" rx="2.2"/><path d="M8.2 10.5V7.8a3.8 3.8 0 0 1 7.6 0v2.7"/><circle cx="12" cy="15.2" r="1.5" fill="currentColor" stroke="none"/>',
  chart: '<path d="M4 4v16h16"/><path d="m7 15 3.5-3.5 3 3L20 8"/><path d="M20 12V8h-4"/>',
  tophat: '<path d="M8 4h8v9H8z"/><path d="M4 13.5h16v1.8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-1.8Z"/><path d="M8.5 9.5h7"/>',
  cactus: '<path d="M12 21V7"/><path d="M12 13.5H9.2A2.2 2.2 0 0 1 7 11.3V9.2"/><path d="M12 11h2.8A2.2 2.2 0 0 0 17 8.8V6.8"/><path d="M9.5 21h5"/><path d="M12 7a2 2 0 0 0-2-2 2 2 0 0 1 2-2 2 2 0 0 1 2 2 2 2 0 0 0-2 2Z" fill="currentColor" stroke="none"/>',
  slot: '<rect x="3.5" y="6" width="15" height="12" rx="2"/><path d="M8.5 6v12M13.5 6v12"/><circle cx="20.5" cy="8" r="1.2"/><path d="M20.5 9.2V13"/><path d="M6 10.5v3M11 10.5v3M16 10.5v3"/>',
  ball: '<circle cx="12" cy="12" r="9"/><path d="M12 7.2 14.9 9.3 13.8 12.7h-3.6L9.1 9.3 12 7.2Z"/><path d="M12 3v4.2M4.6 8.3l3.5 2.4M19.4 8.3l-3.5 2.4M6.8 19l1.4-3.4M17.2 19l-1.4-3.4"/>',

  /* --- Navigation --- */
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  shield: '<path d="M12 2 4 6v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6z"/>',
  book: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v18H5.5A1.5 1.5 0 0 1 4 19.5z"/><path d="M8 8h7M8 12h7M8 16h4"/>',
  ticket: '<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h15A1.5 1.5 0 0 1 21 8.5v1.8a2 2 0 0 0 0 3.4v1.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.5v-1.8a2 2 0 0 0 0-3.4z"/><path d="M14 7v10"/>',
  headset: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  arrowL: '<path d="m15 18-6-6 6-6"/>',
  arrowR: '<path d="m9 18 6-6-6-6"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M14.5 9.3c-.6-.8-1.5-1.1-2.5-1.1-1.4 0-2.5.8-2.5 1.9 0 2.6 5 1.4 5 4 0 1.1-1.1 1.9-2.5 1.9-1 0-1.9-.3-2.5-1.1"/>',
  flame: '<path d="M12 2c1 3-1 4.5-2.3 6.2C8.3 9.9 8 11 8 12a4 4 0 0 0 8 0c0-1.4-.6-2.6-1.3-3.6.4 1.2.1 2.3-.7 2.9.3-2.6-1.4-4.7-3-6-.2 1.3-1 2-1.8 2.7C10 8 10.8 4.9 12 2Z"/>',
};

/* Renvoie une chaîne SVG prête à injecter */
function icon(key, sw) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw || 1.7}" stroke-linecap="round" stroke-linejoin="round">${ICONS[key] || ICONS.chip}</svg>`;
}

/* Version pleine (sans contour) pour les petits badges type flamme */
function iconSolid(key) {
  return `<svg viewBox="0 0 24 24" fill="currentColor">${ICONS[key] || ICONS.chip}</svg>`;
}
