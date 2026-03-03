// mathematik/chef.js
// Der Entscheider — Math first, Fallback bei Unknown
// Wird als Tier 0c in main.js eingeklinkt
//
// Ablauf:
// 1. Pattern bekannt? → NCC Matching → Koordinate (<100ms)
// 2. Nicht gefunden? → null zurück → main.js macht Tier 1+ (API)
// 3. Nach Tier 1/2 Erfolg → Pattern automatisch dazulernen

'use strict';

const fs             = require('fs');
const path           = require('path');
const screenCapture  = require('./screen-capture');
const matcher        = require('./pattern-matcher');
const brutcamp       = require('./brutcamp');

const PATTERNS_DIR   = path.join(__dirname, '..', 'reme-memory', 'patterns');
const INDEX_PATH     = path.join(PATTERNS_DIR, 'index.json');

// Geladen-Templates in RAM halten (für Session-Dauer)
const _templateCache = new Map();

// ── Template laden (mit RAM-Cache) ──────────────────────────────────────────

async function _loadTemplate(key, datei) {
  if (_templateCache.has(key)) return _templateCache.get(key);

  const filepath = path.join(PATTERNS_DIR, datei);
  if (!fs.existsSync(filepath)) return null;

  const template = await screenCapture.loadTemplate(filepath);
  _templateCache.set(key, template);
  return template;
}

// ── Haupt-Funktion: finde Element auf Screen ─────────────────────────────────

/**
 * Sucht ein Element auf dem Screen via Pattern-Matching.
 *
 * @param {string} elementLabel   z.B. "Chrome", "Speichern-Button", "URL-Bar"
 * @param {object} opts
 * @param {object} opts.currentScreen  Bereits gemachter Screenshot (optional, spart Zeit)
 * @returns {Promise<{found, x, y, centerX, centerY, score, source} | null>}
 */
async function find(elementLabel, opts = {}) {
  // Index laden
  if (!fs.existsSync(INDEX_PATH)) return null;
  let index;
  try { index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')); }
  catch { return null; }

  const label = elementLabel.toLowerCase().trim();

  // Passende Patterns suchen (direkt oder Teilstring)
  const kandidaten = Object.entries(index).filter(([key, v]) => {
    const vLabel = (v.label || '').toLowerCase();
    return key.includes(label) || label.includes(key) ||
           vLabel.includes(label) || label.includes(vLabel);
  });

  if (!kandidaten.length) {
    console.log(`🔢 Math: kein trainiertes Pattern für "${elementLabel}"`);
    return null;
  }

  // Screen aufnehmen (einmal für alle Kandidaten)
  let screen;
  try {
    screen = opts.currentScreen || await screenCapture.capture();
  } catch (e) {
    console.error('🔢 Math: Screenshot fehlgeschlagen:', e.message);
    return null;
  }

  // Alle Kandidaten durchprobieren, besten Match nehmen
  let bestResult = null;
  let bestKey    = null;

  for (const [key, info] of kandidaten) {
    const template = await _loadTemplate(key, info.datei);
    if (!template) continue;

    let result;
    if (opts.multiScale) {
      result = await matcher.findPatternMultiScale(screen, template);
    } else {
      result = matcher.findPattern(screen, template);
    }

    if (result.found && (!bestResult || result.score > bestResult.score)) {
      bestResult = result;
      bestKey    = key;
    }
  }

  if (!bestResult || !bestResult.found) {
    console.log(`🔢 Math: Pattern nicht gefunden für "${elementLabel}" (beste Score: ${bestResult?.score?.toFixed(3) || 'n/a'})`);
    return null;
  }

  // Treffer registrieren
  brutcamp.bestätigePattern(bestKey);

  console.log(`🔢 Math: "${elementLabel}" gefunden → [${bestResult.centerX}, ${bestResult.centerY}] (Score: ${bestResult.score.toFixed(3)})`);

  return {
    found:   true,
    x:       bestResult.x,
    y:       bestResult.y,
    centerX: bestResult.centerX,
    centerY: bestResult.centerY,
    score:   bestResult.score,
    source:  'math_pattern',
    key:     bestKey
  };
}

/**
 * Nach einem erfolgreichen Tier 1/2 Fund:
 * Screenshot-Region ausschneiden und als Pattern speichern.
 * So lernt MIRA automatisch ohne explizites Training.
 *
 * @param {string} elementLabel
 * @param {number} centerX
 * @param {number} centerY
 * @param {object} opts  { size?: number, app?: string, kontext?: string }
 */
async function lernVonErfolg(elementLabel, centerX, centerY, opts = {}) {
  try {
    const size = opts.size || 80; // Ausschnitts-Größe in Pixel
    const raw  = await require('screenshot-desktop')({ format: 'png' });

    const x = Math.max(0, centerX - Math.floor(size / 2));
    const y = Math.max(0, centerY - Math.floor(size / 2));

    const regionPng = await screenCapture.cropRegion(raw, { x, y, w: size, h: size });

    await brutcamp.speicherePattern(elementLabel, 'auto-gelernt', regionPng, {
      app:     opts.app     || 'unbekannt',
      kontext: opts.kontext || 'Automatisch gelernt nach Tier 1/2 Erfolg',
      centerX,
      centerY
    });

    // Template aus RAM-Cache entfernen damit es neu geladen wird
    const key = elementLabel.toLowerCase().replace(/\s+/g, '-');
    _templateCache.delete(key);

    console.log(`🧠 Auto-Lernen: "${elementLabel}" als neues Pattern gespeichert`);
  } catch (e) {
    console.error('🧠 Auto-Lernen fehlgeschlagen:', e.message);
  }
}

/**
 * Cache leeren (nach App-Neustart oder explizit vom Training).
 */
function clearCache() {
  _templateCache.clear();
}

module.exports = { find, lernVonErfolg, clearCache };
