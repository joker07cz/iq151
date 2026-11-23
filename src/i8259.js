// Intel 8259A: single PIC, fully nested fixed priorities, MCS-80/85 CALL INTA.
export class I8259 {
  constructor(){this.reset();}
  reset(){this.icw1=0;this.icw2=0;this.icw3=0;this.icw4=0;this.imr=0;this.irr=0;this.isr=0;this.phase=0;this.readISR=false;this.poll=false;this.initialized=false;}
  write(port,value){value&=255;
    if(!(port&1)){
      if(value&0x10){this.icw1=value;this.phase=2;this.imr=0;this.irr=0;this.isr=0;this.initialized=false;return;}
      if(value&0x08){if(value&0x02)this.readISR=!!(value&1);this.poll=!!(value&4);return;}
      // OCW2: non-specific EOI (20), specific EOI (60 + level)
      if((value&0xe0)===0x20){const n=this.highest(this.isr);if(n>=0)this.isr&=~(1<<n);}
      else if((value&0xe0)===0x60)this.isr&=~(1<<(value&7));
    }else if(this.phase){
      if(this.phase===2){this.icw2=value;this.phase=(this.icw1&2)?((this.icw1&1)?4:0):3;}
      else if(this.phase===3){this.icw3=value;this.phase=(this.icw1&1)?4:0;}
      else {this.icw4=value;this.phase=0;}
      if(!this.phase)this.initialized=true;
    }else this.imr=value;
  }
  read(port){if(port&1)return this.imr;if(this.poll){this.poll=false;const n=this.pending();if(n<0)return 0;this.acknowledge(n);return 0x80|n;}return this.readISR?this.isr:this.irr;}
  highest(bits){for(let n=0;n<8;n++)if(bits&(1<<n))return n;return -1;}
  request(line){this.irr|=1<<(line&7);}
  pending(){if(!this.initialized)return -1;const n=this.highest(this.irr&~this.imr);const active=this.highest(this.isr);return n>=0&&(active<0||n<active)?n:-1;}
  acknowledge(n){this.irr&=~(1<<n);if(!(this.icw4&2))this.isr|=1<<n;}
  // In 8080/85 mode, PIC supplies CALL + two-byte address on INTA cycles.
  vector(n){const low=(this.icw1&4)?((this.icw1&0xe0)|(n<<2)):((this.icw1&0xc0)|(n<<3));return ((this.icw2<<8)|low)&65535;}
}
