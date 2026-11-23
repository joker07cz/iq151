import assert from 'node:assert/strict';
import fs from 'node:fs';
import {IQ151} from '../src/iq151.js';
import {displayGeometry, rasterizeComposite} from '../src/iq151_video.js';
const monitor = new Uint8Array(fs.readFileSync(new URL('../roms/Monitor-std.rom',import.meta.url)));
const basic = new Uint8Array(fs.readFileSync(new URL('../modules/Basic6.rom',import.meta.url)));
const g = new IQ151({grafik:true, video:'VIDEO64'});
g.loadMonitor(monitor);g.loadBasic6(basic);g.reset();
assert.equal(g.memRead(0x4000),0); // no GRAFIK memory mapped on CPU address bus
assert.equal(g.grafik.vram.length,16384);
assert.equal(g.ioRead(0xd4),0xff,'no GRAFIK I/O before 8255 init');
g.ioWrite(0xd3,0x80);  // 8255 all outputs, mode 0
g.ioWrite(0xd2,0x89);  // SEL,EV,ALL = 1 => display+byte access
g.ioWrite(0xd0,0x00);g.ioWrite(0xd1,0xff); // upper left byte
g.ioWrite(0xd4,0x81);assert.equal(g.ioRead(0xd4),0x81);
assert.equal(g.grafik.vram[0],0x81);
g.ioWrite(0xd0,63);g.ioWrite(0xd1,0); // lower right byte
g.ioWrite(0xd4,0xff);assert.equal(g.grafik.vram[16383],255);
g.ioWrite(0xd0,0);g.ioWrite(0xd1,255);
g.ioWrite(0xd2,0x88); // SEL,EV,bit mode, PEN*=0 => set pixel
g.ioWrite(0xd4,0x20);assert.equal(g.ioRead(0xd4),0x83,'bit1 set');
g.ioWrite(0xd2,0x8a); // PEN*=1 => erase pixel
g.ioWrite(0xd4,0x20);assert.equal(g.ioRead(0xd4),0x81,'bit1 erased');
g.ioWrite(0xd3,0x07); // BSR: set bit3 -> EV
assert.equal(g.grafik.visible,true);
g.ioWrite(0xd3,0x06); // BSR: reset EV
assert.equal(g.grafik.visible,false);
g.ioWrite(0xd3,0x07); // EV on
assert.equal(g.grafik.visible,true);
g.ioWrite(0xd2,0x09); // SEL off => disconnect module from D4
g.ioWrite(0xd4,0x00);assert.equal(g.ioRead(0xd4),0xff);
assert.equal(g.grafik.vram[0],0x81);
assert.equal(g.grafik.visible,true,'SEL controls bus transfer; EV independently controls video');
// Graphic pixel bit 0 is leftmost, and y grows upward.
g.ioWrite(0xd2,0x89);
const emptyFont=new Uint8Array(1024);
const emptyVideo=new Uint8Array(2048);
const img=new Uint8ClampedArray(512*512*4);
rasterizeComposite(emptyVideo,emptyFont,'VIDEO64',g.grafik,img);
const px=(x,y)=>img[(y*512+x)*4];
assert.equal(px(0,0),191);
assert.equal(px(1,0),6);
assert.equal(px(7,0),191);
assert.equal(px(0,1),191);
assert.equal(px(504,510),191);
// A missing GRAFIK module must not disturb original VIDEO32 geometry.
assert.deepEqual(displayGeometry('VIDEO32'),{width:256,height:256,verticalScale:1});
assert.deepEqual(displayGeometry('VIDEO32',true),{width:512,height:512,verticalScale:2});
const missing=new IQ151();missing.ioWrite(0xd4,0x70);assert.equal(missing.ioRead(0xd4),0xff);
// Reset does not change ROM, and clears the stand-alone GRAFIK state.
g.reset();assert.equal(g.grafik.vram[0],0);assert.equal(g.grafik.initialized,false);
for(let i=0;i<85;i++)g.advanceWallTime(20);
const text=Array.from(g.vram,x=>String.fromCharCode(x&127)).join('');
assert.match(text,/BASIC/);assert.match(text,/READY/);
console.log('PASS: GRAFIK I/O D0-D4, 8255 BSR, byte/bit mode, y origin, compositing, no RAM alias, BASIC6 regression');

