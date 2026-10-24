import { jpegDataUrl, resizeToCanvas } from './image.js';

// Asks the server to read the photo with Claude. The server always answers,
// falling back to simple rules when Claude is off or fails; if the server
// itself is unreachable the same rules run here.
export async function analyzePhoto(canvas, { hints = {}, stats = {} } = {}) {
  // 1092 px on the long edge fits Claude's image limits without resizing,
  // so the pixel coordinates it returns line up with this copy.
  const small = resizeToCanvas(canvas, 1092);
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({ image: jpegDataUrl(small, 0.85), width: small.width, height: small.height, hints, stats }),
    });
    if (!res.ok) throw new Error(`server said ${res.status}`);
    return await res.json();
  } catch (err) {
    return {
      analysis: localFallback(stats),
      source: 'fallback',
      model: null,
      warning: `The server is not reachable (${err.message}), so you will place the spots yourself.`,
    };
  }
}

function localFallback({ brightness = 0.5, warmth = 0 } = {}) {
  const light = brightness < 0.22 ? 'night' : warmth > 0.06 ? 'warm_indoor' : 'daylight';
  return {
    titleSuggestion: '',
    scale: 'room',
    light,
    particles: light === 'night' ? 'none' : 'dust',
    soundLayers: ['room_tone'],
    lens: 'main',
    anchors: [],
  };
}
