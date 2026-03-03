// mathematik/brutcamp.js
// Training Mode — MIRA fragt, User bestätigt oder korrigiert
// "Was siehst du hier?" → User antwortet → MIRA lernt

'use strict';

const fs      = require('fs');
const path    = require('path');
const sharp   = require('sharp');
const capture = require('./screen-capture');
const wissen  = require('./wissenstree');

const PATTERNS_DIR = path.join(__dirname, '..', 'reme-memory', 'patterns');
const INDEX_PATH   = path.join(PATTERNS_DIR, 'index.json');

// ── Pattern-Index laden/speichern ───────────────────────────────────────────

function loadIndex() {
  if (!fs.existsSync(INDEX_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')); }
  catch { return {}; }
}

function saveIndex(index) {
  fs.mkdirSync(PATTERNS_DIR, { recursive: true });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
}

// ── Pattern speichern ───────────────────────────────────────────────────────

/**
 * Speichert ein trainiertes Pattern.
 *
 * @param {string} label      z.B. "Chrome", "URL-Bar", "Speichern-Button"
 * @param {string} kategorie  z.B. "app", "button", "feld", "icon"
 * @param {Buffer} pngBuffer  Ausgeschnittenes Bild
 * @param {object} meta       Zusätzliche Infos (App-Name, Kontext, ...)
 */
async function speicherePattern(label, kategorie, pngBuffer, meta = {}) {
  fs.mkdirSync(PATTERNS_DIR, { recursive: true });

  const key      = label.toLowerCase().replace(/\s+/g, '-');
  const filename = `${key}.png`;
  const filepath = path.join(PATTERNS_DIR, filename);

  // Bild normalisiert speichern (grayscale, optimiert)
  await sharp(pngBuffer)
    .grayscale()
    .png({ compressionLevel: 6 })
    .toFile(filepath);

  // Index aktualisieren
  const index = loadIndex();
  index[key] = {
    label,
    kategorie,
    datei: filename,
    gelernt: new Date().toISOString(),
    trefferCount: 0,
    ...meta
  };
  saveIndex(index);

  // Lesbares Markdown (ReMe-Style)
  const mdPath = path.join(PATTERNS_DIR, `${key}.md`);
  fs.writeFileSync(mdPath,
    `# Pattern: ${label}\n\n` +
    `- **Kategorie:** ${kategorie}\n` +
    `- **Datei:** ${filename}\n` +
    `- **Gelernt:** ${new Date().toLocaleString('de-DE')}\n` +
    (meta.app ? `- **App:** ${meta.app}\n` : '') +
    (meta.kontext ? `- **Kontext:** ${meta.kontext}\n` : '') +
    `\nMIRA erkennt dieses Pattern automatisch und findet es auf dem Screen — egal wo es sich befindet.\n`,
    'utf8'
  );

  console.log(`✅ Pattern gespeichert: "${label}" (${kategorie}) → ${filename}`);
  return { key, filepath };
}

/**
 * Alle gespeicherten Patterns laden.
 * @returns {Array<{ key, label, kategorie, datei, ... }>}
 */
function allePatterns() {
  const index = loadIndex();
  return Object.entries(index).map(([key, v]) => ({ key, ...v }));
}

/**
 * Pattern löschen (falls falsch trainiert).
 */
function löschePattern(key) {
  const index = loadIndex();
  if (!index[key]) return false;

  const filepath = path.join(PATTERNS_DIR, index[key].datei);
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);

  const mdPath = path.join(PATTERNS_DIR, `${key}.md`);
  if (fs.existsSync(mdPath)) fs.unlinkSync(mdPath);

  delete index[key];
  saveIndex(index);
  console.log(`🗑️ Pattern gelöscht: "${key}"`);
  return true;
}

// ── Training-Session (IPC-basiert, wird von main.js aufgerufen) ─────────────

/**
 * Startet eine Training-Session.
 * MIRA macht Screenshot, identifiziert unbekannte Bereiche,
 * und gibt eine Liste von Fragen zurück die dem User gestellt werden.
 *
 * @returns {Promise<Array<{ id, screenshot_region, frage }>>}
 */
async function startTrainingSession() {
  console.log('🏕️ BrutCamp Training gestartet');

  const screen     = await capture.capture();
  const index      = loadIndex();
  const bekannte   = Object.keys(index);

  // Für jetzt: Screenshot des ganzen Screens als erste Trainings-Frage
  // Später: automatisch Bereiche erkennen die unbekannt sind
  const fragen = [
    {
      id:     'full_screen',
      breite: screen.width,
      höhe:   screen.height,
      frage:  'Was siehst du gerade auf dem Screen? Beschreibe die wichtigsten Elemente.',
      typ:    'beschreibung'
    }
  ];

  console.log(`📋 Bekannte Patterns: ${bekannte.length}`);
  console.log(`❓ Trainingsfragen: ${fragen.length}`);

  return { fragen, bekannte, screenWidth: screen.width, screenHeight: screen.height };
}

/**
 * Verarbeitet eine Trainings-Antwort vom User.
 *
 * @param {string} fragenId
 * @param {string} antwort         z.B. "Das ist Chrome"
 * @param {Buffer} regionPng       Bild des Bereichs
 * @param {object} zusatz          { app, kontext, ... }
 */
async function verarbeiteAntwort(fragenId, antwort, regionPng, zusatz = {}) {
  const antwortLower = antwort.toLowerCase().trim();

  // Feldwissen lernen wenn User ein Formularfeld beschreibt
  const feldMuster = antwortLower.match(/(?:das feld |feld )?"?([^"]+)"? (?:ist |erwartet |enthält )(.+)/i);
  if (feldMuster) {
    const feldLabel = feldMuster[1].trim();
    const feldTyp   = feldMuster[2].trim();
    wissen.lernFeld(feldLabel, { typ: feldTyp, beschreibung: antwort });
  }

  // Pattern speichern
  if (regionPng) {
    // Kategorie aus Antwort ableiten
    let kategorie = 'unbekannt';
    if (antwortLower.includes('browser') || antwortLower.includes('chrome') || antwortLower.includes('opera')) kategorie = 'app';
    else if (antwortLower.includes('button') || antwortLower.includes('knopf')) kategorie = 'button';
    else if (antwortLower.includes('feld') || antwortLower.includes('eingabe')) kategorie = 'feld';
    else if (antwortLower.includes('icon') || antwortLower.includes('symbol')) kategorie = 'icon';

    await speicherePattern(antwort, kategorie, regionPng, zusatz);
  }

  return { gelernt: true, antwort, fragenId };
}

/**
 * Treffercount erhöhen wenn Pattern erfolgreich genutzt wurde.
 */
function bestätigeMatch(key) {
  const index = loadIndex();
  if (index[key]) {
    index[key].trefferCount = (index[key].trefferCount || 0) + 1;
    index[key].letzterTreffer = new Date().toISOString();
    saveIndex(index);
  }
}

module.exports = {
  speicherePattern,
  allePatterns,
  löschePattern,
  startTrainingSession,
  verarbeiteAntwort,
  bestätigePattern: bestätigeMatch
};
