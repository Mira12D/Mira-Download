'use strict';

/**
 * ax-layer.js
 *
 * Cross-platform abstraction over OS Accessibility APIs.
 *
 *   macOS  → ax-helper      (Swift, AXUIElement)
 *   Windows → ax-helper-win.exe (C#, UI Automation)
 *
 * Both binaries expose identical commands and JSON output:
 *   check-permission  → { granted: boolean }
 *   frontmost         → { bundleId, name, pid }
 *   focused           → element | { found: false }
 *   find <desc> [--bundle <id>]
 *   list [--bundle <id>]
 *   at --x N --y N
 *
 * Coordinates: top-left origin, Y increases downward.
 * On Mac the Swift helper converts from AX Quartz coords internally.
 * On Windows UIA already uses this coordinate system natively.
 *
 * "bundleId" semantics per platform:
 *   macOS   → CFBundleIdentifier (e.g. "com.microsoft.Excel")
 *   Windows → process name without .exe (e.g. "EXCEL", "chrome")
 */

const { execFileSync, spawnSync } = require('child_process');
const path                        = require('path');

const PLATFORM = process.platform; // 'darwin' | 'win32' | 'linux'

class AxLayer {
  constructor() {
    this._helperPath      = null;
    this._supported       = PLATFORM === 'darwin' || PLATFORM === 'win32';
    this._permissionKnown = false;
    this._permissionGrant = false;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /**
   * Resolve the binary path for the current platform.
   * Packaged app: binary is in process.resourcesPath (electron-builder extraResources).
   * Development:  binary is in ./resources/.
   */
  _getHelperPath() {
    if (this._helperPath) return this._helperPath;

    // Windows uses a PowerShell script — no .NET SDK / compilation required.
    const binaryName = PLATFORM === 'win32' ? 'ax-helper-win.ps1' : 'ax-helper';

    // Packaged Electron app
    try {
      const { app } = require('electron');
      if (app && app.isPackaged) {
        this._helperPath = path.join(process.resourcesPath, binaryName);
        return this._helperPath;
      }
    } catch (_) { /* not running inside Electron (e.g. unit tests) */ }

    // Development
    this._helperPath = path.join(__dirname, 'resources', binaryName);
    return this._helperPath;
  }

  /**
   * Run the helper binary with the given args.
   * Returns parsed JSON on success or { error: string } on failure.
   */
  _run(args) {
    if (!this._supported) return { error: 'not_supported_on_platform' };

    // Windows: run the PowerShell script (no compilation needed).
    // Mac: run the compiled Swift binary directly.
    if (PLATFORM === 'win32') {
      const result = spawnSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
        '-ExecutionPolicy', 'Bypass',
        '-File', this._getHelperPath(),
        ...args.map(String),
      ], { timeout: 8000, stdio: ['ignore', 'pipe', 'pipe'] });

      if (result.error) return { error: result.error.message };
      const out = (result.stdout || Buffer.alloc(0)).toString('utf8').trim();
      if (out) { try { return JSON.parse(out); } catch (_) {} }
      return { error: 'no_output' };
    }

    try {
      const raw = execFileSync(this._getHelperPath(), args.map(String), {
        timeout: 3000,
        stdio:   ['ignore', 'pipe', 'ignore'],
      });
      return JSON.parse(raw.toString('utf8'));
    } catch (err) {
      // execFileSync throws when the process exits non-zero or times out;
      // the binary may still have printed valid JSON to stdout.
      if (err.stdout) {
        try { return JSON.parse(err.stdout.toString('utf8')); } catch (_) {}
      }
      return { error: err.message };
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Check whether Accessibility permission has been granted.
   * macOS: requires user to grant permission in System Settings → Privacy → Accessibility.
   * Windows: always returns { granted: true } — no explicit permission needed.
   *
   * @returns {{ granted: boolean } | { error: string }}
   */
  checkPermission() {
    if (!this._supported) return { granted: false };

    // Windows never needs a permission prompt
    if (PLATFORM === 'win32') {
      this._permissionKnown = true;
      this._permissionGrant = true;
      return { granted: true };
    }

    const result = this._run(['check-permission']);
    if (typeof result.granted === 'boolean') {
      this._permissionKnown = true;
      this._permissionGrant = result.granted;
    }
    return result;
  }

  /**
   * Returns true if accessibility access is available (cached after first call).
   * On Windows this is always true.
   */
  isPermissionGranted() {
    if (!this._supported)              return false;
    if (PLATFORM === 'win32')          return true;   // no permission gate on Windows
    if (!this._permissionKnown)        this.checkPermission();
    return this._permissionGrant;
  }

  /**
   * Get info about the currently frontmost/foreground application.
   *
   * macOS   → { bundleId: "com.microsoft.Excel", name: "Microsoft Excel", pid: 1234 }
   * Windows → { bundleId: "EXCEL",               name: "Book1 - Excel",    pid: 1234 }
   *
   * @returns {{ bundleId: string, name: string, pid: number } | { error: string }}
   */
  getFrontmostApp() {
    return this._run(['frontmost']);
  }

  /**
   * Find the best-matching UI element for a natural-language description.
   *
   * @param {string} description           e.g. "Speichern", "Close button"
   * @param {{ bundleId?: string }} options  macOS: CFBundleId; Windows: process name
   * @returns {{
   *   found: boolean,
   *   x?: number, y?: number,             // top-left of element bounding box
   *   width?: number, height?: number,
   *   centerX?: number, centerY?: number, // center — pass directly to mouse.setPosition()
   *   role?: string,                      // AX-style role ("AXButton", "AXTextField", …)
   *   title?: string,
   *   confidence?: number                 // 0.0 – 1.0
   * }}
   */
  findElement(description, { bundleId } = {}) {
    if (!this.isPermissionGranted()) return { found: false, error: 'no_accessibility_permission' };

    const args = ['find', description];
    if (bundleId) args.push('--bundle', bundleId);
    return this._run(args);
  }

  /**
   * List all interactive / labelled elements in an app's frontmost window.
   * Used by context-manager.js to build the state snapshot for element search
   * and backend context enrichment.
   *
   * @param {string} [bundleId]  macOS: CFBundleId; Windows: process name
   * @returns {{ elements: Array<ElementDict>, count: number } | { error: string }}
   */
  getElements(bundleId) {
    if (!this.isPermissionGranted()) return { elements: [], error: 'no_accessibility_permission' };

    const args = ['list'];
    if (bundleId) args.push('--bundle', bundleId);
    return this._run(args);
  }

  /**
   * Get the UI element that currently has keyboard focus.
   * On Windows this is the caret/active control; on macOS the AX focused element.
   *
   * @returns {{ found: boolean, role?: string, title?: string, value?: string, … }}
   */
  getFocusedElement() {
    if (!this.isPermissionGranted()) return { found: false, error: 'no_accessibility_permission' };
    return this._run(['focused']);
  }

  /**
   * Get the UI element at a specific screen coordinate.
   *
   * @param {number} x   Screen X (top-left origin)
   * @param {number} y   Screen Y (top-left origin)
   * @returns {{ found: boolean, role?: string, title?: string, … }}
   */
  getElementAt(x, y) {
    if (!this.isPermissionGranted()) return { found: false, error: 'no_accessibility_permission' };
    return this._run(['at', '--x', x, '--y', y]);
  }

  // ── Fix 2: Fingerprint-basierte Element-Suche ─────────────────────────────

  /**
   * Sucht ein Element im aktuellen AX-Baum anhand eines gespeicherten Fingerprints
   * (AXRole + AXLabel). Wird aufgerufen wenn der Koordinaten-Cache einen Treffer
   * hat und die App möglicherweise verschoben/reskaliert wurde.
   *
   * @param {{ axLabel: string, axRole?: string, axParent?: string }} fp  Fingerprint
   * @param {{ bundleId?: string }} options
   * @returns {{ found: boolean, centerX?: number, centerY?: number, role?: string, title?: string }}
   */
  findByFingerprint(fp, { bundleId } = {}) {
    if (!fp || !fp.axLabel || !this.isPermissionGranted()) return { found: false };

    const result = this.getElements(bundleId);
    if (!result.elements || result.elements.length === 0) return { found: false };

    const normalise = s => (s || '').toLowerCase().trim();
    const targetLabel = normalise(fp.axLabel);
    const targetRole  = fp.axRole || null;

    // Alle Elemente die Label UND (falls vorhanden) Role matchen
    const matches = result.elements.filter(el => {
      const label = normalise(el.title || el.label || el.value || '');
      const labelOk = label === targetLabel;
      const roleOk  = !targetRole || el.role === targetRole;
      return labelOk && roleOk;
    });

    if (matches.length === 0) return { found: false };

    // Mehrere Treffer: axParent als Tiebreaker falls vorhanden
    let best = matches[0];
    if (matches.length > 1 && fp.axParent) {
      const parentNorm = normalise(fp.axParent);
      const parentMatch = matches.find(el => normalise(el.parentTitle || el.parentLabel || '') === parentNorm);
      if (parentMatch) best = parentMatch;
    }

    return {
      found:      true,
      centerX:    best.centerX,
      centerY:    best.centerY,
      x:          best.x,
      y:          best.y,
      width:      best.width,
      height:     best.height,
      role:       best.role,
      title:      best.title,
      confidence: 0.95,
    };
  }

  // ── Fix 3: Dialog/Sheet-Erkennung ─────────────────────────────────────────

  /**
   * Prüft ob das aktuelle frontmost Window ein Dialog (AXSheet / AXDialog) ist.
   * Gibt eine Liste der verfügbaren Buttons zurück damit der Aufrufer den
   * richtigen klicken kann (OK / Allow / Cancel).
   *
   * @param {string} [bundleId]
   * @returns {{
   *   dialog: boolean,
   *   title?: string,
   *   buttons?: Array<{ label: string, centerX: number, centerY: number, isConfirm: boolean, isCancel: boolean }>
   * }}
   */
  checkForDialog(bundleId) {
    if (!this.isPermissionGranted()) return { dialog: false };

    const result = this.getElements(bundleId);
    if (!result.elements || result.elements.length === 0) return { dialog: false };

    const DIALOG_ROLES  = ['AXSheet', 'AXDialog'];
    const CONFIRM_RE    = /^(ok|allow|erlauben|weiter|fortfahren|confirm|bestätigen|ja|yes|akzeptieren|accept|öffnen|open)$/i;
    const CANCEL_RE     = /^(cancel|abbrechen|nicht erlauben|nein|no|schließen|close|verwerfen|discard)$/i;

    const dialogEl = result.elements.find(el => DIALOG_ROLES.includes(el.role));
    if (!dialogEl) return { dialog: false };

    const buttons = result.elements
      .filter(el => el.role === 'AXButton' && (el.title || el.label))
      .map(el => {
        const lbl = (el.title || el.label || '').trim();
        return {
          label:     lbl,
          centerX:   el.centerX,
          centerY:   el.centerY,
          isConfirm: CONFIRM_RE.test(lbl),
          isCancel:  CANCEL_RE.test(lbl),
        };
      });

    return {
      dialog:  true,
      title:   dialogEl.title || dialogEl.label || 'Dialog',
      buttons,
    };
  }
}

module.exports = new AxLayer();
