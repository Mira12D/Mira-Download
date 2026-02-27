'use strict';

/**
 * coord-cache.js
 *
 * Persistent local cache for UI element coordinates.
 * Keyed by: bundleId::elementLabel (case-insensitive).
 * TTL: 24 hours per entry.
 *
 * Speichert zusätzlich einen Element-Fingerprint (AXLabel + AXRole + AXParent).
 * Bei Cache-Hit kann ax-layer.js das Element zuerst per Fingerprint im
 * aktuellen AX-Baum suchen und so verschobene/skalierte Apps korrekt handhaben.
 *
 * Used as Tier -1 in executeRouteStep case 'click'.
 */

const fs   = require('fs');
const path = require('path');

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

class CoordCache {
  constructor() {
    this._data     = null;   // loaded lazily on first access
    this._savePath = null;
  }

  // ── Storage ───────────────────────────────────────────────────────────────

  _getPath() {
    if (this._savePath) return this._savePath;
    try {
      const { app } = require('electron');
      this._savePath = path.join(app.getPath('userData'), 'coord-cache.json');
    } catch {
      this._savePath = path.join(__dirname, 'coord-cache.json');
    }
    return this._savePath;
  }

  _load() {
    if (this._data !== null) return;
    try {
      this._data = JSON.parse(fs.readFileSync(this._getPath(), 'utf8'));
    } catch {
      this._data = {};
    }
  }

  _persist() {
    try {
      fs.writeFileSync(this._getPath(), JSON.stringify(this._data, null, 2), 'utf8');
    } catch {}
  }

  _key(bundleId, label) {
    return `${bundleId || '_'}::${(label || '').toLowerCase().trim()}`;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Look up cached coordinates for an element in a specific app.
   * Returns null if not found or if the entry has expired.
   *
   * @param {string} bundleId   CFBundleId (Mac) or process name (Win)
   * @param {string} label      Natural-language element label
   * @returns {{ x, y, confidence, tier, hitCount } | null}
   */
  get(bundleId, label) {
    this._load();
    const key   = this._key(bundleId, label);
    const entry = this._data[key];
    if (!entry) return null;
    if (Date.now() - entry.timestamp > TTL_MS) {
      delete this._data[key];
      this._persist();
      return null;
    }
    return entry;
  }

  /**
   * Store successful coordinates for an element.
   * Call after every verified-successful click.
   *
   * @param {string} bundleId
   * @param {string} label
   * @param {number} x           Screen center X
   * @param {number} y           Screen center Y
   * @param {number} confidence  Score 0–1
   * @param {string} tier        Which tier resolved it ('ax', 'ctx_state', 'mini', etc.)
   * @param {{ axLabel?: string, axRole?: string, axParent?: string } | null} fingerprint
   *   Optional AX element fingerprint for position-independent re-lookup after app move.
   */
  set(bundleId, label, x, y, confidence = 1.0, tier = 'unknown', fingerprint = null) {
    this._load();
    const key  = this._key(bundleId, label);
    const prev = this._data[key];
    this._data[key] = {
      x, y, confidence, tier,
      timestamp:   Date.now(),
      hitCount:    (prev?.hitCount || 0) + 1,
      fingerprint: fingerprint || prev?.fingerprint || null,
    };
    this._persist();
  }

  /**
   * Remove a stale entry (e.g. after a failed click at cached coords).
   */
  invalidate(bundleId, label) {
    this._load();
    const key = this._key(bundleId, label);
    if (this._data[key]) {
      delete this._data[key];
      this._persist();
    }
  }

  /**
   * Remove all entries older than TTL.
   * Call once at startup to keep the cache clean.
   */
  prune() {
    this._load();
    const now    = Date.now();
    let   pruned = 0;
    for (const key of Object.keys(this._data)) {
      if (now - this._data[key].timestamp > TTL_MS) {
        delete this._data[key];
        pruned++;
      }
    }
    if (pruned > 0) {
      this._persist();
      console.log(`🗂️ CoordCache: ${pruned} abgelaufene Einträge entfernt`);
    }
    console.log(`🗂️ CoordCache: ${Object.keys(this._data).length} Einträge geladen`);
  }

  size() {
    this._load();
    return Object.keys(this._data).length;
  }
}

module.exports = new CoordCache();
