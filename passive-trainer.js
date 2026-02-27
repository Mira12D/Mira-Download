'use strict';

/**
 * passive-trainer.js
 *
 * 1-Stunden Training Mode.
 *
 * Der Mitarbeiter arbeitet normal. Vor jedem Maus-Klick fängt dieses Modul:
 *   1. AX-State (welche App, Fenster, fokussiertes Element)
 *   2. Screenshot des aktuellen Zustands
 *   3. Element an der Klick-Position (axLayer.getElementAt)
 *
 * Alle Beobachtungen werden:
 *   a) sofort in den coord-cache geschrieben (MIRA kennt die Positionen ab jetzt)
 *   b) alle 10 Klicks gebündelt an POST /api/brain/memory-save gesendet
 *   c) beim Stop gesammelt finalisiert
 *
 * Nach 1 Stunde (oder manuellem Stop) sendet MIRA die gesammelten Muster
 * zum Backend — Claude analysiert sie und baut daraus Route-Vorschläge.
 *
 * Wird aus main.js heraus gesteuert (IPC: start-passive-training,
 * stop-passive-training, get-training-progress).
 */

const TRAINING_DURATION_MS = 60 * 60 * 1000;  // 1 Stunde
const FLUSH_EVERY          = 10;               // alle N Klicks zum Backend senden
const DEBOUNCE_MS          = 400;              // min. ms zwischen zwei Klick-Events

class PassiveTrainer {
  constructor() {
    this._active        = false;
    this._startTime     = null;
    this._endTimer      = null;
    this._observations  = [];
    this._lastClickTime = 0;
    this._onDone        = null;
    this._onProgress    = null;
    this._api           = null;
    this._token         = null;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  isActive() { return this._active; }

  getProgress() {
    if (!this._active || !this._startTime) return null;
    const elapsed   = Date.now() - this._startTime;
    const remaining = Math.max(0, TRAINING_DURATION_MS - elapsed);
    return {
      active:         true,
      elapsed_ms:     elapsed,
      remaining_ms:   remaining,
      elapsed_min:    Math.floor(elapsed / 60000),
      remaining_min:  Math.ceil(remaining / 60000),
      observations:   this._observations.length,
    };
  }

  /**
   * Training starten.
   * @param {{ api: string, token: string, onDone?: fn, onProgress?: fn }} opts
   * @returns {boolean} false wenn bereits aktiv
   */
  start({ api, token, onDone, onProgress }) {
    if (this._active) return false;

    this._api        = api;
    this._token      = token;
    this._active     = true;
    this._startTime  = Date.now();
    this._observations = [];
    this._onDone     = onDone   || null;
    this._onProgress = onProgress || null;

    // Auto-Stop nach 1 Stunde
    this._endTimer = setTimeout(() => this.stop('timeout'), TRAINING_DURATION_MS);

    console.log('🎓 Passives Training gestartet — 1 Stunde');
    return true;
  }

  /**
   * Training manuell oder per Timeout stoppen.
   * Sendet alle verbleibenden Beobachtungen zum Backend und ruft onDone auf.
   * @param {'manual'|'timeout'} reason
   */
  async stop(reason = 'manual') {
    if (!this._active) return null;

    this._active = false;
    clearTimeout(this._endTimer);
    this._endTimer = null;

    const duration = Date.now() - this._startTime;
    const count    = this._observations.length;

    console.log(`🎓 Training beendet (${reason}): ${count} Beobachtungen in ${Math.round(duration / 60000)} Min`);

    // Rest-Batch senden
    if (this._observations.length > 0) {
      await this._flush(this._observations, true).catch(() => {});
    }

    const result = { reason, duration_ms: duration, observations: count };
    if (this._onDone) this._onDone(result);

    this._observations = [];
    this._startTime    = null;
    return result;
  }

  // ── Klick-Handler (aufgerufen aus main.js uiohook mousedown) ─────────────

  /**
   * Wird für jeden mousedown Event aufgerufen wenn Training aktiv ist.
   * Macht Screenshot + AX-Capture BEVOR der Klick seine Wirkung zeigt.
   *
   * @param {number} x
   * @param {number} y
   * @param {{
   *   takeScreenshot: () => Promise<string>,
   *   axLayer:        object,
   *   contextManager: object,
   *   coordCache:     object,
   * }} services
   */
  async onMouseDown(x, y, { takeScreenshot, axLayer, contextManager, coordCache }) {
    if (!this._active) return;

    // Debounce — doppelte Events (z.B. Doppelklick) ignorieren
    const now = Date.now();
    if (now - this._lastClickTime < DEBOUNCE_MS) return;
    this._lastClickTime = now;

    try {
      // ── 1. AX State ──────────────────────────────────────────────────────
      contextManager.invalidate();
      const axState  = contextManager.captureState(true);
      const app      = axState?.app || {};
      const bundleId = app.bundleId || null;

      // ── 2. Element an Klick-Position ──────────────────────────────────────
      const elemAtClick = axLayer.isPermissionGranted()
        ? axLayer.getElementAt(x, y)
        : { found: false };

      // ── 3. Screenshot (Pre-Click Zustand) ────────────────────────────────
      const screenshot = await takeScreenshot();

      // ── 4. Beobachtung zusammenstellen ───────────────────────────────────
      const obs = {
        ts:            new Date().toISOString(),
        x, y,
        app_bundle:    bundleId,
        app_name:      app.name    || null,
        window_title:  axState?.windowTitle || null,
        element_role:  elemAtClick?.role    || null,
        element_title: elemAtClick?.title   || null,
        context:       contextManager.toShortString(axState),
        screenshot:    screenshot,  // wird beim Flush ggf. entfernt (zu groß für Batch)
      };

      this._observations.push(obs);

      // ── 5. Coord-Cache direkt befüllen ────────────────────────────────────
      // Wenn Element eindeutig identifizierbar → sofort in Cache schreiben
      // damit MIRA JETZT schon weiß wo das Element ist
      if (elemAtClick?.found && bundleId && (elemAtClick.title || elemAtClick.label)) {
        const label = elemAtClick.title || elemAtClick.label;
        const fp    = {
          axLabel: label,
          axRole:  elemAtClick.role  || null,
          axParent: null,
        };
        coordCache.set(bundleId, label, x, y, 0.85, 'passive_training', fp);
      }

      // Progress-Callback (für UI-Countdown)
      if (this._onProgress) {
        this._onProgress(this.getProgress());
      }

      // ── 6. Rolling Flush alle FLUSH_EVERY Klicks ─────────────────────────
      if (this._observations.length % FLUSH_EVERY === 0) {
        const batch = this._observations.slice(-FLUSH_EVERY).map(o => ({
          ...o, screenshot: null, // Screenshot nur bei finalem Flush senden
        }));
        this._flush(batch, false).catch(() => {});
      }

    } catch (e) {
      console.warn('🎓 PassiveTrainer.onMouseDown error:', e.message);
    }
  }

  // ── Backend-Flush ─────────────────────────────────────────────────────────

  async _flush(batch, isFinal) {
    if (!this._api || !this._token || batch.length === 0) return;

    // Für den finalen Flush: Screenshots mitsenden (max. 5, für Analyse)
    const payload = isFinal
      ? batch.map((o, i) => ({ ...o, screenshot: i < 5 ? o.screenshot : null }))
      : batch;

    try {
      await fetch(`${this._api}/api/brain/memory-save`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token:       this._token,
          type:        'passive_training',
          is_final:    isFinal,
          observations: payload,
          stats: {
            total:    this._observations.length,
            duration: this._startTime ? Date.now() - this._startTime : 0,
          },
        }),
      });
    } catch {
      // Offline → nur lokal gespeichert, kein Problem
    }
  }
}

module.exports = new PassiveTrainer();
