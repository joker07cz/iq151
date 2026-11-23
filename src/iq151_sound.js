// iq151_sound.js — reproduktor IQ 151 (PC3 portu C 8255, 1 bit).
//
// SpeakerRenderer: čistá logika bez Web Audia. Z časů přepnutí bitu (v taktech CPU) vyrobí PCM tak, že
//  - stav (úroveň bitu, rozpracovaný vzorek, filtr) se přenáší mezi voláními, takže mezi snímky nevznikají
//    skoky ani mezery a výstup nezávisí na tom, jak se události rozdělí do snímků;
//  - každý výstupní vzorek je přesný průměr bitu přes svůj časový úsek (a ne vzorek v jednom bodě), takže se
//    neztratí úzké pulzy (Manic Miner dělá hlasitost šířkou pulzu 30–90 µs) a tón nekolísá;
//  - stejnosměrná složka se odstraní jednopólovým filtrem (žádné lupnutí při zapnutí / vypnutí).
// IqSound: přehrávání bez mezer (AudioBufferSource navazující na sebe v čase) s malým zpožděním, které
//  pohltí kolísání rAF. Kmitočet CPU se bere z emulátoru (iq.clockHz), stejný pro běh i zvuk.

export class SpeakerRenderer {
  constructor(clockHz, sampleRate, { gain = 0.5, hp = 0.995 } = {}) {
    this.clockHz = clockHz;
    this.sampleRate = sampleRate;
    this.gain = gain;
    this.hp = hp;
    this.spc = clockHz / sampleRate;   // taktů CPU na výstupní vzorek
    this.bit = 0;
    this.reset(0);
  }

  // začít od taktu `cycle` (po resetu stroje, po pauze); úroveň bitu a filtr se zachovají
  reset(cycle, bit = this.bit) {
    this.base = cycle;      // takt, od kterého se měří vzorky
    this.n = 0;             // počet hotových vzorků od base
    this.cur = cycle;       // dokud je zpracováno
    this.acc = 0;           // plocha rozpracovaného vzorku (takty * bit)
    this.bit = bit;
    this.px = 0; this.py = 0;
  }

  // události [{cycle, bit}] (vzestupně, cycle <= untilCycle) a konec úseku untilCycle -> Float32Array nových vzorků
  render(events, untilCycle) {
    if (untilCycle < this.cur) this.reset(untilCycle);            // stroj se resetoval (čítač taktů šel zpět)
    const total = Math.floor((untilCycle - this.base) / this.spc);
    const out = new Float32Array(Math.max(0, total - this.n));
    let o = 0;
    const adv = to => {
      let a = this.cur;
      while (a < to) {
        const end = this.base + (this.n + 1) * this.spc;          // konec rozpracovaného vzorku
        if (end <= to) {
          this.acc += this.bit * (end - a);
          const x = (this.acc / this.spc - 0.5) * 2 * this.gain;
          const y = x - this.px + this.hp * this.py;               // jednopólový filtr stejnosměrné složky
          this.px = x; this.py = y;
          if (o < out.length) out[o++] = y;
          this.acc = 0; this.n++; a = end;
        } else { this.acc += this.bit * (to - a); a = to; }
      }
      this.cur = to;
    };
    for (const e of events) {
      const c = e.cycle !== undefined ? e.cycle : e[0], b = e.bit !== undefined ? e.bit : e[1];
      adv(Math.max(this.cur, Math.min(c, untilCycle)));
      this.bit = b;
    }
    adv(untilCycle);
    return o === out.length ? out : out.subarray(0, o);
  }
}

export class IqSound {
  constructor({ latency = 0.08, maxAhead = 0.3 } = {}) {
    this.ctx = null;
    this.enabled = true;        // výchozí zapnuto (AudioContext stejně začne až po prvním gestu)
    this.latency = latency;     // s mezi vyrenderovaným a přehrávaným (pohltí kolísání rAF)
    this.maxAhead = maxAhead;   // s: víc naplánovaného předstihu se zahodí (emulace předbíhá)
    this.renderer = null;
    this.nextTime = 0;
  }

  ensureStarted() {
    if (this.ctx) { this.wake(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });             // vzorkovací kmitočet zařízení, převzorkovává se v rendereru
    this.ctx.onstatechange = () => this.wake();
  }

  wake() {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === 'running' || ctx.state === 'closed') return;
    ctx.resume().catch(() => {});
  }

  setEnabled(on) {
    this.enabled = on;
    this.nextTime = 0;          // po zapnutí znovu navázat s odstupem
  }

  // volat jednou za snímek po iq.advanceWallTime: log = iq.drainSound(), cycle = iq.cpu.cycles, clockHz = iq.clockHz
  feed(log, cycle, clockHz) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.renderer || this.renderer.clockHz !== clockHz) {
      this.renderer = new SpeakerRenderer(clockHz, ctx.sampleRate);
      this.renderer.reset(cycle);               // začít od teď (nic z doby před prvním gestem uživatele)
      this.nextTime = 0;
      return;
    }
    const pcm = this.renderer.render(log, cycle);   // stav se vždy posouvá, i když je zvuk vypnutý nebo kontext spí
    if (!this.enabled || !pcm.length || ctx.state !== 'running') { this.nextTime = 0; return; }
    const now = ctx.currentTime;
    if (this.nextTime < now + 0.005) this.nextTime = now + this.latency;     // první kus / podtečení: navázat s odstupem
    if (this.nextTime > now + this.maxAhead) return;                         // příliš napřed: zahodit
    const buf = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
    buf.copyToChannel(pcm, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(this.nextTime);
    this.nextTime += pcm.length / ctx.sampleRate;
  }
}
