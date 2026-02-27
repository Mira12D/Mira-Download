'use strict';

/**
 * system-log-monitor.js
 *
 * Background-Service: liest macOS Unified Logging / Windows Event Log und
 * Spotlight/Shell-Recent-Items, um zu verstehen welche Apps und Dateien der
 * Nutzer gerade benutzt.
 *
 * Ergebnis wird in mira-memory.json (lokal) geschrieben UND an
 * POST /api/brain/memory-save gesendet — MIRA weiß damit immer wo was ist.
 *
 * Poll-Intervall: alle 5 Minuten.
 * Plattform: macOS (mdfind + lsappinfo + log) / Windows (PowerShell)
 */

const { execFileSync } = require('child_process');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

const PLATFORM      = process.platform;
const POLL_MS       = 5 * 60 * 1000;   // 5 Minuten
const MAX_FILES     = 100;             // max Einträge in recent_files
const MAX_APPS      = 30;              // max Einträge in recent_apps
const RECENT_WINDOW = 5 * 60;         // Sekunden zurück für mdfind

// Dateierweiterungen die für Büroarbeit relevant sind
const RELEVANT_EXTS = new Set([
  '.xlsx', '.xls', '.csv',
  '.docx', '.doc', '.pdf',
  '.pptx', '.ppt',
  '.txt', '.md',
  '.msg', '.eml',
  '.png', '.jpg', '.jpeg',
]);

class SystemLogMonitor {
  constructor() {
    this._timer        = null;
    this._api          = null;
    this._token        = null;
    this._memPath      = null;
    this._lastPollTime = null;
    this._running      = false;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Service starten. Wird nach Token-Load in main.js aufgerufen.
   * @param {{ api: string, token: string }} opts
   */
  start({ api, token }) {
    if (this._running) {
      // Token-Update (Re-Aktivierung)
      this._token = token;
      this._api   = api;
      return;
    }

    this._api     = api;
    this._token   = token;
    this._running = true;
    this._memPath = this._resolvePath();

    // Sofort einmal + dann alle 5 Min
    this._poll().catch(() => {});
    this._timer = setInterval(() => this._poll().catch(() => {}), POLL_MS);

    console.log(`📋 SystemLogMonitor: gestartet (${PLATFORM}), Memory: ${this._memPath}`);
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this._running = false;
    console.log('📋 SystemLogMonitor: gestoppt');
  }

  /** Token aktualisieren (nach Re-Login) */
  setToken(token) { this._token = token; }

  // ── Internes ──────────────────────────────────────────────────────────────

  _resolvePath() {
    try {
      const { app } = require('electron');
      return path.join(app.getPath('userData'), 'mira-memory.json');
    } catch {
      return path.join(__dirname, 'mira-memory.json');
    }
  }

  async _poll() {
    this._lastPollTime = new Date();

    const events = PLATFORM === 'darwin'
      ? this._collectMac()
      : this._collectWin();

    if (events.files.length === 0 && events.apps.length === 0) return;

    this._mergeToMemory(events);
    await this._sendToBackend(events);

    console.log(`📋 SystemLog: ${events.files.length} Dateien, ${events.apps.length} Apps erfasst`);
  }

  // ── macOS ─────────────────────────────────────────────────────────────────

  _collectMac() {
    const files = this._macRecentFiles();
    const apps  = this._macRunningApps();
    return { files, apps, platform: 'darwin', ts: new Date().toISOString() };
  }

  _macRecentFiles() {
    try {
      // Spotlight: Dateien die in den letzten RECENT_WINDOW Sekunden geöffnet wurden
      const raw = execFileSync('mdfind', [
        '-onlyin', os.homedir(),
        `kMDItemLastUsedDate > $time.now(-${RECENT_WINDOW})`
      ], { timeout: 6000 }).toString('utf8');

      return raw
        .trim().split('\n')
        .filter(Boolean)
        .filter(p => {
          const ext = path.extname(p).toLowerCase();
          // Systempfade rausfiltern
          return !p.includes('/Library/') && !p.includes('/System/') &&
                 (RELEVANT_EXTS.has(ext) || ext === '');
        })
        .slice(0, 40)
        .map(p => ({
          path: p,
          name: path.basename(p),
          ext:  path.extname(p).toLowerCase(),
          dir:  path.dirname(p),
        }));
    } catch {
      return [];
    }
  }

  _macRunningApps() {
    try {
      // lsappinfo list → laufende GUI-Apps
      const raw = execFileSync('lsappinfo', ['list'], { timeout: 4000 }).toString('utf8');

      const apps = [];
      const bundleRe = /CFBundleIdentifier = "([^"]+)"/g;
      const nameRe   = /\(([^)]+)\)/;

      let m;
      while ((m = bundleRe.exec(raw)) !== null) {
        const bundleId = m[1];
        // System-Prozesse überspringen
        if (bundleId.startsWith('com.apple.') && !bundleId.includes('mail') &&
            !bundleId.includes('safari') && !bundleId.includes('notes')) continue;
        apps.push({ bundleId, ts: new Date().toISOString() });
        if (apps.length >= MAX_APPS) break;
      }
      return apps;
    } catch {
      return [];
    }
  }

  // ── Windows ───────────────────────────────────────────────────────────────

  _collectWin() {
    const files = this._winRecentFiles();
    const apps  = this._winRunningApps();
    return { files, apps, platform: 'win32', ts: new Date().toISOString() };
  }

  _winRecentFiles() {
    try {
      // Windows Shell Recent Items
      const psCmd = [
        `Get-ChildItem "$env:APPDATA\\Microsoft\\Windows\\Recent" -ErrorAction SilentlyContinue`,
        `| Sort-Object LastWriteTime -Descending`,
        `| Select-Object -First 40`,
        `| Select-Object Name, FullName, LastWriteTime`,
        `| ConvertTo-Json -Compress`
      ].join(' ');

      const raw  = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd],
        { timeout: 7000 }).toString('utf8');

      const items = JSON.parse(raw);
      const arr   = Array.isArray(items) ? items : [items];

      return arr
        .filter(i => i && i.Name)
        .map(i => {
          const name = (i.Name || '').replace(/\.lnk$/i, '');
          return {
            name,
            ext:  path.extname(name).toLowerCase(),
            path: i.FullName || '',
            ts:   i.LastWriteTime || new Date().toISOString(),
          };
        })
        .filter(i => RELEVANT_EXTS.has(i.ext) || i.ext === '');
    } catch {
      return [];
    }
  }

  _winRunningApps() {
    try {
      // Laufende GUI-Prozesse via PowerShell
      const psCmd = [
        `Get-Process | Where-Object {$_.MainWindowTitle -ne ""}`,
        `| Select-Object Name, MainWindowTitle, Id`,
        `| Select-Object -First 20`,
        `| ConvertTo-Json -Compress`
      ].join(' ');

      const raw  = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd],
        { timeout: 6000 }).toString('utf8');

      const items = JSON.parse(raw);
      const arr   = Array.isArray(items) ? items : [items];

      return arr
        .filter(i => i && i.Name)
        .map(i => ({
          bundleId:    i.Name,           // Windows: Prozessname als BundleId-Äquivalent
          windowTitle: i.MainWindowTitle,
          ts:          new Date().toISOString(),
        }));
    } catch {
      return [];
    }
  }

  // ── Lokale Memory-Datei ───────────────────────────────────────────────────

  _mergeToMemory(events) {
    // Bestehende Memory laden
    let mem = {};
    try {
      mem = JSON.parse(fs.readFileSync(this._memPath, 'utf8'));
    } catch { /* erste Ausführung */ }

    if (!mem.recent_files)   mem.recent_files   = [];
    if (!mem.recent_apps)    mem.recent_apps    = [];
    if (!mem.poll_history)   mem.poll_history   = [];

    // Dateien mergen (Dedup by path/name)
    for (const f of events.files) {
      const key = f.path || f.name;
      const idx = mem.recent_files.findIndex(x => (x.path || x.name) === key);
      const entry = { ...f, last_seen: events.ts };
      if (idx >= 0) {
        mem.recent_files[idx] = entry;   // Aktualisieren
      } else {
        mem.recent_files.unshift(entry); // Vorne einfügen (neueste zuerst)
      }
    }
    // Auf MAX_FILES begrenzen
    mem.recent_files = mem.recent_files.slice(0, MAX_FILES);

    // Apps mergen (Dedup by bundleId)
    for (const a of events.apps) {
      const idx = mem.recent_apps.findIndex(x => x.bundleId === a.bundleId);
      const entry = { ...a, last_seen: events.ts };
      if (idx >= 0) {
        mem.recent_apps.splice(idx, 1); // Raus und vorne wieder rein
      }
      mem.recent_apps.unshift(entry);
    }
    mem.recent_apps = mem.recent_apps.slice(0, MAX_APPS);

    // Poll-Historie (für Debugging)
    mem.poll_history.unshift({ ts: events.ts, files: events.files.length, apps: events.apps.length });
    mem.poll_history = mem.poll_history.slice(0, 48); // letzte 4 Stunden (48 × 5min)

    // Speichern
    try {
      fs.writeFileSync(this._memPath, JSON.stringify(mem, null, 2), 'utf8');
    } catch (e) {
      console.warn('📋 SystemLog: Memory write error:', e.message);
    }
  }

  // ── Backend-Sync ─────────────────────────────────────────────────────────

  async _sendToBackend(events) {
    if (!this._api || !this._token) return;

    try {
      await fetch(`${this._api}/api/brain/memory-save`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: this._token,
          type:  'system_log',
          platform: events.platform,
          recent_files: events.files,
          recent_apps:  events.apps,
          ts: events.ts,
        }),
      });
    } catch {
      // Kein Netz — kein Problem, lokal ist die Memory bereits aktuell
    }
  }

  // ── Öffentlicher Getter (für contextManager Anreicherung) ─────────────────

  /**
   * Gibt die lokale Memory zurück — contextManager kann damit
   * die letzten genutzten Files/Apps an den Prompt anhängen.
   * @returns {{ recent_files: Array, recent_apps: Array } | null}
   */
  getMemory() {
    try {
      return JSON.parse(fs.readFileSync(this._memPath, 'utf8'));
    } catch {
      return null;
    }
  }
}

module.exports = new SystemLogMonitor();
