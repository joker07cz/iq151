// intel8080.js — jádro Intel 8080 (MHB8080A) pro emulátor PMD 85
// ES modul. Zná pouze rozhraní sběrnice: memRead/memWrite/ioRead/ioWrite.
// Příznaky řešeny hardwarově věrně (AC přes doplňkový součet), ověřeno
// proti bootu monitoru PMD 85.1.

const PARITY = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let p = 0, v = i;
  while (v) { p ^= (v & 1); v >>= 1; }
  PARITY[i] = p ? 0 : 1; // 1 = sudá parita
}

// délka instrukce v taktech (základní; podmíněné návraty/volání řešeny zvlášť)
const CYC = [
  4,10,7,5,5,5,7,4, 4,10,7,5,5,5,7,4,   // 00
  4,10,7,5,5,5,7,4, 4,10,7,5,5,5,7,4,   // 10
  4,10,16,5,5,5,7,4, 4,10,16,5,5,5,7,4, // 20
  4,10,13,5,10,10,10,4, 4,10,13,5,5,5,7,4, // 30
  5,5,5,5,5,5,7,5, 5,5,5,5,5,5,7,5,     // 40
  5,5,5,5,5,5,7,5, 5,5,5,5,5,5,7,5,     // 50
  5,5,5,5,5,5,7,5, 5,5,5,5,5,5,7,5,     // 60
  7,7,7,7,7,7,7,7, 5,5,5,5,5,5,7,5,     // 70
  4,4,4,4,4,4,7,4, 4,4,4,4,4,4,7,4,     // 80
  4,4,4,4,4,4,7,4, 4,4,4,4,4,4,7,4,     // 90
  4,4,4,4,4,4,7,4, 4,4,4,4,4,4,7,4,     // A0
  4,4,4,4,4,4,7,4, 4,4,4,4,4,4,7,4,     // B0
  5,10,10,10,11,11,7,11, 5,10,10,10,11,17,7,11, // C0
  5,10,10,10,11,11,7,11, 5,10,10,10,11,17,7,11, // D0
  5,10,10,18,11,11,7,11, 5,5,10,5,11,17,7,11,   // E0
  5,10,10,4,11,11,7,11, 5,5,10,4,11,17,7,11,    // F0
];

export class Intel8080 {
  constructor(bus) {
    this.bus = bus;
    this.reset();
  }

  reset() {
    this.a = 0; this.b = 0; this.c = 0; this.d = 0;
    this.e = 0; this.h = 0; this.l = 0;
    this.sp = 0xFFFF; this.pc = 0x0000;
    this.fs = false; this.fz = false; this.fac = false;
    this.fp = false; this.fcy = false;
    this.inte = false;   // interrupt enable
    this.halted = false;
    this.pendingIrq = -1;
    this.cycles = 0;
  }

  // ---- pomocné ----
  setZSP(v) { this.fz = (v === 0); this.fs = (v & 0x80) !== 0; this.fp = PARITY[v] === 1; }

  getF() {
    return (this.fs ? 0x80 : 0) | (this.fz ? 0x40 : 0) | (this.fac ? 0x10 : 0) |
           (this.fp ? 0x04 : 0) | 0x02 | (this.fcy ? 0x01 : 0);
  }
  setF(v) {
    this.fs = (v & 0x80) !== 0; this.fz = (v & 0x40) !== 0;
    this.fac = (v & 0x10) !== 0; this.fp = (v & 0x04) !== 0; this.fcy = (v & 0x01) !== 0;
  }

  get hl() { return (this.h << 8) | this.l; }
  set hl(v) { this.h = (v >> 8) & 0xFF; this.l = v & 0xFF; }
  get bc() { return (this.b << 8) | this.c; }
  set bc(v) { this.b = (v >> 8) & 0xFF; this.c = v & 0xFF; }
  get de() { return (this.d << 8) | this.e; }
  set de(v) { this.d = (v >> 8) & 0xFF; this.e = v & 0xFF; }

  rd(addr) { return this.bus.memRead(addr & 0xFFFF) & 0xFF; }
  wr(addr, v) { this.bus.memWrite(addr & 0xFFFF, v & 0xFF); }
  rd16(addr) { return this.rd(addr) | (this.rd(addr + 1) << 8); }
  wr16(addr, v) { this.wr(addr, v & 0xFF); this.wr(addr + 1, (v >> 8) & 0xFF); }

  fetch() { const v = this.rd(this.pc); this.pc = (this.pc + 1) & 0xFFFF; return v; }
  fetch16() { const lo = this.fetch(); const hi = this.fetch(); return lo | (hi << 8); }

  push(v) { this.sp = (this.sp - 2) & 0xFFFF; this.wr16(this.sp, v); }
  pop() { const v = this.rd16(this.sp); this.sp = (this.sp + 2) & 0xFFFF; return v; }

  // ---- ALU ----
  add8(x, cyin) {
    const a = this.a, r = a + x + cyin;
    this.fac = ((a & 0xF) + (x & 0xF) + cyin) > 0xF;
    this.fcy = r > 0xFF;
    const res = r & 0xFF; this.setZSP(res); this.a = res;
  }
  sub8(x, borrow) {
    const a = this.a, cyin = borrow ? 0 : 1, nb = (~x) & 0xFF, r = a + nb + cyin;
    this.fac = ((a & 0xF) + (nb & 0xF) + cyin) > 0xF;
    this.fcy = !(r > 0xFF); // borrow = žádný přenos ven
    const res = r & 0xFF; this.setZSP(res); this.a = res;
  }
  cmp8(x) {
    const a = this.a, nb = (~x) & 0xFF, r = a + nb + 1;
    this.fac = ((a & 0xF) + (nb & 0xF) + 1) > 0xF;
    this.fcy = !(r > 0xFF);
    this.setZSP(r & 0xFF);
  }
  ana8(x) { const r = this.a & x; this.fac = ((this.a | x) & 0x08) !== 0; this.fcy = false; this.setZSP(r); this.a = r; }
  xra8(x) { const r = this.a ^ x; this.fac = false; this.fcy = false; this.setZSP(r); this.a = r; }
  ora8(x) { const r = this.a | x; this.fac = false; this.fcy = false; this.setZSP(r); this.a = r; }
  inr8(v) { const r = (v + 1) & 0xFF; this.fac = (v & 0xF) === 0xF; this.setZSP(r); return r; }
  dcr8(v) { const r = (v - 1) & 0xFF; this.fac = (v & 0xF) !== 0x0; this.setZSP(r); return r; }
  dad(rp) { const r = this.hl + rp; this.fcy = r > 0xFFFF; this.hl = r & 0xFFFF; }

  daa() {
    let a = this.a, add = 0, cy = this.fcy;
    if (this.fac || (a & 0x0F) > 9) add |= 0x06;
    if (this.fcy || (a >> 4) > 9 || ((a >> 4) === 9 && (a & 0x0F) > 9)) { add |= 0x60; cy = true; }
    this.fac = ((a & 0x0F) + (add & 0x0F)) > 0x0F;
    a = (a + add) & 0xFF;
    this.setZSP(a); this.fcy = cy; this.a = a;
  }

  // vyvolání HW přerušení (RST vektor 0..7). Uplatní se, je-li INTE.
  requestInterrupt(rst) { this.pendingIrq = rst & 7; }

  step() {
    // External 8259 responds with a CALL instruction and vector address
    // during the three 8080 INTA cycles (not a synthetic RST).
    const pic=this.interruptController;
    if(this.inte && pic){const line=pic.pending();if(line>=0){
      pic.acknowledge(line);this.inte=false;this.halted=false;
      this.push(this.pc);this.pc=pic.vector(line);
      this.cycles+=17;return 17;
    }}
    // legacy RST interrupt path
    if (this.inte && this.pendingIrq >= 0) {
      this.inte = false; this.halted = false;
      const v = this.pendingIrq; this.pendingIrq = -1;
      this.push(this.pc); this.pc = v * 8;
      this.cycles += 11; return 11;
    }
    if (this.halted) { this.cycles += 4; return 4; }

    const op = this.fetch();
    let extra = 0;
    const r = this;

    switch (op) {
      // --- přesuny / MVI / LXI ---
      case 0x00: case 0x08: case 0x10: case 0x18: case 0x20:
      case 0x28: case 0x30: case 0x38: break; // NOP (+ nedok.)
      case 0x01: r.bc = r.fetch16(); break;
      case 0x11: r.de = r.fetch16(); break;
      case 0x21: r.hl = r.fetch16(); break;
      case 0x31: r.sp = r.fetch16(); break;

      case 0x02: r.wr(r.bc, r.a); break;
      case 0x12: r.wr(r.de, r.a); break;
      case 0x0A: r.a = r.rd(r.bc); break;
      case 0x1A: r.a = r.rd(r.de); break;
      case 0x22: { const ad = r.fetch16(); r.wr16(ad, r.hl); break; }
      case 0x2A: { const ad = r.fetch16(); r.hl = r.rd16(ad); break; }
      case 0x32: { const ad = r.fetch16(); r.wr(ad, r.a); break; }
      case 0x3A: { const ad = r.fetch16(); r.a = r.rd(ad); break; }

      case 0x06: r.b = r.fetch(); break;
      case 0x0E: r.c = r.fetch(); break;
      case 0x16: r.d = r.fetch(); break;
      case 0x1E: r.e = r.fetch(); break;
      case 0x26: r.h = r.fetch(); break;
      case 0x2E: r.l = r.fetch(); break;
      case 0x36: r.wr(r.hl, r.fetch()); break;
      case 0x3E: r.a = r.fetch(); break;

      // --- INX/DCX ---
      case 0x03: r.bc = (r.bc + 1) & 0xFFFF; break;
      case 0x13: r.de = (r.de + 1) & 0xFFFF; break;
      case 0x23: r.hl = (r.hl + 1) & 0xFFFF; break;
      case 0x33: r.sp = (r.sp + 1) & 0xFFFF; break;
      case 0x0B: r.bc = (r.bc - 1) & 0xFFFF; break;
      case 0x1B: r.de = (r.de - 1) & 0xFFFF; break;
      case 0x2B: r.hl = (r.hl - 1) & 0xFFFF; break;
      case 0x3B: r.sp = (r.sp - 1) & 0xFFFF; break;

      // --- INR/DCR ---
      case 0x04: r.b = r.inr8(r.b); break;
      case 0x0C: r.c = r.inr8(r.c); break;
      case 0x14: r.d = r.inr8(r.d); break;
      case 0x1C: r.e = r.inr8(r.e); break;
      case 0x24: r.h = r.inr8(r.h); break;
      case 0x2C: r.l = r.inr8(r.l); break;
      case 0x34: r.wr(r.hl, r.inr8(r.rd(r.hl))); break;
      case 0x3C: r.a = r.inr8(r.a); break;
      case 0x05: r.b = r.dcr8(r.b); break;
      case 0x0D: r.c = r.dcr8(r.c); break;
      case 0x15: r.d = r.dcr8(r.d); break;
      case 0x1D: r.e = r.dcr8(r.e); break;
      case 0x25: r.h = r.dcr8(r.h); break;
      case 0x2D: r.l = r.dcr8(r.l); break;
      case 0x35: r.wr(r.hl, r.dcr8(r.rd(r.hl))); break;
      case 0x3D: r.a = r.dcr8(r.a); break;

      // --- DAD ---
      case 0x09: r.dad(r.bc); break;
      case 0x19: r.dad(r.de); break;
      case 0x29: r.dad(r.hl); break;
      case 0x39: r.dad(r.sp); break;

      // --- rotace, DAA, CMA, STC, CMC ---
      case 0x07: { const cy = r.a >> 7; r.a = ((r.a << 1) | cy) & 0xFF; r.fcy = !!cy; break; }
      case 0x0F: { const cy = r.a & 1; r.a = ((r.a >> 1) | (cy << 7)) & 0xFF; r.fcy = !!cy; break; }
      case 0x17: { const cy = r.a >> 7; r.a = ((r.a << 1) | (r.fcy ? 1 : 0)) & 0xFF; r.fcy = !!cy; break; }
      case 0x1F: { const cy = r.a & 1; r.a = ((r.a >> 1) | (r.fcy ? 0x80 : 0)) & 0xFF; r.fcy = !!cy; break; }
      case 0x27: r.daa(); break;
      case 0x2F: r.a = (~r.a) & 0xFF; break;
      case 0x37: r.fcy = true; break;
      case 0x3F: r.fcy = !r.fcy; break;

      // --- MOV r,r (0x40-0x7F) mimo HLT(0x76) ---
      case 0x76: r.halted = true; break;
      default:
        if (op >= 0x40 && op < 0x80) {
          const src = op & 7, dst = (op >> 3) & 7;
          const val = r.getReg(src);
          r.setReg(dst, val);
        } else if (op >= 0x80 && op < 0xC0) {
          const val = r.getReg(op & 7);
          switch ((op >> 3) & 7) {
            case 0: r.add8(val, 0); break;
            case 1: r.add8(val, r.fcy ? 1 : 0); break;
            case 2: r.sub8(val, 0); break;
            case 3: r.sub8(val, r.fcy ? 1 : 0); break;
            case 4: r.ana8(val); break;
            case 5: r.xra8(val); break;
            case 6: r.ora8(val); break;
            case 7: r.cmp8(val); break;
          }
        } else {
          extra = r.doControl(op);
        }
        break;

      // --- immediate ALU ---
      case 0xC6: r.add8(r.fetch(), 0); break;
      case 0xCE: r.add8(r.fetch(), r.fcy ? 1 : 0); break;
      case 0xD6: r.sub8(r.fetch(), 0); break;
      case 0xDE: r.sub8(r.fetch(), r.fcy ? 1 : 0); break;
      case 0xE6: r.ana8(r.fetch()); break;
      case 0xEE: r.xra8(r.fetch()); break;
      case 0xF6: r.ora8(r.fetch()); break;
      case 0xFE: r.cmp8(r.fetch()); break;

      // --- řízení / zásobník / IO — deleguji ---
      case 0xC0: case 0xC8: case 0xC9: case 0xD0: case 0xD8:
      case 0xC2: case 0xCA: case 0xD2: case 0xDA: case 0xE2: case 0xEA: case 0xF2: case 0xFA:
      case 0xC3: case 0xCB:
      case 0xC4: case 0xCC: case 0xCD: case 0xDC: case 0xD4: case 0xE4: case 0xEC: case 0xF4: case 0xFC: case 0xDD: case 0xED: case 0xFD:
      case 0xC7: case 0xCF: case 0xD7: case 0xDF: case 0xE7: case 0xEF: case 0xF7: case 0xFF:
      case 0xC1: case 0xD1: case 0xE1: case 0xF1:
      case 0xC5: case 0xD5: case 0xE5: case 0xF5:
      case 0xE0: case 0xE8: case 0xF0: case 0xF8:
      case 0xD3: case 0xDB:
      case 0xE3: case 0xE9: case 0xEB: case 0xF9: case 0xF3: case 0xFB: case 0xD9:
        extra = r.doControl(op); break;
    }

    const base = CYC[op] || 4;
    this.cycles += base + extra;
    return base + extra;
  }

  getReg(i) {
    switch (i) {
      case 0: return this.b; case 1: return this.c; case 2: return this.d; case 3: return this.e;
      case 4: return this.h; case 5: return this.l; case 6: return this.rd(this.hl); case 7: return this.a;
    }
  }
  setReg(i, v) {
    v &= 0xFF;
    switch (i) {
      case 0: this.b = v; break; case 1: this.c = v; break; case 2: this.d = v; break; case 3: this.e = v; break;
      case 4: this.h = v; break; case 5: this.l = v; break; case 6: this.wr(this.hl, v); break; case 7: this.a = v; break;
    }
  }

  // vrací PŘÍDAVNÉ takty (u splněných podmíněných CALL/RET)
  doControl(op) {
    const r = this;
    switch (op) {
      // podmíněné návraty
      case 0xC0: if (!r.fz) { r.pc = r.pop(); return 6; } return 0;
      case 0xC8: if (r.fz) { r.pc = r.pop(); return 6; } return 0;
      case 0xD0: if (!r.fcy) { r.pc = r.pop(); return 6; } return 0;
      case 0xD8: if (r.fcy) { r.pc = r.pop(); return 6; } return 0;
      case 0xE0: if (!r.fp) { r.pc = r.pop(); return 6; } return 0;
      case 0xE8: if (r.fp) { r.pc = r.pop(); return 6; } return 0;
      case 0xF0: if (!r.fs) { r.pc = r.pop(); return 6; } return 0;
      case 0xF8: if (r.fs) { r.pc = r.pop(); return 6; } return 0;
      case 0xC9: case 0xD9: r.pc = r.pop(); return 0; // RET (0xD9 = *RET)

      // skoky
      case 0xC3: case 0xCB: r.pc = r.fetch16(); return 0;
      case 0xC2: { const a = r.fetch16(); if (!r.fz) r.pc = a; return 0; }
      case 0xCA: { const a = r.fetch16(); if (r.fz) r.pc = a; return 0; }
      case 0xD2: { const a = r.fetch16(); if (!r.fcy) r.pc = a; return 0; }
      case 0xDA: { const a = r.fetch16(); if (r.fcy) r.pc = a; return 0; }
      case 0xE2: { const a = r.fetch16(); if (!r.fp) r.pc = a; return 0; }
      case 0xEA: { const a = r.fetch16(); if (r.fp) r.pc = a; return 0; }
      case 0xF2: { const a = r.fetch16(); if (!r.fs) r.pc = a; return 0; }
      case 0xFA: { const a = r.fetch16(); if (r.fs) r.pc = a; return 0; }

      // volání
      case 0xCD: case 0xDD: case 0xED: case 0xFD: { const a = r.fetch16(); r.push(r.pc); r.pc = a; return 0; }
      case 0xC4: { const a = r.fetch16(); if (!r.fz) { r.push(r.pc); r.pc = a; return 6; } return 0; }
      case 0xCC: { const a = r.fetch16(); if (r.fz) { r.push(r.pc); r.pc = a; return 6; } return 0; }
      case 0xD4: { const a = r.fetch16(); if (!r.fcy) { r.push(r.pc); r.pc = a; return 6; } return 0; }
      case 0xDC: { const a = r.fetch16(); if (r.fcy) { r.push(r.pc); r.pc = a; return 6; } return 0; }
      case 0xE4: { const a = r.fetch16(); if (!r.fp) { r.push(r.pc); r.pc = a; return 6; } return 0; }
      case 0xEC: { const a = r.fetch16(); if (r.fp) { r.push(r.pc); r.pc = a; return 6; } return 0; }
      case 0xF4: { const a = r.fetch16(); if (!r.fs) { r.push(r.pc); r.pc = a; return 6; } return 0; }
      case 0xFC: { const a = r.fetch16(); if (r.fs) { r.push(r.pc); r.pc = a; return 6; } return 0; }

      // RST
      case 0xC7: case 0xCF: case 0xD7: case 0xDF: case 0xE7: case 0xEF: case 0xF7: case 0xFF:
        r.push(r.pc); r.pc = op & 0x38; return 0;

      // zásobník
      case 0xC1: r.bc = r.pop(); return 0;
      case 0xD1: r.de = r.pop(); return 0;
      case 0xE1: r.hl = r.pop(); return 0;
      case 0xF1: { const v = r.pop(); r.a = (v >> 8) & 0xFF; r.setF(v & 0xFF); return 0; }
      case 0xC5: r.push(r.bc); return 0;
      case 0xD5: r.push(r.de); return 0;
      case 0xE5: r.push(r.hl); return 0;
      case 0xF5: r.push((r.a << 8) | r.getF()); return 0;

      // ostatní
      case 0xE3: { const t = r.rd16(r.sp); r.wr16(r.sp, r.hl); r.hl = t; return 0; } // XTHL
      case 0xE9: r.pc = r.hl; return 0;      // PCHL
      case 0xEB: { const t = r.hl; r.hl = r.de; r.de = t; return 0; } // XCHG
      case 0xF9: r.sp = r.hl; return 0;      // SPHL
      case 0xF3: r.inte = false; return 0;   // DI
      case 0xFB: r.inte = true; return 0;    // EI

      // IO
      case 0xD3: { const p = r.fetch(); r.bus.ioWrite(p, r.a); return 0; }
      case 0xDB: { const p = r.fetch(); r.a = r.bus.ioRead(p) & 0xFF; return 0; }
    }
    return 0;
  }
}
