import fs from 'node:fs';
import assert from 'node:assert/strict';
import {IQ151} from '../src/iq151.js';
import {installIntelHex} from '../src/intel_hex.js';
import {parseProgram, parseBlockBin} from '../src/iq151_program.js';
// Přímé zavedení programu: HEX (start z EOF), HEXBIN (turbo zavaděč + blokový BIN),
// blokový BIN jako u Ondry a prostý BIN od zadané adresy.
const bytes=p=>new Uint8Array(fs.readFileSync(new URL(p, import.meta.url)));
const monitor=bytes('../roms/Monitor-std.rom');
const screen=iq=>Array.from({length:32},(_,r)=>Array.from(iq.vram.slice(r*32,r*32+32),x=>String.fromCharCode((x&0x7f)<32?32:x&0x7f)).join('')).join('\n');
function run(name,data){
  const iq=new IQ151({grafik:true});iq.loadMonitor(monitor);
  for(let i=0;i<100;i++)iq.advanceWallTime(20);
  const p=parseProgram(name,data);
  installIntelHex(iq,p);iq.cpu.pc=p.entry;
  for(let i=0;i<100;i++)iq.advanceWallTime(20);
  return {p,text:screen(iq)};
}
const hex=run('MESTO_IQ_G.hex',bytes('../bins/MESTO_IQ_G.hex'));
assert.equal(hex.p.entry,0x1200,'HEX: start z EOF záznamu :00120001ED');
assert.equal(hex.p.size,28039);
assert.match(hex.text,/Vyber rezim zobrazeni/,'Město robotů z HEX běží');
const hb=run('MESTO_IQ_G_turbo.hexbin',bytes('../bins/MESTO_IQ_G_turbo.hexbin'));
assert.equal(hb.p.kind,'HEXBIN');assert.equal(hb.p.entry,0x1200,'HEXBIN: start z bloku 02');
assert.deepEqual(hb.p.ranges,[{start:0x100,end:0x277},{start:0x1100,end:0x7e86}]);
assert.match(hb.text,/Vyber rezim zobrazeni/,'Město robotů z HEXBIN běží');
// blokový BIN poskládaný z HEX
const mem=new Map(hex.p.bytes);const lo=0x1100,len=0x6d87;
const blk=new Uint8Array(5+len+3);blk.set([1,lo&255,lo>>8,len&255,len>>8]);
for(let i=0;i<len;i++)blk[5+i]=mem.get(lo+i);blk.set([2,0x00,0x12],5+len);
assert.equal(parseBlockBin(blk).start,0x1200);
const bb=run('mesto.bin',blk);
assert.equal(bb.p.kind,'BIN');assert.match(bb.text,/Vyber rezim zobrazeni/,'Město robotů z blokového BIN běží');
// prostý BIN
const raw=parseProgram('x.bin',new Uint8Array([0x3e,0x5a,0x32,0x00,0x21,0x76]),0x2000);
assert.equal(raw.raw,true);assert.equal(raw.entry,0x2000);assert.equal(raw.bytes[0][0],0x2000);
assert.throws(()=>parseProgram('x.hexbin',new Uint8Array([0x3a,0x30])),/HEX/);
console.log('PASS: HEX / HEXBIN / blokový BIN / prostý BIN — Město robotů startuje od 1200');
