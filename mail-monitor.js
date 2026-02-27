'use strict';

/**
 * mail-monitor.js
 *
 * Autonomous mail monitoring for MIRA.
 *
 * Periodically queries the AX Layer to detect new unread messages in
 * Mail.app, Outlook, or Thunderbird. When the unread count rises,
 * it sends metadata to the MIRA backend for classification and triggers
 * the matching route — without any human input.
 *
 * Architecture:
 *   1. tick() reads AX elements from all known mail apps (background, no window focus needed)
 *   2. Extracts unread count from badge elements
 *   3. When count increases → calls onNewMail() callback
 *   4. Caller (main.js) handles classification + route trigger
 */

const axLayer = require('./ax-layer');

// Mail app bundle IDs and process names to monitor
const MAIL_BUNDLES = [
  'com.apple.mail',          // macOS Mail
  'com.microsoft.Outlook',   // Outlook (Mac)
  'HxOutlook',               // New Outlook (Windows 11)
  'OUTLOOK',                 // Outlook (Windows, process name)
  'thunderbird',             // Thunderbird (Mac)
  'Thunderbird',             // Thunderbird (Windows)
];

// Pattern: badge texts like "3", "3 ungelesen", "3 unread"
const UNREAD_RE = /^(\d+)(\s*(ungelesen|unread|new|neu|messages?))?$/i;

class MailMonitor {
  constructor() {
    this._interval   = null;
    this._tickMs     = 30_000;     // check every 30 seconds
    this._baseline   = {};         // bundleId → last known unread count
    this._onNewMail  = null;
    this._processing = false;      // prevent overlapping ticks
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Start monitoring.
   * @param {Function} onNewMail  async ({ bundleId, delta, unread, elements }) => void
   */
  start(onNewMail) {
    if (this._interval) return;
    this._onNewMail = onNewMail;
    this._interval  = setInterval(() => this._tick(), this._tickMs);
    console.log(`📬 MailMonitor: gestartet (${this._tickMs / 1000}s-Takt)`);
    // Run an initial baseline immediately (without triggering onNewMail)
    this._tick(true);
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    this._baseline  = {};
    console.log('📬 MailMonitor: gestoppt');
  }

  /**
   * Extract the first visible unread message from an AX element list.
   * Returns { subject, sender, preview } or null.
   */
  extractFirstUnread(elements) {
    if (!elements || !elements.length) return null;

    // Look for a row/cell near the top of the list — likely the newest message
    const row = elements.find(el =>
      (el.role === 'AXRow' || el.role === 'AXCell') &&
      (el.title || el.label) &&
      (el.y || 0) > 50 && (el.y || 0) < 600
    );

    if (row) {
      const text = row.title || row.label || '';
      const parts = text.split(/[\n\r—–|]/);
      return {
        subject: parts[0]?.trim() || text.substring(0, 100),
        sender:  parts[1]?.trim() || '',
        preview: parts[2]?.trim() || (row.value || '').substring(0, 200),
      };
    }

    // Fallback: largest static text element (often the subject line)
    const textEl = elements
      .filter(el => el.role === 'AXStaticText' && (el.title || el.label || el.value))
      .sort((a, b) => ((b.title || b.label || b.value || '').length) -
                      ((a.title || a.label || a.value || '').length))[0];

    if (textEl) {
      return {
        subject: textEl.title || textEl.label || '',
        sender:  '',
        preview: (textEl.value || '').substring(0, 200),
      };
    }

    return null;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  async _tick(baselineOnly = false) {
    if (this._processing) return;
    this._processing = true;
    try {
      for (const bundleId of MAIL_BUNDLES) {
        await this._checkApp(bundleId, baselineOnly);
      }
    } catch (e) {
      console.warn(`📬 MailMonitor Fehler: ${e.message}`);
    } finally {
      this._processing = false;
    }
  }

  async _checkApp(bundleId, baselineOnly) {
    // AX can query background apps — no need to bring mail app to front
    const result = axLayer.getElements(bundleId);
    if (!result.elements || result.elements.length === 0) return; // app not running

    const unread = this._extractUnreadCount(result.elements);
    const prev   = this._baseline[bundleId];

    this._baseline[bundleId] = unread;

    if (baselineOnly || prev === undefined) return; // first check: just set baseline
    if (unread <= prev) return;                     // no new mail

    const delta = unread - prev;
    console.log(`📬 ${bundleId}: +${delta} neue Mail(s) (gesamt ungelesen: ${unread})`);

    if (this._onNewMail) {
      await this._onNewMail({
        bundleId,
        delta,
        unread,
        elements: result.elements,
      });
    }
  }

  _extractUnreadCount(elements) {
    // Strategy 1: Look for explicit badge/unread label
    for (const el of elements) {
      const text = (el.label || el.title || el.description || '').trim();
      const m    = UNREAD_RE.exec(text);
      if (m) return parseInt(m[1], 10);
    }
    // Strategy 2: Small numeric values in value fields (badge numbers)
    for (const el of elements) {
      if (el.role === 'AXStaticText' && el.value) {
        const n = parseInt(el.value.trim(), 10);
        if (!isNaN(n) && n > 0 && n < 10_000 && el.value.trim() === String(n)) return n;
      }
    }
    return 0;
  }
}

module.exports = new MailMonitor();
