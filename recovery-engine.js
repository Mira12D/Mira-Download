'use strict';

/**
 * recovery-engine.js
 *
 * Route-level self-healing for MIRA.
 *
 * Responsibilities:
 *   1. Active error detection after each step via AX (not screenshot):
 *      - Unexpected dialogs / sheets
 *      - Visible error text
 *      - Wrong app in foreground
 *   2. Local recovery playbook: dismiss dialog, press Escape, etc.
 *   3. Goal model: routes can declare an end-state; MIRA verifies it after completion.
 *   4. Undo: Cmd+Z for reversible type/fill steps.
 *   5. Escalation: if self-correction fails → notify user via IPC with screenshot + context.
 */

const axLayer        = require('./ax-layer');
const contextManager = require('./context-manager');

// Roles that indicate a modal dialog appeared
const DIALOG_ROLES = new Set(['AXSheet', 'AXDialog']);

// Text patterns that indicate an error state
const ERROR_TEXT_RE = /\b(fehler|error|ungültig|invalid|nicht gefunden|not found|fehlgeschlagen|failed|abgebrochen|cancelled|timeout|no connection|verbindungsfehler|konnte nicht|could not|permission denied|zugriff verweigert|unavailable|nicht verfügbar)\b/i;

// Button labels that can dismiss a dialog
const DISMISS_RE = /^(ok|schließen|close|abbrechen|cancel|weiter|dismiss|bestätigen|confirm|continue|fortfahren)$/i;

class RecoveryEngine {
  constructor() {
    this._routeGoal        = null;
    this._expectedAppType  = null;
    this._stepHistory      = [];       // [{ step, preState, timestamp }]
    this._maxHistory       = 6;

    // Injected at runtime from main.js (to avoid circular deps)
    this._keyboard  = null;
    this._Key       = null;
    this._sleep     = null;
    this._takeShot  = null;
    this._notify    = null;
    this._inited    = false;
  }

  // ── Dependency injection ──────────────────────────────────────────────────

  /**
   * Must be called once before first use (from startPolling in main.js).
   * Injects runtime dependencies that aren't available at module load time.
   */
  init({ keyboard, Key, sleep, takeScreenshot, notify }) {
    if (this._inited) return;
    this._keyboard = keyboard;
    this._Key      = Key;
    this._sleep    = sleep;
    this._takeShot = takeScreenshot;
    this._notify   = notify;
    this._inited   = true;
  }

  // ── Route lifecycle ───────────────────────────────────────────────────────

  /**
   * Call at the start of a route execution.
   * @param {string|null} goal            Natural-language end-state description.
   * @param {string|null} expectedAppType App type that should be active (e.g. 'mail', 'excel').
   */
  beginRoute(goal = null, expectedAppType = null) {
    this._routeGoal       = goal;
    this._expectedAppType = expectedAppType;
    this._stepHistory     = [];
    if (goal) {
      console.log(`🎯 Ziel: "${goal}"${expectedAppType ? ` [${expectedAppType}]` : ''}`);
    }
  }

  /**
   * Record a step before it executes — enables undo and context for recovery.
   * @param {object} step      The step object about to be executed.
   * @param {object} preState  AX state snapshot just before execution.
   */
  recordStep(step, preState) {
    this._stepHistory.push({ step, preState, timestamp: Date.now() });
    if (this._stepHistory.length > this._maxHistory) {
      this._stepHistory.shift();
    }
  }

  // ── Post-step error detection ─────────────────────────────────────────────

  /**
   * Call immediately after a step completes and its sleep delay finishes.
   * Detects AX-visible errors and attempts local recovery.
   *
   * @param {string} stepLabel  Human-readable step description for logging.
   * @returns {{ ok: boolean, errors: Array, recovered: Array }}
   */
  async checkPostStep(stepLabel = '') {
    if (!this._inited) return { ok: true };

    const state = contextManager.captureState(true);
    if (state.empty) return { ok: true };

    const errors = this._detectErrors(state);
    if (errors.length === 0) return { ok: true };

    for (const err of errors) {
      console.log(`🔴 Nach "${stepLabel}": [${err.type}] ${err.detail}`);
    }

    const recovered = [];
    for (const err of errors) {
      const ok = await this._tryRecover(err, state);
      recovered.push({ error: err, ok });
      if (ok) {
        console.log(`✅ Recovery OK: ${err.type}`);
      } else {
        console.log(`⚠️ Recovery fehlgeschlagen: ${err.type}`);
      }
    }

    const allOk = recovered.every(r => r.ok);
    if (!allOk) {
      await this._escalate(errors, stepLabel);
    }

    return { ok: allOk, errors, recovered };
  }

  // ── Goal verification ─────────────────────────────────────────────────────

  /**
   * Call after a route completes.
   * Returns data that main.js can send to the backend for async verification.
   */
  async verifyGoal() {
    if (!this._routeGoal) return { goalMet: true, goal: null };
    const state   = contextManager.captureState(true);
    const context = contextManager.toPromptString(state);
    return {
      goalMet: null,   // null = needs backend verification
      goal:    this._routeGoal,
      context,
      state,
    };
  }

  // ── Undo ──────────────────────────────────────────────────────────────────

  /**
   * Undo the last N reversible steps via Cmd+Z / Ctrl+Z.
   * @param {number} count  Number of undo operations.
   * @returns {boolean}  true if undo was attempted.
   */
  async undoLastSteps(count = 1) {
    if (!this._keyboard || !this._Key || !this._sleep) return false;

    console.log(`↩️ Undo: ${count} Schritt(e)`);
    const modKey = process.platform === 'darwin' ? this._Key.LeftSuper : this._Key.LeftControl;

    for (let i = 0; i < count; i++) {
      await this._keyboard.pressKey(modKey, this._Key.Z);
      await this._keyboard.releaseKey(modKey, this._Key.Z);
      await this._sleep(150);
    }
    contextManager.invalidate();
    return true;
  }

  // ── Private: Detection ────────────────────────────────────────────────────

  _detectErrors(state) {
    const errors = [];

    // 1. Wrong app type in foreground?
    if (this._expectedAppType &&
        state.appType !== 'unknown' &&
        state.appType !== this._expectedAppType) {
      errors.push({
        type:   'wrong_app',
        detail: `Erwartet: ${this._expectedAppType}, aktuell: ${state.appType} (${state.app?.name || '?'})`,
      });
    }

    // 2. Unexpected dialog / sheet?
    const dialog = state.elements.find(el => DIALOG_ROLES.has(el.role));
    if (dialog) {
      errors.push({
        type:   'dialog',
        detail: `Dialog: "${dialog.title || dialog.label || 'unbekannt'}"`,
        el:     dialog,
      });
    }

    // 3. Visible error text in static labels?
    // Limit search to elements near the top half of the screen (likely toast/alert areas)
    const errEl = state.elements.find(el =>
      el.role === 'AXStaticText' &&
      (el.y == null || el.y < 600) &&
      ERROR_TEXT_RE.test([el.title, el.label, el.value].filter(Boolean).join(' '))
    );
    if (errEl) {
      const text = [errEl.title, errEl.label, errEl.value].filter(Boolean).join(' ');
      errors.push({
        type:   'error_text',
        detail: `Fehlermeldung: "${text.substring(0, 100)}"`,
        el:     errEl,
      });
    }

    return errors;
  }

  // ── Private: Recovery ─────────────────────────────────────────────────────

  async _tryRecover(error, state) {
    if (!this._keyboard || !this._Key || !this._sleep) return false;

    switch (error.type) {

      case 'dialog': {
        // Prefer a named dismiss button
        const btn = state.elements.find(el =>
          el.role === 'AXButton' &&
          DISMISS_RE.test((el.title || el.label || '').trim())
        );
        if (btn && btn.centerX && btn.centerY) {
          try {
            const { mouse } = require('@nut-tree/nut-js');
            await mouse.setPosition({ x: btn.centerX, y: btn.centerY });
            await this._sleep(200);
            await mouse.leftClick();
            await this._sleep(500);
            contextManager.invalidate();
            return true;
          } catch {}
        }
        // Fallback: Escape
        await this._keyboard.pressKey(this._Key.Escape);
        await this._keyboard.releaseKey(this._Key.Escape);
        await this._sleep(400);
        contextManager.invalidate();
        return true;
      }

      case 'wrong_app': {
        // We can't programmatically bring a specific app to front without
        // platform-specific shell commands. Log and let escalation handle it.
        console.log(`⚠️ Falsches Fenster — kann nicht automatisch wechseln`);
        return false;
      }

      case 'error_text': {
        // Dismiss via Escape and report — don't mark as recovered
        await this._keyboard.pressKey(this._Key.Escape);
        await this._keyboard.releaseKey(this._Key.Escape);
        await this._sleep(300);
        contextManager.invalidate();
        return false; // still escalate so the user knows
      }

      default:
        return false;
    }
  }

  // ── Private: Escalation ───────────────────────────────────────────────────

  async _escalate(errors, stepLabel) {
    console.log(`🚨 Eskalation: MIRA steckt fest bei "${stepLabel}"`);
    if (!this._notify) return;

    let screenshot = null;
    try {
      if (this._takeShot) screenshot = await this._takeShot();
    } catch {}

    const state = contextManager.captureState();
    this._notify('mira-stuck', {
      step:      stepLabel,
      errors:    errors.map(e => ({ type: e.type, detail: e.detail })),
      screenshot,
      context:   contextManager.toPromptString(state),
      timestamp: new Date().toISOString(),
    });
  }
}

module.exports = new RecoveryEngine();
