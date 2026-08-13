/* ===================================================================
   pepe.fail — Solana wallet (browser only)

   window.PepeWallet = { startCreateFlow(), get(), open(), disconnect() }

   How it works, exactly as advertised in the modal trust band:
   - The ed25519 key pair is generated in the browser with tweetnacl.
   - The 64-byte secret key is encrypted with WebCrypto: PBKDF2-SHA256
     (250 000 iterations, random 16-byte salt) then AES-GCM-256 with a
     random 12-byte IV.
   - localStorage holds only { version, address, ct, iv, salt, iterations }.
     The plaintext key is never stored, never sent anywhere, never logged.
   - This file performs no fetch/XHR of any kind. The only network access is
     the dynamic import of the two crypto libraries from a CDN.

   Requires modal.js (window.PepeModal) to be loaded first.
   =================================================================== */
(function () {
  "use strict";

  var STORAGE_KEY = "pepe.wallet";
  var VERSION = 1;
  var PBKDF2_ITERATIONS = 250000;
  var MIN_PASSWORD = 8;

  /* In-memory only, wiped when the wallet modal closes or the page is hidden. */
  var session = null;
  var libs = null;
  var libsPromise = null;

  /* ===================================================================
     QR ENCODER — byte mode, EC level M, versions 1..10.
     Verified against the ISO format/version tables, the standard Reed-Solomon
     generator polynomials, and a full read-back with zero RS syndromes.
     =================================================================== */

  /* version: [ecPerBlock, blocksGroup1, dataPerBlock1, blocksGroup2, dataPerBlock2] */
  var QR_ECC_M = {
    1: [10, 1, 16, 0, 0], 2: [16, 1, 28, 0, 0], 3: [26, 1, 44, 0, 0],
    4: [18, 2, 32, 0, 0], 5: [24, 2, 43, 0, 0], 6: [16, 4, 27, 0, 0],
    7: [18, 4, 31, 0, 0], 8: [22, 2, 38, 2, 39], 9: [22, 3, 36, 2, 37],
    10: [26, 4, 43, 1, 44],
  };

  var QR_ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };

  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }

  function rsGenerator(degree) {
    var result = new Uint8Array(degree);
    result[degree - 1] = 1;
    var root = 1;
    for (var i = 0; i < degree; i++) {
      for (var j = 0; j < degree; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 2);
    }
    return result;
  }

  function rsRemainder(data, gen) {
    var result = new Uint8Array(gen.length);
    for (var k = 0; k < data.length; k++) {
      var factor = data[k] ^ result[0];
      result.copyWithin(0, 1);
      result[result.length - 1] = 0;
      for (var i = 0; i < result.length; i++) result[i] ^= gfMul(gen[i], factor);
    }
    return result;
  }

  function qrDataCodewords(version) {
    var t = QR_ECC_M[version];
    return t[1] * t[2] + t[3] * t[4];
  }

  function qrPickVersion(len) {
    for (var v = 1; v <= 10; v++) {
      var header = v >= 10 ? 20 : 12; /* mode 4 bits + character count 8 or 16 bits */
      if (Math.floor((qrDataCodewords(v) * 8 - header) / 8) >= len) return v;
    }
    return null;
  }

  function qrBuildData(bytes, version) {
    var bits = [];
    var push = function (value, width) {
      for (var i = width - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    };
    push(0x4, 4);
    push(bytes.length, version >= 10 ? 16 : 8);
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);

    var capacity = qrDataCodewords(version) * 8;
    for (var t = 0; t < 4 && bits.length < capacity; t++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    var out = [];
    for (var b = 0; b < bits.length; b += 8) {
      var byte = 0;
      for (var j = 0; j < 8; j++) byte = (byte << 1) | bits[b + j];
      out.push(byte);
    }
    for (var pad = 0xec; out.length < qrDataCodewords(version); pad ^= 0xec ^ 0x11) out.push(pad);
    return Uint8Array.from(out);
  }

  function qrInterleave(data, version) {
    var t = QR_ECC_M[version];
    var ecLen = t[0], b1 = t[1], d1 = t[2], b2 = t[3], d2 = t[4];
    var gen = rsGenerator(ecLen);
    var blocks = [], eccs = [], offset = 0;

    for (var i = 0; i < b1 + b2; i++) {
      var size = i < b1 ? d1 : d2;
      var block = data.subarray(offset, offset + size);
      offset += size;
      blocks.push(block);
      eccs.push(rsRemainder(block, gen));
    }

    var result = [];
    var maxData = Math.max(d1, d2 || 0);
    for (var k = 0; k < maxData; k++) {
      for (var x = 0; x < blocks.length; x++) if (k < blocks[x].length) result.push(blocks[x][k]);
    }
    for (var e = 0; e < ecLen; e++) {
      for (var y = 0; y < eccs.length; y++) result.push(eccs[y][e]);
    }
    return Uint8Array.from(result);
  }

  function qrFormatBits(mask) {
    var data = mask; /* EC level M = 0b00 */
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return (((data << 10) | rem) ^ 0x5412) & 0x7fff;
  }

  function qrVersionBits(version) {
    var rem = version;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    return ((version << 12) | rem) >>> 0;
  }

  function qrDrawFormat(m, mask) {
    var size = m.length;
    var bits = qrFormatBits(mask);
    var i;
    for (i = 0; i <= 5; i++) m[i][8] = (bits >>> i) & 1;
    m[7][8] = (bits >>> 6) & 1;
    m[8][8] = (bits >>> 7) & 1;
    m[8][7] = (bits >>> 8) & 1;
    for (i = 9; i < 15; i++) m[8][14 - i] = (bits >>> i) & 1;
    for (i = 0; i < 8; i++) m[8][size - 1 - i] = (bits >>> i) & 1;
    for (i = 8; i < 15; i++) m[size - 15 + i][8] = (bits >>> i) & 1;
    m[size - 8][8] = 1; /* always dark */
  }

  function qrDrawFunctions(m, version) {
    var size = m.length;
    var set = function (x, y, v) {
      if (x >= 0 && y >= 0 && x < size && y < size) m[y][x] = v ? 1 : 0;
    };
    var i, j, dx, dy;

    /* Timing patterns */
    for (i = 0; i < size; i++) {
      set(6, i, i % 2 === 0);
      set(i, 6, i % 2 === 0);
    }

    /* Finder patterns and separators */
    var finder = function (cx, cy) {
      for (dy = -4; dy <= 4; dy++) {
        for (dx = -4; dx <= 4; dx++) {
          var dist = Math.max(Math.abs(dx), Math.abs(dy));
          set(cx + dx, cy + dy, dist !== 2 && dist !== 4);
        }
      }
    };
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);

    /* Alignment patterns */
    var centers = QR_ALIGN[version];
    for (i = 0; i < centers.length; i++) {
      for (j = 0; j < centers.length; j++) {
        var skip =
          (i === 0 && j === 0) ||
          (i === 0 && j === centers.length - 1) ||
          (i === centers.length - 1 && j === 0);
        if (skip) continue;
        for (dy = -2; dy <= 2; dy++) {
          for (dx = -2; dx <= 2; dx++) {
            set(centers[j] + dx, centers[i] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      }
    }

    /* Reserve the exact format-information cells; real bits written after masking */
    qrDrawFormat(m, 0);

    /* Version information block, version 7 and up */
    if (version >= 7) {
      var vbits = qrVersionBits(version);
      for (i = 0; i < 18; i++) {
        var bit = (vbits >>> i) & 1;
        var a = size - 11 + (i % 3);
        var b = Math.floor(i / 3);
        set(a, b, bit);
        set(b, a, bit);
      }
    }
  }

  function qrDrawCodewords(m, codewords) {
    var size = m.length;
    var i = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? size - 1 - vert : vert;
          if (m[y][x] === -1 && i < codewords.length * 8) {
            m[y][x] = (codewords[i >>> 3] >>> (7 - (i & 7))) & 1;
            i++;
          }
        }
      }
    }
    /* Remainder bits stay light */
    for (var ry = 0; ry < size; ry++) {
      for (var rx = 0; rx < size; rx++) if (m[ry][rx] === -1) m[ry][rx] = 0;
    }
  }

  function qrMaskBit(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  }

  function qrPenalty(m) {
    var size = m.length;
    var score = 0;
    var x, y, run;

    for (y = 0; y < size; y++) {
      run = 1;
      for (x = 1; x < size; x++) {
        if (m[y][x] === m[y][x - 1]) { run++; if (run === 5) score += 3; else if (run > 5) score += 1; }
        else run = 1;
      }
    }
    for (x = 0; x < size; x++) {
      run = 1;
      for (y = 1; y < size; y++) {
        if (m[y][x] === m[y - 1][x]) { run++; if (run === 5) score += 3; else if (run > 5) score += 1; }
        else run = 1;
      }
    }
    for (y = 0; y < size - 1; y++) {
      for (x = 0; x < size - 1; x++) {
        var c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
      }
    }

    var pattern = [1, 0, 1, 1, 1, 0, 1];
    var scan = function (get) {
      for (var i = 0; i + 6 < size; i++) {
        var hit = true;
        for (var k = 0; k < 7; k++) if (get(i + k) !== pattern[k]) { hit = false; break; }
        if (!hit) continue;
        var before = true, after = true, v;
        for (k = 1; k <= 4; k++) { v = i - k >= 0 ? get(i - k) : 0; if (v !== 0) { before = false; break; } }
        for (k = 1; k <= 4; k++) { v = i + 6 + k < size ? get(i + 6 + k) : 0; if (v !== 0) { after = false; break; } }
        if (before || after) score += 40;
      }
    };
    for (y = 0; y < size; y++) scan((function (row) { return function (i) { return m[row][i]; }; })(y));
    for (x = 0; x < size; x++) scan((function (col) { return function (i) { return m[i][col]; }; })(x));

    var dark = 0;
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) dark += m[y][x];
    var total = size * size;
    score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
    return score;
  }

  function qrEncode(text) {
    var bytes = new TextEncoder().encode(text);
    var version = qrPickVersion(bytes.length);
    if (!version) return null;
    var size = version * 4 + 17;

    var base = [];
    for (var i = 0; i < size; i++) base.push(new Int8Array(size).fill(-1));
    qrDrawFunctions(base, version);

    var isFunction = base.map(function (row) {
      return Array.prototype.map.call(row, function (v) { return v !== -1; });
    });
    qrDrawCodewords(base, qrInterleave(qrBuildData(bytes, version), version));

    var best = null;
    for (var mask = 0; mask < 8; mask++) {
      var m = base.map(function (row) { return Int8Array.from(row); });
      for (var y = 0; y < size; y++) {
        for (var x = 0; x < size; x++) {
          if (!isFunction[y][x] && qrMaskBit(mask, x, y)) m[y][x] ^= 1;
        }
      }
      qrDrawFormat(m, mask);
      var p = qrPenalty(m);
      if (!best || p < best.penalty) best = { penalty: p, modules: m };
    }
    return { size: size, modules: best.modules };
  }

  /* Renders the QR as a self-contained SVG string, or null if it cannot fit. */
  function qrSvg(text, label) {
    var qr;
    try {
      qr = qrEncode(text);
    } catch (e) {
      return null;
    }
    if (!qr) return null;

    var quiet = 4;
    var dim = qr.size + quiet * 2;
    var path = "";
    for (var y = 0; y < qr.size; y++) {
      var x = 0;
      while (x < qr.size) {
        if (qr.modules[y][x]) {
          var run = 1;
          while (x + run < qr.size && qr.modules[y][x + run]) run++;
          path += "M" + (x + quiet) + " " + (y + quiet) + "h" + run + "v1h-" + run + "z";
          x += run;
        } else {
          x++;
        }
      }
    }
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + " " + dim +
      '" shape-rendering="crispEdges" role="img" aria-label="' + escapeHtml(label || "QR code") + '">' +
      '<rect width="' + dim + '" height="' + dim + '" fill="#ffffff"/>' +
      '<path d="' + path + '" fill="#0d1017"/></svg>'
    );
  }

  /* ===================================================================
     HELPERS
     =================================================================== */

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function wIcon(key, sw) {
    return window.PepeModal && window.PepeModal.icon ? window.PepeModal.icon(key, sw) : "";
  }

  function hasModal() {
    if (window.PepeModal && typeof window.PepeModal.open === "function") return true;
    console.error("PepeWallet: modal.js must be loaded before wallet.js.");
    return false;
  }

  function hasWebCrypto() {
    return !!(window.crypto && window.crypto.subtle && window.crypto.getRandomValues);
  }

  function toBase64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function fromBase64(text) {
    var bin = atob(text);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function shorten(address) {
    return address.length > 14 ? address.slice(0, 6) + "…" + address.slice(-6) : address;
  }

  /* --- Crypto libraries, loaded on demand --- */
  function loadLibs() {
    if (libs) return Promise.resolve(libs);
    if (libsPromise) return libsPromise;

    libsPromise = Promise.all([
      import("https://esm.sh/tweetnacl@1.0.3"),
      import("https://esm.sh/bs58@5.0.0"),
    ])
      .then(function (mods) {
        libs = {
          nacl: mods[0].default || mods[0],
          bs58: mods[1].default || mods[1],
        };
        if (!libs.nacl || !libs.nacl.sign || !libs.bs58 || !libs.bs58.encode) {
          throw makeError("libs", "Crypto libraries loaded in an unexpected shape.");
        }
        return libs;
      })
      .catch(function (err) {
        libsPromise = null;
        throw err && err.reason === "libs" ? err : makeError("libs", "Library load failed.");
      });

    return libsPromise;
  }

  function makeError(reason, message) {
    var err = new Error(message);
    err.reason = reason;
    return err;
  }

  function describeError(err) {
    if (!err) return "Something went wrong. Please try again.";
    if (err.reason === "libs") {
      return "Could not load the crypto libraries. Check your connection and try again.";
    }
    if (err.reason === "password") return err.message;
    if (err.name === "OperationError" || err.reason === "decrypt") {
      return "Wrong password.";
    }
    if (err.name === "QuotaExceededError") {
      return "This browser refused to store the wallet. Free up storage and try again.";
    }
    return "Something went wrong. Please try again.";
  }

  /* --- Encryption --- */
  function deriveKey(password, salt, iterations) {
    return crypto.subtle
      .importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: "PBKDF2", salt: salt, iterations: iterations, hash: "SHA-256" },
          base,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"]
        );
      });
  }

  function encryptSecret(secretKey, password) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return deriveKey(password, salt, PBKDF2_ITERATIONS)
      .then(function (key) {
        return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, secretKey);
      })
      .then(function (buffer) {
        return {
          ct: toBase64(new Uint8Array(buffer)),
          iv: toBase64(iv),
          salt: toBase64(salt),
          iterations: PBKDF2_ITERATIONS,
        };
      });
  }

  function decryptSecret(store, password) {
    return deriveKey(password, fromBase64(store.salt), store.iterations || PBKDF2_ITERATIONS)
      .then(function (key) {
        return crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(store.iv) }, key, fromBase64(store.ct));
      })
      .then(
        function (buffer) {
          return new Uint8Array(buffer);
        },
        function () {
          throw makeError("decrypt", "Wrong password.");
        }
      );
  }

  /* --- Storage --- */
  function readStore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !data.address || !data.ct || !data.iv || !data.salt) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function writeStore(address, blob) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: VERSION,
        address: address,
        ct: blob.ct,
        iv: blob.iv,
        salt: blob.salt,
        iterations: blob.iterations,
      })
    );
  }

  function wipeSession() {
    if (session && session.secretKey) {
      try {
        session.secretKey.fill(0);
      } catch (e) {
        /* ignore */
      }
    }
    var had = !!session;
    session = null;
    if (had) emit();
  }

  function emit() {
    var store = readStore();
    document.dispatchEvent(
      new CustomEvent("pepe:wallet", {
        detail: {
          address: store ? store.address : null,
          exists: !!store,
          unlocked: !!session,
        },
      })
    );
  }

  window.addEventListener("pagehide", function () {
    if (session && session.secretKey) {
      try {
        session.secretKey.fill(0);
      } catch (e) {
        /* ignore */
      }
      session = null;
    }
  });

  /* --- Password strength: length and character variety, nothing fancier --- */
  function strengthOf(password) {
    if (password.length < MIN_PASSWORD) return 0;
    var score = 1;
    if (password.length >= 12) score++;
    if (password.length >= 16) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return Math.min(4, score);
  }

  var STRENGTH_LABEL = [
    "Too short",
    "Weak — add length or variety",
    "Fair",
    "Good",
    "Strong",
  ];

  /* --- Copy to clipboard --- */
  /* navigator.clipboard.writeText never settles while the document is unfocused,
     so fall back to the synchronous path instead of leaving the button silent. */
  function copyToClipboard(text) {
    var modern = navigator.clipboard && navigator.clipboard.writeText && document.hasFocus();
    if (!modern) return legacyCopy(text);

    return new Promise(function (resolve, reject) {
      var settled = false;
      var fallback = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        legacyCopy(text).then(resolve, reject);
      };
      var timer = setTimeout(fallback, 1000);

      navigator.clipboard.writeText(text).then(function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      }, fallback);
    });
  }

  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.top = "-1000px";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      var ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (e) {
        ok = false;
      }
      field.value = "";
      document.body.removeChild(field);
      ok ? resolve() : reject(new Error("copy-unavailable"));
    });
  }

  function bindCopy(handle, selector, getText) {
    var btn = handle.find(selector);
    if (!btn) return;
    var label = btn.querySelector("[data-copy-label]");
    var original = label ? label.textContent : "";
    var timer = null;

    btn.addEventListener("click", function () {
      copyToClipboard(getText()).then(
        function () {
          btn.classList.add("is-done");
          if (label) label.textContent = "Copied";
          clearTimeout(timer);
          timer = setTimeout(function () {
            btn.classList.remove("is-done");
            if (label) label.textContent = original;
          }, 1800);
        },
        function () {
          if (label) label.textContent = "Select the text and press Ctrl+C";
        }
      );
    });
  }

  function copyButton(selectorName, label) {
    return (
      '<button type="button" class="pm-copy" data-copy="' + selectorName + '">' +
      wIcon("copy") +
      '<span data-copy-label>' + escapeHtml(label) + "</span></button>"
    );
  }

  /* --- Error slot inside a modal --- */
  function errorSlot() {
    return '<div class="pm-alert pm-alert--error" data-error role="alert" hidden></div>';
  }

  function showError(handle, message) {
    var slot = handle.find("[data-error]");
    if (!slot) return;
    slot.innerHTML = wIcon("alert") + "<span>" + escapeHtml(message) + "</span>";
    slot.hidden = false;
  }

  function clearError(handle) {
    var slot = handle.find("[data-error]");
    if (slot) slot.hidden = true;
  }

  function steps(current) {
    var out = '<div class="pm-steps">';
    for (var i = 1; i <= 3; i++) out += '<i class="' + (i <= current ? "is-on" : "") + '"></i>';
    return out + "</div>";
  }

  /* ===================================================================
     SCREENS
     =================================================================== */

  var TEXT = {
    createTitle: "Create a wallet",
    createSub: "Pick a password. It encrypts your private key on this device.",
    unlockTitle: "Open wallet",
    unlockSub: "Enter your password to unlock the wallet stored in this browser.",
  };

  /* --- 1. Password --- */
  function screenPassword(handle) {
    handle.setTitle(TEXT.createTitle);
    handle.setSubtitle(TEXT.createSub);
    handle.setBody(
      steps(1) +
        errorSlot() +
        '<div class="pm-field" style="margin-top:12px">' +
        '<label class="pm-label" for="pepe-pw">Password</label>' +
        '<input class="pm-input" type="password" id="pepe-pw" autocomplete="new-password" spellcheck="false" placeholder="At least ' +
        MIN_PASSWORD +
        ' characters" />' +
        '<div class="pm-strength" data-strength data-level="0">' +
        '<div class="pm-strength__bars"><i></i><i></i><i></i><i></i></div>' +
        '<span class="pm-strength__label">Longer is stronger</span></div></div>' +
        '<div class="pm-field">' +
        '<label class="pm-label" for="pepe-pw2">Repeat password</label>' +
        '<input class="pm-input" type="password" id="pepe-pw2" autocomplete="new-password" spellcheck="false" />' +
        "</div>" +
        '<p class="pm-note">There is no recovery. If you forget this password the wallet cannot be opened again — only the private key backup on the next screen can restore it.</p>' +
        '<button type="button" class="pm-linkbtn" data-import-instead>I already have a wallet — import it</button>'
    );

    handle.setActions([
      { label: "Cancel", variant: "glass" },
      {
        label: "Create wallet",
        variant: "gold",
        name: "create",
        keepOpen: true,
        onClick: function (h) {
          return doCreate(h);
        },
      },
    ]);

    handle.find("[data-import-instead]").addEventListener("click", function () {
      screenImport(handle);
    });

    var input = handle.find("#pepe-pw");
    var repeat = handle.find("#pepe-pw2");
    var meter = handle.find("[data-strength]");
    var meterLabel = meter.querySelector(".pm-strength__label");

    input.addEventListener("input", function () {
      var level = strengthOf(input.value);
      meter.dataset.level = String(level);
      meterLabel.textContent = input.value ? STRENGTH_LABEL[level] : "Longer is stronger";
    });

    var submitOnEnter = function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        var btn = handle.action("create");
        if (btn) btn.click();
      }
    };
    input.addEventListener("keydown", submitOnEnter);
    repeat.addEventListener("keydown", submitOnEnter);
    input.focus();
  }

  function doCreate(handle) {
    clearError(handle);
    var password = handle.find("#pepe-pw").value;
    var repeat = handle.find("#pepe-pw2").value;

    if (password.length < MIN_PASSWORD) {
      showError(handle, "Password must be at least " + MIN_PASSWORD + " characters.");
      return false;
    }
    if (password !== repeat) {
      showError(handle, "The two passwords do not match.");
      return false;
    }
    if (!hasWebCrypto()) {
      showError(handle, "This browser blocks WebCrypto here. Open the site over https and try again.");
      return false;
    }

    return loadLibs()
      .then(function (l) {
        var pair = l.nacl.sign.keyPair();
        var address = l.bs58.encode(pair.publicKey);
        return encryptSecret(pair.secretKey, password).then(function (blob) {
          writeStore(address, blob);
          session = { address: address, secretKey: pair.secretKey };
          emit();
          screenBackup(handle, false);
        });
      })
      .catch(function (err) {
        showError(handle, describeError(err));
      });
  }

  /* --- 1b. Import an existing wallet ---
     For a key generated here on another device or session. The password
     is per-device: it only encrypts the key in this browser, so it does
     not need to match the one used where the wallet was created. */
  function screenImport(handle) {
    handle.setTitle("Import a wallet");
    handle.setSubtitle("Paste the private key you backed up, then pick a password for this device.");
    handle.setBody(
      errorSlot() +
        '<div class="pm-field" style="margin-top:12px">' +
        '<label class="pm-label" for="pepe-imp-key">Private key</label>' +
        '<input class="pm-input" type="password" id="pepe-imp-key" autocomplete="off" spellcheck="false" placeholder="Base58 private key" />' +
        "</div>" +
        '<div class="pm-field">' +
        '<label class="pm-label" for="pepe-imp-pw">Password for this device</label>' +
        '<input class="pm-input" type="password" id="pepe-imp-pw" autocomplete="new-password" spellcheck="false" placeholder="At least ' +
        MIN_PASSWORD +
        ' characters" />' +
        "</div>" +
        '<div class="pm-field">' +
        '<label class="pm-label" for="pepe-imp-pw2">Repeat password</label>' +
        '<input class="pm-input" type="password" id="pepe-imp-pw2" autocomplete="new-password" spellcheck="false" />' +
        "</div>" +
        '<p class="pm-note">The key is encrypted with this password and stored only in this browser. It never leaves this device.</p>' +
        '<button type="button" class="pm-linkbtn" data-create-instead>Create a new wallet instead</button>'
    );

    handle.setActions([
      { label: "Cancel", variant: "glass" },
      {
        label: "Import wallet",
        variant: "gold",
        name: "import",
        keepOpen: true,
        onClick: function (h) {
          return doImport(h);
        },
      },
    ]);

    handle.find("[data-create-instead]").addEventListener("click", function () {
      screenPassword(handle);
    });
    handle.find("#pepe-imp-key").focus();
  }

  function doImport(handle) {
    clearError(handle);
    var keyText = handle.find("#pepe-imp-key").value.trim();
    var password = handle.find("#pepe-imp-pw").value;
    var repeat = handle.find("#pepe-imp-pw2").value;

    if (!keyText) {
      showError(handle, "Paste your private key.");
      return false;
    }
    if (password.length < MIN_PASSWORD) {
      showError(handle, "Password must be at least " + MIN_PASSWORD + " characters.");
      return false;
    }
    if (password !== repeat) {
      showError(handle, "The two passwords do not match.");
      return false;
    }
    if (!hasWebCrypto()) {
      showError(handle, "This browser blocks WebCrypto here. Open the site over https and try again.");
      return false;
    }

    return loadLibs()
      .then(function (l) {
        var decoded;
        try {
          decoded = l.bs58.decode(keyText);
        } catch (e) {
          throw makeError("bad-key", "That is not a valid base58 key.");
        }
        var pair;
        if (decoded.length === 64) pair = l.nacl.sign.keyPair.fromSecretKey(decoded);
        else if (decoded.length === 32) pair = l.nacl.sign.keyPair.fromSeed(decoded);
        else throw makeError("bad-key", "A private key is 64 bytes (or a 32-byte seed) — this one decodes to " + decoded.length + ".");
        var address = l.bs58.encode(pair.publicKey);
        return encryptSecret(pair.secretKey, password).then(function (blob) {
          writeStore(address, blob);
          session = { address: address, secretKey: pair.secretKey };
          emit();
          screenDeposit(handle);
        });
      })
      .catch(function (err) {
        showError(handle, describeError(err));
      });
  }

  /* --- 2. Back up the private key --- */
  function screenBackup(handle, revisit) {
    if (!session || !libs) {
      screenDeposit(handle);
      return;
    }
    var secretBase58 = libs.bs58.encode(session.secretKey);

    handle.setTitle("Back up your private key");
    handle.setSubtitle("Write it down and keep it offline. This is the only way to restore this wallet.");
    handle.setBody(
      steps(2) +
        '<div class="pm-key" data-secret>' +
        escapeHtml(secretBase58) +
        "</div>" +
        copyButton("secret", "Copy private key") +
        '<div class="pm-alert pm-alert--warn" style="margin-top:12px">' +
        wIcon("alert") +
        "<span>Anyone holding this key controls the wallet. We cannot reset your password or recover this key for you.</span></div>" +
        (revisit
          ? ""
          : '<label class="pm-check" style="margin-top:12px"><input type="checkbox" data-saved /><span class="pm-check__box">' +
            wIcon("check", 2.4) +
            "</span><span>I have saved my private key</span></label>")
    );

    bindCopy(handle, '[data-copy="secret"]', function () {
      return secretBase58;
    });

    if (revisit) {
      handle.setActions([
        {
          label: "Back to deposit",
          variant: "gold",
          keepOpen: true,
          onClick: function (h) {
            screenDeposit(h);
          },
        },
      ]);
      return;
    }

    handle.setActions([
      {
        label: "Continue",
        variant: "gold",
        name: "continue",
        disabled: true,
        keepOpen: true,
        onClick: function (h) {
          screenDeposit(h);
        },
      },
    ]);

    var box = handle.find("[data-saved]");
    var next = handle.action("continue");
    box.addEventListener("change", function () {
      next.disabled = !box.checked;
    });
  }

  /* --- 3. Deposit --- */
  function screenDeposit(handle) {
    var store = readStore();
    var address = session ? session.address : store ? store.address : null;
    if (!address) {
      handle.close();
      return;
    }

    var qr = qrSvg(address, "Deposit address QR code");

    handle.setTitle("Deposit");
    handle.setSubtitle("Send SOL on the Solana network to this address.");
    handle.setBody(
      steps(3) +
        (qr ? '<div class="pm-qr">' + qr + "</div>" : "") +
        '<div class="pm-key pm-key--lg" data-address>' +
        escapeHtml(address) +
        "</div>" +
        copyButton("address", "Copy address") +
        '<p class="pm-note" style="margin-top:12px">Solana (SOL) only. Assets sent from another network will not arrive.</p>'
    );

    bindCopy(handle, '[data-copy="address"]', function () {
      return address;
    });

    var actions = [];
    if (session && libs) {
      actions.push({
        label: "Show private key",
        variant: "glass",
        keepOpen: true,
        onClick: function (h) {
          screenBackup(h, true);
        },
      });
    }
    actions.push({ label: "Done", variant: "gold" });
    handle.setActions(actions);
  }

  /* --- Unlock --- */
  function screenUnlock(handle) {
    var store = readStore();
    if (!store) {
      screenPassword(handle);
      return;
    }

    handle.setTitle(TEXT.unlockTitle);
    handle.setSubtitle(TEXT.unlockSub);
    handle.setBody(
      '<div class="pm-rows"><div><span>Address</span><span>' +
        escapeHtml(shorten(store.address)) +
        "</span></div></div>" +
        '<div style="height:12px"></div>' +
        errorSlot() +
        '<div class="pm-field" style="margin-top:12px">' +
        '<label class="pm-label" for="pepe-unlock">Password</label>' +
        '<input class="pm-input" type="password" id="pepe-unlock" autocomplete="current-password" spellcheck="false" />' +
        "</div>" +
        '<button type="button" class="pm-linkbtn pm-linkbtn--danger" data-forget>Remove this wallet from the browser</button>'
    );

    handle.setActions([
      { label: "Cancel", variant: "glass" },
      {
        label: "Unlock",
        variant: "gold",
        name: "unlock",
        keepOpen: true,
        onClick: function (h) {
          return doUnlock(h, store);
        },
      },
    ]);

    var input = handle.find("#pepe-unlock");
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        var btn = handle.action("unlock");
        if (btn) btn.click();
      }
    });
    input.focus();

    handle.find("[data-forget]").addEventListener("click", function () {
      confirmRemoval().then(function (removed) {
        if (removed) handle.close();
      });
    });
  }

  function doUnlock(handle, store) {
    clearError(handle);
    var password = handle.find("#pepe-unlock").value;

    if (!password) {
      showError(handle, "Enter your password.");
      return false;
    }
    if (!hasWebCrypto()) {
      showError(handle, "This browser blocks WebCrypto here. Open the site over https and try again.");
      return false;
    }

    /* Decryption needs WebCrypto only. The CDN libraries are used to display
       the private key, so a failed load must not block opening the wallet. */
    return decryptSecret(store, password)
      .then(function (secretKey) {
        if (secretKey.length !== 64) throw makeError("decrypt", "Wrong password.");
        session = { address: store.address, secretKey: secretKey };
        emit();
        return loadLibs().catch(function () { return null; });
      })
      .then(function () {
        screenDeposit(handle);
      })
      .catch(function (err) {
        showError(handle, describeError(err));
        var input = handle.find("#pepe-unlock");
        if (input) {
          input.classList.add("is-invalid");
          input.select();
        }
      });
  }

  /* --- Removal confirmation --- */
  function confirmRemoval() {
    if (!hasModal()) return Promise.resolve(false);
    return window.PepeModal.confirm({
      title: "Remove this wallet?",
      subtitle: "The encrypted wallet is deleted from this browser.",
      body:
        '<div class="pm-alert pm-alert--warn">' +
        wIcon("alert") +
        "<span>Without your private key backup this cannot be undone. Any funds at that address become unreachable from here.</span></div>",
      confirmLabel: "Remove wallet",
      confirmVariant: "orange",
      cancelLabel: "Keep it",
    }).then(function (yes) {
      if (!yes) return false;
      wipeSession();
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (e) {
        /* ignore */
      }
      emit();
      return true;
    });
  }

  /* ===================================================================
     SIGNING (real mode)

     The two entry points below let realmode.js authenticate and move
     funds. Signing happens here so the secret key never crosses a file
     boundary; all network access is delegated to window.PepeReal.rpc so
     this file still performs no fetch of its own.
     =================================================================== */

  /* Compact unlock modal used when a signature is needed while the
     session is locked. Resolves the decrypted 64-byte secret key. */
  function promptUnlock(store) {
    if (!hasModal()) return Promise.reject(makeError("no-modal", "Modal system unavailable."));
    if (!hasWebCrypto()) return Promise.reject(makeError("crypto", "WebCrypto unavailable."));
    return new Promise(function (resolve, reject) {
      var done = false;
      var handle = window.PepeModal.open({
        title: "Unlock to sign",
        subtitle: "Enter your password to sign with " + shorten(store.address) + ".",
        size: "sm",
        trust: true,
        body:
          errorSlot() +
          '<div class="pm-field" style="margin-top:12px">' +
          '<label class="pm-label" for="pepe-sign-pw">Password</label>' +
          '<input class="pm-input" type="password" id="pepe-sign-pw" autocomplete="current-password" spellcheck="false" />' +
          "</div>",
        actions: [
          { label: "Cancel", variant: "glass" },
          {
            label: "Unlock",
            variant: "gold",
            name: "unlock",
            keepOpen: true,
            onClick: function (h) {
              clearError(h);
              var pw = h.find("#pepe-sign-pw").value;
              if (!pw) { showError(h, "Enter your password."); return false; }
              return decryptSecret(store, pw)
                .then(function (secretKey) {
                  if (secretKey.length !== 64) throw makeError("decrypt", "Wrong password.");
                  done = true;
                  h.close();
                  resolve(secretKey);
                })
                .catch(function (err) { showError(h, describeError(err)); });
            },
          },
        ],
        onClose: function () {
          if (!done) reject(makeError("cancelled", "Unlock cancelled."));
        },
      });
      var input = handle.find("#pepe-sign-pw");
      if (input) {
        input.addEventListener("keydown", function (e) {
          if (e.key === "Enter") {
            e.preventDefault();
            var btn = handle.action("unlock");
            if (btn) btn.click();
          }
        });
      }
    });
  }

  /* Runs fn(secretKey, address) with an unlocked key. A key decrypted
     just for this call is zeroed once fn settles; a live session key is
     left alone because the session owns its lifetime. */
  function withSecretKey(fn) {
    if (session && session.secretKey) {
      return Promise.resolve().then(function () {
        return fn(session.secretKey, session.address);
      });
    }
    var store = readStore();
    if (!store) return Promise.reject(makeError("no-wallet", "No wallet in this browser."));
    return promptUnlock(store).then(function (secretKey) {
      var wipe = function () { try { secretKey.fill(0); } catch (e) { /* ignore */ } };
      return Promise.resolve()
        .then(function () { return fn(secretKey, store.address); })
        .then(
          function (out) { wipe(); return out; },
          function (err) { wipe(); throw err; }
        );
    });
  }

  /* --- Minimal Solana wire helpers (legacy tx format) --- */

  function shortvec(n) {
    var out = [];
    do {
      var b = n & 0x7f;
      n >>>= 7;
      if (n) b |= 0x80;
      out.push(b);
    } while (n);
    return out;
  }

  function concatBytes(parts) {
    var len = 0, i;
    for (i = 0; i < parts.length; i++) len += parts[i].length;
    var out = new Uint8Array(len);
    var off = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
    return out;
  }

  function u64le(value) {
    /* Split on 2^32: safe for every amount below 2^53 lamports. */
    var out = new Uint8Array(8);
    var lo = value % 4294967296;
    var hi = Math.floor(value / 4294967296);
    for (var i = 0; i < 4; i++) { out[i] = lo & 0xff; lo = Math.floor(lo / 256); }
    for (var j = 4; j < 8; j++) { out[j] = hi & 0xff; hi = Math.floor(hi / 256); }
    return out;
  }

  /* Signs message bytes (or a UTF-8 string) with the wallet key.
     Resolves the detached ed25519 signature in base58. */
  function signMessage(message) {
    return loadLibs().then(function (l) {
      var bytes = typeof message === "string" ? new TextEncoder().encode(message) : message;
      return withSecretKey(function (secretKey) {
        return l.bs58.encode(l.nacl.sign.detached(bytes, secretKey));
      });
    });
  }

  /* Builds, signs and broadcasts a plain SOL transfer from this wallet.
     Network calls go through window.PepeReal.rpc (blockhash + send) so
     this file keeps its no-fetch promise. Resolves the tx signature. */
  function signAndSendTransfer(opts) {
    var to = opts && opts.to;
    var lamports = opts && opts.lamports;
    if (!to || !isFinite(lamports) || lamports <= 0 || lamports % 1 !== 0) {
      return Promise.reject(makeError("bad-args", "signAndSendTransfer needs { to, lamports } with integer lamports."));
    }
    if (!window.PepeReal || typeof window.PepeReal.rpc !== "function") {
      return Promise.reject(makeError("no-rpc", "Real mode is not active."));
    }
    return loadLibs().then(function (l) {
      return withSecretKey(function (secretKey, address) {
        return window.PepeReal.rpc("getLatestBlockhash", [{ commitment: "confirmed" }]).then(function (r) {
          var blockhash = l.bs58.decode(r && r.value ? r.value.blockhash : r.blockhash);
          var from = l.bs58.decode(address);
          var dest = l.bs58.decode(to);
          var system = new Uint8Array(32); /* all zeros = 11111111111111111111111111111111 */

          /* Self-transfers collapse to two account keys. */
          var self = to === address;
          var keys = self ? [from, system] : [from, dest, system];
          var programIndex = keys.length - 1;
          var toIndex = self ? 0 : 1;

          /* System program transfer: u32 instruction index 2 + u64 lamports. */
          var data = concatBytes([Uint8Array.from([2, 0, 0, 0]), u64le(lamports)]);

          var msg = concatBytes([
            Uint8Array.from([1, 0, 1]),            /* 1 signature, 0 ro signed, 1 ro unsigned */
            Uint8Array.from(shortvec(keys.length)),
            concatBytes(keys),
            blockhash,
            Uint8Array.from(shortvec(1)),          /* one instruction */
            Uint8Array.from([programIndex]),
            Uint8Array.from(shortvec(2)),
            Uint8Array.from([0, toIndex]),
            Uint8Array.from(shortvec(data.length)),
            data,
          ]);

          var sig = l.nacl.sign.detached(msg, secretKey);
          var wire = concatBytes([Uint8Array.from(shortvec(1)), sig, msg]);
          return window.PepeReal.rpc("sendTransaction", [
            toBase64(wire),
            { encoding: "base64", preflightCommitment: "confirmed" },
          ]);
        });
      });
    });
  }

  /* ===================================================================
     PUBLIC API
     =================================================================== */

  function openWalletModal(initialScreen, title, subtitle) {
    if (!hasModal()) return null;
    var handle = window.PepeModal.open({
      title: title,
      subtitle: subtitle,
      size: "md",
      trust: true,
      body: "",
      onClose: wipeSession,
    });
    initialScreen(handle);
    return handle;
  }

  function startCreateFlow() {
    if (readStore()) return openWallet();
    return openWalletModal(screenPassword, TEXT.createTitle, TEXT.createSub);
  }

  function openWallet() {
    if (!readStore()) return startCreateFlow();
    if (session) {
      return openWalletModal(screenDeposit, "Deposit", "Send SOL on the Solana network to this address.");
    }
    return openWalletModal(screenUnlock, TEXT.unlockTitle, TEXT.unlockSub);
  }

  function get() {
    var store = readStore();
    if (!store) return null;
    return {
      address: store.address,
      version: store.version || VERSION,
      unlocked: !!session,
    };
  }

  function startImportFlow() {
    if (readStore()) return openWallet();
    return openWalletModal(screenImport, "Import a wallet", "Paste the private key you backed up, then pick a password for this device.");
  }

  window.PepeWallet = {
    startCreateFlow: startCreateFlow,
    startImportFlow: startImportFlow,
    /* Drops any in-memory unlocked key, so the next signature always
       asks for the password again. Used on casino log-out. */
    lock: wipeSession,
    get: get,
    open: openWallet,
    disconnect: confirmRemoval,
    signMessage: signMessage,
    signAndSendTransfer: signAndSendTransfer,
    /* Convenience for the topbar label */
    exists: function () {
      return !!readStore();
    },
    label: function () {
      return readStore() ? "Open Wallet" : "Create Wallet";
    },
  };
})();
