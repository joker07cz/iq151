import fs from 'node:fs';
import assert from 'node:assert/strict';
import {IQ151} from '../src/iq151.js';
import {CHAR_MATRIX} from '../src/iq151_char_map.js';
const iq=new IQ151();
iq.loadMonitor(new Uint8Array(fs.readFileSync(new URL('../roms/Monitor-std.rom',import.meta.url))));
iq.loadBasic6(new Uint8Array(fs.readFileSync(new URL('../modules/Basic6.rom',import.meta.url))));
const down=(key,code,opts={})=>iq.setBrowserKey({key,code,...opts},true);
const up=(key,code,opts={})=>iq.setBrowserKey({key,code,...opts},false);
assert.equal(Object.keys(CHAR_MATRIX).length,95,'all printable ASCII characters included');
// Check actual 8255 PC4 and row/column levels for representative characters.
// Unshifted letters are uppercase on the original IQ 151; host case is irrelevant.
for (const [ch,baseCode,row,col,shift,opts={}] of [['!','Digit1',0,0,true,{altKey:true}],['$','Digit4',0,3,true,{altKey:true}],['"','Digit2',0,1,true,{shiftKey:true}],['1','Digit1',0,0,false],['a','KeyA',2,0,false],['A','KeyA',2,0,false],['@','Digit2',7,1,false,{altKey:true}]]) {
  assert.equal(down(ch,baseCode,opts),true,ch);
  assert.equal(iq.keyboard.rows[row] & (1<<col),0,`${ch}: matrix closed`);
  assert.equal(iq.keyboard.shift,shift,`${ch}: SHIFT`);
  iq.ppi[3]=0x9b;
  assert.equal((iq.ppiRead(2)&0x10)===0,shift,`${ch}: PC4 input state`);
  // Keyup can report a different char if the physical SHIFT was released first.
  assert.equal(up(ch==='!'?'1':ch,baseCode),true,ch);
  assert.equal(iq.keyboard.rows[row] & (1<<col),1<<col,`${ch}: matrix released`);
  assert.equal(iq.ppiRead(2)&0x10,0x10,`${ch}: PC4 released`);
}
// Test modifiers use the real PC4/PC5 input and don't occupy a row/column.
assert.equal(down('Shift','ShiftLeft'),true);
assert.equal(iq.ppiRead(2)&0x10,0);
assert.equal(down('Control','ControlLeft'),true);
assert.equal(iq.ppiRead(2)&0x20,0);
up('Shift','ShiftLeft');up('Control','ControlLeft');
assert.equal(iq.ppiRead(2)&0x30,0x30);
const advance=n=>{for(let i=0;i<n;i++)iq.advanceWallTime(20)};
const press=(key,code)=>{assert.equal(down(key,code),true);advance(5);assert.equal(up(key,code),true);advance(12)};
const type=s=>{for(const ch of s)press(ch,'char-'+ch);press('Enter','Enter');advance(20)};
const screen=()=>Array.from({length:32},(_,r)=>Array.from(iq.vram.slice(r*32,r*32+32),x=>String.fromCharCode(x&0x7f)).join('')).join('\n');
advance(90);
assert.match(screen(),/^BASIC/,'BASIC boots with keyboard changes');
type('10 PRINT "!$"');type('RUN');
let display=screen();
console.log('DISPLAY:\n'+display.slice(0,550));
assert.match(display,/10 PRINT "!\$"/,'BASIC echoes literal punctuation in program');
assert.match(display,/\n!\$\s/,'BASIC executes PRINT and outputs punctuation');
console.log('PASS: 95 printable ASCII mappings, PC4/PC5 physical inputs and BASIC PRINT "!$" through browser event path');
