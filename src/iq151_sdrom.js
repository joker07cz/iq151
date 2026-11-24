// Modul SD-ROM (porty F8–FB, 8255). Port SDRom.java z Java emulátoru IQ 151.
// Java emuluje ATmegu modulu vláknem; tady je to generátor (function*): každé `yield`
// je místo, kde vlákno čeká na IQ. pump() generátor posouvá, dokud dělá postup.
import { I8255, PP } from './i8255.js';
import { LOADER_NAME, splitPath } from './sd_disk.js';

const BUF = 4096;          // nBufferSize
const FAT_MAX_PATH = 128;
const STARTUP_CYCLES = 2048000;  // ~1 s po resetu, než se SD-ROM „probudí“ (jako sleep(1000) v Javě)
const PUMP_LIMIT = 20000;
// Skutečný modul otevírá soubor / čte adresář na SD kartě desítky ms, než pošle první bajt. Monitor (příkaz L)
// na začátku jedním IN A,(F8) zahodí případný starý bajt — kdyby první bajt přišel dřív, ztratí se (např. ':').
const SD_LATENCY_CYCLES = 100000;  // ~50 ms

const enc = s => Array.from(s, c => c.charCodeAt(0) & 0xff);

export class SdRom {
  constructor(disk, { now = () => 0 } = {}) {
    this.disk = disk;
    this.now = now;           // aktuální takt CPU (zpoždění po resetu)
    this.onLed = null;
    this.reset();
  }

  reset() {
    this.pio = new I8255();
    this.bit2status = 1; this.bit5status = 0;
    this.bSdromIn = false;
    this.bSav = false;
    this.led = false;
    this.ops = 0;             // počet zápisů do 8255 ze strany SD-ROM (měřítko postupu)
    this.saveInterrupt = null;
    this.startCycle = this.now();
    this.main = this._run();
    this.done = false;
  }

  _led(on) { if (this.led !== on) { this.led = on; if (this.onLed) this.onLed(on); } }
  _blink() { this._led(!this.led); }

  // ---- posouvání „vlákna“ ----------------------------------------------
  pump() {
    this._drive('main');
    if (this.saveInterrupt) this._drive('saveInterrupt');
  }

  _drive(which) {
    const gen = which === 'main' ? this.main : this.saveInterrupt;
    if (!gen || (which === 'main' && this.done)) return;
    for (let i = 0; i < PUMP_LIMIT; i++) {
      const before = this.ops;
      const r = gen.next();
      if (r.done) {
        if (which === 'main') this.done = true; else this.saveInterrupt = null;
        return;
      }
      // 'handoff' = m.yield() v Javě: předat řízení IQ; jinak končí, když čeká na IQ a nic neudělalo
      if (r.value === 'handoff' || this.ops === before) return;
    }
  }

  // ---- strana CPU (porty F8–FB) ----------------------------------------
  ioRead(port) {
    const r = this.pio.cpuRead(port - 0xf8);
    this.pump();
    return r;
  }

  ioWrite(port, value) {
    const reg = port - 0xf8;
    if (reg === PP.CWR) {
      // změna směru toku dat: počkat, až SD-ROM dokončí svou část (v Javě blokuje CPU)
      if (value === 180) for (let i = 0; i < 1000 && this.bSdromIn; i++) this.pump();
      this.pio.cpuWrite(reg, value);
      if (value === 129) for (let i = 0; i < 1000 && !this.bSdromIn; i++) this.pump();
      // sekvence 14, 13 = IQ chce ukládat soubor (přerušení ATmegy)
      if (!this.bSav && value === 14) this.bSav = true;
      else if (this.bSav && value === 13) {
        if (!this.saveInterrupt) this.saveInterrupt = this._prijemSouboru();
      } else this.bSav = false;
    } else {
      this.pio.cpuWrite(reg, value);
    }
    this.pump();
  }

  // ---- strana periferie: primitiva z SDRom.java ---------------------------
  _portInput() { this.bit2status = 1; this.bit5status = 0; }

  // Java: m.yield() na začátku — IQ má dostat šanci provést svůj zápis CWR (180) dřív, než SD-ROM pošle první bajt.
  *_portOutput() {
    yield 'handoff';
    this.pio.cpuWrite(PP.CWR, 180);
    this.pio.cpuWrite(PP.CWR, 9);
    this.pio.cpuWrite(PP.CWR, 5);
    this.ops++;
  }

  *_latency() {
    const t = this.now();
    while (this.now() - t < SD_LATENCY_CYCLES) yield;
  }

  _sendByte(c) { this.pio.peripheralWriteByte(PP.A, c & 0xff); this.ops++; }
  _sendStrobe(v) { this.pio.peripheralChangeBit(PP.C, 4, v === 1); this.ops++; }
  _isAck() { return this.pio.peripheralReadBit(PP.C, 5); }
  _sendOutAck(v) { this.pio.peripheralChangeBit(PP.C, 2, v === 1); this.ops++; }
  _isOutStrobe() { return this.pio.peripheralReadBit(PP.C, 1); }

  // Čte 1 bajt z IQ (bit-bang). Vrací bajt přes `yield*`.
  *_readByte() {
    this._blink();
    if (this.bit2status === 0) { this.pio.peripheralChangeBit(PP.C, 2, false); this.bit2status = 1; }
    else { this.pio.peripheralChangeBit(PP.C, 2, true); this.bit2status = 0; }
    this.ops++;
    while (this._isAck() === (this.bit5status === 1)) yield;
    this.bit5status = this.bit5status === 0 ? 1 : 0;
    return this.pio.peripheralReadByte(PP.A);
  }

  // Standardní přenos modul → IQ (mód 2). `buf` má za posledním bajtem nulu (jako v Javě).
  *_send2IQOfficial(buf, cnt, detect) {
    let ret = 0;
    this._led(true);
    this._sendStrobe(1);
    for (let k = 0; k < cnt; k++) {
      this._blink();
      this._sendByte(buf[k]);
      this._sendStrobe(0);
      this._sendStrobe(1);
      // konec HEX (záznam typu 01): IQ posledních 2 bajty nenačítá
      if (cnt - k < 13 && k >= 8) {
        if (buf[k - 7] === 0x3a && buf[k - 6] === 0x30 && buf[k - 5] === 0x30 && buf[k] === 0x30) {
          if (k + 1 <= cnt && buf[k + 1] === 0x31) {
            ret = 1;
            if (detect === 1) break;
          }
        }
      }
      while (this._isAck()) yield;
    }
    return ret;
  }

  // Prostý přenos (výpis adresáře): bajt po bajtu s potvrzením.
  *_send2IQ(bytes) {
    this._sendStrobe(1);
    for (const b of bytes) {
      this._blink();
      this._sendByte(b);
      this._sendStrobe(0);
      this._sendStrobe(1);
      while (this._isAck()) yield;
    }
  }

  // ---- hlavní smyčka ATmegy ---------------------------------------------
  *_run() {
    // počkat na inicializaci IQ
    while (this.now() - this.startCycle < STARTUP_CYCLES) yield;
    yield* this._portOutput();

    // __BLOADER.BAS se nabízí hned, IQ si ho vyzvedne po PTAPE / (0003)=55 + L
    const loader = this.disk.read(LOADER_NAME);
    if (loader) {
      for (let off = 0; off < loader.length; off += BUF - 1) {
        const chunk = loader.subarray(off, Math.min(off + BUF - 1, loader.length));
        const buf = new Uint8Array(chunk.length + 1); buf.set(chunk);
        yield* this._send2IQOfficial(buf, chunk.length, 1);
      }
    }

    // loader odeslán, čekám na příkazy z IQ
    this._portInput();
    this.bSdromIn = true;
    for (;;) {
      this._led(true);
      const cmd = yield* this._readByte();
      if (cmd === 130) yield* this._posliDir();
      else if (cmd === 131) { yield* this._posliSoubor(); break; }   // po odeslání souboru ATmega končí (jako v Javě)
      // jiný bajt se ignoruje
    }
    this._led(false);
  }

  *_readPath() {
    const len = yield* this._readByte();
    if (len > FAT_MAX_PATH) return null;
    let s = '';
    for (let k = 0; k < len; k++) s += String.fromCharCode(yield* this._readByte());
    return s;
  }

  *_posliDir() {
    const dir = yield* this._readPath();
    if (dir === null) return;
    this.bSdromIn = false;
    yield* this._portOutput();
    yield* this._latency();

    const segs = splitPath(dir);
    if (segs.length) yield* this._send2IQ([0x2f, 0x2e, 0x2e, 0]);     // "/.." — o úroveň výš
    const ls = this.disk.list('/' + segs.join('/')) || { dirs: [], files: [] };
    for (const d of ls.dirs) {
      yield* this._send2IQ([0x2f]);                                  // adresář začíná lomítkem
      yield* this._send2IQ(enc(d));
      yield* this._send2IQ([0]);
    }
    for (const f of ls.files) {
      if (f.toLowerCase() === LOADER_NAME.toLowerCase()) continue;
      yield* this._send2IQ(enc(f));
      yield* this._send2IQ([0]);
    }
    yield* this._send2IQ([13]);                                       // konec bloku
    this._portInput();
    this.bSdromIn = true;
    this._led(false);
  }

  *_posliSoubor() {
    const name = yield* this._readPath();
    if (name === null) return;
    this.bSdromIn = false;
    yield* this._portOutput();
    yield* this._latency();

    const data = this.disk.read(name);
    if (data) {
      let nTyp = 0, nKon = 0, last = null, lastCnt = 0;
      for (let off = 0; off < data.length; off += BUF - 1) {
        const chunk = data.subarray(off, Math.min(off + BUF - 1, data.length));
        const cnt = chunk.length;
        const buf = new Uint8Array(cnt + 1); buf.set(chunk);
        let size = cnt;
        // ESC na konci = konec BASICového programu
        if (cnt >= 3) {
          if (buf[cnt - 3] === 0x1b) { size -= 2; nKon = 1; }
          if (buf[cnt - 2] === 0x1b) { size -= 1; nKon = 1; }
          if (buf[cnt - 1] === 0x1b) nKon = 1;
        }
        nTyp = yield* this._send2IQOfficial(buf, size, cnt < BUF - 1 ? 1 : 0);
        last = buf; lastCnt = cnt;
        if (nKon === 1) break;
      }
      if (nTyp === 0 && last && lastCnt >= 3) {
        // nebinární data: pro jistotu poslat ESC, pokud ho BASICový soubor neobsahuje
        if (last[lastCnt - 3] !== 0x1b && last[lastCnt - 2] !== 0x1b && last[lastCnt - 1] !== 0x1b)
          yield* this._send2IQOfficial(Uint8Array.of(0x1b, 0), 1, 0);
      }
    }
    this._portInput();
    this.bSdromIn = true;
    this._led(false);
  }

  // ---- ukládání IQ → SD (přerušení ATmegy) -------------------------------
  *_prijemSouboru() {
    const tail = new Array(13).fill(0);      // posledních 13 přijatých bajtů, [0] = nejnovější
    const bytes = [];
    let nTyp = 0;
    yield* this._portOutput();
    this._sendOutAck(1);
    for (;;) {
      this._blink();
      while (this._isOutStrobe()) yield;      // čekám, až IQ připraví data
      this._sendOutAck(0);
      const b = this.pio.peripheralReadByte(PP.B);
      if (b !== 0) {                          // jen nenulové bajty
        tail.unshift(b); tail.length = 13;
        bytes.push(b);
        // konec BASICového programu: ESC CR LF
        if (tail[2] === 0x1b && tail[1] === 0x0d && tail[0] === 0x0a) {
          for (let i = 0; i < 64; i++) {      // následuje 64 nul
            while (!this._isOutStrobe()) yield;
            this._sendOutAck(1);
            while (this._isOutStrobe()) yield;
            this._sendOutAck(0);
          }
          nTyp = 0;
          break;
        }
        // konec HEX: :00 .... 01 CR LF
        if (tail[12] === 0x3a && tail[11] === 0x30 && tail[10] === 0x30 && tail[5] === 0x30 &&
            tail[4] === 0x31 && tail[1] === 0x0d && tail[0] === 0x0a) {
          nTyp = 1;
          break;
        }
      }
      while (!this._isOutStrobe()) yield;     // čekám na vzestupnou hranu
      this._sendOutAck(1);                    // IQ může poslat další bajt
    }
    const num = String(this.disk.nextSaveNumber()).padStart(3, '0');
    this.disk.write(`/save${num}.${nTyp === 0 ? 'bas' : 'hex'}`, Uint8Array.from(bytes));
    this._led(false);
    this.bSav = false;
  }
}
