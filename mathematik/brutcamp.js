// mathematik/brutcamp.js
// BrutCamp — Interaktiver Training Mode
//
// FLOW:
// 1. MIRA macht Screenshot
// 2. AX-Layer liefert alle sichtbaren Elemente mit Koordinaten
// 3. Für jedes Element: Math prüft ob bekannt
//    → Bekannt:   "Ich erkenne das als Chrome — stimmt das?" [✓ / ✗]
//    → Unbekannt: "Was ist das hier?" [Eingabe]
// 4. User bestätigt oder korrigiert → gespeichert
// 5. Nächstes Element

'use strict';

const fs      = require('fs');
const path    = require('path');
const sharp   = require('sharp');
const capture = require('./screen-capture');
const matcher = require('./pattern-matcher');
const wissen  = require('./wissenstree');

const PATTERNS_DIR = path.join(__dirname, '..', 'reme-memory', 'patterns');
const INDEX_PATH   = path.join(PATTERNS_DIR, 'index.json');

// Aktive Session — läuft im Hintergrund, IPC schickt Events
let _activeSession = null;

// ── Index ────────────────────────────────────────────────────────────────────

function loadIndex() {
  if (!fs.existsSync(INDEX_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')); }
  catch { return {}; }
}

function saveIndex(index) {
  fs.mkdirSync(PATTERNS_DIR, { recursive: true });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
}

// ── Pattern speichern ────────────────────────────────────────────────────────

async function speicherePattern(label, kategorie, pngBuffer, meta = {}) {
  fs.mkdirSync(PATTERNS_DIR, { recursive: true });

  const key      = label.toLowerCase().replace(/[^a-z0-9äöü]/g, '-').replace(/-+/g, '-');
  const filename = `${key}.png`;
  const filepath = path.join(PATTERNS_DIR, filename);

  await sharp(pngBuffer)
    .grayscale()
    .resize({ width: 128, height: 128, fit: 'contain', background: 0 })
    .png({ compressionLevel: 6 })
    .toFile(filepath);

  const index = loadIndex();
  index[key] = {
    label, kategorie,
    datei: filename,
    gelernt: new Date().toISOString(),
    trefferCount: 0,
    ...meta
  };
  saveIndex(index);

  // Markdown (ReMe-Style)
  fs.writeFileSync(
    path.join(PATTERNS_DIR, `${key}.md`),
    `# Pattern: ${label}\n\n` +
    `- **Kategorie:** ${kategorie}\n` +
    `- **Datei:** ${filename}\n` +
    `- **Gelernt:** ${new Date().toLocaleString('de-DE')}\n` +
    (meta.app     ? `- **App:** ${meta.app}\n`     : '') +
    (meta.kontext ? `- **Kontext:** ${meta.kontext}\n` : ''),
    'utf8'
  );

  console.log(`✅ Pattern: "${label}" (${kategorie}) → ${filename}`);
  return { key, filepath };
}

function allePatterns() {
  const index = loadIndex();
  return Object.entries(index).map(([key, v]) => ({ key, ...v }));
}

function löschePattern(key) {
  const index = loadIndex();
  if (!index[key]) return false;
  ['png', 'md'].forEach(ext => {
    const p = path.join(PATTERNS_DIR, `${key}.${ext}`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
  delete index[key];
  saveIndex(index);
  return true;
}

function bestätigePattern(key) {
  const index = loadIndex();
  if (index[key]) {
    index[key].trefferCount  = (index[key].trefferCount  || 0) + 1;
    index[key].letzterTreffer = new Date().toISOString();
    saveIndex(index);
  }
}

// ── Interaktive Session ──────────────────────────────────────────────────────

/**
 * Startet eine interaktive BrutCamp-Session.
 * Nutzt AX-Layer um alle sichtbaren Elemente zu bekommen.
 * Für jedes: prüft Math ob bekannt, baut Fragen-Queue.
 *
 * @param {object} axLayer    — ax-layer.js Instanz
 * @param {object} chef       — mathematik/chef.js
 * @returns {object}          — { sessionId, totalElements, fragen: [] }
 */
async function startInteractiveSession(axLayer, chef) {
  console.log('🏕️ BrutCamp Interaktiv gestartet');

  // Screenshot für Pattern-Matching
  const screen = await capture.capture();

  // AX liefert alle sichtbaren interaktiven Elemente
  let axElemente = [];
  try {
    const frontmost = await axLayer.getFrontmostApp();
    if (frontmost?.bundleId) {
      const elements = await axLayer.getElements(frontmost.bundleId);
      axElemente = (elements || []).filter(e =>
        e.centerX && e.centerY &&
        ['button', 'textField', 'menuItem', 'link', 'image', 'staticText'].includes(e.role)
      ).slice(0, 30); // max 30 Elemente pro Session
    }
  } catch (e) {
    console.log('⚠️ AX nicht verfügbar — nutze Grid-Scan');
  }

  // Fallback: Grid-Scan wenn AX nichts liefert
  if (!axElemente.length) {
    axElemente = gridScan(screen.width, screen.height);
  }

  // Für jedes Element: Math prüfen
  const fragen = [];
  for (const el of axElemente) {
    const label    = el.title || el.label || el.description || '';
    const region   = regionUmElement(el, screen.width, screen.height);

    // Region aus Screenshot ausschneiden
    let regionPng = null;
    try {
      const sc = await require('screenshot-desktop')({ format: 'png' });
      regionPng = await require('./screen-capture').cropRegion(sc, region);
    } catch {}

    // Math: bekannt?
    const mathResult = label ? await chef.find(label, { multiScale: false }).catch(() => null) : null;

    fragen.push({
      id:           `el-${fragen.length}`,
      centerX:      el.centerX || (region.x + region.w / 2),
      centerY:      el.centerY || (region.y + region.h / 2),
      region,
      axLabel:      label,
      axRole:       el.role || 'unknown',
      mathErkannt:  mathResult?.found ? mathResult.key : null,
      regionBase64: regionPng ? regionPng.toString('base64') : null,
      // Frage-Text für UI
      frage: mathResult?.found
        ? `Ich erkenne das als "${mathResult.key}" — stimmt das?`
        : label
          ? `Dieses Element heißt "${label}" laut System — wie soll ich es nennen?`
          : 'Was ist dieses Element?',
      typ: mathResult?.found ? 'bestätigen' : 'benennen'
    });
  }

  _activeSession = {
    id:       Date.now().toString(),
    fragen,
    aktuell:  0,
    screen:   { width: screen.width, height: screen.height }
  };

  return {
    sessionId:     _activeSession.id,
    totalElements: fragen.length,
    aktuelleFrage: fragen[0] || null,
    fortschritt:   0
  };
}

/**
 * Verarbeitet User-Antwort und gibt nächste Frage zurück.
 *
 * @param {string} sessionId
 * @param {string} antwort      'ja' | 'nein' | 'überspringen' | beliebiger Text
 * @param {string} korrektur    Falls antwort = 'nein' → richtiger Name
 */
async function antwortGeben(sessionId, antwort, korrektur) {
  if (!_activeSession || _activeSession.id !== sessionId) {
    return { error: 'Session nicht gefunden' };
  }

  const frage = _activeSession.fragen[_activeSession.aktuell];
  if (!frage) return { fertig: true };

  const antwortLower = (antwort || '').toLowerCase().trim();

  if (antwortLower !== 'überspringen') {
    let labelZuSpeichern = null;
    let kategorieZuSpeichern = 'icon';

    if (frage.typ === 'bestätigen') {
      if (antwortLower === 'ja' || antwortLower === 'j' || antwortLower === 'yes') {
        // Math hatte recht → Treffer bestätigen
        bestätigePattern(frage.mathErkannt);
        console.log(`✓ Bestätigt: "${frage.mathErkannt}"`);
      } else {
        // Falsch erkannt → korrektes Label speichern
        labelZuSpeichern = korrektur || antwort;
      }
    } else {
      // Unbekannt → User nennt es
      labelZuSpeichern = antwort;
    }

    // Kategorie aus AX-Role ableiten
    if (frage.axRole === 'button')     kategorieZuSpeichern = 'button';
    else if (frage.axRole === 'textField') kategorieZuSpeichern = 'feld';
    else if (frage.axRole === 'menuItem')  kategorieZuSpeichern = 'menu';
    else if (frage.axRole === 'image')     kategorieZuSpeichern = 'icon';

    if (labelZuSpeichern && frage.regionBase64) {
      await speicherePattern(
        labelZuSpeichern,
        kategorieZuSpeichern,
        Buffer.from(frage.regionBase64, 'base64'),
        { axLabel: frage.axLabel, axRole: frage.axRole, kontext: 'BrutCamp Interaktiv' }
      );
    }
  }

  // Nächste Frage
  _activeSession.aktuell++;
  const naechste = _activeSession.fragen[_activeSession.aktuell];
  const fortschritt = Math.round((_activeSession.aktuell / _activeSession.fragen.length) * 100);

  if (!naechste) {
    _activeSession = null;
    return { fertig: true, fortschritt: 100 };
  }

  return {
    fertig:        false,
    aktuelleFrage: naechste,
    fortschritt,
    verbleibend:   _activeSession.fragen.length - _activeSession.aktuell
  };
}

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────

function regionUmElement(el, screenW, screenH, padding = 20) {
  const w = Math.min(el.width  || 80, 200);
  const h = Math.min(el.height || 40, 120);
  return {
    x: Math.max(0, (el.centerX || screenW / 2) - w / 2 - padding),
    y: Math.max(0, (el.centerY || screenH / 2) - h / 2 - padding),
    w: Math.min(w + padding * 2, screenW),
    h: Math.min(h + padding * 2, screenH)
  };
}

function gridScan(screenW, screenH, cols = 4, rows = 3) {
  const elemente = [];
  const cw = screenW / cols;
  const ch = screenH / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      elemente.push({
        centerX: Math.round(cw * c + cw / 2),
        centerY: Math.round(ch * r + ch / 2),
        width: Math.round(cw * 0.6),
        height: Math.round(ch * 0.6),
        role: 'unknown', title: '', label: ''
      });
    }
  }
  return elemente;
}

// ── Legacy (statische Session) ───────────────────────────────────────────────

async function startTrainingSession() {
  const screen = await capture.capture();
  return {
    fragen: [{
      id: 'full_screen', breite: screen.width, höhe: screen.height,
      frage: 'Was siehst du gerade auf dem Screen?', typ: 'beschreibung'
    }],
    bekannte: Object.keys(loadIndex()),
    screenWidth: screen.width, screenHeight: screen.height
  };
}

async function verarbeiteAntwort(fragenId, antwort, regionPng, zusatz = {}) {
  const antwortLower = antwort.toLowerCase().trim();
  let kategorie = 'unbekannt';
  if (antwortLower.includes('browser') || antwortLower.includes('chrome') || antwortLower.includes('opera')) kategorie = 'app';
  else if (antwortLower.includes('button') || antwortLower.includes('knopf')) kategorie = 'button';
  else if (antwortLower.includes('feld') || antwortLower.includes('eingabe')) kategorie = 'feld';
  else if (antwortLower.includes('icon') || antwortLower.includes('symbol')) kategorie = 'icon';
  if (regionPng) await speicherePattern(antwort, kategorie, regionPng, zusatz);
  return { gelernt: true, antwort, fragenId };
}

module.exports = {
  speicherePattern, allePatterns, löschePattern, bestätigePattern,
  startInteractiveSession, antwortGeben,
  startTrainingSession, verarbeiteAntwort
};
