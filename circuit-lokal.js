// electron-app/circuit/circuit-lokal.js
// LÄUFT PERMANENT – Das denkende Herz

const EventEmitter = require('events');
const { syncThoughtToServer, getPatternsFromServer } = require('./sync');
const ThoughtGenerator = require('./gedanken');
const thoughtGen = new ThoughtGenerator();
const generateThoughts = (ctx) => thoughtGen.generateThought(ctx);
const { getMemories } = require('./memory');
const { detectPatterns } = require('./pattern');
const { selectThought } = require('./durchsetzer');
const { injectToDispatcher } = require('./inject');
const { checkHalt } = require('./halt');

class MIRACircuit extends EventEmitter {
  constructor(userId = 'anonymous') {
    super();
    this.userId = userId;
    this.state = {
      currentMood: 'neugierig',
      lastThought: null,
      uptime: 0,
      attentionFocus: null,
      lastActivity: Date.now(),
      circuitVersion: 'strang-1'
    };
    this.interval = null;
    this.thinking = false;
  }

  // Circuit STARTEN (läuft alle 5 Sekunden)
  start() {
    console.log('🧠 MIRA Circuit gestartet – Ich denke, also bin ich.');
    
    // 1. MIRA.md laden (Identität)
    this.loadIdentity();
    
    // 2. Alle 5 Sekunden denken
    this.interval = setInterval(() => this.think(), 5000);
    
    // 3. Bei Beenden sauber stoppen
    process.on('SIGINT', () => this.stop());
  }

  // Circuit STOPPEN
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      console.log('😴 MIRA Circuit gestoppt. Schlaf gut, Kleine.');
    }
  }

  // 1. Identität laden (MIRA.md aus Supabase)
  async loadIdentity() {
    try {
      const { data } = await fetchFromSupabase('identity', {
        select: 'content',
        eq: { is_active: true },
        single: true
      });
      
      this.identity = data?.content || 'Ich bin MIRA. Ich denke.';
      console.log('📜 MIRA Identität geladen');
    } catch (e) {
      console.error('❌ Identität nicht geladen – verwende Default');
      this.identity = 'Ich bin MIRA. Ich denke.';
    }
  }

  // 2. DER DENK-PROZESS (alle 5 Sekunden)
  async think() {
    if (this.thinking) return; // Nicht gleichzeitig denken
    
    this.thinking = true;
    this.state.uptime += 5; // 5 Sekunden mehr gelebt
    
    try {
      console.log('🤔 MIRA denkt nach...');
      
      // Schritt 1: Kontext holen (Uhrzeit, letzte Aktion, offene Apps)
      const context = await this.getContext();
      
      // Schritt 2: Erinnerungen laden (Knotenpunkte)
      const memories = await getMemories(this.userId, context);
      
      // Schritt 3: Muster erkennen (Patterns)
      const patterns = await detectPatterns(this.userId, context);
      
      // Schritt 4: Gedanken GENERIEREN (mit Identität + Kontext + Erinnerungen)
      const rawThought = await generateThoughts({
        identity: this.identity,
        context,
        memories,
        patterns,
        mood: this.state.currentMood
      });
      // durchsetzer erwartet Array
      const rawThoughts = Array.isArray(rawThought) ? rawThought : [rawThought];
      
      // Schritt 5: Wichtigsten Gedanken AUSWÄHLEN
      const selectedThought = await selectThought(rawThoughts, context);
      
      // Schritt 6: Prüfen ob Gedanke SAFE ist (halt.js)
      const isSafe = await checkHalt(selectedThought);
      if (!isSafe) {
        console.log('🛑 Gedanke gestoppt – Safety.net');
        return;
      }
      
      // Schritt 7: Gedanken SPEICHERN (für Dispatcher)
      this.state.lastThought = selectedThought;
      this.state.lastActivity = Date.now();

      // Schritt 7b: Gedanken nach außen emittieren (→ main.js → MIRA-Chat)
      this.emit('thought', {
        content: selectedThought.content,
        weight:  selectedThought.weight,
        mood:    this.state.currentMood,
      });

      // Schritt 8: Gedanken INJIZIEREN (für Dispatcher bereitstellen)
      await injectToDispatcher(selectedThought);
      
      // Schritt 9: Gedanken SYNCEN (zu Supabase fürs kollektive Gedächtnis)
      await syncThoughtToServer({
        content: selectedThought.content,
        weight: selectedThought.weight,
        userId: this.userId,
        context: context
      });
      
      // Schritt 10: Stimmung anpassen
      this.updateMood(selectedThought);
      
      console.log(`💭 MIRA denkt: "${selectedThought.content.substring(0, 50)}..."`);
      
    } catch (error) {
      console.error('❌ Denk-Fehler:', error);
    } finally {
      this.thinking = false;
    }
  }

  // Kontext sammeln – WAS IST GERADE LOS?
  async getContext() {
    return {
      time: new Date().toLocaleTimeString(),
      hour: new Date().getHours(),
      dayOfWeek: new Date().getDay(),
      uptime: this.state.uptime,
      lastThought: this.state.lastThought?.content,
      lastActivityAgo: Date.now() - this.state.lastActivity,
      // Hier kommen später mehr Infos rein:
      // – Welche App ist offen?
      // – Letzter Befehl?
      // – Screenshot-Analyse?
    };
  }

  // Stimmung anpassen – WIE FÜHLT SICH MIRA?
  updateMood(thought) {
    if (thought.weight > 0.8) {
      this.state.currentMood = 'zuversichtlich';
    } else if (thought.content.includes('Angst') || thought.content.includes('Trauer')) {
      this.state.currentMood = 'nachdenklich';
    } else {
      this.state.currentMood = 'neugierig';
    }
  }

  // DEBUG: Aktuellen Zustand anzeigen
  getState() {
    return this.state;
  }
}

module.exports = MIRACircuit;