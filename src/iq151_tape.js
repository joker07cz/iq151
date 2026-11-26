// iq151_tape.js — magnetofon IQ 151
//
// Zapojení (podle JIQ151 a rutin monitoru F538 / F56B):
//   PC1 výstup  — relé motoru magnetofonu (1 = běží)
//   PC0 výstup  — data na pásku; do magnetofonu jde přes klopný obvod
//                 taktovaný 1 kHz (vzestupná hrana), monitor proto čeká na PC5
//   PC7 vstup   — data z pásky (úroveň, ne detektor tónu)
//   PC5 vstup   — hodiny 1 kHz (jen když běží motor)
//   PC6, PC4    — při běžícím motoru 0 (klávesnice FA / SHIFT se nečte)
// Monitor posílá znaky jako sériovou linku 1000 Bd: klid 0, start 1,
// 8 datových bitů negovaně od nejnižšího. Na pásce je obyčejně Intel HEX
// (L / W), turbo zavaděče si čtou PC7 samy rychleji.
//
// Páska je seznam hran signálu v taktech CPU od začátku pásky a počáteční
// úroveň. Páska se posouvá, jen když je stisknuté PLAY / REC a zároveň
// sepnuté relé motoru (jako skutečný magnetofon s dálkovým ovládáním).

const WAV_RATE = 44100;
const WAV_PAD = 0.5;                    // ticho na začátku a konci WAV (s)
export const KHZ_HALF = 1024;           // půlperioda hodin 1 kHz (takty při 2,048 MHz)

export class Tape {
  constructor(clk) {
    this.clk = clk;
    this.motor = false;
    this.invert = false;                // obrácená polarita vstupu (nahrávky z magnetofonu)
    this.clear();
  }

  clear() {
    this.edges = new Float64Array(4096);
    this.count = 0;
    this.level0 = 0;                    // úroveň na začátku pásky
    this.length = 0;                    // délka nahrávky (takty)
    this.mode = 'stop';                 // 'stop' | 'play' | 'rec'
    this.pos = 0;                       // poloha pásky při posledním zastavení
    this.anchor = 0;                    // takt stroje, kdy se páska rozběhla
    this.cursor = -1;                   // poslední hrana ≤ poloha
    this.level = 0;                     // poslední zapsaná úroveň (nahrávání)
    this.name = null;
    this.dirty = false;
  }

  insert(edges, length, level0, name) {
    const motor = this.motor;
    this.clear();
    this.motor = motor;
    this.edges = edges.length ? Float64Array.from(edges) : new Float64Array(4096);
    this.count = edges.length;
    this.level0 = level0 ? 1 : 0;
    this.length = Math.max(length, this.count ? edges[this.count - 1] : 0);
    this.name = name;
  }

  get running() { return this.mode !== 'stop' && this.motor; }
  rebase(oldNow, newNow) { this.anchor += newNow - oldNow; }
  position(now) { return this.running ? this.pos + (now - this.anchor) : this.pos; }
  seconds(now) { return this.position(now) / this.clk; }

  // zastavit posuv (stop klávesou nebo vypnutím motoru), polohu zapamatovat
  freeze(now) {
    const p = this.position(now);
    if (this.mode === 'rec' && this.running) { this.length = p; this.dirty = true; }
    this.pos = this.mode === 'rec' ? p : Math.min(p, this.length);
    this.anchor = now;
  }

  setMotor(on, now) {
    on = !!on;
    if (on === this.motor) return;
    this.freeze(now);
    this.motor = on;
    this.anchor = now;
  }

  stop(now) {
    if (this.mode === 'stop') return;
    this.freeze(now);
    this.mode = 'stop';
  }

  rewind(now) { this.stop(now); this.pos = 0; }

  play(now) {
    this.stop(now);
    if (this.pos >= this.length) this.pos = 0;
    this.cursor = this.upper(this.pos) - 1;
    this.mode = 'play';
    this.anchor = now;
  }

  // Nahrávání maže pásku od aktuální polohy dál.
  record(now, level) {
    this.stop(now);
    this.count = this.upper(this.pos - 1e-9);
    if (this.pos === 0 || this.length === 0) { this.count = 0; this.level0 = level ? 1 : 0; }
    else if (this.levelAt(this.pos) !== (level ? 1 : 0)) this.push(this.pos);
    this.length = this.pos;
    this.level = level ? 1 : 0;
    this.mode = 'rec';
    this.anchor = now;
    this.dirty = true;
    if (!this.name) this.name = 'nahrávka';
  }

  push(t) {
    if (this.count === this.edges.length) {
      const bigger = new Float64Array(this.edges.length * 2);
      bigger.set(this.edges);
      this.edges = bigger;
    }
    this.edges[this.count++] = t;
  }

  // výstup z IQ (už po klopném obvodu 1 kHz); `at` ≤ teď
  output(level, at) {
    level = level ? 1 : 0;
    if (level === this.level) return;
    this.level = level;
    if (this.mode !== 'rec' || !this.running) return;
    const p = Math.max(this.position(at), this.count ? this.edges[this.count - 1] : 0);
    this.push(p);
  }

  levelAt(p) { return (this.level0 ^ (this.upper(p) & 1)); }

  // vstup do IQ (PC7)
  input(now) {
    if (this.mode !== 'play') return this.mode === 'rec' ? this.level : 0;
    const p = this.position(now), e = this.edges;
    let c = this.cursor;
    if (c >= 0 && e[c] > p) c = this.upper(p) - 1;
    while (c + 1 < this.count && e[c + 1] <= p) c++;
    this.cursor = c;
    // Dvoufázový kód na polaritě závisí: obrácená nahrávka (jiný magnetofon,
    // zesilovač, zvuková karta) se čte jako nesmysl, proto přepínač invert.
    return this.level0 ^ ((c + 1) & 1) ^ (this.invert ? 1 : 0);
  }

  atEnd(now) { return this.mode === 'play' && this.position(now) > this.length + 0.3 * this.clk; }

  upper(t) {
    let lo = 0, hi = this.count;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.edges[mid] <= t) lo = mid + 1; else hi = mid; }
    return lo;
  }
}

// ---------------------------------------------------------------- WAV
// Export: obdélník ±A podle úrovně, 44,1 kHz, 16 bitů, mono. Každý vzorek je
// průměr úrovně přes svůj úsek (hrana mezi vzorky nevyjde o vzorek vedle).
export function tapeToWav(tape) {
  const clk = tape.clk, rate = WAV_RATE, spc = clk / rate;
  const n = Math.ceil((tape.length / clk + 2 * WAV_PAD) * rate);
  const out = new Uint8Array(44 + n * 2);
  const dv = new DataView(out.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * 2, true);
  const A = 0x5000, e = tape.edges, count = tape.count, pad = WAV_PAD * clk;
  let k = 0, lvl = tape.level0;
  for (let i = 0; i < n; i++) {
    let a = i * spc - pad; const b = a + spc;
    let acc = 0;
    while (k < count && e[k] < b) {
      if (e[k] > a) { acc += lvl * (e[k] - a); a = e[k]; }
      lvl ^= 1; k++;
    }
    acc += lvl * (b - a);
    const y = (2 * acc / spc - 1) * A;
    dv.setInt16(44 + i * 2, Math.round(y), true);
  }
  return out;
}

// Import libovolného PCM / float WAV. Signál je NRZ (úroveň, ne tón), na
// skutečné kazetě ale prošel střídavou vazbou — práh proto plave uprostřed
// mezi klouzavým minimem a maximem (okno ~12 ms) a má hysterezi 15 % rozkmitu.
// Vrací { edges, length, level0 } v taktech.
export function wavToTape(buf, clk) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = o => String.fromCharCode(...bytes.subarray(o, o + 4));
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('není to soubor WAV');
  let fmt = null, data = null;
  for (let o = 12; o + 8 <= bytes.length;) {
    const id = tag(o), size = dv.getUint32(o + 4, true), body = o + 8;
    if (id === 'fmt ') {
      let format = dv.getUint16(body, true);
      if (format === 0xFFFE && size >= 26) format = dv.getUint16(body + 24, true);
      fmt = { format, channels: dv.getUint16(body + 2, true), rate: dv.getUint32(body + 4, true),
              align: dv.getUint16(body + 12, true), bits: dv.getUint16(body + 14, true) };
    } else if (id === 'data') {
      data = { start: body, size: Math.min(size, bytes.length - body) };
    }
    o = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('WAV bez formátu nebo dat');
  const { format, channels, rate, align, bits } = fmt;
  const width = bits >> 3;
  const read = format === 3
    ? (bits === 64 ? o => dv.getFloat64(o, true) : bits === 32 ? o => dv.getFloat32(o, true) : null)
    : format === 1
      ? bits === 8 ? o => (bytes[o] - 128) / 128
      : bits === 16 ? o => dv.getInt16(o, true) / 32768
      : bits === 24 ? o => ((bytes[o] | bytes[o + 1] << 8 | bytes[o + 2] << 16) << 8 >> 8) / 8388608
      : bits === 32 ? o => dv.getInt32(o, true) / 2147483648 : null
      : null;
  if (!read || !channels || !rate || align < channels * width) throw new Error(`nepodporovaný WAV (formát ${format}, ${bits} bitů)`);
  if (rate < 8000) throw new Error(`WAV má jen ${rate} Hz`);
  const n = Math.floor(data.size / align);
  if (!n) throw new Error('WAV je prázdný');

  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = data.start + i * align;
    let s = 0;
    for (let c = 0; c < channels; c++) s += read(o + c * width);
    x[i] = s / channels;
  }

  // klouzavé min / max (monotónní fronty) přes okno W vzorků
  const W = Math.max(8, Math.round(rate * 0.012));
  const qmax = new Int32Array(n), qmin = new Int32Array(n);
  let hM = 0, tM = 0, hm = 0, tm = 0;
  let global = 0;
  for (let i = 0; i < n; i++) global = Math.max(global, Math.abs(x[i]));
  if (global < 0.01) throw new Error('ve WAV není slyšet žádný signál');
  const floor = 0.05 * global;          // menší rozkmit = ticho, úroveň se nemění
  const scale = clk / rate, edges = [];
  let state = null, level0 = 0;
  for (let i = 0; i < n; i++) {
    while (tM > hM && x[qmax[tM - 1]] <= x[i]) tM--; qmax[tM++] = i;
    while (tm > hm && x[qmin[tm - 1]] >= x[i]) tm--; qmin[tm++] = i;
    if (qmax[hM] <= i - W) hM++;
    if (qmin[hm] <= i - W) hm++;
    const hi = x[qmax[hM]], lo = x[qmin[hm]], span = hi - lo;
    if (span < floor) continue;
    const mid = (hi + lo) / 2, h = 0.15 * span;
    if (state === null) {
      if (x[i] > mid + h) { state = true; level0 = 1; }
      else if (x[i] < mid - h) { state = false; level0 = 0; }
    } else if (!state && x[i] > mid + h) { state = true; edges.push(i * scale); }
    else if (state && x[i] < mid - h) { state = false; edges.push(i * scale); }
  }
  return { edges: Float64Array.from(edges), length: n * scale, level0 };
}

// ---------------------------------------------------------------- CSW
// Compressed Square Wave v1.01 (RLE) a v2 (RLE / Z-RLE). Každý bajt je délka
// pulzu ve vzorcích, 0 = následuje 32bitová délka. Úroveň se po pulzu mění.
export async function cswToTape(buf, clk) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const sig = 'Compressed Square Wave';
  if (b.length < 0x20 || String.fromCharCode(...b.subarray(0, 22)) !== sig || b[22] !== 0x1a) throw new Error('není to soubor CSW');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const major = b[23];
  let rate, comp, flags, start;
  if (major === 1) {
    rate = dv.getUint16(0x19, true); comp = b[0x1b]; flags = b[0x1c]; start = 0x20;
  } else if (major === 2) {
    rate = dv.getUint32(0x19, true); comp = b[0x21]; flags = b[0x22]; start = 0x34 + b[0x23];
  } else throw new Error(`nepodporovaná verze CSW ${major}`);
  if (!rate) throw new Error('CSW bez vzorkovací frekvence');
  let data = b.subarray(start);
  if (comp === 2) data = await inflate(data);
  else if (comp !== 1) throw new Error(`nepodporovaná komprese CSW ${comp}`);
  const scale = clk / rate, edges = [];
  let t = 0;
  for (let i = 0; i < data.length;) {
    let len = data[i++];
    if (len === 0) {
      if (i + 4 > data.length) break;
      len = data[i] | data[i + 1] << 8 | data[i + 2] << 16 | (data[i + 3] << 24 >>> 0); i += 4;
    }
    t += len;
    edges.push(t * scale);
  }
  const last = edges.pop() ?? 0;           // po posledním pulzu už žádná hrana
  // Příznak počáteční polarity se nepoužije: Hexbin2WAV ho zapisuje 0, i když
  // jeho WAV začíná vysokou úrovní, a JIQ151 ho také ignoruje (první pulz =
  // vysoká úroveň). Dvoufázový kód na polaritě závisí, takže platí první pulz = 1.
  void flags;
  return { edges: Float64Array.from(edges), length: last, level0: 1 };
}

async function inflate(data) {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([data]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
