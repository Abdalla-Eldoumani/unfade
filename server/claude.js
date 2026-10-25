import {
  LENSES,
  LIGHTS,
  MAX_ANCHORS,
  MAX_SOUND_LAYERS,
  PARTICLES,
  SCALES,
  SOUND_LAYERS,
} from '../src/shared/contract.js';

// Reads one photo with Claude and returns scene settings plus up to three
// anchors. The key only ever comes from the environment.
const API_URL = 'https://api.anthropic.com/v1/messages';
export const MODEL = process.env.UNFADE_MODEL || 'claude-sonnet-5-5';
const EFFORT = process.env.UNFADE_EFFORT || 'low';
const TIMEOUT_MS = 30000;

const SYSTEM = `You help a person step back into one of their own photos inside a VR headset. They will stand inside a 3D version of this photo. It starts faded, and each anchor you choose is a spot that brings part of the memory back when they look at it.

Look at the photo and fill in the schema.

What you write must stay true to the photo:
- Describe only what you can see. Never guess names, relationships, ages, dates, places, or what happened. If the person gave a title, a time or a place, you may use their words and nothing beyond them.
- titleSuggestion: 2 to 6 plain words naming what is visible, like "Candles on a kitchen table".
- scale: how far away most of the scene is. closeup: under 2 metres (food, hands, a pet up close). room: an indoor space. street: outdoors with buildings or a yard. landscape: open views, beaches, mountains.
- light: the light in the photo.
- particles: something that belongs in this air. dust for still indoor light, snow or rain only if visible, fireflies for a warm night outdoors, confetti only at a visible party, petals for flowers or spring, mist for fog or steam, none otherwise.
- soundLayers: one to three ambient sounds that fit the place. Never music.
- lens: main unless the photo is clearly a selfie, an ultrawide shot or a zoomed shot.
- anchors: one to three specific visible things worth remembering, spread apart: a person, an object, a light, a detail in the background. For each give x and y in pixels of this image (origin at the top left), a plain label of at most 4 words ("the candles", "the man on the left", "the window"), and a question.
- Each question is about the thing its spot sits on, and asks what only someone who knew this moment could answer: who, a name, what was said or happening, where something came from, what came before or after. Ask, never tell. At most 9 words, plain words, no exclamation marks. Speak of the people in the photo as he, she or they, never as "you", and only of people who are really in it: no "you two", "you all" or "were you laughing", and never assume something is the person's or that they did it. Never ask what an animal sensed or thought, and never ask anyone to imagine or guess ("might", "do you think"). Good: "Who lit these candles?", "What was she laughing at?", "What was this dog's name?", "Whose chair was this?" Bad: "What were you two talking about?", "When did you last light these?", "What scents was it picking up?", "What do you think the wall felt like?", "Your grandmother baked this cake."
- Keep every question warm and curious about the good parts of the moment: the people, what they were doing, what they could hear, smell or taste, a small detail. Never ask about loss, death, illness, absence or regret, and never suggest that anyone or anything is gone, even when the photo looks old or a place looks empty.
- Never assume the person is in the photo, took it, or who they were with, and never assume what a stranger in it was doing with them. Ask openly instead: "Who else was there?", not "Who did you sit here with?". When a photo looks older than the person could be, they were not there: ask about the people in it and that moment ("What was happening just before this?", "Where was this coat from?"), never "you" in the scene, and never what the person remembers of them.
- sound for an anchor: a layer from the list that this thing makes or sits in, or none.`;

const SCHEMA = {
  type: 'object',
  properties: {
    titleSuggestion: { type: 'string' },
    scale: { type: 'string', enum: SCALES },
    light: { type: 'string', enum: LIGHTS },
    particles: { type: 'string', enum: PARTICLES },
    soundLayers: { type: 'array', items: { type: 'string', enum: SOUND_LAYERS } },
    lens: { type: 'string', enum: LENSES },
    anchors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          x: { type: 'integer' },
          y: { type: 'integer' },
          label: { type: 'string' },
          question: { type: 'string' },
          sound: { type: 'string', enum: [...SOUND_LAYERS, 'none'] },
        },
        required: ['x', 'y', 'label', 'question', 'sound'],
        additionalProperties: false,
      },
    },
  },
  required: ['titleSuggestion', 'scale', 'light', 'particles', 'soundLayers', 'lens', 'anchors'],
  additionalProperties: false,
};

export function hasKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// A paste into a terminal can wrap the key in invisible characters (the
// bracketed-paste markers, a carriage return): send the key itself and drop
// whatever surrounds it. Node's error for a bad header quotes the whole value.
function apiKey() {
  return /sk-[a-z]+-[A-Za-z0-9_-]+/.exec(process.env.ANTHROPIC_API_KEY || '')?.[0] || '';
}

// Without Claude: a reasonable scene from simple image statistics the
// studio sends along. No anchors; the studio lets the person place them.
export function fallbackAnalysis(stats = {}) {
  const b = Number(stats.brightness);
  const w = Number(stats.warmth);
  const light = b < 0.22 ? 'night' : w > 0.06 ? 'warm_indoor' : 'daylight';
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

function cleanAnalysis(raw, width, height) {
  const anchors = (Array.isArray(raw.anchors) ? raw.anchors : []).slice(0, MAX_ANCHORS).map((a, i) => ({
    id: `a${i + 1}`,
    x: Math.min(1, Math.max(0, Number(a.x) / width)),
    y: Math.min(1, Math.max(0, Number(a.y) / height)),
    label: String(a.label || '').slice(0, 32),
    question: String(a.question || '').slice(0, 80),
    sound: a.sound,
  }));
  return {
    titleSuggestion: String(raw.titleSuggestion || '').slice(0, 60),
    scale: raw.scale,
    light: raw.light,
    particles: raw.particles,
    soundLayers: (raw.soundLayers || []).slice(0, MAX_SOUND_LAYERS),
    lens: raw.lens,
    anchors,
  };
}

// Every failure is one plain sentence: the server hands it to the studio as the
// reason the person places the spots themselves. The status stays in brackets
// for whoever reads the server's log.
function failed(reason) {
  return new Error(`${reason}, so place the spots yourself by tapping the photo.`);
}

function failedStatus(status, detail) {
  if (status === 401 || status === 403) return failed(`Claude did not accept the API key (${status})`);
  if (status === 429) return failed('Claude has had too many photos for now (429)');
  if (status >= 500) return failed(`Claude is having trouble right now (${status})`);
  return failed(`Claude could not read this photo (${status}: ${detail})`);
}

export async function analyzeWithClaude({ base64, mediaType, width, height, hints = {} }) {
  const key = apiKey();
  if (!key) throw failed('The API key on the server is not an Anthropic key (it should start with sk-ant)');
  const lines = [`This photo is ${width} by ${height} pixels.`];
  if (hints.title) lines.push(`The person titled it: "${String(hints.title).slice(0, 60)}".`);
  if (hints.when) lines.push(`When, in their words: "${String(hints.when).slice(0, 40)}".`);
  if (hints.where) lines.push(`Where, in their words: "${String(hints.where).slice(0, 40)}".`);

  const res = await fetch(API_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2026-10-21',
    },
    body: JSON.stringify({
      model: MODEL,
      // thinking counts toward this cap, so leave room past the short reply
      max_tokens: 4000,
      system: SYSTEM,
      output_config: { effort: EFFORT, format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: lines.join('\n') },
          ],
        },
      ],
    }),
  }).catch((err) => {
    // the code or the name only: a message about the request can quote its headers
    throw err.name === 'TimeoutError'
      ? failed(`Claude took longer than ${TIMEOUT_MS / 1000} seconds to answer`)
      : failed(`Claude could not be reached from this laptop (${err.cause?.code || err.name})`);
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw failedStatus(res.status, body?.error?.message || 'no details');
  if (body.stop_reason && !['end_turn', 'stop_sequence'].includes(body.stop_reason)) {
    throw failed(`Claude's answer was cut short (${body.stop_reason})`);
  }
  const text = (body.content || []).find((b) => b.type === 'text')?.text;
  let raw = null;
  try {
    raw = JSON.parse(text);
  } catch {
    throw failed("Claude's answer could not be read");
  }
  return cleanAnalysis(raw, width, height);
}
