// ════════════════════════════════════════════════════════════════════════
// SessionContext — Persistentes Arbeitsgedächtnis
// Lebt solange der Agent läuft. Singleton.
// Wird in JEDEN Claude/GPT-Prompt injiziert.
// ════════════════════════════════════════════════════════════════════════

class SessionContext {
  constructor() {
    this.reset();
  }

  reset() {
    this.goal            = null;        // Was wollen wir erreichen?
    this.started         = null;        // Wann hat die Session begonnen?
    this.steps_done      = [];          // Erledigte Schritte (max 20, FIFO)
    this.current_step    = null;        // Was machen wir gerade?
    this.available_docs  = [];          // Dokumente/Dateien die User erwähnt hat
    this.known_facts     = {};          // name, email, iban, kfz... — wächst mit Antworten
    this.last_perception = null;        // Letztes WahrnehmungsAmt Ergebnis
    this.task_count      = 0;

    // Checkpoint-System für Rollback (max 5)
    this.checkpoints     = [];

    // Confidence-Learning: fingerprint → {count, correction, trusted}
    this.learnings       = {};
  }

  // ── Ziel setzen (nur einmal pro Session) ──────────────────────────────
  setGoal(goal) {
    if (!this.goal && goal) {
      this.goal    = goal;
      this.started = new Date().toISOString();
      console.log(`🎯 SessionContext: Ziel → "${goal}"`);
    }
  }

  // ── Kontext updaten (nach jedem Task) ─────────────────────────────────
  update(patch = {}) {
    if (patch.goal)         this.setGoal(patch.goal);
    if (patch.current_step) this.current_step = patch.current_step;
    if (patch.step_done) {
      this.steps_done.push(patch.step_done);
      if (this.steps_done.length > 20) this.steps_done.shift();
    }
    if (patch.known_facts)  Object.assign(this.known_facts, patch.known_facts);
    if (patch.document && !this.available_docs.includes(patch.document)) {
      this.available_docs.push(patch.document);
    }
    if (patch.perception)   this.last_perception = patch.perception;
    this.task_count++;
  }

  // ── Als Prompt-String für Claude/GPT ──────────────────────────────────
  toPromptString() {
    const lines = [];
    if (this.goal)                         lines.push(`Ziel: ${this.goal}`);
    if (this.current_step)                 lines.push(`Aktuell: ${this.current_step}`);
    if (this.steps_done.length)            lines.push(`Erledigt: ${this.steps_done.slice(-5).join(' → ')}`);
    if (Object.keys(this.known_facts).length)
      lines.push(`Bekannte Fakten: ${JSON.stringify(this.known_facts)}`);
    if (this.available_docs.length)        lines.push(`Dokumente: ${this.available_docs.join(', ')}`);
    if (this.last_perception?.scene)       lines.push(`Zuletzt gesehen: ${this.last_perception.scene}`);
    return lines.length
      ? `[SESSION_KONTEXT]\n${lines.join('\n')}\n[/SESSION_KONTEXT]`
      : '';
  }

  // ── Checkpoint-System ─────────────────────────────────────────────────
  addCheckpoint({ description, ax_snapshot, url = null }) {
    this.checkpoints.push({ ts: Date.now(), description, ax_snapshot, url });
    if (this.checkpoints.length > 5) this.checkpoints.shift();
    console.log(`📍 Checkpoint: "${description}"`);
  }

  getLastCheckpoint() {
    return this.checkpoints.length
      ? this.checkpoints[this.checkpoints.length - 1]
      : null;
  }

  // ── Confidence-Learning ───────────────────────────────────────────────
  // fingerprint: z.B. "NO_DELTA:opera:google_suche"
  // Erst nach 3× erfolgreicher Korrektur → trusted (wird in device_knowledge gespeichert)
  recordLearning(fingerprint, correction) {
    if (!this.learnings[fingerprint]) {
      this.learnings[fingerprint] = { count: 0, correction, trusted: false };
    }
    const l = this.learnings[fingerprint];
    l.count++;
    if (l.count >= 3 && !l.trusted) {
      l.trusted = true;
      console.log(`🧠 Learning trusted nach 3× (${fingerprint}): ${JSON.stringify(correction)}`);
    }
    return l.trusted;
  }

  getTrustedLearning(fingerprint) {
    const l = this.learnings[fingerprint];
    return l?.trusted ? l.correction : null;
  }
}

module.exports = new SessionContext(); // Singleton
