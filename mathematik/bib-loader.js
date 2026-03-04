/**
 * MIRA BibLoader — Telekolleg-Wissensbibliothek
 *
 * Liest alle MD-Dateien aus reme-memory/knowledge/bib/
 * Baut einen Keyword-Index über Abschnitte (## / ###)
 * findRelevant(command) → gibt passende Abschnitte zurück (<500 Tokens)
 *
 * Kein API-Call. Läuft lokal in <5ms.
 * Wird von der Schaltzentrale vor dem Server-Dispatch aufgerufen.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const BIB_DIR = path.join(__dirname, '..', 'reme-memory', 'knowledge', 'bib');

// ── Keyword → Datei-Mapping (welche Datei ist für welchen Intent?) ─────────
const FILE_KEYWORDS = {
  'Telekolleg-Einführung-Excel.md':         ['excel', 'tabelle', 'zelle', 'formel', 'spalte', 'zeile', 'summe', 'pivot', 'diagramm', 'rechnen', 'kalkulation', 'xlsx'],
  'Telekolleg-Daten-ins-Excel.md':          ['excel', 'daten', 'importieren', 'kopieren', 'pdf', 'google', 'sheet', 'csv', 'einfügen', 'übertragen', 'tabelle'],
  'Telekolleg-Outlook.md':                  ['outlook', 'mail', 'email', 'e-mail', 'posteingang', 'kalender', 'termin', 'kontakt', 'aufgabe', 'microsoft mail'],
  'Telekolleg-Outlook-Teil-2.md':           ['outlook', 'suche', 'suchen', 'filter', 'ordner', 'archiv', 'anhang', 'weiterleiten', 'antworten', 'bcc', 'cc'],
  'Telekolleg-E-Mail.md':                   ['mail', 'email', 'e-mail', 'smtp', 'imap', 'gmail', 'gmx', 'postfach', 'absender', 'empfänger', 'betreff', 'anhang'],
  'Telekolleg-Einführung-Apple.md':         ['mac', 'apple', 'macos', 'finder', 'spotlight', 'cmd', 'dock', 'mission control', 'icloud', 'imac', 'macbook'],
  'Telekolleg-Mac-Einführung-ASCII.md':     ['mac', 'ascii', 'sonderzeichen', 'symbol', 'tastenkombination', 'zeichen', 'option', 'alt'],
  'ASCI-Codes-Mac.md':                      ['mac', 'ascii', 'sonderzeichen', 'symbol', 'code', 'zeichen', 'option'],
  'Telekolleg-Windows-Einführung-ins-Zahlenblock.md': ['windows', 'numpad', 'zahlenblock', 'numlock', 'ascii', 'sonderzeichen', 'strg', 'alt'],
  'Windows-ASCII-Symbole.md':               ['windows', 'ascii', 'sonderzeichen', 'symbol', 'alt', 'code', 'zeichen'],
  'Telekolleg-Dokumente-Einführung.md':     ['dokument', 'word', 'text', 'schreiben', 'speichern', 'formatierung', 'absatz', 'überschrift', 'docx'],
  'Telekolleg-Einführung-Youtube.md':       ['youtube', 'video', 'kanal', 'abonnieren', 'playlist', 'suchen', 'hochladen', 'kommentar'],
  'Telekolleg-Einführung.md':               ['pc', 'computer', 'tastatur', 'maus', 'desktop', 'betriebssystem', 'windows', 'grundlagen', 'einführung', 'anfänger', 'screenreader', 'blind'],
};

// ── Index: { sectionTitle, content, keywords, file } ─────────────────────
let _index = null;
let _loaded = false;

function _loadIndex() {
  if (_loaded) return;
  _loaded = true;
  _index  = [];

  if (!fs.existsSync(BIB_DIR)) return;

  for (const [filename, fileKws] of Object.entries(FILE_KEYWORDS)) {
    const filePath = path.join(BIB_DIR, filename);
    if (!fs.existsSync(filePath)) continue;

    let text;
    try { text = fs.readFileSync(filePath, 'utf8'); } catch { continue; }

    // Zerlege in Abschnitte (## und ###)
    const sections = _splitSections(text);
    for (const sec of sections) {
      // Extrahiere Keywords aus dem Abschnitt-Inhalt selbst
      const contentKws = _extractKeywords(sec.title + ' ' + sec.content);
      _index.push({
        file:     filename,
        title:    sec.title,
        content:  sec.content,
        keywords: [...new Set([...fileKws, ...contentKws])],
      });
    }
  }
}

// Zerlegt einen MD-Text in Abschnitte anhand von ## / ###
function _splitSections(text) {
  const lines    = text.split('\n');
  const sections = [];
  let current    = null;

  for (const line of lines) {
    if (/^#{1,3}\s+/.test(line)) {
      if (current && current.content.trim().length > 30) sections.push(current);
      current = { title: line.replace(/^#+\s+/, '').trim(), content: '' };
    } else if (current) {
      current.content += line + '\n';
    }
  }
  if (current && current.content.trim().length > 30) sections.push(current);
  return sections;
}

// Extrahiert Nomen/Keywords aus Text (einfaches Heuristik-Verfahren)
function _extractKeywords(text) {
  return text.toLowerCase()
    .replace(/[^a-zäöüß\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 4)
    .slice(0, 40);
}

// ── Score: wie gut passt ein Abschnitt zum Befehl? ────────────────────────
function _scoreSection(section, tokens) {
  let score = 0;
  for (const token of tokens) {
    // Treffer im Titel → höher gewichten
    if (section.title.toLowerCase().includes(token)) score += 3;
    // Treffer in Keywords → mittel
    if (section.keywords.some(k => k.includes(token) || token.includes(k))) score += 2;
    // Treffer im Content → niedrig
    if (section.content.toLowerCase().includes(token)) score += 1;
  }
  return score;
}

// ── Hauptfunktion: findRelevant(command) ──────────────────────────────────
/**
 * Sucht die relevantesten Abschnitte für einen Befehl.
 * @param {string} command
 * @param {object} opts
 * @param {number} opts.maxSections  max. zurückgegebene Abschnitte (default: 2)
 * @param {number} opts.maxChars     max. Gesamtlänge (default: 1200 Zeichen ≈ ~300 Tokens)
 * @returns {{ found: boolean, context: string, sections: string[] }}
 */
function findRelevant(command, { maxSections = 2, maxChars = 1200 } = {}) {
  _loadIndex();
  if (!_index || _index.length === 0) return { found: false, context: '', sections: [] };

  const tokens = command.toLowerCase()
    .replace(/[^a-zäöüß\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3);

  if (tokens.length === 0) return { found: false, context: '', sections: [] };

  // Alle Abschnitte bewerten
  const scored = _index
    .map(sec => ({ sec, score: _scoreSection(sec, tokens) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  // Mindest-Score: verhindert False-Positives (z.B. Excel-Artikel für "iran krieg notizen")
  if (scored.length === 0 || scored[0].score < 4) return { found: false, context: '', sections: [] };

  // Top-Abschnitte zusammenbauen (Zeichenlimit)
  const results  = [];
  let totalChars = 0;

  for (const { sec, score } of scored.slice(0, maxSections * 2)) {
    if (results.length >= maxSections) break;
    const snippet = `### ${sec.title}\n${sec.content.slice(0, 600).trim()}`;
    if (totalChars + snippet.length > maxChars) continue;
    results.push(snippet);
    totalChars += snippet.length;
  }

  if (results.length === 0) return { found: false, context: '', sections: [] };

  const context = `## MIRA Wissensbibliothek (Telekolleg)\n${results.join('\n\n---\n\n')}`;

  return {
    found:    true,
    context,
    sections: results.map((_, i) => scored[i]?.sec?.title || ''),
  };
}

// ── Vorwärmen (beim App-Start) ────────────────────────────────────────────
function warmup() {
  _loadIndex();
  console.log(`📚 BibLoader: ${_index?.length ?? 0} Abschnitte aus ${Object.keys(FILE_KEYWORDS).length} Dateien geladen`);
}

module.exports = { findRelevant, warmup };
