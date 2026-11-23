import fs from 'node:fs';
import assert from 'node:assert/strict';
import {IQ151} from '../src/iq151.js';
const bytes=path=>new Uint8Array(fs.readFileSync(new URL(path, import.meta.url)));
const monitor=bytes('../roms/Monitor-std.rom');
const basic=bytes('../modules/Basic6.rom');
const iq=new IQ151();iq.loadMonitor(monitor);
assert.equal(iq.memRead(0xc800),0xff,'No module: open bus at C800');
iq.advanceWallTime(200);
assert.equal(iq.ram[0x1d] | (iq.ram[0x1e]<<8),0xf22b,'No-module monitor warm entry');

// The only hardware change is an 8 KB read-only EPROM window.
iq.loadBasic6(basic);iq.reset();
for(const addr of [0xc800,0xc801,0xcfff,0xd000,0xe7ff])
 assert.equal(iq.memRead(addr),basic[addr-0xc800],`ROM byte ${addr.toString(16)}`);
const original=iq.memRead(0xc800);iq.memWrite(0xc800,original^255);
assert.equal(iq.memRead(0xc800),original,'EPROM is read-only');
const advance=n=>{for(let i=0;i<n;i++)iq.advanceWallTime(20)};
const press=k=>{assert.equal(iq.setKey(k,true),true,`key ${k}`);advance(5);iq.setKey(k,false);advance(12)};
const type=s=>{for(const c of s)press(c.charCodeAt(0));press(13);advance(20)};
const screen=()=>Array.from({length:32},(_,r)=>
 Array.from(iq.vram.slice(r*32,r*32+32),x=>String.fromCharCode(x&0x7f)).join('')).join('\n');
advance(90);
assert.equal(iq.ram[0x1d] | (iq.ram[0x1e]<<8),0xcad6,'Monitor chose original BASIC warm entry');
assert.match(screen(),/^BASIC/,'BASIC startup banner');
assert.match(screen(),/READY/,'BASIC prompt');
type('10 PRINT 42');type('RUN');
assert.match(screen(),/10 PRINT 42/,'Program line accepted');
assert.match(screen(),/\n 42 /,'Original BASIC printed 42');
console.log('PASS: no-module MONITOR, BASIC6 8KB ROM/read-only, auto-start and 10 PRINT 42 / RUN');
