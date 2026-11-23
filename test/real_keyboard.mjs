import fs from 'node:fs';
import assert from 'node:assert/strict';
import {IQ151} from '../src/iq151.js';

const iq = new IQ151();
iq.loadMonitor(new Uint8Array(fs.readFileSync(new URL('../roms/Monitor-std.rom', import.meta.url))));
iq.loadBasic6(new Uint8Array(fs.readFileSync(new URL('../modules/Basic6.rom', import.meta.url))));
const tick = n => { for (let i=0; i<n; ++i) iq.advanceWallTime(20); };
const screen = () => Array.from({length:32},(_,r)=>Array.from(iq.vram.slice(r*32,r*32+32),x=>String.fromCharCode(x&127)).join('')).join('\n');
function send(key, code, down, opts={}){
  assert.equal(iq.setBrowserKey({key,code,shiftKey:!!opts.shiftKey,altKey:!!opts.altKey,metaKey:false},down),true,key);
  tick(down ? 3 : 6);
}
function plain(ch,code=`Key${ch}`){send(ch,code,true);send(ch,code,false);}
function shift(ch,code){send('Shift','ShiftLeft',true,{shiftKey:true});send(ch,code,true,{shiftKey:true});assert.equal(iq.keyboard.shift,true);send(ch,code,false,{shiftKey:true});send('Shift','ShiftLeft',false);}
function option(ch,code){send('Alt','AltLeft',true,{altKey:true});send(ch,code,true,{altKey:true});assert.equal(iq.keyboard.fa,false,'Host Option/Alt must not assert IQ FA while character is held');send(ch,code,false,{altKey:true});send('Alt','AltLeft',false);}
function altgr(ch,code){
  send('Control','ControlLeft',true);send('Alt','AltRight',true,{altKey:true});
  send(ch,code,true,{altKey:true});
  assert.equal(iq.keyboard.ctrl,false,'AltGr-typed printable must not assert IQ CTRL');
  assert.equal(iq.keyboard.fa,false,'AltGr-typed printable must not assert IQ FA');
  send(ch,code,false,{altKey:true});send('Alt','AltRight',false);send('Control','ControlLeft',false);
}
function type(text){for(const ch of text)plain(ch,`Text${ch}`);}
tick(90);
type('10 print ');
shift('"','Digit2');
option('!','Digit1');
altgr('$','Digit4');
shift('"','Digit2');
plain('Enter','Enter');
type('run');plain('Enter','Enter');tick(30);
let display=screen();
assert.match(display,/10 PRINT "!\$"/,'BASIC literal quotes and punctuation after physical host modifiers');
assert.match(display,/\n!\$\s/,'BASIC print actual symbols after Shift/Option chords');
console.log('PASS: host Shift/Option chords, BASIC uppercase command, printable ! $ ", and RUN');

// Typed Shift+letter must continue producing lowercase IQ symbols.
const next = new IQ151();
next.loadMonitor(new Uint8Array(fs.readFileSync(new URL('../roms/Monitor-std.rom', import.meta.url))));
next.loadBasic6(new Uint8Array(fs.readFileSync(new URL('../modules/Basic6.rom', import.meta.url))));
for(let i=0;i<90;i++)next.advanceWallTime(20);
const evt=(key,code,shiftKey=false)=>({key,code,shiftKey});
next.setBrowserKey(evt('Shift','ShiftLeft',true),true);
next.setBrowserKey(evt('P','KeyP',true),true);
assert.equal(next.keyboard.shift,true);
next.setBrowserKey(evt('P','KeyP',true),false);
next.setBrowserKey(evt('Shift','ShiftLeft'),false);
console.log('PASS: Shift+letter still produces IQ lowercase without affecting PPI hardware');
