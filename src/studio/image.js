// Photo handling for the studio: decode (with phone rotation applied),
// resize, encode, and a few numbers about the picture.

export async function decodeImage(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Older Safari: an <img> applies the rotation itself.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } catch {
      throw new Error(`This browser cannot open "${file.name}". Choose a JPEG, PNG or WebP photo${/\.hei[cf]$/i.test(file.name) ? ' (an iPhone HEIC opens on the iPhone itself; on a laptop, save it as a JPEG first)' : ''}.`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export function resizeToCanvas(source, maxEdge) {
  const w = source.width;
  const h = source.height;
  const k = Math.min(1, maxEdge / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function jpegDataUrl(canvas, quality = 0.9) {
  return canvas.toDataURL('image/jpeg', quality);
}

// Five main colours, most common first (k-means on a small copy).
export function palette(canvas, k = 5) {
  const small = resizeToCanvas(canvas, 64);
  const d = small.getContext('2d').getImageData(0, 0, small.width, small.height).data;
  const px = [];
  for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
  let centers = Array.from({ length: k }, (_, j) => [...px[Math.floor(((j + 0.5) / k) * px.length)]]);
  let labels = new Array(px.length).fill(0);
  for (let iter = 0; iter < 10; iter++) {
    labels = px.map((p) => {
      let best = 0;
      let bestD = Infinity;
      centers.forEach((c, j) => {
        const dd = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (dd < bestD) {
          bestD = dd;
          best = j;
        }
      });
      return best;
    });
    centers = centers.map((c, j) => {
      const members = px.filter((_, i) => labels[i] === j);
      if (!members.length) return c;
      return [0, 1, 2].map((ch) => members.reduce((s, m) => s + m[ch], 0) / members.length);
    });
  }
  const counts = centers.map((_, j) => labels.filter((l) => l === j).length);
  return centers
    .map((c, j) => ({ c, n: counts[j] }))
    .sort((a, b) => b.n - a.n)
    .map(({ c }) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`);
}

// brightness 0..1, warmth > 0 when red outweighs blue
export function imageStats(canvas) {
  const small = resizeToCanvas(canvas, 48);
  const d = small.getContext('2d').getImageData(0, 0, small.width, small.height).data;
  let lum = 0;
  let warm = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    lum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    warm += (d[i] - d[i + 2]) / 255;
  }
  return { brightness: lum / n, warmth: warm / n };
}

// 35 mm equivalent focal length from the JPEG's EXIF (tag 0xA405), so the
// memory is stood up at the field of view the camera really had.
export async function readFocal35(file) {
  try {
    const buf = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (buf.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 < buf.byteLength) {
      const marker = buf.getUint16(off);
      const len = buf.getUint16(off + 2);
      if (marker === 0xffe1 && buf.getUint32(off + 4) === 0x45786966) return exifFocal(buf, off + 10);
      if ((marker & 0xff00) !== 0xff00) return null;
      off += 2 + len;
    }
  } catch {
    // no EXIF; the studio falls back to the lens guess
  }
  return null;
}

function exifFocal(buf, tiff) {
  const little = buf.getUint16(tiff) === 0x4949;
  const u16 = (o) => buf.getUint16(tiff + o, little);
  const u32 = (o) => buf.getUint32(tiff + o, little);
  const findTag = (ifd, tag) => {
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (u16(e) === tag) return e;
    }
    return -1;
  };
  const ifd0 = u32(4);
  const exifPtr = findTag(ifd0, 0x8769);
  if (exifPtr < 0) return null;
  const exifIfd = u32(exifPtr + 8);
  const f = findTag(exifIfd, 0xa405);
  if (f < 0) return null;
  const v = u16(f + 8);
  return v > 0 && v < 1000 ? v : null;
}

// A video becomes the frame a third of the way in; the studio works from one still.
export async function videoFrame(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  const wait = (event, ms) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`"${file.name}" could not be opened as a video here. Try a photo instead.`)), ms);
    v.addEventListener(event, () => { clearTimeout(t); resolve(); }, { once: true });
    v.addEventListener('error', () => { clearTimeout(t); reject(new Error(`"${file.name}" could not be opened as a video here. Try a photo instead.`)); }, { once: true });
  });
  try {
    await wait('loadeddata', 15000);
    const d = Number.isFinite(v.duration) ? v.duration : 0;
    if (d > 0.1) {
      v.currentTime = d / 3;
      await wait('seeked', 15000);
    }
    return await createImageBitmap(v);
  } finally {
    URL.revokeObjectURL(url);
  }
}
