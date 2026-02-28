// ════════════════════════════════════════════════════════════════════════
// WahrnehmungsAmt — Was sieht MIRA gerade?
// Screenshot + AX-Kontext → semantische Beschreibung via GPT-4o-mini Vision
// Antwortet auf: "Was ist das? Was ist der Zweck? Welche Gefahren gibt es?"
// 2-Sekunden-Cache damit nicht bei jedem kleinen Task ein API-Call gemacht wird.
// ════════════════════════════════════════════════════════════════════════

const sessionCtx = require('./session-context');

class WahrnehmungsAmt {
  constructor() {
    this._lastTs     = 0;
    this._lastResult = null;
    this._CACHE_MS   = 2000;
  }

  // Hauptmethode: Screenshot + AX → semantische Wahrnehmung
  async wahrnehmen({ screenshot, axContext, token, API, force = false }) {
    const now = Date.now();
    if (!force && this._lastResult && (now - this._lastTs) < this._CACHE_MS) {
      return this._lastResult; // Cache hit
    }

    try {
      const res = await fetch(`${API}/api/brain/perceive`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          token,
          screenshot,
          ax_context:      axContext,
          session_context: sessionCtx.toPromptString()
        })
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.success && data.perception) {
        this._lastResult = data.perception;
        this._lastTs     = now;
        sessionCtx.update({ perception: data.perception });

        const dangerStr = data.perception.dangers?.join(', ') || 'keine';
        console.log(`🔭 Wahrnehmung: "${data.perception.scene}" | Gefahren: ${dangerStr}`);
        return data.perception;
      }
    } catch(e) {
      console.warn('🔭 WahrnehmungsAmt Fehler:', e.message);
    }
    return null;
  }

  // Cache invalidieren (z.B. nach Navigation)
  invalidate() {
    this._lastTs = 0;
    this._lastResult = null;
  }
}

module.exports = new WahrnehmungsAmt();
