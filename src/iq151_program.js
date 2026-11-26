// iq151_program.js — programy zaváděné přímo do RAM (bez magnetofonu).
//
//   .hex / .ihx  Intel HEX (start = záznam 03/05, nebo adresa EOF jako u L)
//   .bin         blokový BIN jako u Ondry: [01 adr16 délka16 data…]… [02 start16]
//                (vše little-endian); soubor bez platné blokové struktury se
//                bere jako prostý obraz paměti od zadané adresy
//   .hexbin      Intel HEX (turbo zavaděč) a za EOF záznamem blokový BIN
//                (tak je vyrábí Hexbin2WAV); zavedou se obě části a startuje
//                se z bloku 02, jinak z adresy EOF
// Výsledek má stejný tvar jako parseIntelHex, takže ho instaluje installIntelHex.
import { parseIntelHex } from './intel_hex.js';

const h4 = n => n.toString(16).toUpperCase().padStart(4, '0');

export function parseBlockBin(data) {
  const blocks = [];
  let pos = 0, start = null;
  while (pos < data.length) {
    const typ = data[pos++];
    if (typ === 0x01) {
      if (pos + 4 > data.length) throw new Error('BIN: neúplná hlavička bloku');
      const addr = data[pos] | data[pos + 1] << 8, len = data[pos + 2] | data[pos + 3] << 8;
      pos += 4;
      if (pos + len > data.length) throw new Error(`BIN: blok ${blocks.length + 1} má ${len} B, v souboru je jen ${data.length - pos} B`);
      if (addr + len > 0x10000) throw new Error(`BIN: blok ${blocks.length + 1} přesahuje konec paměti`);
      blocks.push({ addr, data: data.subarray(pos, pos + len) });
      pos += len;
    } else if (typ === 0x02) {
      if (pos + 2 > data.length) throw new Error('BIN: neúplná startovací adresa');
      start = data[pos] | data[pos + 1] << 8;
      pos += 2;
      break;
    } else throw new Error(`BIN: neznámý typ bloku ${typ.toString(16).padStart(2, '0')}h na pozici ${pos - 1}`);
  }
  if (!blocks.length) throw new Error('BIN neobsahuje žádný blok');
  return { blocks, start };
}

function fromMap(map, entry, explicitEntry, kind) {
  if (!map.size) throw new Error('soubor neobsahuje žádná data');
  const ordered = [...map].sort((a, b) => a[0] - b[0]);
  const ranges = [];
  for (const [address] of ordered) {
    const last = ranges[ranges.length - 1];
    if (last && address === last.end + 1) last.end = address;
    else ranges.push({ start: address, end: address });
  }
  return { bytes: ordered, ranges, size: ordered.length, entry: entry ?? ordered[0][0], explicitEntry, kind };
}

function addBlocks(map, blocks) {
  for (const b of blocks) for (let i = 0; i < b.data.length; i++) map.set(b.addr + i, b.data[i]);
}

// Nalezne konec textové části Intel HEX (za EOF záznamem a koncem řádku).
function splitHexBin(data) {
  let i = 0;
  while (i < data.length) {
    let j = i;
    while (j < data.length && data[j] !== 0x0a && data[j] !== 0x0d) j++;
    const line = String.fromCharCode(...data.subarray(i, Math.min(j, i + 64))).trim();
    while (j < data.length && (data[j] === 0x0a || data[j] === 0x0d)) j++;
    if (/^:00[0-9A-Fa-f]{4}01[0-9A-Fa-f]{2}$/.test(line)) return j;
    if (line && line[0] !== ':') throw new Error('HEXBIN: před binární částí chybí EOF záznam Intel HEX');
    i = j;
  }
  return data.length;
}

// name = jméno souboru (rozhoduje přípona), data = Uint8Array,
// rawBase = adresa pro prostý BIN bez blokové hlavičky.
export function parseProgram(name, data, rawBase = 0x0100) {
  const ext = (name.match(/\.([A-Za-z0-9]+)$/)?.[1] || '').toLowerCase();
  const looksHex = data[0] === 0x3a || (data[0] === 0xef && data[3] === 0x3a);
  if (ext === 'hexbin' || (looksHex && ext === 'bin')) {
    const cut = splitHexBin(data);
    const text = new TextDecoder('latin1').decode(data.subarray(0, cut));
    const hex = parseIntelHex(text);
    const map = new Map(hex.bytes);
    let entry = hex.explicitEntry ? hex.entry : null, explicit = hex.explicitEntry;
    if (cut < data.length) {
      const bin = parseBlockBin(data.subarray(cut));
      addBlocks(map, bin.blocks);
      if (bin.start !== null) { entry = bin.start; explicit = true; }
    }
    return fromMap(map, entry, explicit, 'HEXBIN');
  }
  if (ext === 'hex' || ext === 'ihx' || looksHex) {
    return { ...parseIntelHex(new TextDecoder('latin1').decode(data)), kind: 'HEX' };
  }
  // BIN: nejdřív bloková struktura, jinak prostý obraz od rawBase
  if (data[0] === 0x01) {
    try {
      const bin = parseBlockBin(data);
      const map = new Map(); addBlocks(map, bin.blocks);
      return fromMap(map, bin.start, bin.start !== null, 'BIN');
    } catch { /* není blokový — prostý obraz */ }
  }
  if (rawBase + data.length > 0x10000) throw new Error(`BIN ${data.length} B se od ${h4(rawBase)}h nevejde do paměti`);
  const map = new Map();
  for (let i = 0; i < data.length; i++) map.set(rawBase + i, data[i]);
  return { ...fromMap(map, rawBase, false, 'BIN'), raw: true };
}
