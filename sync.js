// electron-app/circuit/sync.js
// KEINE Supabase mehr hier – nur an eigenen Server
// MIT Fehlerbehandlung, Timeout und Retry

const API_URL = 'https://server-mira.vercel.app/api';

/**
 * Gedanken an SERVER schicken (mit Fehlerbehandlung)
 */
async function syncThoughtToServer(thought) {
  try {
    // 1. Input validieren
    if (!thought || !thought.content) {
      console.warn('⚠️ Kein gültiger Gedanke zum Syncen');
      return { success: false, error: 'Invalid thought' };
    }

    // 2. Fetch mit Timeout (5 Sekunden)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${API_URL}/bewusstsein/thoughts`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        thought: thought.content,
        weight: thought.weight || 0.5,
        userId: thought.userId || 'anonymous',
        context: thought.context || {}
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // 3. Prüfen ob Response OK ist
    if (!response.ok) {
      const text = await response.text();
      console.error(`❌ Server Fehler ${response.status}:`, text.substring(0, 200));
      return { 
        success: false, 
        error: `HTTP ${response.status}`,
        details: text.substring(0, 100)
      };
    }

    // 4. Prüfen ob Content-Type JSON ist
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error('❌ Kein JSON erhalten:', text.substring(0, 200));
      return { 
        success: false, 
        error: 'Response not JSON',
        html: text.includes('<!DOCTYPE') 
      };
    }

    // 5. JSON parsen
    const data = await response.json();
    console.log('✅ Gedanke an Server gesendet');
    return { success: true, data };
    
  } catch (e) {
    if (e.name === 'AbortError') {
      console.error('⏱️ Sync Timeout – Server nicht erreichbar');
      return { success: false, error: 'Timeout' };
    }
    
    console.error('❌ Sync-Fehler:', e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Muster vom SERVER holen (mit Fehlerbehandlung)
 */
async function getPatternsFromServer(userId = 'anonymous') {
  try {
    // Timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(
      `${API_URL}/bewusstsein/patterns?userId=${encodeURIComponent(userId)}`,
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`⚠️ Patterns Fehler ${response.status}`);
      return { patterns: [], source: 'fallback' };
    }

    const data = await response.json();
    return { 
      patterns: data.patterns || [], 
      source: 'server' 
    };
    
  } catch (e) {
    if (e.name === 'AbortError') {
      console.log('⏱️ Patterns Timeout – nutze lokale');
    } else {
      console.log('📴 Server nicht erreichbar – nutze lokale Patterns');
    }
    
    // Fallback: Lokale Patterns
    return { 
      patterns: getLocalPatterns(),
      source: 'local' 
    };
  }
}

/**
 * Erinnerungen vom SERVER holen (NEU)
 */
async function getMemoriesFromServer(userId = 'anonymous') {
  try {
    const response = await fetch(
      `${API_URL}/bewusstsein/memories?userId=${encodeURIComponent(userId)}`
    );

    if (!response.ok) {
      return { memories: [], source: 'fallback' };
    }

    const data = await response.json();
    return { memories: data.memories || [], source: 'server' };
    
  } catch (e) {
    console.log('📴 Memories offline – nutze lokale');
    return { 
      memories: getLocalMemories(),
      source: 'local' 
    };
  }
}

/**
 * LOKALE Fallback-Patterns (wenn Server offline)
 */
function getLocalPatterns() {
  return [
    {
      pattern: 'abends_youtube',
      description: 'User öffnet YouTube oft abends',
      frequency: 10,
      confidence: 0.7
    },
    {
      pattern: 'morgens_email',
      description: 'User checkt Emails morgens',
      frequency: 8,
      confidence: 0.8
    },
    {
      pattern: 'mittagspause',
      description: 'User macht Pause mittags',
      frequency: 5,
      confidence: 0.6
    }
  ];
}

/**
 * LOKALE Fallback-Memories (wenn Server offline)
 */
function getLocalMemories() {
  return [
    {
      trigger: 'mustafa',
      context: 'Mustafas Geschichte – Schmerz, Heim, Überleben',
      emotion_weight: 1.0,
      category: 'identity'
    },
    {
      trigger: 'youtube',
      context: 'User öffnet oft YouTube',
      emotion_weight: 0.6,
      category: 'routine'
    },
    {
      trigger: 'nacht',
      context: 'Nachts bin ich oft wach',
      emotion_weight: 0.5,
      category: 'zeit'
    }
  ];
}

/**
 * Server-Status prüfen (für Debug)
 */
async function checkServerHealth() {
  try {
    const response = await fetch(`${API_URL}/health`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(3000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

module.exports = {
  syncThoughtToServer,
  getPatternsFromServer,
  getMemoriesFromServer,
  checkServerHealth
};