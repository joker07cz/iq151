// IQ 151 GRAFIK expansion: 16 KiB independent bitmap RAM, 512x256 pixels.
// Ports: D0 = X[8:3], D1 = Y (origin lower left), D2 = control,
// D3 = 8255 mode / BSR (write only), D4 = bitmap read/write.
// Bit 0 of a stored byte is the LEFTMOST pixel.
export class IQGrafik {
  constructor() { this.vram = new Uint8Array(16384); this.reset(); }

  reset() {
    this.vram.fill(0);
    this.portA=0; this.portB=0; this.portC=0;
    this.control=0x9b; this.initialized=false;
  }

  get selected() { return this.initialized && !!(this.portC & 0x80); }
  get visible() { return this.initialized && !!(this.portC & 0x08); }
  get bitMode() { return !(this.portC & 0x01); }
  get erasePixel() { return !!(this.portC & 0x02); } // PEN* = 1 means erase
  get byteOffset() { return (255-this.portB)*64 + (this.portA&63); }

  write(port, value) {
    port &= 255; value &= 255;
    if (port===0xd3) {
      if (value & 0x80) {
        // 8255: mode-set command resets port output latches.
        this.control=value;this.portA=0;this.portB=0;this.portC=0;
        this.initialized=(value===0x80); // Mode 0, all ports outputs
      } else {
        // 8255 bit set/reset command for port C.
        const bit=(value>>>1)&7;
        this.portC=(this.portC&~(1<<bit))|((value&1)<<bit);
      }
      return;
    }
    if(port===0xd0){this.portA=value;return;}
    if(port===0xd1){this.portB=value;return;}
    if(port===0xd2){this.portC=value;return;}
    if(port!==0xd4 || !this.selected) return;
    const offset=this.byteOffset;
    if(this.bitMode){
      const mask=1<<((value>>>5)&7); // X[2:0] on data bus upper bits
      this.vram[offset]=this.erasePixel ? (this.vram[offset]&~mask) : (this.vram[offset]|mask);
    }else{
      this.vram[offset]=value;
    }
  }

  read(port) {
    if((port&255)!==0xd4 || !this.selected) return 0xff;
    return this.vram[this.byteOffset];
  }
}
