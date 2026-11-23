import fs from 'node:fs';
import {IQ151} from '../src/iq151.js';
const m=new IQ151(); m.loadMonitor(new Uint8Array(fs.readFileSync(new URL('../roms/Monitor-std.rom',import.meta.url))));
let pcs = new Map();let traces=[];
for(let i=0;i<300000;i++){
 const pc=m.cpu.pc;pcs.set(pc,(pcs.get(pc)||0)+1);
 if(i<40)traces.push(pc.toString(16));
 try{m.runInstructions(1)}catch(e){console.log('EXCEPTION',i,pc.toString(16),e.stack);break}
}
console.log('first PC',traces.join(','),'endPC',m.cpu.pc.toString(16),'halted',m.cpu.halted,'overlay',m.resetOverlay,'port80',m.port80.toString(16),'io',m.ioLog.slice(0,30));
console.log('RAM vars',Array.from(m.ram.slice(0,40)));console.log('VRAM nonzero',m.vram.filter(x=>x!==0).length, 'topPC', [...pcs].sort((a,b)=>b[1]-a[1]).slice(0,15).map(([a,b])=>[a.toString(16),b]));
