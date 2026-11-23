// IQ 151 BASIC 6 expansion module: four 2 KB EPROMs, fixed 8 KB window.
// No software-level BASIC emulation or forced jump to the interpreter.
export class Basic6Module {
  static START = 0xc800;
  static END = 0xe800;

  constructor(image) {
    if (!(image instanceof Uint8Array) || image.length !== 8192) {
      throw new Error('BASIC 6 module requires exactly 8 KB ROM');
    }
    this.rom = image.slice();
  }

  read(address) {
    return this.rom[(address & 0xffff) - Basic6Module.START];
  }
  contains(address) {
    const a=address&0xffff;
    return a>=Basic6Module.START && a<Basic6Module.END;
  }
}


// BASIC G replaces BASIC 6; its second EPROM bank adds graphics routines.
// Both ROM images are read-only and visible on the CPU bus only when selected.
export class BasicGModule extends Basic6Module {
  static GRAPHICS_START = 0xb000;
  static GRAPHICS_END = 0xc000;
  constructor(basicGImage, graphicsImage) {
    super(basicGImage);
    if (!(graphicsImage instanceof Uint8Array) || graphicsImage.length !== 4096)
      throw new Error('BASIC G graphics extension requires exactly 4 KB ROM');
    this.graphicsRom = graphicsImage.slice();
  }
  read(address) {
    const a=address&0xffff;
    if(a>=BasicGModule.GRAPHICS_START && a<BasicGModule.GRAPHICS_END)
      return this.graphicsRom[a-BasicGModule.GRAPHICS_START];
    return super.read(a);
  }
  contains(address){
    const a=address&0xffff;
    return (a>=BasicGModule.GRAPHICS_START&&a<BasicGModule.GRAPHICS_END) ||
      (a>=Basic6Module.START&&a<Basic6Module.END);
  }
}
