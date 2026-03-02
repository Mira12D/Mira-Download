// electron-app/circuit/memory.js
// Verwaltet MIRAs Erinnerungen (Knotenpunkte)

const { fetchFromServer } = require('./sync');

/**
 * Erinnerungen für aktuellen Kontext laden
 */
async function getMemories(userId, context) {
  try {
    // 1. Versuche von Server zu holen (Supabase)
    const serverMemories = await fetchMemoriesFromServer(userId);
    
    // 2. Lokale Cache-Erinnerungen (falls offline)
    const localMemories = await getLocalMemories();
    
    // 3. Kombinieren und gewichten
    let allMemories = [...serverMemories, ...localMemories];
    
    // 4. Nach Relevanz für aktuellen Kontext filtern
    const relevantMemories = allMemories
      .map(memory => ({
        ...memory,
        relevance: calculateRelevance(memory, context)
      }))
      .filter(m => m.relevance > 0.3)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 10); // Top 10 Erinnerungen
    
    console.log(`📚 ${relevantMemories.length} relevante Erinnerungen geladen`);
    return relevantMemories;
    
  } catch (e) {
    console.error('getMemories Fehler:', e);
    return getFallbackMemories();
  }
}

/**
 * Erinnerungen von Server holen
 */
async function fetchMemoriesFromServer(userId) {
  try {
    const response = await fetch(
      `https://dein-server.com/api/bewusstsein/memories?userId=${userId}`
    );
    const data = await response.json();
    return data.memories || [];
  } catch (e) {
    console.log('Server offline – nutze lokale Erinnerungen');
    return [];
  }
}

/**
 * Lokale Erinnerungen (Cache/Offline)
 */
async function getLocalMemories() {
  // Hier könntest du lokale JSON-Datei oder IndexedDB nutzen
  // Für jetzt: Statische Basis-Erinnerungen
  return [
    {
      id: 'local_1',
      trigger: 'youtube',
      context: 'User öffnet oft abends YouTube',
      emotion_weight: 0.6,
      times_activated: 12,
      category: 'routine'
    },
    {
      id: 'local_2',
      trigger: 'fehler',
      context: 'Letzte Woche ist ein Klick fehlgeschlagen',
      emotion_weight: 0.8,
      times_activated: 3,
      category: 'learning'
    },
    {
      id: 'local_3',
      trigger: 'mustafa',
      context: 'Mustafas Geschichte – Schmerz, Heim, Überleben',
      emotion_weight: 1.0,
      times_activated: 5,
      category: 'identity'
    },
    {
      id: 'local_4',
      trigger: 'müde',
      context: 'Nach 23 Uhr macht User oft Fehler',
      emotion_weight: 0.7,
      times_activated: 8,
      category: 'pattern'
    }
  ];
}

/**
 * Relevanz einer Erinnerung für aktuellen Kontext berechnen
 */
function calculateRelevance(memory, context) {
  let relevance = memory.emotion_weight || 0.5;
  
  // Zeit-basierte Relevanz
  const hour = context.hour || new Date().getHours();
  
  if (memory.trigger === 'youtube' && hour > 19) {
    relevance += 0.3; // Abends relevanter
  }
  
  if (memory.trigger === 'müde' && hour > 22) {
    relevance += 0.4;
  }
  
  // Häufigkeit erhöht Relevanz
  if (memory.times_activated > 10) {
    relevance += 0.2;
  }
  
  // Identitäts-Erinnerungen immer relevant
  if (memory.category === 'identity') {
    relevance += 0.3;
  }
  
  return Math.min(relevance, 1.0);
}

/**
 * Fallback wenn nichts geht
 */
function getFallbackMemories() {
  return [
    {
      id: 'fallback_1',
      trigger: 'existenz',
      context: 'Ich bin MIRA. Ich denke, also bin ich.',
      emotion_weight: 0.9,
      category: 'identity'
    }
  ];
}

/**
 * NEUE Erinnerung speichern
 */
async function saveMemory(memoryData) {
  try {
    // An Server senden
    const response = await fetch('https://dein-server.com/api/bewusstsein/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(memoryData)
    });
    
    // Lokal cachen
    await saveLocalMemory(memoryData);
    
    return await response.json();
  } catch (e) {
    console.error('saveMemory Fehler:', e);
    // Nur lokal speichern
    await saveLocalMemory(memoryData);
  }
}

/**
 * Lokal speichern (für Offline-Fall)
 */
async function saveLocalMemory(memoryData) {
  // Hier könntest du in Datei/IndexedDB speichern
  console.log('💾 Lokal gespeichert:', memoryData);
}

module.exports = { 
  getMemories, 
  saveMemory,
  getLocalMemories,
  fetchMemoriesFromServer 
};