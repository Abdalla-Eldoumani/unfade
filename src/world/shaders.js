import * as THREE from 'three';

// What the haze around a memory works out for every pixel it covers, the
// fourth lever if the headset drops frames: 2 the photo's own blur with the
// ragged bloom edges behind the photo, 1 the blur without them, 0 one flat colour.
const HAZE_DETAIL = 2;

// Behind the photo, where depth edges open, the haze shows the photo again.
// From where the camera stood that copy lines up and hides the gaps; once the
// head moves it reads as a second copy beside the first (a ghost cup by the
// cup). At 1 the haze there goes as soft as the haze around the photo as the
// eyes move 0.03 to 0.2 m away. 0 switches this off.
const GAP_BLUR = 1;

// All colour maths happens in linear space; each fragment shader ends with
// colorspace_fragment so three converts to the display's sRGB.
const DITHER = /* glsl */ `
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

const FADED = /* glsl */ `
  // How an old print looks: colour drained, lifted toward the paper, yellowed.
  vec3 fadedLook(vec3 c, vec3 paper, vec3 tint) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return mix(mix(vec3(l), c, 0.22), paper, 0.38) * tint;
  }
`;

// How far colour has come back at a point of the photo: the base level, or
// an uneven, ink-like front spreading out from each bloomed anchor.
const BLOOM = /* glsl */ `
  uniform vec4 uBloom[3];
  uniform float uAspect;
  float bloomAt(vec2 uv, float base) {
    float local = base;
    float ragged = (vnoise(uv * 9.0) - 0.5) * 0.14 + (vnoise(uv * 37.0) - 0.5) * 0.04;
    for (int i = 0; i < 3; i++) {
      vec2 d = (uv - uBloom[i].xy) * vec2(uAspect, 1.0);
      float k = 1.0 - smoothstep(uBloom[i].z - 0.22, uBloom[i].z, length(d) + ragged);
      local = max(local, k * uBloom[i].w);
    }
    return local;
  }
`;

export const AGE_CAST = new THREE.Vector3(1.03, 0.97, 0.86);
export const PAPER = new THREE.Color('#f1e9dc');

// Instant print developing in the hand. uDevelop 0 = blank cream, 1 = full photo.
export function printMaterial(map, { crop = [1, 1], offset = [0, 0] } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uDevelop: { value: 0.3 },
      uWarm: { value: 0 },
      uCream: { value: new THREE.Color('#e9e1d3') },
      uCrop: { value: new THREE.Vector2(...crop) },
      uOffset: { value: new THREE.Vector2(...offset) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uDevelop;
      uniform float uWarm;
      uniform vec3 uCream;
      uniform vec2 uCrop;
      uniform vec2 uOffset;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(uMap, uOffset + vUv * uCrop).rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        vec3 ghost = mix(uCream, mix(vec3(l), c, 0.2) * vec3(0.86, 0.95, 1.05), smoothstep(0.0, 0.5, uDevelop) * 0.8);
        vec3 col = mix(ghost, c, smoothstep(0.3, 1.0, uDevelop));
        col *= mix(vec3(1.0), vec3(1.06, 1.0, 0.92), uWarm);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

// The photo stood up in 3D. Starts faded and blurred; each bloom spreads
// colour out from an anchor like ink in water. Stretched triangles at depth
// edges are cut, showing the haze behind instead of smearing.
export function memoryMaterial(photo, { aspect, palette }) {
  return new THREE.ShaderMaterial({
    // Drawn with the opaque pass, right after the haze behind it, but blended:
    // its rim dissolves into that haze, and anything drawn later (lights,
    // particles, words) still sorts against its depth.
    transparent: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      uPhoto: { value: photo },
      uVivid: { value: 0 },
      uBloom: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
      uAspect: { value: aspect },
      uTime: { value: 0 },
      uPaper: { value: PAPER.clone() },
      uCast: { value: AGE_CAST.clone() },
      uFadeIn: { value: 0 },
      uTint: { value: new THREE.Color(palette?.[0] || '#c77f4b') },
    },
    vertexShader: /* glsl */ `
      attribute float aEdge;
      varying vec2 vUv;
      varying float vEdge;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vEdge = aEdge;
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uPhoto;
      uniform float uVivid;
      uniform float uTime;
      uniform vec3 uPaper;
      uniform vec3 uCast;
      uniform float uFadeIn;
      varying vec2 vUv;
      varying float vEdge;
      varying vec3 vWorldPos;
      ${DITHER}
      ${FADED}
      ${BLOOM}
      void main() {
        // fade out triangles viewed edge-on: the depth cliffs at the cup/cat
        // boundary are nearly perpendicular to the camera and look like spikes
        // from behind. Screen-space derivatives give the face normal.
        vec3 fdx = dFdx(vWorldPos);
        vec3 fdy = dFdy(vWorldPos);
        vec3 faceN = normalize(cross(fdx, fdy));
        float facing = abs(dot(faceN, normalize(cameraPosition - vWorldPos)));
        float angleFade = smoothstep(0.02, 0.18, facing);

        float local = bloomAt(vUv, uVivid);
        // progressively blur stretched triangles at depth edges
        float edgeBlur = smoothstep(0.15, 0.6, vEdge) * 5.0;
        vec3 c = texture2D(uPhoto, vUv, (1.0 - local) * 2.4 + edgeBlur).rgb;
        vec3 col = mix(fadedLook(c, uPaper, uCast), c, local);
        col += (hash(vUv * 1024.0 + fract(uTime * 7.0)) - 0.5) * mix(0.06, 0.015, local);
        // The rim dissolves over a wide, uneven margin with rounded corners,
        // like the edge of a print left in the sun, so no rectangle shows.
        vec2 q = abs(vUv - 0.5) * 2.0;
        float r = pow(pow(q.x, 6.0) + pow(q.y, 6.0), 1.0 / 6.0) + (vnoise(vUv * 7.0) - 0.5) * 0.08;
        float rim = 1.0 - smoothstep(0.78, 1.0, r);
        // Depth cliffs and edge-on triangles are cut, not blended: what is
        // behind them has to show, and a half-clear cliff reads as a ghost.
        float edgeFade = 1.0 - smoothstep(0.3, 0.85, vEdge);
        if (edgeFade * angleFade < ign(gl_FragCoord.xy)) discard;
        float alpha = rim * uFadeIn;
        if (alpha < 0.003) discard;
        gl_FragColor = vec4(max(col, 0.0), alpha);
        #include <colorspace_fragment>
      }
    `,
  });
}

// Inside of a big sphere: the world around the photo. A panorama (the
// memory's own env.jpg, or one from public/environments) or, without one,
// the palette's sky and ground. Near the photo the world is out of focus,
// graded toward the photo's colours, and the photo's own edge colours run out
// into it; further out it sharpens. Behind the photo it matches the photo's
// own look (faded or back), so the gaps at depth edges read as soft focus.
// uBloom should be the memory material's own uniform, shared.
// plate, if given, is the background plate (depth-mesh.js): shown through the
// gaps instead of the photo once the head moves.
export function peripheryMaterial(photo, { tanH, tanV, env, maxDim, aspect, bloom, plate = null, envMap = null, envYaw = 0 }) {
  const plateDim = plate ? Math.max(plate.image.width, plate.image.height) : 1;
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    defines: { HAZE_DETAIL, GAP_BLUR: GAP_BLUR.toFixed(2), GAP_FILL: plate ? 1 : 0, HAS_ENV_MAP: envMap ? 1 : 0 },
    uniforms: {
      uPhoto: { value: photo },
      uPlate: { value: plate },
      uPlateShift: { value: Math.max(0, Math.log2((maxDim || 512) / plateDim)) },
      uLod: { value: Math.max(1, Math.log2(maxDim || 512) - 3.2) },
      uTan: { value: new THREE.Vector2(tanH, tanV) },
      uEnvMap: { value: envMap },
      uEnvYaw: { value: envYaw },
      uTop: { value: env?.top ?? new THREE.Color('#3a2c22') },
      uMid: { value: env?.mid ?? new THREE.Color('#2b1d16') },
      uBot: { value: env?.bot ?? new THREE.Color('#140d09') },
      uPaper: { value: PAPER.clone() },
      uCast: { value: AGE_CAST.clone() },
      uVivid: { value: 0 },
      uCore: { value: 0 },
      uFadeIn: { value: 0 },
      uAspect: { value: aspect },
      uBloom: bloom,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      varying float vLean;
      void main() {
        vDir = position;
        vLean = distance(cameraPosition, (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uPhoto;
      uniform sampler2D uPlate;
      uniform sampler2D uEnvMap;
      uniform float uEnvYaw;
      uniform vec3 uTop;
      uniform vec3 uMid;
      uniform vec3 uBot;
      uniform float uPlateShift;
      uniform float uLod;
      uniform vec2 uTan;
      uniform vec3 uPaper;
      uniform vec3 uCast;
      uniform float uVivid;
      uniform float uCore;
      uniform float uFadeIn;
      varying vec3 vDir;
      varying float vLean;
      ${DITHER}
      ${FADED}
      ${BLOOM}

      // Equirectangular: a direction to panorama UV, turned by uEnvYaw
      vec2 envUV(vec3 dir) {
        float phi = atan(dir.z, dir.x);
        float theta = asin(clamp(dir.y, -1.0, 1.0));
        return vec2(phi / 6.2831853 + 0.5 + uEnvYaw, theta / 3.1415926 + 0.5);
      }

      // An explicit level of detail: blur on demand, and no seam where the
      // panorama's two ends meet (a derivative-picked level breaks there)
      vec3 surroundings(vec3 d, float lod) {
        #if HAS_ENV_MAP
        return textureLod(uEnvMap, envUV(d), lod).rgb;
        #else
        return d.y > 0.0 ? mix(uMid, uTop, smoothstep(0.0, 0.7, d.y)) : mix(uMid, uBot, smoothstep(0.0, -0.5, d.y));
        #endif
      }

      void main() {
        vec3 d = normalize(vDir);
        float forward = smoothstep(0.0, -0.2, d.z);
        vec2 p = d.xy / max(0.05, -d.z);
        vec2 uv = 0.5 + p / (2.0 * uTan);
        // Distance from the photo in photo half-sizes: 0 at its centre, 1 at
        // its edge, with rounded corners and an uneven rim.
        vec2 q = abs(uv - 0.5) * 2.0;
        float edgeD = pow(pow(q.x, 4.0) + pow(q.y, 4.0), 0.25) + (vnoise(uv * 2.6) - 0.5) * 0.18;
        edgeD = mix(4.0, edgeD, forward);
        float near = 1.0 - smoothstep(0.9, 2.6, edgeD);

        vec3 world = surroundings(d, mix(0.0, 6.5, near));
        #if HAS_ENV_MAP
        vec3 worldMean = textureLod(uEnvMap, vec2(0.5), 20.0).rgb;
        #else
        vec3 worldMean = uMid;
        #endif
        // Match the photo's brightness, and only some of its colour cast, so
        // a bright room stays a room and does not turn the colour of the cup.
        // Near the photo the match is against what sits right behind it, so
        // a lit street does not glow around a dark night photo.
        vec3 photoMean = textureLod(uPhoto, vec2(0.5), 20.0).rgb;
        vec3 worldAhead = surroundings(vec3(0.0, 0.0, -1.0), 7.0);
        worldMean = mix(worldMean, worldAhead, near);
        float lumP = max(dot(photoMean, vec3(0.2126, 0.7152, 0.0722)), 0.02);
        float lumW = max(dot(worldMean, vec3(0.2126, 0.7152, 0.0722)), 0.02);
        vec3 tint = (photoMean / lumP) / max(worldMean / lumW, vec3(0.05));
        vec3 grade = clamp(vec3(lumP / lumW) * mix(vec3(1.0), tint, 0.3), vec3(0.15), vec3(2.0));
        world *= mix(vec3(1.0), grade, 0.45 + 0.4 * near);

        vec3 col = world;
        float inside = 0.0;
        float local = uVivid;
        #if HAZE_DETAIL > 0
        // Photo projection: forward rays use the real projection, sides and
        // rear clamp to the nearest edge at heavy blur
        vec2 outside = max(abs(uv - 0.5) - 0.5, 0.0) * 2.0 * uTan;
        inside = 1.0 - clamp(length(outside) * 3.0, 0.0, 1.0);
        float lean = smoothstep(0.03, 0.2, vLean);
        float edgeBlur = smoothstep(0.45, 1.0, edgeD) * 4.0;
        float lod = mix(uLod + 2.0, mix(2.5, uLod, GAP_BLUR * lean), inside * forward) + edgeBlur;
        vec3 c = textureLod(uPhoto, clamp(uv, 0.0, 1.0), lod).rgb;
        #if GAP_FILL
        vec3 behind = textureLod(uPlate, clamp(uv, 0.0, 1.0), max(0.0, lod - uPlateShift)).rgb;
        c = mix(c, behind, inside * lean * forward);
        #endif
        // the photo's edge colours run out into the haze before the world takes over
        vec3 photoEdge = textureLod(uPhoto, clamp(uv, 0.0, 1.0), uLod + 3.0).rgb;
        vec3 haze = mix(world, photoEdge, (1.0 - smoothstep(0.85, 1.7, edgeD)) * 0.45 * forward);
        // the blurred copy ends where the photo's own rim ends, so no band
        // of it is left standing around the photo
        float w = (1.0 - smoothstep(0.75, 1.05, edgeD)) * forward;
        col = mix(haze, c, w);
        inside = w;
        #if HAZE_DETAIL > 1
        local = mix(uVivid, bloomAt(clamp(uv, 0.0, 1.0), uCore), inside * forward);
        #else
        local = mix(uVivid, uCore, inside * forward);
        #endif
        #endif
        col = mix(fadedLook(col, uPaper * mix(0.4, 1.0, inside), uCast), col, local);
        col += (ign(gl_FragCoord.xy) - 0.5) * 0.012 * max(0.15, dot(col, vec3(0.3, 0.6, 0.1)));
        gl_FragColor = vec4(max(col, 0.0) * uFadeIn, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

export const PARTICLE_TYPES = { dust: 0, snow: 1, rain: 2, fireflies: 3, confetti: 4, petals: 5, mist: 6 };

export function particleMaterial({ type, colors }) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: type === 'fireflies' || type === 'dust' ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uType: { value: PARTICLE_TYPES[type] ?? 0 },
      uSize: { value: type === 'mist' ? 0.05 : 0.012 },
      uScale: { value: 600 },
      uOpacity: { value: 0 },
      uBoxMin: { value: new THREE.Vector3(-4, -0.2, -7) },
      uBoxSize: { value: new THREE.Vector3(8, 3.6, 9) },
      uColors: { value: colors.map((c) => new THREE.Color(c)) },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform int uType;
      uniform float uSize;
      uniform float uScale;
      uniform vec3 uBoxMin;
      uniform vec3 uBoxSize;
      uniform vec3 uColors[4];
      attribute vec3 aSeed;
      attribute float aColor;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vec3 p = position;
        float t = uTime;
        float size = uSize;
        float alpha = 1.0;
        if (uType == 0) {
          p += vec3(sin(t * 0.13 + aSeed.x * 6.28), sin(t * 0.09 + aSeed.y * 6.28) * 0.6, cos(t * 0.11 + aSeed.z * 6.28)) * 0.25;
          alpha = 0.5 + 0.5 * sin(t * 0.7 + aSeed.y * 20.0);
        } else if (uType == 1) {
          p.y -= t * (0.25 + aSeed.x * 0.25);
          p.x += sin(t * 0.6 + aSeed.y * 6.28) * 0.15;
        } else if (uType == 2) {
          p.y -= t * (4.0 + aSeed.x * 2.0);
          size *= 0.6;
          alpha = 0.45;
        } else if (uType == 3) {
          p += vec3(sin(t * 0.4 + aSeed.x * 6.28), sin(t * 0.3 + aSeed.y * 6.28), cos(t * 0.35 + aSeed.z * 6.28)) * 0.4;
          alpha = pow(max(0.0, sin(t * 1.3 + aSeed.z * 30.0)), 6.0);
          size *= 1.4;
        } else if (uType == 4) {
          p.y -= t * (0.35 + aSeed.x * 0.3);
          p.x += sin(t * 1.7 + aSeed.y * 6.28) * 0.12;
          alpha = 0.6 + 0.4 * abs(sin(t * 3.0 + aSeed.z * 6.28));
        } else if (uType == 5) {
          p.y -= t * (0.18 + aSeed.x * 0.15);
          p.x += sin(t * 0.8 + aSeed.y * 6.28) * 0.3;
          size *= 1.3;
        } else if (uType == 6) {
          p.x += t * 0.05 * (aSeed.x - 0.5);
          size *= 1.0 + aSeed.y;
          alpha = 0.08;
        }
        p = uBoxMin + mod(p - uBoxMin, uBoxSize);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(size * projectionMatrix[1][1] * uScale / max(0.15, -mv.z), 1.0, 96.0);
        gl_Position = projectionMatrix * mv;
        vAlpha = alpha;
        vColor = uColors[int(aColor)];
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        gl_FragColor = vec4(vColor, smoothstep(0.5, 0.0, d) * vAlpha * uOpacity);
        #include <colorspace_fragment>
      }
    `,
  });
}

// Thin ring that fills clockwise while you look at an anchor.
export function ringMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uProgress: { value: 0 }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0.9 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uProgress;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv - 0.5;
        float a = fract(0.25 - atan(p.y, p.x) / 6.2831853);
        float on = step(a, uProgress);
        gl_FragColor = vec4(uColor, uOpacity * mix(0.22, 1.0, on));
        #include <colorspace_fragment>
      }
    `,
  });
}
