import { IQKeyboard } from './iq151_keyboard.js';
import { Intel8080 } from './intel8080.js';
import { I8259 } from './i8259.js';
import { Basic6Module, BasicGModule } from './iq151_module.js';
import { IQGrafik } from './iq151_grafik.js';
import { Tape, KHZ_HALF } from './iq151_tape.js';

// IQ 151 hardware model: CPU, 8255, 8259, video and optional ROM module.
export class IQ151 {
  constructor({ramKB=32, video='VIDEO32', grafik=false}={}) {
    if (![32,64].includes(ramKB)) throw new Error('RAM must be 32 or 64 kB');
    if (!['VIDEO32','VIDEO64'].includes(video)) throw new Error('Unsupported video module');
    this.ram = new Uint8Array(ramKB*1024);
    this.video = video;
    this.grafik = grafik ? new IQGrafik() : null;
    this.vram = new Uint8Array(video === 'VIDEO64' ? 2048 : 1024);
    this.monitor = null;
    this.module = null;
    this.ioLog = [];
    this.soundLog = [];
    this._lastSoundBit = 0;
    this.resetOverlay=true; this.port80=0; this.video64DoubleWidthEnabled=false; this.ppi=[0xff,0xff,0xff,0x9b]; this.pic=new I8259(); this.keyboard=new IQKeyboard();
    this.bus = {
      memRead: addr => this.memRead(addr),
      memWrite: (addr, value) => this.memWrite(addr,value),
      ioRead: port => this.ioRead(port),
      ioWrite: (port,value) => this.ioWrite(port,value),
    };
    this.cpu = new Intel8080(this.bus);
    this.cpu.interruptController=this.pic;
    // 18,432 MHz / 9 = 2,048 MHz (skutečný IQ 151; 50 Hz přerušení = 40 960 taktů). Zvuk bere kmitočet odsud.
    this.clockHz=2048000; this.irqPeriodMs=20; this.irqCount=0; this.lastWallMs=null; this.tstateRemainder=0;
    this.tape = new Tape(this.clockHz);   // magnetofon: přežije RESET i přestavbu stroje (web ho přenáší)
    this.reset();
  }
  loadMonitor(image) {
    if (!(image instanceof Uint8Array) || image.length !== 4096) throw new Error('Expected 4 KB monitor ROM');
    this.monitor = image.slice();
  }
  loadBasic6(image) {
    this.module = new Basic6Module(image);
  }
  loadBasicG(mainImage,graphicsImage) {
    this.module = new BasicGModule(mainImage,graphicsImage);
  }
  ejectModule() {
    this.module = null;
  }
  reset() {
    this.ram.fill(0); this.vram.fill(0); if(this.grafik) this.grafik.reset();
    this.tape.rebase(this.cpu.cycles, 0);   // čítač taktů se nuluje, páska běží plynule dál
    this.cpu.reset();
    this.ram[0xc800] = 0xff; // Obchází chybu monitoru při konfiguraci 64 kB RAM bez BASICu (na C800 hledá modul).
    this.ioLog=[];
    this.soundLog=[];
    this._lastSoundBit=0;
    this.resetOverlay=true; this.port80=0; this.video64DoubleWidthEnabled=false; this.ppi=[0xff,0xff,0xff,0x9b]; this.pic.reset(); this.keyboard=new IQKeyboard();
    this.lastWallMs=null;this.tstateRemainder=0;this.irqCount=0;this.irqTstates=0;
    this.tapePc0=0; this.tapeLatched=0; this.tapeNextB=0;
    this.tape.setMotor(false, 0); this.tape.level = 0;
  }
  // Magnetofon. Relé motoru = PC1, data ven = PC0 (jen když je dolní půlka C výstup).
  tapeMotorBit(){ return (this.ppi[3]&0x01) ? 0 : (this.ppi[2]>>1)&1; }
  tapePc0Bit(){ return (this.ppi[3]&0x01) ? 0 : this.ppi[2]&1; }
  khz1(t=this.cpu.cycles){ return Math.floor(t/KHZ_HALF)&1; }
  // Výstup na pásku: PC0 se přepíše do klopného obvodu při vzestupné hraně
  // hodin 1 kHz a do magnetofonu jde XOR s hodinami (dvoufázové kódování,
  // buňka bitu 1 ms: v půlce buňky je vždy hrana). Hrany se generují líně
  // po hranicích půlperiod až do `now`.
  tapeOutFlush(now=this.cpu.cycles){
    const H=KHZ_HALF;
    if(!(this.tape.mode==='rec' && this.tape.motor)){
      // nenahrává se: zpoždění klopného obvodu nehraje roli
      this.tapeLatched=this.tapePc0; this.tapeNextB=Math.floor(now/H)*H+H; return;
    }
    while(this.tapeNextB<=now){
      const b=this.tapeNextB, k=(b/H)&1;
      if(k) this.tapeLatched=this.tapePc0;          // vzestupná hrana hodin
      this.tape.output(this.tapeLatched^k, b);
      this.tapeNextB=b+H;
    }
  }
  tapeAfterPpiWrite(){
    const now=this.cpu.cycles, pc0=this.tapePc0Bit(), motor=this.tapeMotorBit();
    if(pc0!==this.tapePc0){ this.tapeOutFlush(now); this.tapePc0=pc0; }
    if(!!motor!==this.tape.motor){ this.tapeOutFlush(now); this.tape.setMotor(motor, now); }
  }
  tapePlay(){ this.tapeOutFlush(); this.tape.play(this.cpu.cycles); }
  tapeRecord(){ this.tapeOutFlush(); this.tape.record(this.cpu.cycles, this.tape.level); }
  tapeStop(){ this.tapeOutFlush(); this.tape.stop(this.cpu.cycles); }
  tapeRewind(){ this.tapeOutFlush(); this.tape.rewind(this.cpu.cycles); }
  // Přenesení magnetofonu do nově postaveného stroje (změna RAM / videa).
  adoptTape(old){ old.tapeOutFlush(); old.tape.setMotor(false, old.cpu.cycles); this.tape=old.tape; this.tape.anchor=this.cpu.cycles; }
  memRead(addr) {
    addr &= 0xffff;
    if (this.resetOverlay && this.monitor && addr < 0x800) return this.monitor[0x800 + addr];
    if (this.monitor && addr>=0xf000) return this.monitor[addr - 0xf000];
    const start = this.video==='VIDEO32' ? 0xec00 : 0xe800;
    if (addr>=start && addr<0xf000) return this.vram[addr-start];
    if (this.module && this.module.contains(addr))
      return this.module.read(addr);
    if (addr < this.ram.length) return this.ram[addr];
    return 0xff;
  }
  memWrite(addr, value) {
    addr &= 0xffff; value &= 0xff;
    const start = this.video==='VIDEO32' ? 0xec00 : 0xe800;
    if (addr>=start && addr<0xf000) this.vram[addr-start] = value;
    else if (addr<this.ram.length && !(this.module && this.module.contains(addr)))
      this.ram[addr]=value;
  }
  // 8255 mode 0: per-port direction and bit set/reset for C.
  // Keyboard wiring: PPI A and B connect to both axes of an 8x8 matrix.
  ppiRead(reg) {
    const control=this.ppi[3];
    if(reg===0) return (control&0x10) ? this.keyboard.readA(this.ppi[1]) : this.ppi[0];
    if(reg===1) return (control&0x02) ? this.keyboard.readB(this.ppi[0]) : this.ppi[1];
    if(reg===2) {
      let v=this.ppi[2];
      if((control&0x08) && this.tape.motor) {
        // Běží motor magnetofonu: PC7 = data z pásky, PC5 = hodiny 1 kHz, PC6 = PC4 = 0.
        const now=this.cpu.cycles;
        v=(v&0x0f)|(this.tape.input(now)<<7)|(this.khz1(now)<<5);
      } else if(control&0x08) {
        // Input lines PC4=SHIFT, PC5=CTRL, PC6=FA, PC7=FB are active low.
        let high=0xf0;
        if(this.keyboard.shift)high&=~0x10;
        if(this.keyboard.ctrl) high&=~0x20;
        if(this.keyboard.fa)   high&=~0x40;
        if(this.keyboard.fb)   high&=~0x80;
        v=(v&0x0f)|high;
      }
      if(control&0x01) v=(v&0xf0)|0x0f;
      return v;
    }
    return 0xff; // 8255 control register is write-only
  }
  ppiWrite(reg,value) {
    if(reg===3){
      if(value&0x80){this.ppi=[0,0,0,value];}
      else {const bit=(value>>1)&7;this.ppi[2]=(this.ppi[2]&~(1<<bit))|((value&1)<<bit);}
      return;
    }
    this.ppi[reg]=value;
  }
  setKey(keyCode,down){
    // Original Java emulator uses AWT VK_ENTER=10 and VK_DELETE=127;
    // browser KeyboardEvent.keyCode reports Enter=13 and Backspace=8.
    if (keyCode === 13) keyCode = 10;
    else if (keyCode === 8) keyCode = 127;
    return this.keyboard.key(keyCode,down);
  }
  setBrowserKey(event,down){return this.keyboard.browserKey(event,down)}
  // Klávesa BR: mimo matici, vede na IR5 řadiče 8259. Monitor ho nastaví
  // hranově (ICW1 bit LTIM=0), takže jeden stisk = jedno přerušení. Obsluha
  // v monitoru (skok z 7FF4) uloží registry, vypíše #adresa a vrátí se do
  // příkazového řádku monitoru.
  pressBreak(){this.pic.request(5)}
  ioRead(port) {
    port &= 0xff;
    if(port>=0x84 && port<=0x87) return this.ppiRead(port-0x84);
    if(port===0x88 || port===0x89) return this.pic.read(port-0x88);
    if(port===0xd4 && this.grafik) return this.grafik.read(port);
    if (port>=0xfc) return this.video==='VIDEO64' ? 0xfe : 0xff;
    return 0xff;
  }
  ioWrite(port, value) {
    port &= 0xff; value &= 0xff;
    if(this.ioLog.length < 2048) this.ioLog.push({port,value});
    if(port===0x80) { this.port80=value; if(value&1) this.resetOverlay=false; }
    else if(port>=0x84 && port<=0x87) {
      this.ppiWrite(port-0x84,value);
      this.tapeAfterPpiWrite();
      // reproduktor: PC3 portu C; zaznamenat každé přepnutí s časem v taktech CPU
      const bit = (this.ppi[2] >> 3) & 1;
      if (bit !== this._lastSoundBit) {
        this._lastSoundBit = bit;
        this.soundLog.push({ cycle: this.cpu.cycles, bit });
        if (this.soundLog.length > 65536) this.soundLog.shift();
      }
    }
    else if(port===0x88 || port===0x89) this.pic.write(port-0x88,value);
    else if(port>=0xd0 && port<=0xd4 && this.grafik) this.grafik.write(port,value);
    else if(port>=0xfc && this.video==='VIDEO64') this.video64DoubleWidthEnabled=!!(value&1);
  }
  // Hardware tick source: 20ms of wall time, independent of video frames.
  // The CPU advances by a matching real-time budget, so IRQ and CPU never drift.
  advanceWallTime(deltaMs) {
    if(!Number.isFinite(deltaMs)||deltaMs<=0)return 0;
    const whole=this.tstateRemainder+deltaMs*this.clockHz/1000;
    let budget=Math.floor(whole);
    this.tstateRemainder=whole-budget;
    const period=this.clockHz*this.irqPeriodMs/1000;
    let executed=0;
    while(executed<budget){
      const next=Math.min(budget-executed,period-this.irqTstates);
      let chunk=0;
      while(chunk<next){const cycles=this.cpu.step();chunk+=cycles;}
      executed+=chunk;
      this.irqTstates+=chunk;
      while(this.irqTstates>=period){this.irqTstates-=period;this.pic.request(6);this.irqCount++;}
    }
    this.tapeOutFlush();
    return executed;
  }
  drainSound() { const l = this.soundLog; this.soundLog = []; return l; }
  runInstructions(count=1) {
    let tstates=0;
    for(let i=0;i<count;i++) tstates+=this.cpu.step();
    return tstates;
  }
}
