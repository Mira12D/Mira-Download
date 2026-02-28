// ════════════════════════════════════════════════════════════════════════
// InformationsAmt — Denkt BEVOR MIRA handelt
// Prüft ob genug Kontext vorhanden ist.
// Fragt User EINMAL pro Kontext-Lücke — nie doppelt.
// Sammelt Antworten im SessionContext.
// ════════════════════════════════════════════════════════════════════════

const sessionCtx = require('./session-context');

class InformationsAmt {
  constructor() {
    this._asked  = new Set(); // Verhindert Doppelfragen in einer Session
    this._askFn  = null;      // Callback gesetzt von main.js (Electron dialog)
  }

  // Muss von main.js gesetzt werden:
  // infoAmt.init(async (question, type) => { ... return answer or null })
  init(fn) {
    this._askFn = fn;
  }

  // Hauptmethode — gibt zurück ob MIRA fortfahren soll + ggf. angereicherten Befehl
  // { proceed: true, enriched_command } | { proceed: false, reason }
  async assess({ command, perception }) {
    // 1. Ziel aus Befehl extrahieren (einmalig)
    if (!sessionCtx.goal) {
      const goal = this._extractGoal(command);
      if (goal) sessionCtx.setGoal(goal);
    }

    // 2. Gefahr erkannt → Bestätigung einholen
    const danger = this._findDanger(perception);
    if (danger) {
      const key = `danger:${danger.substring(0, 40)}`;
      if (!this._asked.has(key)) {
        this._asked.add(key);
        const ok = await this._ask(
          `⚠️ MIRA hat erkannt: "${danger}"\n\nDas könnte irreversibel sein. Fortfahren?`,
          'danger'
        );
        if (!ok) return { proceed: false, reason: `Nutzer hat abgebrochen wegen: ${danger}` };
      }
    }

    // 3. Formular erkannt + fehlende Infos
    if (perception?.is_form && perception.needs?.length > 0) {
      const missing = perception.needs.filter(n => !this._hasInfo(n));
      if (missing.length > 0) {
        const question = perception.suggested_user_question
          || `Ich sehe: "${perception.purpose || perception.scene}".\nDafür brauche ich: ${missing.join(', ')}.\nHast du diese Infos oder eine Datei die ich lesen soll?`;
        const key = question.substring(0, 60);
        if (!this._asked.has(key)) {
          this._asked.add(key);
          const answer = await this._ask(question, 'info');
          if (answer) {
            // Antwort im SessionContext speichern
            sessionCtx.update({ known_facts: { user_provided: answer } });
            // Prüfen ob Datei-Pfad genannt wurde
            const fileMatch = answer.match(/([/\\~]?[\w\-. ]+\.(pdf|docx|xlsx|jpg|png))/i);
            if (fileMatch) sessionCtx.update({ document: fileMatch[0] });
            return { proceed: true, enriched_command: `${command} [NUTZER_INFO: ${answer}]` };
          }
        }
      }
    }

    return { proceed: true, enriched_command: command };
  }

  // ── Hilfsfunktionen ───────────────────────────────────────────────────

  _findDanger(perception) {
    if (!perception?.dangers?.length) return null;
    return perception.dangers.find(d =>
      /absend|submit|bestell|kauf|zahlen|überweisen|lösch|send|delete|confirm/i.test(d)
    ) || null;
  }

  _hasInfo(infoType) {
    const facts = sessionCtx.known_facts;
    const lower = infoType.toLowerCase();
    return Object.keys(facts).some(k =>
      k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase())
    );
  }

  _extractGoal(command) {
    const clean = command
      .replace(/\[.*?\]/g, '')
      .replace(/^(hey\s+mira[,!]?\s*)/i, '')
      .trim();
    return clean.length > 8 && clean.length < 200 ? clean : null;
  }

  async _ask(question, type = 'info') {
    if (!this._askFn) {
      console.warn('⚠️ InformationsAmt: kein askFn gesetzt');
      return null;
    }
    try {
      return await this._askFn(question, type);
    } catch(e) {
      console.warn('⚠️ InformationsAmt ask Fehler:', e.message);
      return null;
    }
  }

  // Session zurücksetzen (z.B. bei neuem Ziel)
  reset() {
    this._asked.clear();
  }
}

module.exports = new InformationsAmt();
