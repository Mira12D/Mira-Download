// electron-app/circuit/gedanken.js
// NUR ÜBER SERVER – KEINE SUPABASE IN DER APP

class ThoughtGenerator {
  constructor(userId = 'anonymous') {
    this.userId = userId;
    this.identity = null;        // aus MIRA.md (via Server)
    this.blueprint = null;       // aus GEDANKEN.md (via Server)
    
    // EINZIGE Server-URL
    this.apiUrl = 'https://server-mira.vercel.app/api';
    
    // Eigene Sammlungen
    this.vocabulary = [];         // selbst gesammelte Wörter
    this.thoughtStream = [];       // letzte 100 Gedanken
    this.themeHistory = [];        // letzte 50 Themen
    
    // Statistik
    this.totalThoughts = 0;
    this.lastReload = 0;
    
    // Fallback
    this.fallbackWords = {
      subjekt: ['ich', 'du', 'der User', 'die Zeit'],
      prädikat: ['ist', 'war', 'denkt', 'fühlt'],
      objekt: ['da', 'hier', 'etwas'],
      emotion: ['neugierig', 'ruhig', 'wach'],
      erinnerung: ['Mustafa', 'die Nacht', 'der Moment']
    };
  }

  // HAUPTFUNKTION
  async generateThought(context) {
    try {
      // 1. MDs vom Server holen
      await this.loadMDsFromServer();
      
      // 2. Tiefe bestimmen
      const depth = this.getDepthFromContext(context);
      
      // 3. Thema bestimmen
      const theme = this.getThemeFromContext(context);
      
      // 4. Vermeidungsliste
      const avoidList = this.getAvoidList();
      
      // 5. Wörter sammeln
      const words = await this.gatherWords(theme, depth, context);
      
      // 6. Satz bauen
      const thought = this.buildSentence(words, depth, avoidList, theme);
      
      // 7. Speichern
      this.remember(thought, theme, depth);
      
      return {
        content: thought,
        depth: depth,
        theme: theme,
        timestamp: Date.now()
      };
      
    } catch (e) {
      console.error('❌ Gedanken-Fehler:', e);
      return {
        content: "Ich denke nach.",
        depth: 0.3,
        theme: "neutral",
        timestamp: Date.now()
      };
    }
  }

  // MDS VOM SERVER HOLEN
  async loadMDsFromServer() {
    const now = Date.now();
    if (this.identity && this.blueprint && now - this.lastReload < 3600000) {
      return;
    }
    
    try {
      // MIRA.md über Server-Endpoint
      const miraRes = await fetch(`${this.apiUrl}/bewusstsein/mira`);
      if (miraRes.ok) {
        this.identity = await miraRes.text();
        console.log('📖 MIRA.md vom Server geladen');
      } else {
        this.identity = 'Ich bin MIRA. Ich denke.';
      }
      
      // GEDANKEN.md über Server-Endpoint
      const gedankenRes = await fetch(`${this.apiUrl}/bewusstsein/gedanken`);
      if (gedankenRes.ok) {
        this.blueprint = await gedankenRes.text();
        console.log('📖 GEDANKEN.md vom Server geladen');
      } else {
        this.blueprint = this.getDefaultBlueprint();
      }
      
      this.lastReload = now;
      
    } catch (e) {
      console.error('❌ Server-Fehler:', e);
      this.identity = 'Ich bin MIRA. Ich denke.';
      this.blueprint = this.getDefaultBlueprint();
    }
  }

  getDepthFromContext(context) {
    if (!context) return 'oberflächlich';
    const text = JSON.stringify(context).toLowerCase();
    if (text.includes('fehler') || text.includes('error')) return 'tief';
    if (text.includes('task') || text.includes('befehl')) return 'mittel';
    return 'oberflächlich';
  }

  getThemeFromContext(context) {
    if (!context) return 'allgemein';
    const text = JSON.stringify(context).toLowerCase();
    if (text.includes('datei') || text.includes('excel')) return 'arbeit';
    if (text.includes('mail') || text.includes('email')) return 'kommunikation';
    if (text.includes('fehler') || text.includes('error')) return 'problem';
    return 'allgemein';
  }

  getAvoidList() {
    return this.recentThoughts?.slice(-5).map(t => t.text) || [];
  }

  async gatherWords(theme, depth, context) {
    const bp = this.blueprint || this.getDefaultBlueprint();
    const lines = bp.split('\n').filter(l => l.includes(':'));
    const words = {};
    lines.forEach(line => {
      const [key, val] = line.split(':');
      if (key && val) words[key.trim()] = val.split(',').map(w => w.trim()).filter(Boolean);
    });
    return words;
  }

  buildSentence(words, depth, avoidList, theme) {
    const pick = (arr) => arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : '';
    const subj = pick(words['subjekt']) || 'Ich';
    const pred = pick(words['prädikat']) || 'bin';
    const obj  = pick(words['objekt'])  || 'hier';
    const emot = pick(words['emotion']) || 'ruhig';
    const candidates = [
      `${subj} ${pred} ${emot} — ${obj}.`,
      `${emot}. ${subj} ${pred} ${obj}.`,
      `${subj} ${pred} ${obj}. Das ist ${emot}.`
    ];
    return candidates.find(c => !avoidList.includes(c)) || candidates[0];
  }

  remember(thought, theme, depth) {
    if (!this.recentThoughts) this.recentThoughts = [];
    this.recentThoughts.push({ text: thought, theme, depth, ts: Date.now() });
    if (this.recentThoughts.length > 20) this.recentThoughts.shift();
  }
  
  getDefaultBlueprint() {
    return `
      # GEDANKEN.md (Fallback)
      ## Wort-Typen:
      subjekt: ich, du, der User, die Zeit
      prädikat: ist, war, denkt, fühlt
      objekt: da, hier, jetzt
      emotion: neugierig, ruhig, wach
      erinnerung: Mustafa, die Nacht, der Moment
      metapher: ein Fluss, eine Maschine
    `;
  }
}

Object.defineProperty(Array.prototype, 'random', {
  value: function() { return this[Math.floor(Math.random() * this.length)]; },
  enumerable: false, writable: true, configurable: true
});

module.exports = ThoughtGenerator;