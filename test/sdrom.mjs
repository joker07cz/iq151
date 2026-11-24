// SD-ROM (porty F8–FB) nad virtuálním diskem: načtení loaderu monitorem, výpis adresáře,
// načtení HEX souboru správcem SD-ROM a ukládání IQ → SD (BASIC i HEX).
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { IQ151 } from '../src/iq151.js';
import { SdDisk } from '../src/sd_disk.js';

const rd = p => new Uint8Array(fs.readFileSync(new URL(p, import.meta.url)));
const enc = s => new TextEncoder().encode(s);
const dec = b => new TextDecoder().decode(b);
// Zkušební HEX: 300 bajtů vzoru na 3000 (několik záznamů) a smyčka JMP 2200 na 2200.
const record = (addr, type, data) => {
  const b = [data.length, addr >> 8, addr & 255, type, ...data];
  return ':' + [...b, (-b.reduce((a, c) => a + c, 0)) & 255].map(x => x.toString(16).toUpperCase().padStart(2, '0')).join('');
};
const pattern = Array.from({ length: 300 }, (_, i) => (i * 7 + 3) & 255);
const lines = [record(0x2200, 0, [0xc3, 0x00, 0x22])];
for (let o = 0; o < pattern.length; o += 32) lines.push(record(0x3000 + o, 0, pattern.slice(o, o + 32)));
lines.push(record(0, 1, []));
const testHex = enc(lines.join('\r\n') + '\r\n');

// --- virtuální disk -------------------------------------------------------
const disk = new SdDisk({ loader: rd('../programs/__BLOADER.BAS') });
disk.write('/HELLO.BAS', enc('10 PRINT 1\r\n\x1b'));
disk.write('/TEST.HEX', testHex);
disk.write('/games/Manic.hex', enc(':00000001FF\r\n'));
assert.deepEqual(disk.list('/'), { dirs: ['games'], files: ['__BLOADER.BAS', 'HELLO.BAS', 'TEST.HEX'] });
assert.deepEqual(disk.read('/GAMES/MANIC.HEX'), enc(':00000001FF\r\n'), 'jména bez ohledu na velikost písmen');
assert.equal(disk.read('/../../hello.bas').length, 13, '.. nevyleze nad kořen');
assert.equal(disk.nextSaveNumber(), 1);

// --- stroj ----------------------------------------------------------------
const iq = new IQ151();
iq.loadMonitor(rd('../roms/Monitor-std.rom'));
iq.attachSdRom(disk);
iq.reset();
const advance = n => { for (let i = 0; i < n; i++) iq.advanceWallTime(20); };
const press = (key, code, keyCode) => { iq.setBrowserKey({ key, code, keyCode }, true); advance(5); iq.setBrowserKey({ key, code, keyCode }, false); advance(12); };
const type = s => { for (const ch of s) press(ch, 'char-' + ch); press('Enter', 'Enter'); advance(20); };
const screen = () => Array.from({ length: 32 }, (_, r) => Array.from(iq.vram.slice(r * 32, r * 32 + 32), x => String.fromCharCode(x & 0x7f)).join('')).join('\n');

advance(90);
assert.match(screen(), /^MONITOR/);

// Monitor: vstupní zařízení = páska/Staper ((0003)=55), příkaz L načte __BLOADER.BAS
iq.ram[3] = 0x55;
type('L');
advance(500);
assert.match(screen(), /SD-ROM Manager/, 'loader z SD-ROM nastartoval správce');
assert.equal(iq.ram[0x1000], 0xcd, 'HEX z loaderu je v RAM na 1000');
assert.match(screen(), /games/);
assert.match(screen(), /HELLO\.BAS/);
assert.match(screen(), /TEST\.HEX/);
assert.doesNotMatch(screen(), /BLOADER/, 'loader se ve výpisu neukazuje');

// vybrat TEST.HEX (games, HELLO.BAS, TEST.HEX) a načíst
press('ArrowDown', 'ArrowDown', 40); advance(50);
press('ArrowDown', 'ArrowDown', 40); advance(50);
press('Enter', 'Enter', 13); advance(1500);
for (let i = 0; i < pattern.length; i++) assert.equal(iq.ram[0x3000 + i], pattern[i], `TEST.HEX @${(0x3000 + i).toString(16)}`);
assert.deepEqual(Array.from(iq.ram.slice(0x2200, 0x2203)), [0xc3, 0x00, 0x22]);
assert.equal(iq.sdrom.done, true, 'po odeslání souboru ATmega končí');

// --- ukládání IQ → SD -----------------------------------------------------
// Krátký program v RAM volá rutinu monitoru F6D9 (výstup znaku na děrovač) pro každý bajt tabulky.
function punch(text, zeros) {
  const data = Uint8Array.from([...enc(text), ...new Array(zeros).fill(0)]);
  const prog = [
    0x21, 0x20, 0x21,          // 2100 LXI H,2120
    0x06, data.length,         // 2103 MVI B,len
    0x4e,                      // 2105 MOV C,M
    0xcd, 0xd9, 0xf6,          // 2106 CALL F6D9
    0x23,                      // 2109 INX H
    0x05,                      // 210A DCR B
    0xc2, 0x05, 0x21,          // 210B JNZ 2105
    0xc3, 0x0e, 0x21,          // 210E JMP 210E
  ];
  prog.forEach((b, i) => { iq.ram[0x2100 + i] = b; });
  data.forEach((b, i) => { iq.ram[0x2120 + i] = b; });
  iq.cpu.pc = 0x2100;
}

// ATmega po příkazu 131 skončila; reset stroje SD-ROM obnoví
iq.reset();
advance(90);
iq.ram[3] = 0xc0;            // výstup na děrovač (Staper)
punch('10 PRINT "AHOJ"\r\n20 END\r\n\x1b\r\n', 64);
advance(300);
assert.ok(disk.exists('/save001.bas'), 'BASIC uložen jako save001.bas');
assert.equal(dec(disk.read('/save001.bas')), '10 PRINT "AHOJ"\r\n20 END\r\n\x1b\r\n');

iq.reset();
advance(90);
iq.ram[3] = 0xc0;
punch(':0100000042BD\r\n:00000001FF\r\n', 0);
advance(300);
assert.ok(disk.exists('/save002.hex'), 'HEX uložen jako save002.hex');
assert.equal(dec(disk.read('/save002.hex')), ':0100000042BD\r\n:00000001FF\r\n');
assert.equal(disk.nextSaveNumber(), 3);

console.log('PASS: SD-ROM — loader, výpis adresáře, načtení HEX, ukládání BASIC a HEX');
