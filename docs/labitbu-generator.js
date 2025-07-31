class LabitbuGenerator {
  constructor() {
    this.labitbus = [];
    this.accessories = [];
  }

  setLabitbus(arr)     { this.labitbus   = arr.filter(x => x?.length); }
  setAccessories(arr)  { this.accessories = arr.filter(x => x?.length); }

  /**
   * @param {string} pubkey  hex‐encoded compressed Bitcoin pub-key
   * @returns {Promise<{bytes:Uint8Array, unpaddedBytes:Uint8Array, format:string}>}
   */
  async generate(pubkey) {
    if (!this.labitbus.length) throw new Error('No base images set');

    const TARGET_SIZE = 4096;
    const FORMAT = 'image/webp';

    const rng = await rngFromPubkey(pubkey);

    const baseIdx = rng.nextInt(this.labitbus.length);

    let accessoryIdx = -1;
    if (this.accessories.length) {
      const roll = rng.nextInt(this.accessories.length + 1);
      if (roll < this.accessories.length) accessoryIdx = roll;
    }

    const hueShiftDeg = Math.floor(rng.next() * 360);

    const baseImg = await this._loadImageFromHex(this.labitbus[baseIdx]);
    const { width, height } = baseImg;

    const canvas = await this._createImageFromSeed(
      hueShiftDeg,
      baseImg,
      accessoryIdx,
      width,
      height
    );

    const unpaddedBytes = await this._canvasToBytes(canvas, FORMAT, 0.95);

    if (unpaddedBytes.length >= TARGET_SIZE)
      throw new Error(
        `Generated image is ${unpaddedBytes.length} B - exceeds 4096 B cap`
      );

    const bytes = new Uint8Array(TARGET_SIZE);
    bytes.set(unpaddedBytes);

    return { bytes, unpaddedBytes, format: FORMAT };
  }

  async _createImageFromSeed(hueDeg, baseImg, accessoryIdx, w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');

    ctx.drawImage(baseImg, 0, 0, w, h);

    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;                        
      if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240)
        continue;

      const { s, l } = rgbToHsl(d[i], d[i + 1], d[i + 2]);
      const { r, g, b } = hslToRgb(hueDeg, Math.max(0.6, s), l);

      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
    ctx.putImageData(imgData, 0, 0);

    if (accessoryIdx !== -1) {
      const accImg = await this._loadImageFromHex(this.accessories[accessoryIdx]);
      ctx.drawImage(accImg, 0, 0, w, h);
    }
    return canvas;
  }

  _loadImageFromHex(hex) {
    return new Promise((res, rej) => {
      const bytes = hexToBytes(hex);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/webp' }));
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad img')); };
      img.src = url;
    });
  }

  _canvasToBytes(canvas, format, quality) {
    return new Promise(r =>
      canvas.toBlob(b => {
        const fr = new FileReader();
        fr.onload = () => r(new Uint8Array(fr.result));
        fr.readAsArrayBuffer(b);
      }, format, quality)
    );
  }
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; ++i) out[i] = parseInt(hex.substr(i << 1, 2), 16);
  return out;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > .5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      case b: h = ((r - g) / d + 4); break;
    }
    h *= 60;
  }
  return { h, s, l };
}

function hslToRgb(h, s, l) {
  h /= 360;
  let r, g, b;
  if (s === 0) r = g = b = l; else {
    const q = l < .5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = t => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    r = f(h + 1 / 3); g = f(h); b = f(h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

/* ───── PRNG: xoshiro128** ──────────────────────── */
const rotl = (x, k) => (x << k) | (x >>> (32 - k));

class Xoshiro128PP {
  constructor(s0, s1, s2, s3) {
    this.s0 = s0 >>> 0;
    this.s1 = s1 >>> 0;
    this.s2 = s2 >>> 0;
    this.s3 = s3 >>> 0;
  }

  next() {
    const res = ((this.s0 + this.s3) >>> 0) / 0x100000000;

    const t = (this.s1 << 9) >>> 0;

    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;

    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);

    return res;
  }

  nextInt(maxExclusive) {
    return Math.floor(this.next() * maxExclusive);
  }
}

async function rngFromPubkey(pubkeyHex) {
  const hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', hexToBytes(pubkeyHex))
  );
  const w = i =>
    (hash[i] |
      (hash[i + 1] << 8) |
      (hash[i + 2] << 16) |
      (hash[i + 3] << 24)) >>>
    0;
  return new Xoshiro128PP(w(0), w(4), w(8), w(12));
}