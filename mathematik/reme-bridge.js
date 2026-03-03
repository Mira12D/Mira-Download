// mathematik/reme-bridge.js
// Bridge zu ReMe (Python) via subprocess
// Node → stdin JSON → Python → stdout JSON
// Wie ax-helper: eigenständiger Prozess, JSON rein/raus

'use strict';

const { spawn } = require('child_process');
const path      = require('fs');
const fs        = require('fs');

const REME_DIR    = path.join ? path : require('path').join;
const REME_PATH   = require('path').join(__dirname, '..', '..', 'Reme-Main');
const SCRIPT_PATH = require('path').join(REME_PATH, 'reme', '__main__.py');
const MEMORY_DIR  = require('path').join(__dirname, '..', 'reme-memory');

let _available = null;

function isAvailable() {
  if (_available !== null) return _available;
  _available = fs.existsSync(SCRIPT_PATH);
  if (!_available) {
    console.log('ℹ️  ReMe-Bridge: Python-ReMe nicht gefunden — nutze lokale Markdown-Speicherung');
  }
  return _available;
}

/**
 * Sendet einen Befehl an ReMe und gibt die Antwort zurück.
 * Falls ReMe nicht verfügbar → Fallback auf lokale Speicherung.
 */
async function remeCall(command, data = {}) {
  if (!isAvailable()) return { ok: false, reason: 'reme_not_available' };

  return new Promise((resolve) => {
    const proc = spawn('python3', [SCRIPT_PATH], {
      env: { ...process.env, REME_MEMORY_DIR: MEMORY_DIR }
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);

    proc.on('close', () => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ ok: false, raw: stdout, error: stderr });
      }
    });

    proc.stdin.write(JSON.stringify({ command, ...data }));
    proc.stdin.end();

    setTimeout(() => { try { proc.kill(); } catch {} resolve({ ok: false, reason: 'timeout' }); }, 5000);
  });
}

/**
 * Speichert eine Erinnerung in ReMe.
 * Falls ReMe nicht da → als Markdown lokal.
 */
async function remember(key, content, kategorie = 'allgemein') {
  if (!isAvailable()) {
    // Fallback: direkt als Markdown speichern
    const dir  = require('path').join(MEMORY_DIR, kategorie);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      require('path').join(dir, `${key}.md`),
      `# ${key}\n\n${content}\n\n*Gespeichert: ${new Date().toLocaleString('de-DE')}*\n`,
      'utf8'
    );
    return { ok: true, local: true };
  }
  return remeCall('remember', { key, content, kategorie });
}

/**
 * Liest eine Erinnerung aus ReMe.
 */
async function recall(key, kategorie = 'allgemein') {
  if (!isAvailable()) {
    const mdPath = require('path').join(MEMORY_DIR, kategorie, `${key}.md`);
    if (!fs.existsSync(mdPath)) return { ok: false, content: null };
    return { ok: true, content: fs.readFileSync(mdPath, 'utf8'), local: true };
  }
  return remeCall('recall', { key, kategorie });
}

module.exports = { remember, recall, isAvailable };
