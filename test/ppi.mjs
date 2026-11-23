import assert from 'node:assert/strict';
import {IQ151} from '../src/iq151.js';
const q=new IQ151();
q.ioWrite(0x87,0x82); // A output, B input, C output
q.ioWrite(0x84,0xfe); // select column 0
assert.equal(q.ioRead(0x85),0xff);
assert.equal(q.setKey(49,true),true); // key '1' row0 bit0
assert.equal(q.ioRead(0x85)&1,0);
q.ioWrite(0x84,0xfd);assert.equal(q.ioRead(0x85),0xff);
q.ioWrite(0x84,0xfe);q.setKey(49,false);assert.equal(q.ioRead(0x85),0xff);
q.ioWrite(0x87,0x90); // A input, B output
q.ioWrite(0x85,0xfe);q.setKey(49,true);assert.equal(q.ioRead(0x84)&1,0);
q.ioWrite(0x87,0x80);q.ioWrite(0x86,0);q.ioWrite(0x87,0x0f);assert.equal(q.ioRead(0x86)&0x80,0x80);
q.ioWrite(0x87,0x0e);assert.equal(q.ioRead(0x86)&0x80,0);
console.log('PASS: 8255 mode, BSR and keyboard matrix both directions');
