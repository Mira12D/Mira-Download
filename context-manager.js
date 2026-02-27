'use strict';

/**
 * context-manager.js
 *
 * Reads the current screen state once per executeStep using the AX Layer,
 * then makes that state available to every resolution tier without additional
 * OS queries.
 *
 * Usage:
 *   const ctx = contextManager.captureState();        // one AX snapshot
 *   const el  = contextManager.findInState(ctx, label); // fast JS search
 *   const str = contextManager.toPromptString(ctx);    // for API prompts
 *   contextManager.invalidate();                        // after an action
 */

const axLayer = require('./ax-layer');

// ── App type mapping ──────────────────────────────────────────────────────────
// macOS keys: CFBundleIdentifier  (e.g. "com.microsoft.Excel")
// Windows keys: process name without .exe  (e.g. "EXCEL", "chrome")

const BUNDLE_TO_TYPE = {
  // ── macOS ──────────────────────────────────────────────────────────────────
  'com.microsoft.Word':           'word',
  'com.microsoft.Excel':          'excel',
  'com.microsoft.Powerpoint':     'powerpoint',
  'com.microsoft.Outlook':        'outlook',
  'com.apple.mail':               'mail',
  'com.apple.Safari':             'browser',
  'com.google.Chrome':            'browser',
  'org.mozilla.firefox':          'browser',
  'com.brave.Browser':            'browser',
  'com.apple.finder':             'finder',
  'com.apple.TextEdit':           'textedit',
  'com.adobe.Acrobat.Pro':        'pdf',
  'com.adobe.Reader':             'pdf',
  'com.apple.Preview':            'pdf',
  'com.apple.Numbers':            'numbers',
  'com.apple.Pages':              'pages',
  'com.apple.Keynote':            'keynote',

  // ── Windows (process name = bundleId returned by ax-helper-win) ───────────
  'WINWORD':                      'word',
  'winword':                      'word',
  'EXCEL':                        'excel',
  'excel':                        'excel',
  'POWERPNT':                     'powerpoint',
  'powerpnt':                     'powerpoint',
  'OUTLOOK':                      'outlook',
  'outlook':                      'outlook',
  'HxOutlook':                    'outlook',      // new Outlook app (Windows 11)
  'chrome':                       'browser',
  'msedge':                       'browser',
  'firefox':                      'browser',
  'iexplore':                     'browser',
  'brave':                        'browser',
  'opera':                        'browser',
  'explorer':                     'finder',       // Windows File Explorer
  'Notepad':                      'textedit',
  'notepad':                      'textedit',
  'AcroRd32':                     'pdf',
  'Acrobat':                      'pdf',
  'SumatraPDF':                   'pdf',
  'NUMBERS':                      'numbers',
  'PAGES':                        'pages',
  'KEYNOTE':                      'keynote',
  'thunderbird':                  'mail',
  'Thunderbird':                  'mail',
};

// Roles that represent user-fillable or interactable fields per app type
const FIELD_ROLES_BY_APP = {
  mail:     ['AXTextField', 'AXTextArea'],
  word:     ['AXTextArea', 'AXTextField'],
  excel:    ['AXTextField', 'AXStaticText'],
  numbers:  ['AXTextField', 'AXStaticText'],
  browser:  ['AXTextField', 'AXTextArea', 'AXButton', 'AXLink'],
  textedit: ['AXTextArea', 'AXTextField'],
  default:  ['AXTextField', 'AXTextArea', 'AXButton', 'AXCheckBox',
             'AXPopUpButton', 'AXComboBox', 'AXRadioButton'],
};

// Interactive roles for scoring bonus
const INTERACTIVE_ROLES = new Set([
  'AXButton', 'AXTextField', 'AXTextArea', 'AXCheckBox',
  'AXRadioButton', 'AXPopUpButton', 'AXComboBox',
  'AXMenuItem', 'AXLink', 'AXSlider', 'AXTab',
]);

// ── ContextManager ────────────────────────────────────────────────────────────

class ContextManager {
  constructor() {
    this._cache   = null;
    this._cacheAt = 0;
    this._ttl     = 400; // ms — don't re-query AX within this window
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Capture a full screen-state snapshot using the AX Layer.
   * Result is cached for _ttl ms to avoid redundant subprocess calls during
   * a single executeStep invocation.
   *
   * @param {boolean} [force=false]  Bypass cache and force a fresh AX query.
   * @returns {StateSnapshot}
   */
  captureState(force = false) {
    const now = Date.now();
    if (!force && this._cache && (now - this._cacheAt) < this._ttl) {
      return this._cache;
    }

    // 1. Frontmost app
    const app = axLayer.getFrontmostApp();
    if (app.error || !app.bundleId) {
      return this._empty('no_app');
    }

    const appType = BUNDLE_TO_TYPE[app.bundleId] || 'unknown';

    // 2. Currently focused element (cursor / active field)
    const focusedRaw = axLayer.getFocusedElement();
    const focused    = focusedRaw.found ? focusedRaw : null;

    // 3. All interactive elements in current window
    const elemResult = axLayer.getElements(app.bundleId);
    const elements   = elemResult.elements || [];

    // 4. App-specific field extraction
    const fields = this._extractFields(elements, appType);

    // 5. Window / document title
    const windowTitle = this._detectWindowTitle(elements, focused, appType);

    const state = {
      timestamp:   now,
      empty:       false,
      app,
      appType,
      windowTitle,
      focused,
      fields,
      elements,
      context:     '',   // filled below
    };

    state.context = this._describeContext(state);

    this._cache   = state;
    this._cacheAt = now;
    return state;
  }

  /**
   * Invalidate the cache. Call this immediately after any action that changes
   * the screen (click, type, key press) so the next captureState() gets fresh data.
   */
  invalidate() {
    this._cache   = null;
    this._cacheAt = 0;
  }

  /**
   * Search for a UI element within a previously captured state.
   * Pure JS — no subprocess, no AX call — runs in < 1 ms.
   * This is "Tier 0a" in the coordinate resolution chain.
   *
   * @param {StateSnapshot} state
   * @param {string}        description  Natural-language label to search for.
   * @returns {{ centerX, centerY, confidence, role, title, ... } | null}
   */
  findInState(state, description) {
    if (!state?.elements?.length) return null;

    const q = description.toLowerCase().trim();
    let best = null, bestScore = 0;

    for (const el of state.elements) {
      const s = this._scoreEl(el, q);
      if (s > bestScore) { bestScore = s; best = el; }
    }

    if (bestScore < 0.25 || !best) return null;
    return { ...best, confidence: bestScore, source: 'ctx_state' };
  }

  /**
   * Build a compact, LLM-readable context string from a captured state.
   * Pass this as `context` to /api/brain/resolve-step and /api/brain/mini-find
   * to enrich the server's reasoning with OS-level knowledge.
   *
   * @param {StateSnapshot} state
   * @returns {string}
   */
  toPromptString(state) {
    if (!state || state.empty) return '';

    const lines = [
      `=== MIRA SCREEN CONTEXT ===`,
      `App: ${state.app.name} [${state.appType}]`,
      `Fenster: ${state.windowTitle || '(unbekannt)'}`,
    ];

    // Focused element
    if (state.focused) {
      const f   = state.focused;
      const val = f.value ? ` = "${f.value.substring(0, 80)}"` : '';
      lines.push(`Fokus: ${f.role} "${f.title || f.label || f.description || ''}${val}"`);
    }

    // Visible fields
    if (state.fields.length) {
      lines.push('Felder:');
      state.fields.slice(0, 8).forEach(f => {
        const name = f.title || f.label || f.description || f.role;
        const val  = f.value ? ` → "${f.value.substring(0, 60)}"` : '';
        const st   = f.value ? '✓' : '○';
        lines.push(`  ${st} [${f.role}] "${name}"${val}`);
      });
    }

    // High-level context description
    if (state.context) lines.push(`Kontext: ${state.context}`);

    return lines.join('\n');
  }

  /**
   * Returns a minimal one-line summary (for logging / debug).
   * @param {StateSnapshot} state
   * @returns {string}
   */
  toShortString(state) {
    if (!state || state.empty) return '(kein Kontext)';
    const f = state.focused ? ` | Fokus: ${state.focused.role} "${state.focused.title || ''}"` : '';
    return `${state.app.name} [${state.appType}] | ${state.windowTitle || '?'}${f}`;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _extractFields(elements, appType) {
    const roles = FIELD_ROLES_BY_APP[appType] || FIELD_ROLES_BY_APP.default;
    return elements
      .filter(el =>
        roles.includes(el.role) &&
        (el.title || el.label || el.description)
      )
      .slice(0, 20);
  }

  _detectWindowTitle(elements, focused, appType) {
    // Heuristic: large static text near the top of the screen is the title/doc name.
    // Apps like Word/Excel/Pages put the document name in the window's title bar.
    const candidates = elements.filter(el =>
      el.role === 'AXStaticText' &&
      (el.width || 0) > 150 &&
      (el.y || 0) < 80
    );
    if (candidates.length) {
      const best = candidates.sort((a, b) => (b.width || 0) - (a.width || 0))[0];
      if (best.title) return best.title;
      if (best.label) return best.label;
    }

    // Fallback: focused element's window title (if text editor / browser)
    if (focused && (appType === 'browser' || appType === 'word' || appType === 'textedit')) {
      const w = focused.title || focused.label;
      if (w) return w;
    }

    return null;
  }

  _describeContext({ appType, windowTitle, fields, focused, app }) {
    switch (appType) {
      case 'mail': {
        const to  = fields.find(f => /^(to|an|empfänger|recipient)/i.test(f.title || f.label || ''));
        const sub = fields.find(f => /^(subject|betreff)/i.test(f.title || f.label || ''));
        const cc  = fields.find(f => /^(cc|bcc)/i.test(f.title || f.label || ''));
        if (to || sub) {
          const parts = [];
          if (to?.value)  parts.push(`An: ${to.value}`);
          if (sub?.value) parts.push(`Betreff: ${sub.value}`);
          if (cc?.value)  parts.push(`CC: ${cc.value}`);
          return `E-Mail schreiben — ${parts.join(', ') || '(leer)'}`;
        }
        return windowTitle ? `E-Mail lesen: "${windowTitle}"` : 'Mail App';
      }

      case 'excel':
      case 'numbers': {
        // In spreadsheets, the focused TextField is usually the formula bar / active cell
        const activeCell = focused && focused.role === 'AXTextField'
          ? focused
          : fields.find(f => f.role === 'AXTextField');
        const sheet = windowTitle ? `"${windowTitle}"` : app.name;
        if (activeCell) {
          const cellName = activeCell.title || activeCell.label || 'Zelle';
          const cellVal  = activeCell.value ? ` = "${activeCell.value}"` : '';
          return `${appType === 'excel' ? 'Excel' : 'Numbers'} ${sheet} — Aktiv: ${cellName}${cellVal}`;
        }
        return `${appType === 'excel' ? 'Excel' : 'Numbers'}: ${sheet}`;
      }

      case 'word':
      case 'pages': {
        const doc = appType === 'word' ? 'Word' : 'Pages';
        return `${doc} Dokument: "${windowTitle || 'unbenannt'}"`;
      }

      case 'powerpoint':
      case 'keynote': {
        const app2 = appType === 'powerpoint' ? 'PowerPoint' : 'Keynote';
        return `${app2} Präsentation: "${windowTitle || 'unbenannt'}"`;
      }

      case 'outlook': {
        const to  = fields.find(f => /^(to|an)/i.test(f.title || f.label || ''));
        const sub = fields.find(f => /^(subject|betreff)/i.test(f.title || f.label || ''));
        if (to || sub) return `Outlook E-Mail — An: ${to?.value || '?'}, Betreff: ${sub?.value || '?'}`;
        return windowTitle ? `Outlook: "${windowTitle}"` : 'Outlook';
      }

      case 'browser': {
        const urlField = fields.find(f =>
          /^(url|address|adresse|suche|search)/i.test(f.title || f.label || f.description || '')
        );
        const url = urlField?.value || '';
        return url
          ? `Browser — URL: "${url}", Seite: "${windowTitle || ''}"`
          : `Browser: "${windowTitle || ''}"`;
      }

      case 'finder': {
        return `Finder: "${windowTitle || 'Desktop'}"`;
      }

      case 'pdf': {
        return `PDF Dokument: "${windowTitle || 'unbekannt'}"`;
      }

      case 'textedit': {
        return `TextEdit: "${windowTitle || 'unbenannt'}"`;
      }

      default:
        return windowTitle ? `${app.name}: "${windowTitle}"` : app.name;
    }
  }

  /**
   * Score how well an element matches a natural-language query.
   * Mirrors the Swift scoring logic in ax-helper.swift but runs in JS
   * on the already-captured elements list.
   */
  _scoreEl(el, query) {
    const title = (el.title       || '').toLowerCase();
    const label = (el.label       || '').toLowerCase();
    const desc  = (el.description || '').toLowerCase();
    // Ignore long values (terminal buffers, doc content)
    const val   = el.value && el.value.length < 200
      ? el.value.toLowerCase()
      : '';

    if (!title && !label && !desc) return 0;

    // Off-screen guard (inherited from AX snapshot — shouldn't need extra check)
    // but keep as safety net
    if ((el.y || 0) < -100) return 0;

    let s = 0;
    const candidates = [title, label, desc, val];

    for (const text of candidates) {
      if (!text) continue;
      if (text === query)          { s += 0.60; break; }
      if (text.startsWith(query)) { s += 0.45; break; }
      if (text.includes(query))   { s += 0.35; break; }
    }

    // Partial word overlap bonus (each query word found in any candidate)
    const qWords = query.split(/\s+/).filter(w => w.length > 2);
    for (const word of qWords) {
      if (candidates.some(t => t.includes(word))) s += 0.08;
    }

    // Interactive role bonus
    if (INTERACTIVE_ROLES.has(el.role)) s += 0.08;
    if (el.enabled !== false)           s += 0.04;

    return Math.min(s, 1.0);
  }

  /**
   * Compare two captured states to detect whether an action produced a visible effect.
   * Used after click/type to verify success without taking a screenshot.
   *
   * @param {StateSnapshot} before  State captured just before the action.
   * @param {StateSnapshot} after   State captured after the action settles (~600ms later).
   * @returns {{ changed: boolean, changes: string[], signal: 'strong'|'weak'|'none' }}
   */
  diffStates(before, after) {
    if (!before || before.empty || !after || after.empty) {
      return { changed: false, changes: [], signal: 'none' };
    }

    const changes = [];
    let strongSignal = false;

    // ── App / frontmost window changed ───────────────────────────────────────
    if (before.app?.bundleId !== after.app?.bundleId) {
      changes.push(`app: ${before.app?.name || '?'} → ${after.app?.name || '?'}`);
      strongSignal = true;
    }

    // ── Document / window title changed ──────────────────────────────────────
    if (before.windowTitle !== after.windowTitle &&
        (before.windowTitle !== null || after.windowTitle !== null)) {
      changes.push(`window: "${before.windowTitle || ''}" → "${after.windowTitle || ''}"`);
      strongSignal = true;
    }

    // ── Focused element identity changed ─────────────────────────────────────
    const bFocusId = before.focused
      ? `${before.focused.role}::${before.focused.title || before.focused.label || ''}`
      : '__none__';
    const aFocusId = after.focused
      ? `${after.focused.role}::${after.focused.title || after.focused.label || ''}`
      : '__none__';

    if (bFocusId !== aFocusId) {
      const from = bFocusId === '__none__' ? 'kein Fokus' : bFocusId;
      const to   = aFocusId === '__none__' ? 'kein Fokus' : aFocusId;
      changes.push(`focus: ${from} → ${to}`);
      strongSignal = true;
    }

    // ── Focused element value changed (same element, new content) ────────────
    if (before.focused && after.focused && bFocusId === aFocusId) {
      const bVal = before.focused.value || '';
      const aVal = after.focused.value || '';
      if (bVal !== aVal && (bVal.length > 0 || aVal.length > 0)) {
        changes.push(`value: "${bVal.substring(0, 30)}" → "${aVal.substring(0, 30)}"`);
      }
    }

    // ── Significant element-count change (dialog opened/closed, navigation) ──
    const bCount = before.elements.length;
    const aCount = after.elements.length;
    if (Math.abs(bCount - aCount) > 5) {
      changes.push(`elements: ${bCount} → ${aCount}`);
    }

    const changed = changes.length > 0;
    return {
      changed,
      changes,
      signal: changed ? (strongSignal ? 'strong' : 'weak') : 'none',
    };
  }

  /**
   * Returns true if an AX element looks like a browser URL / address bar.
   * Used to decide whether to CMD+A before typing a new URL.
   *
   * @param {object} element  An element from the AX snapshot.
   * @returns {boolean}
   */
  isUrlField(element) {
    if (!element) return false;
    const text = [element.title, element.label, element.description]
      .filter(Boolean).join(' ').toLowerCase();
    // Label or title contains a URL-field indicator
    if (/\b(url|address|adresse|location)\b/.test(text)) return true;
    // Value itself looks like a URL (detect by content as fallback)
    if (element.role === 'AXTextField' && element.value &&
        /^https?:\/\/|^www\./i.test(element.value)) return true;
    return false;
  }

  _empty(reason) {
    return {
      empty:       true,
      reason,
      timestamp:   Date.now(),
      app:         null,
      appType:     'unknown',
      windowTitle: null,
      focused:     null,
      fields:      [],
      elements:    [],
      context:     '',
    };
  }
}

module.exports = new ContextManager();
