import fs from 'node:fs';
import assert from 'node:assert/strict';
import {IQ151} from '../src/iq151.js';
const iq=new IQ151();
iq.loadMonitor(new Uint8Array(fs.readFileSync(new URL('../roms/Monitor-std.rom',import.meta.url))));
for(let n=0;n<80;n++)iq.advanceWallTime(20);
assert.equal(iq.irqCount,80);
assert.equal(iq.pic.initialized,true);
assert.equal(iq.pic.imr,0x9f);
for(const code of [65,66,67]){
 iq.setKey(code,true);for(let n=0;n<5;n++)iq.advanceWallTime(20);
 iq.setKey(code,false);for(let n=0;n<25;n++)iq.advanceWallTime(20);
 assert.equal(iq.ram[6]&31,0,'release must be processed by ROM interrupt service');
 assert.ok(iq.cpu.pc>=0xf000,'monitor must remain in ROM');
}
iq.reset();assert.equal(iq.pic.irr,0);assert.equal(iq.irqCount,0);
console.log('PASS: PIC initialization, 20ms IRQ6 cadence, three key press/release cycles, reset');
