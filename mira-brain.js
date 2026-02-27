'use strict';

/**
 * mira-brain.js
 *
 * MIRA's configurable knowledge base — "das Gehirn das im Code nicht steht".
 *
 * Loaded once at startup, cached in-memory, refreshed every 5 minutes.
 * Provides fast synchronous queries so every decision point in main.js
 * can call it without async overhead.
 *
 * Schema:
 *   context   { company_name, role, language, notes }
 *   triggers  [{ id, event, condition, route_id, route_name, auto, priority }]
 *   contacts  [{ id, name, email, role, phone, notes }]
 *   limits    [{ id, action, autonomous, threshold, escalate_to, notes }]
 */

const fetch = require('node-fetch');

const REFRESH_MS = 5 * 60 * 1000; // 5 minutes

const DEFAULT_KB = {
  context: {
    company_name: '',
    role:         'Virtueller Assistent',
    language:     'de',
    notes:        '',
  },
  triggers: [],
  contacts: [],
  limits:   [],
};

class MiraBrain {
  constructor() {
    this._api       = null;
    this._token     = null;
    this._deviceId  = null;
    this._kb        = null;        // cached knowledge base
    this._loadedAt  = 0;
    this._loading   = false;
    this._timer     = null;
  }

  // ── Setup ─────────────────────────────────────────────────────────────────

  configure(api, token, deviceId) {
    this._api      = api;
    this._token    = token;
    this._deviceId = deviceId;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start() {
    await this.load();
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(() => this.load(), REFRESH_MS);
    console.log('🧠 MiraBrain: gestartet');
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  // ── Load / Save ───────────────────────────────────────────────────────────

  async load(force = false) {
    if (!this._api || !this._token) return;
    if (this._loading) return;
    if (!force && this._kb && Date.now() - this._loadedAt < REFRESH_MS) return;

    this._loading = true;
    try {
      const res  = await fetch(`${this._api}/api/brain/knowledge-base?token=${this._token}&device_id=${this._deviceId}`);
      const data = await res.json();
      if (data.success && data.kb) {
        this._kb       = { ...DEFAULT_KB, ...data.kb };
        this._loadedAt = Date.now();
        console.log(`🧠 Wissensbase geladen: ${this._kb.triggers.length} Trigger, ${this._kb.contacts.length} Kontakte, ${this._kb.limits.length} Grenzen`);
      } else if (!data.success) {
        // Surface migration errors clearly — fall back to defaults so MIRA still runs
        console.error(`🧠 Wissensbase Fehler: ${data.error}`);
        if (!this._kb) this._kb = { ...DEFAULT_KB }; // use defaults, don't freeze
      }
    } catch (e) {
      console.warn(`🧠 Wissensbase laden fehlgeschlagen: ${e.message}`);
      if (!this._kb) this._kb = { ...DEFAULT_KB };
    } finally {
      this._loading = false;
    }
  }

  async save(kb) {
    if (!this._api || !this._token) throw new Error('Not configured');
    const res = await fetch(`${this._api}/api/brain/knowledge-base`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token: this._token, device_id: this._deviceId, kb }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Save failed');
    // Update local cache immediately
    this._kb       = { ...DEFAULT_KB, ...kb };
    this._loadedAt = Date.now();
    return data;
  }

  // ── Queries — synchronous, fast ───────────────────────────────────────────

  /**
   * Return the full KB (or the default if not yet loaded).
   */
  get() {
    return this._kb || { ...DEFAULT_KB };
  }

  /**
   * Find the best matching trigger for an event.
   *
   * @param {string} eventType  e.g. 'new_mail', 'new_invoice', 'schedule'
   * @param {object} meta       event metadata (subject, sender, amount, …)
   * @returns {{ route_id, route_name, auto, priority } | null}
   */
  findTrigger(eventType, meta = {}) {
    const kb = this.get();
    const candidates = kb.triggers.filter(t => {
      if (t.event !== eventType) return false;
      if (!t.condition || t.condition.trim() === '') return true;
      // Simple keyword match in condition string against meta values
      const haystack = Object.values(meta).join(' ').toLowerCase();
      return t.condition.toLowerCase().split(',').map(s => s.trim())
        .some(kw => kw && haystack.includes(kw));
    });
    if (candidates.length === 0) return null;
    // Highest priority wins (lower number = higher priority, default 99)
    candidates.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
    return candidates[0];
  }

  /**
   * Check whether an action is within autonomous limits.
   *
   * @param {string} action   e.g. 'send_mail', 'approve_invoice'
   * @param {number} value    optional numeric value (invoice amount, etc.)
   * @returns {{ autonomous: boolean, escalate_to: string|null, reason: string }}
   */
  checkLimit(action, value = null) {
    const kb = this.get();
    const rule = kb.limits.find(l => {
      if (l.action.toLowerCase() !== action.toLowerCase()) return false;
      return true;
    });
    if (!rule) return { autonomous: true, escalate_to: null, reason: 'Keine Grenze definiert' };
    if (!rule.autonomous) {
      return { autonomous: false, escalate_to: rule.escalate_to || null, reason: rule.notes || rule.action };
    }
    if (rule.threshold && value !== null) {
      const limit = parseFloat(rule.threshold);
      if (!isNaN(limit) && value > limit) {
        return { autonomous: false, escalate_to: rule.escalate_to || null, reason: `Betrag ${value} > Grenze ${limit}` };
      }
    }
    return { autonomous: true, escalate_to: null, reason: 'Innerhalb der Grenzen' };
  }

  /**
   * Look up a contact by email address or name (case-insensitive).
   *
   * @param {string} query  email or name fragment
   * @returns {object|null}
   */
  lookupContact(query) {
    if (!query) return null;
    const q   = query.toLowerCase().trim();
    const kb  = this.get();
    return kb.contacts.find(c =>
      (c.email && c.email.toLowerCase().includes(q)) ||
      (c.name  && c.name.toLowerCase().includes(q))
    ) || null;
  }

  /**
   * Build a compact prompt-context string to prepend to every LLM API call.
   * Gives the backend model knowledge of who MIRA works for and the key rules.
   *
   * @returns {string}
   */
  buildPromptContext() {
    const kb = this.get();
    const lines = [];

    if (kb.context.company_name || kb.context.role) {
      lines.push(`## MIRA Kontext`);
      if (kb.context.company_name) lines.push(`Unternehmen: ${kb.context.company_name}`);
      if (kb.context.role)         lines.push(`Rolle: ${kb.context.role}`);
      if (kb.context.notes)        lines.push(`Hinweise: ${kb.context.notes}`);
      lines.push('');
    }

    if (kb.contacts.length > 0) {
      lines.push('## Wichtige Kontakte');
      for (const c of kb.contacts) {
        const parts = [c.name, c.role, c.email].filter(Boolean);
        lines.push(`- ${parts.join(' | ')}${c.notes ? ` (${c.notes})` : ''}`);
      }
      lines.push('');
    }

    if (kb.limits.length > 0) {
      lines.push('## Autonomiegrenzen');
      for (const l of kb.limits) {
        const auto = l.autonomous ? 'autonom' : `eskalieren an ${l.escalate_to || '?'}`;
        lines.push(`- ${l.action}: ${auto}${l.threshold ? `, max. ${l.threshold}` : ''}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  isReady() {
    return this._kb !== null;
  }

  /**
   * Returns true when no meaningful KB has been set up yet (= first run).
   */
  needsOnboarding() {
    if (!this._kb) return true;
    const kb = this._kb;
    const hasContext  = kb.context?.company_name || kb.context?.role !== 'Virtueller Assistent';
    const hasTriggers = kb.triggers?.length > 0;
    return !hasContext && !hasTriggers;
  }

  /**
   * Build and save a KB from onboarding answers.
   * Called by main.js IPC handler after the user completes onboarding.
   *
   * @param {{ industry, tasks, apps }} answers
   * @returns {{ triggerCount, limitCount }}
   */
  async generateFromOnboarding({ industry, tasks, apps }) {
    const ROLE_MAP = {
      handel:      'Handelsassistentin',
      gastronomie: 'Gastro-Assistentin',
      buero:       'Büroassistentin',
      it:          'IT-Assistentin',
      handwerk:    'Handwerks-Assistentin',
      sonstige:    'Büroassistentin',
    };

    // ── Context ────────────────────────────────────────────────────────────
    const context = {
      company_name: '',
      role:         ROLE_MAP[industry] || 'Büroassistentin',
      language:     'de',
      notes:        `Branche: ${industry}. Tätigkeiten: ${tasks.join(', ')}.`,
    };

    // ── Triggers — one per selected task ──────────────────────────────────
    const TASK_TRIGGERS = {
      emails: [
        { event: 'new_mail', condition: 'rechnung, invoice', route_name: 'Eingangsrechnung prüfen',     priority: 1, auto: true },
        { event: 'new_mail', condition: 'bestellung, order', route_name: 'Bestellbestätigung ablegen',  priority: 2, auto: true },
        { event: 'new_mail', condition: '',                  route_name: 'Mail klassifizieren',          priority: 9, auto: true },
      ],
      rechnungen: [
        { event: 'new_mail', condition: 'rechnung, invoice, zahlung, payment', route_name: 'Rechnung buchen', priority: 1, auto: true },
      ],
      bestellungen: [
        { event: 'new_mail', condition: 'bestellung, order, lieferung',        route_name: 'Bestellung verarbeiten', priority: 2, auto: true },
      ],
      berichte: [
        { event: 'schedule', condition: 'wöchentlich',                         route_name: 'Wochenbericht erstellen', priority: 5, auto: false },
      ],
      buchhaltung: [
        { event: 'new_mail', condition: 'mahnung, reminder, fällig, overdue',  route_name: 'Mahnung prüfen', priority: 1, auto: false },
      ],
      dokumente: [
        { event: 'file_created', condition: 'pdf, docx',                       route_name: 'Dokument ablegen', priority: 5, auto: true },
      ],
    };

    const seenNames = new Set();
    const triggers = [];
    let uid = () => Math.random().toString(36).slice(2, 8);

    // Always add a basic new-mail trigger
    triggers.push({ id: uid(), event: 'new_mail', condition: '', route_name: 'Mail eingehend', route_id: 'tbd', priority: 10, auto: true });

    for (const task of tasks) {
      const defs = TASK_TRIGGERS[task] || [];
      for (const d of defs) {
        if (!seenNames.has(d.route_name)) {
          seenNames.add(d.route_name);
          triggers.push({ id: uid(), route_id: 'tbd', ...d });
        }
      }
    }

    // ── Limits — sensible defaults per industry ────────────────────────────
    const INDUSTRY_LIMITS = {
      handel:      [{ action: 'approve_order',   autonomous: true,  threshold: '500',  escalate_to: '', notes: 'Bestellungen bis 500 € autonom' }],
      gastronomie: [{ action: 'approve_invoice', autonomous: true,  threshold: '200',  escalate_to: '', notes: 'Eingangsrechnungen bis 200 €' }],
      buero:       [{ action: 'send_mail',        autonomous: true,  threshold: null,   escalate_to: '', notes: 'Standard-Mails autonom senden' }],
      it:          [{ action: 'send_mail',        autonomous: true,  threshold: null,   escalate_to: '', notes: 'Kommunikation autonom' }],
      handwerk:    [{ action: 'approve_order',    autonomous: true,  threshold: '300',  escalate_to: '', notes: 'Materialbestellungen bis 300 €' }],
    };
    const limits = [
      { id: uid(), action: 'delete_file',    autonomous: false, threshold: null, escalate_to: '', notes: 'Dateien nie autonom löschen' },
      { id: uid(), action: 'send_payment',   autonomous: false, threshold: null, escalate_to: '', notes: 'Zahlungen immer bestätigen' },
      ...(INDUSTRY_LIMITS[industry] || []).map(l => ({ id: uid(), ...l })),
    ];

    // ── Contacts — empty but structured ───────────────────────────────────
    const contacts = [];

    const kb = { context, triggers, contacts, limits };

    await this.save(kb);

    return { triggerCount: triggers.length, limitCount: limits.length };
  }
}

module.exports = new MiraBrain();
