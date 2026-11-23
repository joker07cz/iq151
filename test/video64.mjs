import fs from 'node:fs';
import assert from 'node:assert/strict';
import {IQ151} from '../src/iq151.js';
import {videoGeometry,displayGeometry,rasterizeText} from '../src/iq151_video.js';
const bytes = p => new Uint8Array(fs.readFileSync(new URL(p,import.meta.url)));
const font=bytes('../roms/chars.bin');
const basic=bytes('../modules/Basic6.rom');
const monitor=bytes('../roms/Monitor-std.rom');
const v32=new IQ151({video:'VIDEO32'});v32.loadMonitor(monitor);v32.loadBasic6(basic);v32.reset();
const v64=new IQ151({video:'VIDEO64'});v64.loadMonitor(monitor);v64.loadBasic6(basic);v64.reset();
assert.equal(v32.ioRead(0xfc),0xff);
assert.equal(v64.ioRead(0xfc),0xfe);
for (let p=0xfc;p<=0xff;p++) assert.equal(v64.ioRead(p),0xfe);
assert.equal(v64.memRead(0xe800),0x00);
v64.memWrite(0xe800,0x41);
assert.equal(v64.memRead(0xe800),0x41);
v32.memWrite(0xe800,0x41);
assert.equal(v32.memRead(0xe800),0xff,'VIDEO32 has no RAM at E800');
v64.ioWrite(0xfc,1);assert.equal(v64.video64DoubleWidthEnabled,true);
v64.ioWrite(0xff,0);assert.equal(v64.video64DoubleWidthEnabled,false);
for(let i=0;i<85;i++){v32.advanceWallTime(20);v64.advanceWallTime(20);}
assert.equal(v32.ram[0x1f],32);
assert.equal(v64.ram[0x1f],64);
assert.equal(v32.ram[0x20]|v32.ram[0x21]<<8,0xec00);
assert.equal(v64.ram[0x20]|v64.ram[0x21]<<8,0xe800);
assert.equal(v32.ram[0x1d]|v32.ram[0x1e]<<8,0xcad6);
assert.equal(v64.ram[0x1d]|v64.ram[0x1e]<<8,0xcad6);
const text=iq=>Array.from(iq.vram,code=>String.fromCharCode(code&127)).join('');
assert.match(text(v32),/BASIC/);
assert.match(text(v64),/BASIC/);
assert.match(text(v64),/READY/);
for (const iq of [v32,v64]) {
  const g=displayGeometry(iq.video);const pixels=new Uint8ClampedArray(g.width*g.height*4);
  rasterizeText(iq.vram,font,iq.video,pixels);
  assert.equal(pixels[3],255);
  assert.equal(pixels.length,g.width*g.height*4);
}
assert.equal(videoGeometry('VIDEO64').width,512);
assert.equal(videoGeometry('VIDEO64').height,256,'logical scanlines unchanged');
assert.deepEqual(displayGeometry('VIDEO32'),{width:256,height:256,verticalScale:1});
assert.deepEqual(displayGeometry('VIDEO64'),{width:512,height:512,verticalScale:2});
{
  const row=512*4;
  const pixels=new Uint8ClampedArray(512*512*4);
  const sampleVram=new Uint8Array(2048);
  const sampleFont=new Uint8Array(1024);
  sampleFont[0]=0x80; // first pixel of glyph row 0
  sampleFont[1]=0x40; // second pixel of glyph row 1
  rasterizeText(sampleVram,sampleFont,'VIDEO64',pixels);
  assert.deepEqual(pixels.slice(0,row),pixels.slice(row,2*row),'each VIDEO64 raster line doubled');
  assert.deepEqual(pixels.slice(2*row,3*row),pixels.slice(3*row,4*row),'next line doubled');
  assert.notDeepEqual(pixels.slice(0,16),pixels.slice(2*row,2*row+16),'glyph rows remain distinct');
}
console.log('PASS: VIDEO32 and VIDEO64 detection, 1/2KB RAM mapping, ROM boot, BASIC READY, 512x256 logical / 512x512 presented raster and FC-FF latch');
const advance=n=>{for(let i=0;i<n;i++)v64.advanceWallTime(20)};
const press=k=>{assert.equal(v64.setKey(k,true),true);advance(5);v64.setKey(k,false);advance(12)};
const type=s=>{for(const c of s)press(c.charCodeAt(0));press(13);advance(20)};
type('10 PRINT 42');type('RUN');
const lines=Array.from({length:32},(_,r)=>Array.from(v64.vram.slice(r*64,r*64+64),b=>String.fromCharCode(b&127)).join('')).join('\n');
assert.match(lines,/10 PRINT 42/);
assert.match(lines,/\n 42 /);
assert.match(lines,/READY/);
console.log('PASS: original BASIC 6 PRINT 42 executes in VIDEO64 through 8255, 8259 and the monitor');
