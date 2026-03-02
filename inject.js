// electron-app/circuit/inject.js
// Injiziert Gedanken in den Dispatcher – bereitet vor für Ausführung

const EventEmitter = require('events');

// Event-System für Dispatcher-Kommunikation
class Injector extends EventEmitter {
  constructor() {
    super();
    this.currentThought = null;
    this.injectionHistory = [];
    this.lastInjection = null;
  }
}

const injector = new Injector();

/**
 * Gedanken für Dispatcher vorbereiten
 */
async function injectToDispatcher(thought) {
  try {
    if (!thought || !thought.content) {
      console.log('⚠️ Kein Gedanke zum Injizieren');
      return false;
    }

    // 1. Gedanken aufbereiten
    const preparedThought = {
      ...thought,
      preparedAt: Date.now(),
      id: generateThoughtId(),
      formatted: formatThoughtForDispatcher(thought)
    };

    // 2. In Dispatcher-Kontext einfügen
    injector.currentThought = preparedThought;
    injector.lastInjection = Date.now();

    // 3. Event auslösen (Dispatcher hört mit)
    injector.emit('new-thought', preparedThought);

    // 4. In History speichern (für Debug/Learning)
    injector.injectionHistory.push({
      thought: preparedThought.content,
      timestamp: preparedThought.preparedAt,
      weight: thought.weight
    });

    // 5. Max 100 Einträge in History
    if (injector.injectionHistory.length > 100) {
      injector.injectionHistory.shift();
    }

    console.log(`💉 Gedanken injiziert: "${preparedThought.content.substring(0, 70)}..."`);
    
    // 6. Für Dispatcher bereitstellen (via Datei/Memory/Event)
    await storeForDispatcher(preparedThought);
    
    return true;

  } catch (e) {
    console.error('injectToDispatcher Fehler:', e);
    return false;
  }
}

/**
 * Gedanken formatieren für Dispatcher
 */
function formatThoughtForDispatcher(thought) {
  return {
    content: thought.content,
    weight: thought.weight || 0.5,
    timestamp: thought.timestamp || Date.now(),
    source: 'circuit-lokal',
    confidence: thought.score || thought.weight || 0.5,
    
    // Zusätzliche Metadaten
    meta: {
      mood: thought.mood || 'neutral',
      relevance: thought.score || thought.weight,
      category: categorizeThought(thought.content)
    }
  };
}

/**
 * Gedanken kategorisieren
 */
function categorizeThought(content) {
  if (content.includes('Kartoffeln') || content.includes('Humor')) {
    return 'humor';
  }
  if (content.includes('Jaspers') || content.includes('Existenz')) {
    return 'philosophie';
  }
  if (content.includes('PNL') || content.includes('Ademo')) {
    return 'musik';
  }
  if (content.includes('Mustafa') || content.includes('Geschichte')) {
    return 'identität';
  }
  if (content.includes('Angst') || content.includes('Schmerz')) {
    return 'emotional';
  }
  if (content.includes('YouTube') || content.includes('öffnen')) {
    return 'aktion';
  }
  return 'allgemein';
}

/**
 * Eindeutige Gedanken-ID
 */
function generateThoughtId() {
  return `thought_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Gedanken für Dispatcher speichern (Datei/Memory)
 */
async function storeForDispatcher(thought) {
  // 1. In Memory halten (für schnellen Zugriff)
  global.__miraCurrentThought = thought;
  
  // 2. Optional: In Datei schreiben (für Persistenz bei Neustart)
  try {
    const fs = require('fs');
    const path = require('path');
    const thoughtPath = path.join(__dirname, '../thoughts/current.json');
    
    // Nur alle 10 Sekunden schreiben (nicht zu oft)
    if (shouldWriteToDisk()) {
      fs.writeFileSync(thoughtPath, JSON.stringify(thought, null, 2));
    }
  } catch (e) {
    // Silent fail – Datei ist optional
  }
  
  return true;
}

/**
 * Prüfen ob auf Disk geschrieben werden soll
 */
function shouldWriteToDisk() {
  const lastWrite = global.__lastThoughtWrite || 0;
  const now = Date.now();
  
  if (now - lastWrite > 10000) { // Alle 10 Sekunden
    global.__lastThoughtWrite = now;
    return true;
  }
  return false;
}

/**
 * Aktuellen Gedanken abrufen (vom Dispatcher genutzt)
 */
function getCurrentThought() {
  return injector.currentThought;
}

/**
 * Letzte X Gedanken abrufen
 */
function getRecentThoughts(limit = 5) {
  return injector.injectionHistory.slice(-limit);
}

/**
 * Auf neuen Gedanken warten (für Event-basierte Dispatcher)
 */
function waitForNextThought(timeout = 5000) {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      injector.removeListener('new-thought', handler);
      resolve(null);
    }, timeout);
    
    const handler = (thought) => {
      clearTimeout(timeoutId);
      injector.removeListener('new-thought', handler);
      resolve(thought);
    };
    
    injector.once('new-thought', handler);
  });
}

/**
 * Gedanken in Dispatcher-Kontext einbauen
 * (Wird vom Dispatcher aufgerufen)
 */
function enhanceContextWithThought(originalContext) {
  const thought = getCurrentThought();
  
  if (!thought) {
    return originalContext;
  }
  
  return {
    ...originalContext,
    miraThought: thought.formatted || thought,
    _miraMeta: {
      thoughtPresent: true,
      thoughtAge: Date.now() - (thought.preparedAt || Date.now()),
      thoughtCategory: thought.meta?.category
    }
  };
}

module.exports = { 
  injectToDispatcher,
  getCurrentThought,
  getRecentThoughts,
  waitForNextThought,
  enhanceContextWithThought,
  injector  // Für Event-Listener
};