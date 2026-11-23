import fs from 'node:fs';
import assert from 'node:assert/strict';
import {IQ151} from '../src/iq151.js';
const monitor = new Uint8Array(fs.readFileSync(new URL('../roms/Monitor-std.rom', import.meta.url)));
const basic = new Uint8Array(fs.readFileSync(new URL('../modules/Basic6.rom', import.meta.url)));
function machine(){ const iq = new IQ151();iq.loadMonitor(monitor);iq.loadBasic6(basic); return iq; }
const tick=(iq,n)=>{for(let i=0;i<n;i++)iq.advanceWallTime(20)};
const down=(iq,key,code,shiftKey=false)=>iq.setBrowserKey({key,code,shiftKey},true);
const up=(iq,key,code,shiftKey=false)=>iq.setBrowserKey({key,code,shiftKey},false);
const screen=iq=>Array.from({length:32},(_,r)=>Array.from(iq.vram.slice(r*32,r*32+32),x=>String.fromCharCode(x&127)).join('')).join('\n');
function press(iq,ch,code='Char'+ch){assert.ok(down(iq,ch,code));tick(iq,4);assert.ok(up(iq,ch,code));tick(iq,12)}
function type(iq,text){for(const ch of text)press(iq,ch);press(iq,'Enter','Enter');tick(iq,20)}
{
  const iq=machine();tick(iq,90);
  type(iq,'10 print 42');type(iq,'run');
  const display=screen(iq);
  assert.match(display,/10 PRINT 42/,'plain PC lowercase inputs must become original IQ uppercase');
  assert.match(display,/\n\s*42\s/,'unshifted lowercase host BASIC must run instead of ERROR 21');
  console.log('PASS: lowercase host inputs produce original uppercase BASIC and execute PRINT 42');
}
{
  const iq=machine();tick(iq,90);
  press(iq,'P','KeyP');
  assert.match(screen(iq),/READY\s*P/,'Caps Lock uppercase host input remains IQ uppercase');
  console.log('PASS: Caps Lock uppercase remains uppercase on IQ');
}
{
  const iq=machine();tick(iq,90);
  assert.ok(down(iq,'Shift','ShiftLeft',true));
  assert.ok(down(iq,'P','KeyP',true));tick(iq,4);
  assert.ok(up(iq,'P','KeyP',true));tick(iq,12);
  assert.ok(up(iq,'Shift','ShiftLeft',false));tick(iq,12);
  assert.match(screen(iq),/READY\s*p/,'host physical Shift + letter simulates IQ SH lowercase');
  console.log('PASS: physical SH + letter yields lowercase on IQ');
}
{
  const iq=machine();tick(iq,90);
  type(iq,'10 print "!$"');type(iq,'run');
  assert.match(screen(iq),/\n!\$\s/,'punctuation follows original key/shift map');
  console.log('PASS: punctuation and default uppercase BASIC coexist');
}
