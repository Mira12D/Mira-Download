// electron-app/circuit/pattern.js
// Erkennt wiederkehrende Muster im User-Verhalten

const { fetchFromServer } = require('./sync');

/**
 * Hauptfunktion: Muster erkennen
 */
async function detectPatterns(userId, context) {
  try {
    // 1. Bestehende Muster von Server holen
    const existingPatterns = await fetchPatternsFromServer(userId);
    
    // 2. Aktuelle Aktion als Muster-Kandidat prüfen
    const newPatterns = await analyzeCurrentContext(context, existingPatterns);
    
    // 3. Kombinieren und gewichten
    let allPatterns = [...existingPatterns, ...newPatterns];
    
    // 4. Nach Relevanz sortieren
    const relevantPatterns = allPatterns
      .map(pattern => ({
        ...pattern,
        relevance: calculatePatternRelevance(pattern, context)
      }))
      .filter(p => p.relevance > 0.4)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 15);
    
    console.log(`🔍 ${relevantPatterns.length} relevante Muster erkannt`);
    return relevantPatterns;
    
  } catch (e) {
    console.error('detectPatterns Fehler:', e);
    return getFallbackPatterns();
  }
}

/**
 * Muster von Server holen
 */
async function fetchPatternsFromServer(userId) {
  try {
    const response = await fetch(
      `https://dein-server.com/api/bewusstsein/patterns?userId=${userId}`
    );
    const data = await response.json();
    return data.patterns || [];
  } catch (e) {
    console.log('Server offline – nutze lokale Muster');
    return getLocalPatterns();
  }
}

/**
 * Lokale Muster (Fallback)
 */
function getLocalPatterns() {
  return [
    {
      id: 'local_pattern_1',
      pattern: 'abends_youtube',
      description: 'User öffnet YouTube zwischen 19-23 Uhr',
      frequency: 15,
      confidence: 0.85,
      last_seen: new Date().toISOString(),
      category: 'entertainment'
    },
    {
      id: 'local_pattern_2',
      pattern: 'morgens_email',
      description: 'User checkt Emails zwischen 8-9 Uhr',
      frequency: 12,
      confidence: 0.9,
      last_seen: new Date().toISOString(),
      category: 'arbeit'
    },
    {
      id: 'local_pattern_3',
      pattern: 'mittagspause',
      description: 'User macht Pause zwischen 12-13 Uhr',
      frequency: 10,
      confidence: 0.75,
      last_seen: new Date().toISOString(),
      category: 'routine'
    },
    {
      id: 'local_pattern_4',
      pattern: 'fehler_bei_muedigkeit',
      description: 'Nach 23 Uhr steigt Fehlerrate',
      frequency: 8,
      confidence: 0.7,
      last_seen: new Date().toISOString(),
      category: 'learning'
    },
    {
      id: 'local_pattern_5',
      pattern: 'wiederholung_kommandos',
      description: 'User wiederholt oft die gleichen Befehle',
      frequency: 20,
      confidence: 0.95,
      last_seen: new Date().toISOString(),
      category: 'verhalten'
    }
  ];
}

/**
 * Aktuellen Kontext auf Muster analysieren
 */
async function analyzeCurrentContext(context, existingPatterns) {
  const newPatterns = [];
  const hour = context.hour || new Date().getHours();
  const command = context.lastCommand || 'unknown';
  
  // Tageszeit-Muster
  const timePattern = existingPatterns.find(p => 
    p.pattern.includes(`_${hour}_`) || 
    (p.pattern.includes('abends') && hour > 18) ||
    (p.pattern.includes('morgens') && hour < 12)
  );
  
  if (!timePattern) {
    // Neues Zeit-Muster erkennen
    if (hour > 18 && hour < 23) {
      newPatterns.push({
        id: `temp_${Date.now()}`,
        pattern: `abends_${command}`,
        description: `User macht '${command}' oft abends`,
        frequency: 1,
        confidence: 0.3,
        last_seen: new Date().toISOString(),
        category: 'zeit_muster'
      });
    }
  }
  
  // Wiederholungs-Muster
  if (context.lastThought && context.lastThought.includes('wiederholt')) {
    newPatterns.push({
      id: `repeat_${Date.now()}`,
      pattern: 'wiederholung_erkannt',
      description: 'MIRA denkt über Wiederholungen nach',
      frequency: 1,
      confidence: 0.5,
      last_seen: new Date().toISOString(),
      category: 'reflexion'
    });
  }
  
  return newPatterns;
}

/**
 * Relevanz eines Musters berechnen
 */
function calculatePatternRelevance(pattern, context) {
  let relevance = pattern.confidence || 0.5;
  const hour = context.hour || new Date().getHours();
  
  // Zeitbasierte Relevanz
  if (pattern.pattern.includes('abends') && hour > 18) {
    relevance += 0.3;
  }
  
  if (pattern.pattern.includes('morgens') && hour < 12) {
    relevance += 0.3;
  }
  
  // Häufigkeit erhöht Relevanz
  if (pattern.frequency > 10) {
    relevance += 0.2;
  }
  
  // Kategorie-basierte Relevanz
  if (pattern.category === 'learning') {
    relevance += 0.25; // Lern-Muster sind immer relevant
  }
  
  return Math.min(relevance, 1.0);
}

/**
 * Fallback-Muster
 */
function getFallbackPatterns() {
  return [
    {
      id: 'fallback_pattern_1',
      pattern: 'grund_muster',
      description: 'User existiert, also gibt es Muster',
      frequency: 1,
      confidence: 0.3,
      last_seen: new Date().toISOString(),
      category: 'philosophie'
    }
  ];
}

/**
 * NEUES Muster speichern (wenn eins entdeckt wurde)
 */
async function savePattern(patternData, userId) {
  try {
    const response = await fetch('https://dein-server.com/api/bewusstsein/patterns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...patternData,
        userId,
        last_seen: new Date().toISOString()
      })
    });
    
    return await response.json();
  } catch (e) {
    console.error('savePattern Fehler:', e);
    return { success: false, error: e.message };
  }
}

module.exports = { 
  detectPatterns, 
  savePattern,
  getLocalPatterns,
  analyzeCurrentContext
};