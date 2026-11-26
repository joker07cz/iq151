import fs from 'node:fs';
import assert from 'node:assert/strict';
import {IQ151} from '../src/iq151.js';
import {tapeToWav, wavToTape} from '../src/iq151_tape.js';
// Magnetofon: monitor W zapíše Intel HEX na pásku (dvoufázově, 1000 Bd),
// páska → WAV → páska, monitor L ji přečte zpět a skočí na adresu z EOF.
const bytes=p=>new Uint8Array(fs.readFileSync(new URL(p, import.meta.url)));
const monitor=bytes('../roms/Monitor-std.rom');
let iq;
const adv=n=>{for(let i=0;i<n;i++)iq.advanceWallTime(20)};
const key=(ch,down)=>iq.setBrowserKey(ch==='\r'?{key:'Enter',code:'Enter',keyCode:13}:{key:ch,code:'Key'+ch,keyCode:ch.charCodeAt(0)},down);
const type=s=>{for(const c of s+'\r'){key(c,true);adv(4);key(c,false);adv(6)}};
const screen=()=>Array.from({length:32},(_,r)=>Array.from(iq.vram.slice(r*32,r*32+32),x=>String.fromCharCode((x&0x7f)<32?32:x&0x7f)).join('')).join('\n');
const boot=()=>{const old=iq;iq=new IQ151();iq.loadMonitor(monitor);if(old)iq.adoptTape(old);iq.reset();adv(100);};

boot();
assert.equal(iq.ram[3],0x69,'IOBYTE: čtení i zápis = magnetofon');
// program: 2000: MVI A,5A / STA 2100 / JMP 2006 (smyčka)
const prog=[0x3e,0x5a,0x32,0x00,0x21,0xc3,0x06,0x20];
for(let a=0x2000;a<0x2080;a++)iq.ram[a]=(a*7+3)&0xff;
prog.forEach((b,i)=>iq.ram[0x2000+i]=b);
const ref=iq.ram.slice(0x2000,0x2080);
iq.tapeRecord();
type('W2000,207F,2000');
for(let i=0;i<40&&!/>\s*$/.test(screen().trimEnd().split('\n').pop()+' ');i++)adv(50);
adv(50);
iq.tapeStop();
assert.ok(iq.tape.count>1000,`na pásce jsou hrany (${iq.tape.count})`);
// půlperiody 0,5 / 1 ms — dvoufázový kód
const e=iq.tape.edges, H=1024;
for(let i=1;i<Math.min(iq.tape.count,400);i++){const d=e[i]-e[i-1];assert.ok(Math.abs(d-H)<1||Math.abs(d-2*H)<1||d>4*H,`délka pulzu ${d}`);}

// přes WAV a zpět
const wav=tapeToWav(iq.tape);
const t=wavToTape(wav,iq.clockHz);
boot();
iq.tape.insert(t.edges,t.length,t.level0,'test.wav');
assert.equal(iq.ram[0x2005],0,'RAM po resetu prázdná');
iq.tapePlay();
type('L');
adv(30*50);
assert.deepEqual(iq.ram.slice(0x2008,0x2080),ref.slice(8),'L načetl data z pásky');
assert.equal(iq.ram[0x2100],0x5a,'program se po L spustil od adresy z EOF');
// obrácená nahrávka: bez INV se nenačte, s INV ano
for (const inv of [false, true]) {
  boot();
  iq.tape.insert(t.edges,t.length,t.level0^1,'obracena.wav');
  iq.tape.invert=inv;
  iq.tapePlay(); type('L'); adv(30*50);
  assert.equal(iq.ram[0x2100]===0x5a, inv, inv ? 'INV: obrácená nahrávka se načte a spustí' : 'bez INV se obrácená nahrávka nenačte');
}
console.log(`PASS: W → páska (${iq.tape.count} hran) → WAV ${wav.length} B → L, data souhlasí a program běží od 2000; obrácená polarita jen s INV`);
