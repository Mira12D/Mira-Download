// ════════════════════════════════════════════════════════════════════════
// GefahrenAmt — Erkennt Fehler, korrigiert, lernt
//
// Nach jeder Aktion:
//   Hat sie etwas bewirkt? → nein → Korrektur (max 3 Versuche)
//   Korrektur erfolgreich → in SessionContext lernen
//   Nach 3× erfolgreicher Korrektur → trusted → in device_knowledge speichern
//
// Checkpoint-System: Snapshot vor jeder riskanten Aktion für Rollback.
// ════════════════════════════════════════════════════════════════════════

const sessionCtx = require('./session-context');

class GefahrenAmt {
  constructor() {
    this.MAX_RETRIES = 3;
  }

  // ── Checkpoint vor riskanter Aktion ────────────────────────────────────
  snapshot({ contextManager, description }) {
    try {
      const state = contextManager.captureState(true);
      const ax    = contextManager.toShortString(state);
      const url   = state?.url || null;
      sessionCtx.addCheckpoint({ description, ax_snapshot: ax, url });
    } catch(e) {
      console.warn('📍 Checkpoint Fehler:', e.message);
    }
  }

  // ── Nach einem Click: Hat er etwas bewirkt? ────────────────────────────
  // Gibt zurück: { ok, issue, fingerprint }
  verify({ preState, postState, action, coordSource, contextManager }) {
    try {
      const diff = contextManager.diffStates(preState, postState);
      if (diff.changed) return { ok: true };

      const appName    = preState?.frontmostApp || 'unknown';
      const fingerprint = `NO_DELTA:${appName}:${action.replace(/\s/g, '_').substring(0, 30)}`;
      const issue       = `Kein State-Delta nach "${action}" (source: ${coordSource})`;
      return { ok: false, issue, fingerprint };
    } catch(e) {
      return { ok: true }; // Im Zweifel nicht blockieren
    }
  }

  // ── Korrektur durchführen ──────────────────────────────────────────────
  // executeStepFn: async (step) => void
  // Returns { corrected, attempt?, reason? }
  async correct({ fingerprint, issue, executeStepFn, contextManager, token, API, deviceKnowledgeId }) {

    // 1. Trusted Learning vorhanden? → sofort anwenden
    const trusted = sessionCtx.getTrustedLearning(fingerprint);
    if (trusted) {
      console.log(`🧠 Trusted Learning anwenden: ${JSON.stringify(trusted)}`);
      try {
        await executeStepFn(trusted);
        await this._sleep(400);
        contextManager.invalidate();
        return { corrected: true, used_learning: true };
      } catch(e) {
        console.warn('Trusted Learning fehlgeschlagen:', e.message);
      }
    }

    // 2. Korrektur via Server ermitteln
    let correctionStep = null;
    try {
      const state = contextManager.captureState(true);
      const ax    = contextManager.toPromptString(state);
      const res   = await fetch(`${API}/api/brain/correct`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          token, issue, ax_context: ax,
          fingerprint,
          session: sessionCtx.toPromptString()
        })
      });
      const data = await res.json();
      if (data.success && data.step) correctionStep = data.step;
    } catch(e) {
      console.warn('⚠️ GefahrenAmt.correct API Fehler:', e.message);
    }

    if (!correctionStep) return { corrected: false, reason: 'Keine Korrektur gefunden' };

    // 3. Korrektur ausführen — max MAX_RETRIES Versuche
    const preState = contextManager.captureState(true);

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      console.log(`🔧 Korrektur ${attempt}/${this.MAX_RETRIES}: ${JSON.stringify(correctionStep)}`);
      try {
        await executeStepFn(correctionStep);
        await this._sleep(400);
        contextManager.invalidate();

        const postState = contextManager.captureState(true);
        const diff      = contextManager.diffStates(preState, postState);

        if (diff.changed) {
          // Erfolg → lernen
          const becameTrusted = sessionCtx.recordLearning(fingerprint, correctionStep);
          if (becameTrusted && deviceKnowledgeId) {
            this._saveToDeviceKnowledge({ fingerprint, correctionStep, token, API, deviceKnowledgeId })
              .catch(e => console.warn('device_knowledge save Fehler:', e.message));
          }
          console.log(`✅ GefahrenAmt Korrektur OK (Versuch ${attempt})`);
          return { corrected: true, attempt };
        }
      } catch(e) {
        console.warn(`Korrektur Versuch ${attempt} Fehler:`, e.message);
      }
    }

    return { corrected: false, reason: `${this.MAX_RETRIES} Versuche erschöpft` };
  }

  // ── Trusted Learning dauerhaft in device_knowledge speichern ───────────
  async _saveToDeviceKnowledge({ fingerprint, correctionStep, token, API, deviceKnowledgeId }) {
    await fetch(`${API}/api/agent/device-knowledge/${deviceKnowledgeId}/add-learning`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token, fingerprint, correction: correctionStep, confidence: 3 })
    });
    console.log(`💾 Learning in device_knowledge: ${fingerprint}`);
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

module.exports = new GefahrenAmt();
