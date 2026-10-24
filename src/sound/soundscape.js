// Every sound is made in code with the Web Audio API: no files, no music.
// The world calls:
//   const audio = createAudio();   audio.unlock()  (inside a click or Enter VR)
//   audio.ambience(['room_tone'])  -> { setGain(v), stop() }
//   audio.scene(layers)            -> { setVivid(0..1), swell(layer), stop() }
//   audio.oneShot(name)            names in ONE_SHOTS
export const ONE_SHOTS = ['tick', 'unclip', 'developed', 'step-in', 'bloom', 'revive', 'leave', 'drip'];

export function createAudio() {
  return new AudioEngine();
}

const rand = (a, b) => a + Math.random() * (b - a);

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.buffers = {};
  }

  get ready() {
    return Boolean(this.ctx) && this.ctx.state === 'running';
  }

  unlock() {
    if (!this.ctx) {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) return false;
      this.ctx = new Ctx();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 3;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(comp).connect(this.ctx.destination);
      for (const kind of ['white', 'pink', 'brown']) this.buffers[kind] = noiseBuffer(this.ctx, kind, 4);
      this.buffers.burst = noiseBuffer(this.ctx, 'white', 0.08);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  noise(kind) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[kind];
    src.loop = true;
    src.start(this.ctx.currentTime + rand(0, 0.5));
    return src;
  }

  // A bundle of layers mixed into one gain.
  mix(layers, gain) {
    if (!this.ctx) return nullMix();
    const out = this.ctx.createGain();
    out.gain.value = 0;
    out.connect(this.master);
    const parts = new Map();
    for (const name of layers) {
      const recipe = RECIPES[name];
      if (!recipe) continue;
      const layerGain = this.ctx.createGain();
      layerGain.gain.value = 1;
      layerGain.connect(out);
      parts.set(name, { gain: layerGain, stop: recipe(this, layerGain) });
    }
    const t = this.ctx.currentTime;
    out.gain.setTargetAtTime(gain, t, 0.8);
    return {
      out,
      parts,
      setGain: (v, seconds = 1.2) => out.gain.setTargetAtTime(v, this.ctx.currentTime, seconds / 3),
      stop: (seconds = 1.2) => {
        out.gain.setTargetAtTime(0, this.ctx.currentTime, seconds / 3);
        setTimeout(() => {
          for (const p of parts.values()) p.stop();
          out.disconnect();
        }, seconds * 1000 + 400);
      },
    };
  }

  ambience(layers, { gain = 0.5 } = {}) {
    return this.mix(layers, gain);
  }

  scene(layers) {
    const m = this.mix(layers.length ? layers : ['room_tone'], 0.22);
    // Lowpass filter: starts muffled (500 Hz), opens as colour returns.
    // Only scene() gets this; ambience() stays clear.
    let lp = null;
    if (this.ctx) {
      lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 500;
      lp.Q.value = 0.7;
      m.out.disconnect();
      m.out.connect(lp).connect(this.master);
    }
    return {
      setVivid: (v) => {
        const clamped = Math.min(1, Math.max(0, v));
        m.setGain(0.22 + 0.78 * clamped, 1.5);
        if (lp) lp.frequency.setTargetAtTime(500 + 11500 * clamped, this.ctx.currentTime, 0.5);
      },
      swell: (layer) => {
        const p = m.parts.get(layer);
        if (!p || !this.ctx) return;
        const g = p.gain.gain;
        const t = this.ctx.currentTime;
        g.cancelScheduledValues(t);
        g.setTargetAtTime(1.8, t, 0.4);
        g.setTargetAtTime(1.2, t + 4, 1.5);
      },
      stop: (s) => {
        m.stop(s);
        if (lp) setTimeout(() => lp.disconnect(), (s || 1.2) * 1000 + 400);
      },
    };
  }

  oneShot(name, { gain = 1 } = {}) {
    if (!this.ready) return;
    const fn = SHOTS[name];
    if (fn) fn(this, gain);
  }
}

function nullMix() {
  return { parts: new Map(), setGain() {}, stop() {}, setVivid() {}, swell() {} };
}

function noiseBuffer(ctx, kind, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') d[i] = w * 0.5;
    else if (kind === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else {
      // pink, Paul Kellet's filter
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
  return buf;
}

function filter(ctx, type, freq, q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function lfo(ctx, rate, depth, target) {
  const o = ctx.createOscillator();
  o.frequency.value = rate;
  const g = ctx.createGain();
  g.gain.value = depth;
  o.connect(g).connect(target);
  o.start();
  return o;
}

// Repeats fn at random intervals until stopped.
function every(engine, minS, maxS, fn) {
  let timer = null;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    try {
      fn();
    } catch {
      // a missed blip does not matter
    }
    timer = setTimeout(tick, rand(minS, maxS) * 1000);
  };
  timer = setTimeout(tick, rand(minS, maxS) * 1000);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

function burst(engine, out, { hp = 2000, gain = 0.2, pan = rand(-0.7, 0.7), dur = 0.012 }) {
  const { ctx } = engine;
  const src = ctx.createBufferSource();
  src.buffer = engine.buffers.burst;
  const f = filter(ctx, 'highpass', hp);
  const g = ctx.createGain();
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  const t = ctx.currentTime;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(p).connect(out);
  src.start(t, rand(0, 0.06), dur + 0.02);
}

function chirp(engine, out, { from, to, dur, gain, pan, at = 0 }) {
  const { ctx } = engine;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  const t = ctx.currentTime + at;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(p).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

const RECIPES = {
  room_tone(e, out) {
    const src = e.noise('brown');
    const g = e.ctx.createGain();
    g.gain.value = 0.35;
    src.connect(filter(e.ctx, 'lowpass', 350)).connect(g).connect(out);
    return () => src.stop();
  },
  wind(e, out) {
    const src = e.noise('pink');
    const bp = filter(e.ctx, 'bandpass', 500, 0.6);
    const g = e.ctx.createGain();
    g.gain.value = 0.35;
    const a = lfo(e.ctx, 0.07, 260, bp.frequency);
    const b = lfo(e.ctx, 0.11, 0.22, g.gain);
    src.connect(bp).connect(g).connect(out);
    return () => [src, a, b].forEach((n) => n.stop());
  },
  rain(e, out) {
    const src = e.noise('white');
    const g = e.ctx.createGain();
    g.gain.value = 0.16;
    src.connect(filter(e.ctx, 'highpass', 900)).connect(filter(e.ctx, 'lowpass', 7000)).connect(g).connect(out);
    const stopDrops = every(e, 0.04, 0.12, () => burst(e, out, { hp: 2500, gain: rand(0.04, 0.12) }));
    return () => {
      src.stop();
      stopDrops();
    };
  },
  waves(e, out) {
    const src = e.noise('brown');
    const lp = filter(e.ctx, 'lowpass', 700);
    const g = e.ctx.createGain();
    g.gain.value = 0.33;
    const a = lfo(e.ctx, 0.09, 450, lp.frequency);
    const b = lfo(e.ctx, 0.09, 0.18, g.gain);
    src.connect(lp).connect(g).connect(out);
    return () => [src, a, b].forEach((n) => n.stop());
  },
  stream(e, out) {
    const src = e.noise('white');
    const g1 = e.ctx.createGain();
    g1.gain.value = 0.1;
    src.connect(filter(e.ctx, 'bandpass', 2400, 1.2)).connect(g1).connect(out);
    const g2 = e.ctx.createGain();
    g2.gain.value = 0.08;
    src.connect(filter(e.ctx, 'bandpass', 900, 0.8)).connect(g2).connect(out);
    const stopWobble = every(e, 0.06, 0.12, () => g2.gain.setTargetAtTime(rand(0.03, 0.12), e.ctx.currentTime, 0.03));
    return () => {
      src.stop();
      stopWobble();
    };
  },
  fire(e, out) {
    const src = e.noise('brown');
    const g = e.ctx.createGain();
    g.gain.value = 0.22;
    src.connect(filter(e.ctx, 'lowpass', 500)).connect(g).connect(out);
    const stopCrackle = every(e, 0.03, 0.25, () => burst(e, out, { hp: 1800, gain: rand(0.08, 0.35), dur: rand(0.004, 0.01) }));
    return () => {
      src.stop();
      stopCrackle();
    };
  },
  birds(e, out) {
    return every(e, 1.5, 6, () => {
      const pan = rand(-0.8, 0.8);
      const base = rand(2600, 4200);
      const n = Math.floor(rand(2, 6));
      for (let i = 0; i < n; i++) {
        chirp(e, out, { from: base * rand(0.95, 1.05), to: base * rand(1.15, 1.35), dur: rand(0.05, 0.11), gain: rand(0.03, 0.07), pan, at: i * rand(0.11, 0.18) });
      }
    });
  },
  crickets(e, out) {
    const stops = [-0.5, 0.45].map((pan) =>
      every(e, 0.7, 1.4, () => {
        for (let i = 0; i < 4; i++) chirp(e, out, { from: 4600, to: 4650, dur: 0.025, gain: 0.025, pan, at: i * 0.05 });
      }),
    );
    return () => stops.forEach((s) => s());
  },
  city(e, out) {
    const src = e.noise('brown');
    const g = e.ctx.createGain();
    g.gain.value = 0.3;
    src.connect(filter(e.ctx, 'lowpass', 220)).connect(g).connect(out);
    const stopCars = every(e, 6, 14, () => {
      const car = e.noise('pink');
      const bp = filter(e.ctx, 'bandpass', 300, 0.9);
      const cg = e.ctx.createGain();
      const p = e.ctx.createStereoPanner();
      const t = e.ctx.currentTime;
      const dir = Math.random() < 0.5 ? -1 : 1;
      p.pan.setValueAtTime(-dir, t);
      p.pan.linearRampToValueAtTime(dir, t + 3);
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.linearRampToValueAtTime(900, t + 1.5);
      bp.frequency.linearRampToValueAtTime(300, t + 3);
      cg.gain.setValueAtTime(0.0001, t);
      cg.gain.exponentialRampToValueAtTime(0.22, t + 1.5);
      cg.gain.exponentialRampToValueAtTime(0.0001, t + 3);
      car.connect(bp).connect(cg).connect(p).connect(out);
      setTimeout(() => car.stop(), 3500);
    });
    return () => {
      src.stop();
      stopCars();
    };
  },
  night_air(e, out) {
    const half = e.ctx.createGain();
    half.gain.value = 0.5;
    half.connect(out);
    const a = RECIPES.wind(e, half);
    const b = RECIPES.crickets(e, half);
    return () => {
      a();
      b();
    };
  },
  drips(e, out) {
    return every(e, 2, 6, () => SHOTS.drip(e, 0.6, out));
  },
};

function sweep(e, { kind = 'pink', type = 'lowpass', from, mid, to, dur, peak, out = e.master }) {
  const src = e.ctx.createBufferSource();
  src.buffer = e.buffers[kind];
  const f = filter(e.ctx, type, from, 0.8);
  const g = e.ctx.createGain();
  const t = e.ctx.currentTime;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(mid, t + dur * 0.5);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.1);
}

const SHOTS = {
  tick(e, gain) {
    burst(e, e.master, { hp: 900, gain: 0.25 * gain, pan: 0, dur: 0.03 });
  },
  unclip(e, gain) {
    burst(e, e.master, { hp: 3000, gain: 0.35 * gain, pan: 0, dur: 0.006 });
    setTimeout(() => burst(e, e.master, { hp: 2500, gain: 0.25 * gain, pan: 0, dur: 0.006 }), 70);
  },
  developed(e, gain) {
    sweep(e, { from: 400, mid: 1800, to: 400, dur: 1.2, peak: 0.18 * gain });
  },
  'step-in'(e, gain) {
    sweep(e, { type: 'bandpass', from: 200, mid: 2600, to: 900, dur: 1.6, peak: 0.3 * gain });
  },
  bloom(e, gain) {
    sweep(e, { from: 300, mid: 1500, to: 500, dur: 2.0, peak: 0.16 * gain });
  },
  revive(e, gain) {
    sweep(e, { kind: 'brown', from: 150, mid: 900, to: 300, dur: 3.2, peak: 0.4 * gain });
    sweep(e, { from: 500, mid: 3000, to: 800, dur: 2.6, peak: 0.1 * gain });
  },
  leave(e, gain) {
    sweep(e, { type: 'bandpass', from: 2600, mid: 900, to: 200, dur: 1.0, peak: 0.25 * gain });
  },
  drip(e, gain, out = e.master) {
    const o = e.ctx.createOscillator();
    const g = e.ctx.createGain();
    const t = e.ctx.currentTime;
    o.frequency.setValueAtTime(rand(800, 1100), t);
    o.frequency.exponentialRampToValueAtTime(rand(420, 520), t + 0.045);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1 * gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    const delay = e.ctx.createDelay(1);
    delay.delayTime.value = 0.19;
    const fb = e.ctx.createGain();
    fb.gain.value = 0.28;
    o.connect(g);
    g.connect(out);
    g.connect(delay).connect(fb).connect(delay);
    fb.connect(out);
    o.start(t);
    o.stop(t + 0.2);
    setTimeout(() => {
      delay.disconnect();
      fb.disconnect();
    }, 2000);
  },
};
