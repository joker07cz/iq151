// Intel 8255 (PIO) včetně módů 1 a 2 — pro modul SD-ROM (porty F8–FB).
// Převod z Pio8255.java (autor Roman Borik, GPLv3) z Java emulátoru IQ 151.
// Strana CPU: cpuWrite / cpuRead. Strana periferie (SD-ROM): peripheral*.
// Registry portu C: bity 0–7 podle módu (viz datasheet 8255).

export const PP = { A: 0, B: 1, C: 2, CWR: 3 };

const CWR_MASK = 0x80;
const GA_MODE = 0x60, GA_MODE0 = 0x00, GA_MODE1 = 0x20, GA_MODE2 = 0x40;
const PORTA_DIR = 0x10, PORTA_INP = 0x10, PORTA_OUT = 0x00;
const PORTCH_DIR = 0x08, PORTCH_INP = 0x08, PORTCH_OUT = 0x00;
const GB_MODE = 0x04, GB_MODE0 = 0x00, GB_MODE1 = 0x04;
const PORTB_DIR = 0x02, PORTB_INP = 0x02, PORTB_OUT = 0x00;
const PORTCL_DIR = 0x01, PORTCL_INP = 0x01, PORTCL_OUT = 0x00;

const BASIC_CWR = CWR_MASK | GA_MODE0 | PORTA_INP | PORTCH_INP | GB_MODE0 | PORTB_INP | PORTCL_INP;

// Signály portu C v módech 1 a 2
const STBA = 4, IBFA = 5, OBFA = 7, ACKA = 6, INTRA = 3;
const INTEA_IN = 4, INTEA_OUT = 6;
const STBB = 2, IBFB = 1, OBFB = 1, ACKB = 2, INTRB = 0;
const m = b => 1 << b;
const STBA_M = m(STBA), IBFA_M = m(IBFA), OBFA_M = m(OBFA), ACKA_M = m(ACKA), INTRA_M = m(INTRA);
const INTEAIN_M = m(INTEA_IN), INTEAOUT_M = m(INTEA_OUT);
const STBB_M = m(STBB), IBFB_M = m(IBFB), OBFB_M = m(OBFB), ACKB_M = m(ACKB), INTRB_M = m(INTRB);
const INTEB_M = m(2);

export class I8255 {
  constructor() { this.reset(); }

  reset() {
    this.CWR = 0; this.InBufferA = 0; this.InLatchA = 0; this.OutLatchA = 0;
    this.InBufferB = 0; this.InLatchB = 0; this.OutLatchB = 0;
    this.InBufferC = 0; this.OutLatchC = 0;
    this.InteAin = false; this.InteAout = false; this.InteB = false;
    this.cpuWrite(PP.CWR, BASIC_CWR);
    this.InLatchA = 0; this.InLatchB = 0;
  }

  // ---- strana CPU -------------------------------------------------------
  cpuWrite(dest, val) {
    val &= 0xff;
    let oldVal;
    switch (dest) {
      case PP.A:
        this.OutLatchA = val;
        if ((this.CWR & GA_MODE) !== GA_MODE0) this.OutLatchC &= ~(INTRA_M | OBFA_M);
        break;

      case PP.B:
        this.OutLatchB = val;
        if ((this.CWR & GB_MODE) !== GB_MODE0) this.OutLatchC &= ~(INTRB_M | OBFB_M);
        break;

      case PP.C: {
        const cl = (this.CWR & (GB_MODE | PORTCL_DIR)) === (GB_MODE0 | PORTCL_OUT);
        const ch = (this.CWR & (GA_MODE | PORTCH_DIR)) === (GA_MODE0 | PORTCH_OUT);
        if (cl && ch) this.OutLatchC = val;
        else if (cl) this.OutLatchC = (this.OutLatchC & 0xf0) | (val & 0x0f);
        else if (ch) this.OutLatchC = (this.OutLatchC & 0x0f) | (val & 0xf0);
        break;
      }

      case PP.CWR:
        if (val & CWR_MASK) this._setMode(val);
        else this._bitSetReset(val);
        break;
    }
  }

  _setMode(val) {
    this.CWR = val;
    if ((this.CWR & GA_MODE) === GA_MODE) this.CWR &= ~GA_MODE1;

    this.InBufferA = 0xff;
    this.OutLatchA = 0;
    this.InBufferB = 0xff;
    if ((this.CWR & GB_MODE) !== GB_MODE0) this.InLatchB = 0;
    this.OutLatchB = 0;

    this.InBufferC = 0;
    if ((this.CWR & GB_MODE) === GB_MODE0) this.InBufferC |= 0x07;
    if ((this.CWR & GA_MODE) === GA_MODE0) this.InBufferC |= 0xf8;

    this.OutLatchC = 0;
    if ((this.CWR & GB_MODE) !== GB_MODE0) this.OutLatchC |= OBFB_M;
    if ((this.CWR & GA_MODE) !== GA_MODE0) this.OutLatchC |= OBFA_M;

    this.InteAin = false; this.InteAout = false; this.InteB = false;
  }

  _bitSetReset(val) {
    let inte = false;
    val &= 0x0f;
    const mode = this.CWR & (GA_MODE | PORTA_DIR);

    if ((mode === (GA_MODE1 | PORTA_INP) || (this.CWR & GA_MODE) === GA_MODE2) && (val & 0x0e) === 8) {
      this.InteAin = !!(val & 1);
      inte = true;
    } else if ((mode === (GA_MODE1 | PORTA_OUT) || (this.CWR & GA_MODE) === GA_MODE2) && (val & 0x0e) === 12) {
      this.InteAout = !!(val & 1);
      inte = true;
    }

    if (inte) {
      this.OutLatchC &= ~INTRA_M;
      if ((this.InteAin && (this.InBufferC & STBA_M) && (this.OutLatchC & IBFA_M)) ||
          (this.InteAout && (this.InBufferC & ACKA_M) && (this.OutLatchC & OBFA_M))) {
        this.OutLatchC |= INTRA_M;
      }
    }

    if ((this.CWR & GB_MODE) === GB_MODE1 && (val & 0x0e) === 4) {
      this.InteB = !!(val & 1);
      this.OutLatchC &= ~INTRB_M;
      if (this.InteB) {
        if (((this.CWR & PORTB_INP) === PORTB_INP && (this.InBufferC & STBB_M) && (this.OutLatchC & IBFB_M)) ||
            ((this.CWR & PORTB_INP) === 0 && (this.InBufferC & ACKB_M) && (this.OutLatchC & OBFB_M))) {
          this.OutLatchC |= INTRB_M;
        }
      }
      inte = true;
    }

    if (!inte) {
      const clOut = (this.CWR & (GB_MODE | PORTCL_DIR)) === (GB_MODE0 | PORTCL_OUT);
      const clInp = (this.CWR & (GB_MODE | PORTCL_DIR)) === (GB_MODE0 | PORTCL_INP);
      const chOut = (this.CWR & (GA_MODE | PORTCH_DIR)) === (GA_MODE0 | PORTCH_OUT);
      const chInp = (this.CWR & (GA_MODE | PORTCH_DIR)) === (GA_MODE0 | PORTCH_INP);
      const b = val >>> 1;
      if ((clOut && chOut) ||
          (clOut && chInp && b < 4) ||
          (clInp && chOut && b > 3) ||
          (clOut && b < 3) ||
          (chOut && b > 2)) {
        if (val & 1) this.OutLatchC |= (1 << b);
        else this.OutLatchC &= ~(1 << b);
      }
    }
  }

  cpuRead(src) {
    let ret = 0;
    switch (src) {
      case PP.A: {
        const mode = this.CWR & (GA_MODE | PORTA_DIR);
        if (mode === (GA_MODE0 | PORTA_INP)) ret = this.InBufferA;
        if (mode === (GA_MODE0 | PORTA_OUT)) ret = this.OutLatchA & this.InBufferA;
        if (mode === (GA_MODE1 | PORTA_OUT)) ret = this.OutLatchA;
        if (mode === (GA_MODE1 | PORTA_INP) || (this.CWR & GA_MODE) === GA_MODE2) {
          ret = this.InLatchA;
          this.OutLatchC &= ~(INTRA_M | IBFA_M);   // /RD nuluje INTRA a IBFA
        }
        break;
      }

      case PP.B: {
        const mode = this.CWR & (GB_MODE | PORTB_DIR);
        if (mode === (GB_MODE0 | PORTB_OUT)) ret = this.OutLatchB;
        if (mode === (GB_MODE0 | PORTB_INP)) ret = this.InBufferB;
        if (mode === (GB_MODE1 | PORTB_OUT)) ret = this.OutLatchB;
        if (mode === (GB_MODE1 | PORTB_INP)) {
          ret = this.InLatchB;
          this.OutLatchC &= ~(INTRB_M | IBFB_M);
        }
        break;
      }

      case PP.C: {
        const cwr = this.CWR;
        if ((cwr & (GB_MODE | PORTCL_DIR)) === (GB_MODE0 | PORTCL_OUT)) ret |= this.OutLatchC & 0x0f;
        if ((cwr & (GB_MODE | PORTCL_DIR)) === (GB_MODE0 | PORTCL_INP)) ret |= this.InBufferC & 0x0f;
        if ((cwr & (GA_MODE | PORTCH_DIR)) === (GA_MODE0 | PORTCH_OUT)) ret |= this.OutLatchC & 0xf0;
        if ((cwr & (GA_MODE | PORTCH_DIR)) === (GA_MODE0 | PORTCH_INP)) ret |= this.InBufferC & 0xf0;

        switch (cwr & GA_MODE) {
          case GA_MODE1:
            if ((cwr & PORTA_DIR) === PORTA_INP) {
              ret &= 0xc7;
              if (this.InteAin) ret |= INTEAIN_M;
              ret |= this.OutLatchC & IBFA_M;
            } else {
              ret &= 0x37;
              if (this.InteAout) ret |= INTEAOUT_M;
              ret |= this.OutLatchC & OBFA_M;
            }
            ret |= this.OutLatchC & INTRA_M;
            break;
          case GA_MODE2:
            ret &= 0x07;
            if (this.InteAin) ret |= INTEAIN_M;
            ret |= this.OutLatchC & IBFA_M;
            if (this.InteAout) ret |= INTEAOUT_M;
            ret |= this.OutLatchC & OBFA_M;
            ret |= this.OutLatchC & INTRA_M;
            break;
        }

        if ((cwr & GB_MODE) === GB_MODE1) {
          ret &= 0xf8;
          if (this.InteB) ret |= INTEB_M;
          ret |= this.OutLatchC & INTRB_M;
          if ((cwr & PORTB_DIR) === PORTB_INP) ret |= this.OutLatchC & IBFB_M;
          else ret |= this.OutLatchC & OBFB_M;
          if ((cwr & GA_MODE) === GA_MODE0) {
            ret &= 0xf7;
            if ((cwr & PORTCH_DIR) === PORTCH_INP) ret |= this.InBufferC & 0x08;
            else ret |= this.OutLatchC & 0x08;
          }
        }
        break;
      }

      case PP.CWR:
        ret = this.CWR;   // jako CMOS 82C55
        break;
    }
    return ret & 0xff;
  }

  // ---- strana periferie -------------------------------------------------
  peripheralWriteByte(dest, val) {
    switch (dest) {
      case PP.A: this.InBufferA = val & 0xff; break;
      case PP.B: this.InBufferB = val & 0xff; break;
      case PP.C: {
        val &= 0xff;
        const cwr = this.CWR;
        if ((cwr & GB_MODE) === GB_MODE1) {
          if ((cwr & PORTB_DIR) === PORTB_INP) {
            if ((this.InBufferC & STBB_M) && !(val & STBB_M)) {
              this.InLatchB = this.InBufferB;
              this.OutLatchC |= IBFB_M;
              this.OutLatchC &= ~INTRB_M;
            } else if (!(this.InBufferC & STBB_M) && (val & STBB_M)) {
              if (this.InteB && (this.OutLatchC & IBFB_M)) this.OutLatchC |= INTRB_M;
              else this.OutLatchC &= ~INTRB_M;
            }
          } else {
            if ((this.InBufferC & ACKB_M) && !(val & ACKB_M)) {
              this.OutLatchC |= OBFB_M;
              this.OutLatchC &= ~INTRB_M;
            } else if (!(this.InBufferC & ACKB_M) && (val & ACKB_M)) {
              if (this.InteB && (this.OutLatchC & OBFB_M)) this.OutLatchC |= INTRB_M;
              else this.OutLatchC &= ~INTRB_M;
            }
          }
        }

        if ((cwr & GA_MODE) !== GA_MODE0) {
          if ((cwr & GA_MODE) === GA_MODE2 || (cwr & (GA_MODE | PORTA_DIR)) === (GA_MODE1 | PORTA_INP)) {
            if ((this.InBufferC & STBA_M) && !(val & STBA_M)) {
              this.InLatchA = this.InBufferA;
              this.OutLatchC |= IBFA_M;
              this.OutLatchC &= ~INTRA_M;
            } else if (!(this.InBufferC & STBA_M) && (val & STBA_M)) {
              if (this.InteAin && (this.OutLatchC & IBFA_M)) this.OutLatchC |= INTRA_M;
              else this.OutLatchC &= ~INTRA_M;
            }
          }
          if ((cwr & GA_MODE) === GA_MODE2 || (cwr & (GA_MODE | PORTA_DIR)) === (GA_MODE1 | PORTA_OUT)) {
            if ((this.InBufferC & ACKA_M) && !(val & ACKA_M)) {
              this.OutLatchC |= OBFA_M;
              this.OutLatchC &= ~INTRA_M;
            } else if (!(this.InBufferC & ACKA_M) && (val & ACKA_M)) {
              if (this.InteAout && (this.OutLatchC & OBFA_M)) this.OutLatchC |= INTRA_M;
              else this.OutLatchC &= ~INTRA_M;
            }
          }
        }
        this.InBufferC = val;
        break;
      }
    }
  }

  peripheralChangeBit(dest, bit, state) {
    switch (dest) {
      case PP.A:
        this.InBufferA = state ? (this.InBufferA | (1 << bit)) : (this.InBufferA & ~(1 << bit));
        break;
      case PP.B:
        this.InBufferB = state ? (this.InBufferB | (1 << bit)) : (this.InBufferB & ~(1 << bit));
        break;
      case PP.C: {
        const cwr = this.CWR;
        if ((cwr & GB_MODE) === GB_MODE1 && (bit === STBB || bit === ACKB)) {
          const mask = bit === STBB ? STBB_M : ACKB_M;
          this.peripheralWriteByte(PP.C, (this.InBufferC & ~mask) | (state ? mask : 0));
        } else if ((cwr & GA_MODE) !== GA_MODE0 && (bit === STBA || bit === ACKA)) {
          const mask = bit === STBA ? STBA_M : ACKA_M;
          this.peripheralWriteByte(PP.C, (this.InBufferC & ~mask) | (state ? mask : 0));
        } else {
          this.InBufferC = state ? (this.InBufferC | (1 << bit)) : (this.InBufferC & ~(1 << bit));
        }
        break;
      }
    }
  }

  peripheralReadByte(src) {
    const cwr = this.CWR;
    let ret = 0;
    switch (src) {
      case PP.A:
        if ((cwr & GA_MODE) === GA_MODE2) {
          if (!(this.InBufferC & ACKA_M)) ret = this.OutLatchA;
          else if (!(this.InBufferC & STBA_M)) ret = this.InBufferA;
          else ret = 0xff;
        } else {
          ret = (cwr & PORTA_DIR) === PORTA_OUT ? this.OutLatchA : this.InBufferA;
        }
        break;

      case PP.B:
        ret = (cwr & PORTB_DIR) === PORTB_OUT ? this.OutLatchB : this.InBufferB;
        break;

      case PP.C:
        if ((cwr & (GB_MODE | PORTCL_DIR)) === (GB_MODE0 | PORTCL_OUT)) ret |= this.OutLatchC & 0x07;
        else if ((cwr & (GB_MODE | PORTCL_DIR)) === (GB_MODE0 | PORTCL_INP)) ret |= this.InBufferC & 0x07;
        else if ((cwr & GB_MODE) === GB_MODE1) {
          ret |= this.OutLatchC & 0x03;
          ret |= this.InBufferC & 0x04;
        }

        if ((cwr & (GA_MODE | PORTCH_DIR)) === (GA_MODE0 | PORTCH_OUT)) ret |= this.OutLatchC & 0xf0;
        else if ((cwr & (GA_MODE | PORTCH_DIR)) === (GA_MODE0 | PORTCH_INP)) ret |= this.InBufferC & 0xf0;
        else if ((cwr & (GA_MODE | PORTA_DIR)) === (GA_MODE1 | PORTA_OUT)) {
          ret |= this.OutLatchC & 0x88;
          ret |= this.InBufferC & 0x70;
        } else if ((cwr & (GA_MODE | PORTA_DIR)) === (GA_MODE1 | PORTA_INP)) {
          ret |= this.OutLatchC & 0x28;
          ret |= this.InBufferC & 0xd0;
        } else if ((cwr & GA_MODE) === GA_MODE2) {
          ret |= this.OutLatchC & 0xa8;
          ret |= this.InBufferC & 0x50;
        }

        if ((cwr & GA_MODE) === GA_MODE0) {
          if ((cwr & (GB_MODE | PORTCL_DIR)) === (GB_MODE0 | PORTCL_OUT)) ret |= this.OutLatchC & 0x08;
          else if ((cwr & (GB_MODE | PORTCL_DIR)) === (GB_MODE0 | PORTCL_INP)) ret |= this.InBufferC & 0x08;
        }
        break;

      default:
        ret = 0xff;
    }
    return ret & 0xff;
  }

  peripheralReadBit(src, bit) {
    return (this.peripheralReadByte(src) & (1 << bit)) !== 0;
  }
}
