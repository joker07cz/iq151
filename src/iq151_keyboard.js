import { CHAR_MATRIX } from './iq151_char_map.js';
// Keyboard matrix mappings extracted from machine.Keyboard.keyPressedOriginal
// in the supplied publicly distributed emulator.jar. Active low 8x8.
export const KEY_MATRIX = {
  10:[4,4],
  32:[7,3],
  33:[6,5],
  34:[5,5],
  36:[6,6],
  37:[5,6],
  38:[7,5],
  39:[7,6],
  40:[6,3],
  45:[7,0],
  46:[4,3],
  47:[5,3],
  48:[5,0],
  49:[0,0],
  50:[0,1],
  51:[0,2],
  52:[0,3],
  53:[0,4],
  54:[0,5],
  55:[0,6],
  56:[0,7],
  57:[4,0],
  59:[5,2],
  61:[6,0],
  65:[2,0],
  66:[3,4],
  67:[3,2],
  68:[2,2],
  69:[1,2],
  70:[2,3],
  71:[2,4],
  72:[2,5],
  73:[1,7],
  74:[2,6],
  75:[2,7],
  76:[4,2],
  77:[3,6],
  78:[3,5],
  79:[4,1],
  80:[5,1],
  81:[1,0],
  82:[1,3],
  83:[2,1],
  84:[1,4],
  85:[1,6],
  86:[3,3],
  87:[1,1],
  88:[3,1],
  89:[1,5],
  90:[3,0],
  91:[6,1],
  92:[5,4],
  93:[6,2],
  96:[5,0],
  97:[0,0],
  98:[0,1],
  99:[0,2],
  100:[0,3],
  101:[0,4],
  102:[0,5],
  103:[0,6],
  105:[4,0],
  116:[6,4],
  127:[4,5],
  155:[4,6],
  192:[7,1],
  222:[7,2],
  523:[7,4]
};
// The host's printed character must be converted to the IQ 151's key+SHIFT,
// not to an AWT/DOM physical keyCode. Modifier inputs live on 8255 PC4-PC7.
export class IQKeyboard {
  constructor(){this.reset()}
  reset(){
    this.rawRows=new Uint8Array(8).fill(0xff);
    this.rows=new Uint8Array(8).fill(0xff);
    this.held=new Map();
    this.shift=this.ctrl=this.fa=this.fb=false;
  }
  // Legacy numeric AWT keyCode path retained for existing emulator tests.
  key(code,down){
    const coord=KEY_MATRIX[code];if(!coord)return false;
    const [r,c]=coord;
    if(down)this.rawRows[r]&=~(1<<c);else this.rawRows[r]|=1<<c;
    this.refresh();return true;
  }
  refresh(){
    this.rows.set(this.rawRows);
    const printable=[];
    let physicalShift=false;
    let physicalAlt=false;
    let physicalCtrl=false;
    this.ctrl=this.fa=this.fb=false;
    for(const entry of this.held.values()){
      if(entry.coord){
        const [r,c]=entry.coord;
        this.rows[r]&=~(1<<c);
        if(entry.printable)printable.push(entry);
      }
      if(entry.modifier==='shift')physicalShift=true;
      if(entry.modifier==='ctrl')physicalCtrl=true;
      if(entry.modifier==='host-alt')physicalAlt=true;
      if(entry.modifier==='fa')this.fa=true;
      if(entry.modifier==='fb')this.fb=true;
    }
    // Java "smart keyboard": typed characters may need a different IQ SHIFT
    // than the physical PC keyboard (e.g. @ or punctuation on national layouts).
    // During host-key rollover, the newest printable key determines the
    // IQ's SH level. A previous held key may require the opposite SH level.
    this.shift=printable.length>0?printable[printable.length-1].shift:physicalShift;
    // A host Alt/Option or AltGr (Ctrl+Alt) combination can produce an
    // ordinary ASCII symbol on non-US keyboards. Suppress its host modifier
    // signals *while a printable character is active*. The IQ 8255 still
    // receives the character's correct SH bit through PC4.
    if (printable.length===0) {
      this.ctrl ||= physicalCtrl;
      this.fa ||= physicalAlt;
    }
  }
  browserKey(event,down){
    // Keyup uses code rather than key because key changes when SHIFT is released.
    const id=event.code || `keyCode:${event.keyCode}`;
    if(!down){
      if(!this.held.has(id))return false;
      this.held.delete(id);this.refresh();return true;
    }
    if(this.held.has(id))return true; // ignore host auto-repeat
    if(event.metaKey)return false;  // don't capture Cmd/Ctrl+OS shortcuts
    let entry=null;
    const mods={Shift:'shift',Control:'ctrl',Alt:'host-alt'};
    // National layouts (e.g. Czech Mac) can report '+' for bare Digit1 and
    // accented letters for Digit2..Digit0. An unmodified number-row key
    // always enters its physical digit; modified chords still use event.key
    // so existing Shift/Option/AltGr punctuation keeps working.
    const heldModifier=[...this.held.values()].some(k=>
      k.modifier==='shift'||k.modifier==='ctrl'||k.modifier==='host-alt');
    const bareDigit=/^Digit[0-9]$/.test(event.code??'') &&
      !heldModifier && !event.shiftKey && !event.altKey &&
      !event.ctrlKey && !event.metaKey;
    if(mods[event.key])entry={modifier:mods[event.key]};
    else if(bareDigit){
      const [row,col,shift]=CHAR_MATRIX[event.code.slice(-1)];
      entry={coord:[row,col],shift:!!shift,printable:true};
    }
    else if(event.key?.length===1 && Object.hasOwn(CHAR_MATRIX,event.key)){
      const [row,col,shift]=CHAR_MATRIX[event.key];
      // Always translate the *resulting* host character for punctuation.
      // For letters the IQ is uppercase without SH and lowercase with SH;
      // use host SHIFT rather than host letter case (Caps Lock differs).
      const alphabetic = /^[A-Za-z]$/.test(event.key);
      const hostShift = !!event.shiftKey || [...this.held.values()].some(k => k.modifier === 'shift');
      entry={coord:[row,col],shift:alphabetic ? hostShift : !!shift,printable:true};
    } else {
      // Nonprinting keys follow the original keyboard mapping, not ASCII.
      const special={Enter:10,Backspace:127};
      const code=special[event.key]??event.keyCode;
      if(KEY_MATRIX[code])entry={coord:KEY_MATRIX[code],printable:false};
    }
    if(!entry)return false;
    this.held.set(id,entry);this.refresh();return true;
  }
  readA(b){let x=0xff;for(let r=0;r<8;r++)if(!(b&(1<<r)))x&=this.rows[r];return x}
  readB(a){let x=0xff;for(let r=0;r<8;r++)if((this.rows[r]|a)!==0xff)x&=~(1<<r);return x}
}
