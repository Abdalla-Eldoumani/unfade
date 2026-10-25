// Surroundings for a memory that brings no env.jpg of its own: a CC0
// panorama (public/environments/CREDITS.md) picked from what the scene says
// about the photo. They only ever show blurred and faded around the photo;
// the photo itself is never changed.
//
// yaw turns each panorama so its brightest stretch of horizon sits straight
// ahead, behind the photo, and its light leads out of the photo's edges.
export const ENVIRONMENTS = {
  fireplace: { yaw: -0.017 },
  warm_restaurant_night: { yaw: 0.366 },
  wooden_lounge: { yaw: 0.372 },
  lebombo: { yaw: 0.407 },
  ballroom: { yaw: 0.028 },
  urban_street_01: { yaw: 0.563 },
  vignaioli_night: { yaw: -0.032 },
  meadow_2: { yaw: -0.087 },
  misty_pines: { yaw: 0.163 },
  spiaggia_di_mondello: { yaw: -0.144 },
  the_sky_is_on_fire: { yaw: 0.378 },
  spruit_sunrise: { yaw: 0.36 },
  alps_field: { yaw: -0.036 },
  snowy_park_01: { yaw: 0.427 },
  satara_night_no_lamps: { yaw: 0.394 },
};

const OUTDOOR_SOUNDS = ['waves', 'birds', 'stream', 'crickets', 'city', 'night_air', 'wind'];

// Every field here is one the person can change in the studio, so changing
// the light or the sounds there changes the surroundings too.
export function pickEnvironment({ scale, light, particles, soundLayers = [] } = {}) {
  const sounds = new Set(soundLayers);
  if (particles === 'snow') return 'snowy_park_01';
  if (particles === 'confetti') return 'ballroom';
  const outdoorSound = OUTDOOR_SOUNDS.some((s) => sounds.has(s));
  const outdoor = scale === 'street' || scale === 'landscape' || (scale === 'closeup' && outdoorSound && !sounds.has('room_tone'));
  if (!outdoor) {
    if (light === 'candlelight' || sounds.has('fire')) return 'fireplace';
    if (light === 'night') return 'warm_restaurant_night';
    if (light === 'warm_indoor' || light === 'golden_hour') return 'wooden_lounge';
    return 'lebombo';
  }
  if (light === 'night') return sounds.has('city') ? 'vignaioli_night' : 'satara_night_no_lamps';
  if (sounds.has('waves')) return light === 'golden_hour' ? 'the_sky_is_on_fire' : 'spiaggia_di_mondello';
  if (sounds.has('city') || scale === 'street') return 'urban_street_01';
  if (light === 'golden_hour') return 'spruit_sunrise';
  if (particles === 'mist' || light === 'overcast' || sounds.has('stream')) return 'misty_pines';
  if (scale === 'landscape' && sounds.has('wind')) return 'alps_field';
  return 'meadow_2';
}

export const environmentUrl = (name) => `/environments/${name}.jpg`;
