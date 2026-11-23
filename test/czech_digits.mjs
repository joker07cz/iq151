import assert from 'node:assert/strict';
import fs from 'node:fs';
import {IQ151} from '../src/iq151.js';
import {CHAR_MATRIX} from '../src/iq151_char_map.js';

const iq = new IQ151();
iq.loadMonitor(new Uint8Array(fs.readFileSync(new URL('../roms/Monitor-std.rom',import.meta.url))));
iq.loadBasic6(new Uint8Array(fs.readFileSync(new URL('../modules/Basic6.rom',import.meta.url))));
const rowKeys = [['1','+'],['2','ě'],['3','š'],['4','č'],['5','ř'],['6','ž'],['7','ý'],['8','á'],['9','í'],['0','é']];
const mk=(key,code,more={})=>({key,code,shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,...more});
function keydown(e){assert.equal(iq.setBrowserKey(e,true),true,`keydown ${e.code}:${e.key}`)}
function keyup(e){assert.equal(iq.setBrowserKey(e,false),true,`keyup ${e.code}:${e.key}`)}

// Verify each Czech-layout key arrives at the correct IQ 151 matrix bit
// and leaves the IQ Shift input inactive, including the formerly broken Digit1.
for (const [digit,hostKey] of rowKeys) {
  const code=`Digit${digit}`;
  const e=mk(hostKey,code);
  const [row,col]=CHAR_MATRIX[digit];
  keydown(e);
  assert.equal(iq.keyboard.rows[row]&(1<<col),0,`physical ${code} row/column`);
  assert.equal(iq.keyboard.shift,false,`physical ${code} must be unshifted`);
  keyup(e);
  assert.equal(iq.keyboard.rows[row]&(1<<col),1<<col,`${code} must release`);
}
// Bare '+' elsewhere must still type '+', never be rewritten as '1'.
let e=mk('+','Equal');
keydown(e);
assert.equal(iq.keyboard.shift,true);
assert.equal(iq.keyboard.rows[5]&4,0);
keyup(e);
// Character-based symbol path for modified chords stays intact.
e=mk('"','Digit2',{shiftKey:true});
keydown(e);
assert.equal(iq.keyboard.shift,true);
assert.equal(iq.keyboard.rows[0]&2,0);
keyup(e);
e=mk('!','Digit1',{altKey:true});
keydown(e);
assert.equal(iq.keyboard.shift,true);
assert.equal(iq.keyboard.rows[0]&1,0);
keyup(e);

const tick=n=>{for(let i=0;i<n;i++)iq.advanceWallTime(20)};
const press=e=>{keydown(e);tick(4);keyup(e);tick(10)};
const text=s=>{for(const ch of s)press(mk(ch,`Text${ch}`))};
const screen=()=>Array.from({length:32},(_,r)=>Array.from(iq.vram.slice(r*32,r*32+32),x=>String.fromCharCode(x&127)).join('')).join('\n');
tick(90);
text('10 print ');
press(mk('+','Digit1'));
press(mk('ě','Digit2'));
press(mk('Enter','Enter'));
text('run');press(mk('Enter','Enter'));tick(35);
assert.match(screen(),/10 PRINT 12/,'Czech 1+ and 2ě keys must type numeric 12 into BASIC');
assert.match(screen(),/\n\s*12\s/,'BASIC must execute PRINT 12');
console.log('PASS: Czech Mac Digit0..Digit9 without modifiers, Shift/Option punctuation, BASIC PRINT 12');
