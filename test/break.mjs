import fs from 'node:fs';
import assert from 'node:assert/strict';
import {IQ151} from '../src/iq151.js';
// Klávesa BR → IR5 řadiče 8259 → obsluha monitoru: #adresa a návrat do monitoru.
const bytes=path=>new Uint8Array(fs.readFileSync(new URL(path, import.meta.url)));
const monitor=bytes('../roms/Monitor-std.rom');
let iq;
const advance=n=>{for(let i=0;i<n;i++)iq.advanceWallTime(20)};
const press=k=>{iq.setKey(k,true);advance(5);iq.setKey(k,false);advance(12)};
const type=s=>{for(const c of s)press(c.charCodeAt(0));press(13);advance(20)};
const screen=()=>Array.from({length:32},(_,r)=>
 Array.from(iq.vram.slice(r*32,r*32+32),x=>String.fromCharCode(x&0x7f)).join('')).join('\n');

// Monitor po startu povolí IR5 (IMR 9F) a vektor 7FF4 vede na obsluhu BR.
iq=new IQ151();iq.loadMonitor(monitor);advance(90);
assert.equal(iq.pic.imr&0x20,0,'IR5 povoleno');
assert.deepEqual([0,1,2].map(i=>iq.memRead(0x7ff4+i)),[0xc3,0x92,0xf7],'vektor IR5 = JMP F792');
iq.pressBreak();advance(30);
assert.match(screen(),/#F[0-9A-F]{3}/,'BR v monitoru vypíše #adresa');
assert.equal(iq.pic.isr,0,'obsluha poslala EOI');

// Běžící program v BASICu: BR ho zastaví a vrátí se do monitoru.
iq=new IQ151();iq.loadMonitor(monitor);iq.loadBasic6(bytes('../modules/Basic6.rom'));iq.reset();advance(90);
type('10 GOTO 10');type('RUN');advance(50);
const pc=iq.cpu.pc;
assert.ok(pc>=0xc800&&pc<0xe800,'program běží v BASICu');
iq.pressBreak();advance(30);
assert.match(screen(),/#[CD][0-9A-F]{3}\s+>/,'BR vypíše adresu v BASICu a prompt monitoru');
assert.ok(iq.cpu.pc>=0xf000,'CPU je zpět v monitoru');
// Jeden stisk = jedno přerušení (hrana), další BR funguje znovu.
iq.pressBreak();advance(30);
assert.equal((screen().match(/#/g)||[]).length,2,'druhý BR = druhé přerušení');
console.log('PASS: BR → IR5 v monitoru i při běhu BASICu, EOI, opakovaný stisk');
