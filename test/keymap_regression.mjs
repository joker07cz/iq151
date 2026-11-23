import fs from 'node:fs';
import assert from 'node:assert/strict';
import {IQ151} from '../src/iq151.js';
const iq=new IQ151();
iq.loadMonitor(new Uint8Array(fs.readFileSync(new URL('../roms/Monitor-std.rom',import.meta.url))));
// Byte-accurate keyboard matrix compared with machine.Keyboard.keyPressedOriginal in emulator.jar.
for(const [code,row,col] of [[56,0,7],[73,1,7],[75,2,7],[13,4,4],[8,4,5]]){
 assert.equal(iq.setKey(code,true),true);
 assert.equal(iq.keyboard.rows[row] & (1<<col),0);
 iq.setKey(code,false);
 assert.notEqual(iq.keyboard.rows[row] & (1<<col),0);
}
// Browser Enter=13 must reach the original Java matrix location (VK_ENTER=10).
// Execute real monitor register editing: XA55<Enter> writes register A shadow
// at 0023h and returns to monitor command processing without resetting video.
const advance=n=>{for(let i=0;i<n;i++)iq.advanceWallTime(20)};
advance(80);
const type=code=>{iq.setKey(code,true);advance(6);iq.setKey(code,false);advance(18)};
for(const code of [88,65,53,53,13]) type(code);
assert.equal(iq.ram[0x23],0x55,'XA55 + Enter must store 55h as A register');
assert.equal(iq.vram[0],0x4d,'screen must still begin with MONITOR, not clear');
assert.equal(iq.ram[6]&31,0,'key must be released');
for(const code of [88,65]) type(code);
assert.equal(iq.ram[0x23],0x55,'XA must preserve edited value');
assert.equal(iq.vram[0],0x4d);
console.log('PASS: 8/I/K, browser Enter/Backspace and XA55<Enter> stores 55h, no reset');
