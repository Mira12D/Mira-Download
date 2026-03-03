// mathematik/wissenstree.js
// MIRA's Verständnis — Was bedeutet was sie sieht?
// Hierarchisches Wissen: App → Element → Erwartung
// Wird aus Supabase geladen + lokal gecacht.

'use strict';

const fs   = require('fs');
const path = require('path');

const WISSEN_DIR  = path.join(__dirname, '..', 'reme-memory', 'wissen');
const CACHE_PATH  = path.join(WISSEN_DIR, '_cache.json');
const CACHE_TTL   = 10 * 60 * 1000; // 10 Minuten

let _cache     = null;
let _cacheTime = 0;

// ── Basis-Wissentree (Fallback wenn keine DB) ───────────────────────────────
const BASIS_WISSEN = {
  felder: {
    'tag':         { typ: 'zahl',    bereich: [1, 31],   beschreibung: 'Tag des Monats' },
    'monat':       { typ: 'zahl',    bereich: [1, 12],   beschreibung: 'Monat (1-12)' },
    'jahr':        { typ: 'zahl',    bereich: [2000, 2100], beschreibung: 'Jahreszahl' },
    'datum':       { typ: 'datum',   format: 'DD.MM.YYYY', beschreibung: 'Vollständiges Datum' },
    'vorname':     { typ: 'text',    beschreibung: 'Erster Vorname der Person' },
    'name':        { typ: 'text',    beschreibung: 'Nachname / Familienname' },
    'nachname':    { typ: 'text',    beschreibung: 'Nachname / Familienname' },
    'email':       { typ: 'email',   beschreibung: 'E-Mail-Adresse' },
    'telefon':     { typ: 'telefon', beschreibung: 'Telefonnummer' },
    'betrag':      { typ: 'zahl',    beschreibung: 'Geldbetrag in Euro' },
    'preis':       { typ: 'zahl',    beschreibung: 'Preis in Euro' },
    'anzahl':      { typ: 'zahl',    beschreibung: 'Stückzahl / Menge' },
    'strasse':     { typ: 'text',    beschreibung: 'Straßenname und Hausnummer' },
    'plz':         { typ: 'text',    beschreibung: 'Postleitzahl (5-stellig)' },
    'ort':         { typ: 'text',    beschreibung: 'Stadt / Gemeinde' },
    'unternehmen': { typ: 'text',    beschreibung: 'Firmenname' },
    'firma':       { typ: 'text',    beschreibung: 'Firmenname' },
    'beschreibung':{ typ: 'text',    beschreibung: 'Freitext-Beschreibung' },
    'kommentar':   { typ: 'text',    beschreibung: 'Kommentar oder Notiz' },
  },

  apps: {
    'opera':   { typ: 'browser',  url_bar: true,  beschreibung: 'Opera Browser' },
    'chrome':  { typ: 'browser',  url_bar: true,  beschreibung: 'Google Chrome Browser' },
    'safari':  { typ: 'browser',  url_bar: true,  beschreibung: 'Apple Safari Browser' },
    'firefox': { typ: 'browser',  url_bar: true,  beschreibung: 'Mozilla Firefox Browser' },
    'excel':   { typ: 'tabelle',  zellen: true,   beschreibung: 'Microsoft Excel' },
    'word':    { typ: 'dokument', seiten: true,   beschreibung: 'Microsoft Word' },
    'outlook': { typ: 'mail',     postfach: true, beschreibung: 'Microsoft Outlook Mail' },
    'finder':  { typ: 'datei',    ordner: true,   beschreibung: 'macOS Finder' },
    'explorer':{ typ: 'datei',    ordner: true,   beschreibung: 'Windows Explorer' },
  }
};

// ── Wissen laden (lokal + optional Supabase) ────────────────────────────────

function _loadLokal() {
  if (!fs.existsSync(CACHE_PATH)) return BASIS_WISSEN;
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    return { ...BASIS_WISSEN, ...JSON.parse(raw) };
  } catch { return BASIS_WISSEN; }
}

function getWissen() {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;
  _cache     = _loadLokal();
  _cacheTime = Date.now();
  return _cache;
}

// ── Feld-Lookup: Was erwartet dieses Formularfeld? ──────────────────────────

/**
 * Gibt zurück was in ein Feld hineingehört basierend auf dem Label.
 * "Tag" → { typ: 'zahl', bereich: [1,31], beschreibung: 'Tag des Monats' }
 *
 * @param {string} feldLabel
 * @returns {object|null}
 */
function wasGehörtInsFeld(feldLabel) {
  const wissen = getWissen();
  const key    = feldLabel.toLowerCase().trim();

  // Direkter Match
  if (wissen.felder[key]) return wissen.felder[key];

  // Teilstring-Match (z.B. "Datum der Geburt" → 'datum')
  for (const [k, v] of Object.entries(wissen.felder)) {
    if (key.includes(k) || k.includes(key)) return v;
  }

  return null;
}

/**
 * Gibt zurück was eine App ist.
 * "Opera" → { typ: 'browser', url_bar: true, ... }
 *
 * @param {string} appName
 * @returns {object|null}
 */
function wasIstDieApp(appName) {
  const wissen = getWissen();
  const key    = appName.toLowerCase().trim();
  if (wissen.apps[key]) return wissen.apps[key];
  for (const [k, v] of Object.entries(wissen.apps)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}

// ── Wissen hinzufügen (vom Training oder User-Korrektur) ────────────────────

/**
 * Fügt neues Feldwissen hinzu und speichert es lokal.
 * Wird vom Training aufgerufen wenn User korrigiert.
 *
 * @param {string} feldLabel
 * @param {object} info  { typ, beschreibung, bereich?, format? }
 */
function lernFeld(feldLabel, info) {
  const wissen = getWissen();
  const key    = feldLabel.toLowerCase().trim();

  wissen.felder[key] = { ...wissen.felder[key], ...info, gelernt: new Date().toISOString() };

  fs.mkdirSync(WISSEN_DIR, { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(wissen, null, 2), 'utf8');
  _cache = wissen;

  // Auch als lesbares Markdown speichern (ReMe-Style)
  const mdPath = path.join(WISSEN_DIR, `${key}.md`);
  fs.writeFileSync(mdPath,
    `# Feld: ${feldLabel}\n\n` +
    `- **Typ:** ${info.typ}\n` +
    `- **Beschreibung:** ${info.beschreibung}\n` +
    (info.bereich ? `- **Bereich:** ${info.bereich[0]} bis ${info.bereich[1]}\n` : '') +
    (info.format  ? `- **Format:** ${info.format}\n` : '') +
    `- **Gelernt:** ${new Date().toLocaleString('de-DE')}\n`,
    'utf8'
  );

  console.log(`📚 Wissen gelernt: "${feldLabel}" → ${info.typ} (${info.beschreibung})`);
}

/**
 * Gibt den vollständigen Kontext für einen Prompt zurück.
 * Wird an Claude weitergegeben wenn Fallback benötigt wird.
 *
 * @param {string[]} feldLabels
 * @returns {string}
 */
function getKontextFürPrompt(feldLabels = []) {
  const infos = feldLabels
    .map(l => {
      const w = wasGehörtInsFeld(l);
      return w ? `"${l}": ${w.beschreibung} (Typ: ${w.typ})` : null;
    })
    .filter(Boolean);

  if (!infos.length) return '';
  return `Feldwissen:\n${infos.map(i => `  - ${i}`).join('\n')}`;
}

module.exports = { wasGehörtInsFeld, wasIstDieApp, lernFeld, getKontextFürPrompt, getWissen };
