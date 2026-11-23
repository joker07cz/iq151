// Display adapter for the two interchangeable IQ 151 video modules.
// Render from actual emulated video RAM and the original bundled character ROM.
// No characters are synthesized from BASIC/monitor output.
export function videoGeometry(mode) {
  if (mode !== 'VIDEO32' && mode !== 'VIDEO64') throw new Error('Unknown video mode');
  return {columns: mode==='VIDEO64' ? 64 : 32, rows:32, width: mode==='VIDEO64' ? 512 : 256, height:256};
}

// The physical framebuffer stays 512x256 for VIDEO64, but its pixels are
// displayed with a 1:2 vertical aspect ratio. Keep that correction in the
// presentation layer: emulated VRAM, font addressing and scanlines do not change.
export function displayGeometry(mode, grafik=false) {
  if (grafik) return {width:512,height:512,verticalScale:2};
  const {width,height}=videoGeometry(mode);
  const verticalScale=mode==='VIDEO64' ? 2 : 1;
  return {width,height:height*verticalScale,verticalScale};
}

// Phosphor colours are presentation only: {on:[r,g,b], off:[r,g,b]}.
// The default keeps the original green tint used by the regression tests.
export const DEFAULT_COLORS = {on:[191,233,171], off:[6,17,10]};

export function rasterizeText(vram, font, mode, target, colors=DEFAULT_COLORS) {
  const [onR,onG,onB]=colors.on, [offR,offG,offB]=colors.off;
  const {columns,width,height}=videoGeometry(mode);
  const verticalScale=displayGeometry(mode).verticalScale;
  const stride=width*4;
  if (vram.length < columns*32) throw new Error('Insufficient video RAM');
  if (font.length < 1024) throw new Error('Character ROM requires 1024 bytes');
  if (target.length < width*height*verticalScale*4) throw new Error('Insufficient RGBA output buffer');
  for (let y=0;y<height;y++) {
    const row=y>>>3, glyphRow=y&7;
    for (let col=0;col<columns;col++) {
      const code=vram[row*columns+col];
      const glyph=font[(code&127)*8+glyphRow];
      for (let bit=0;bit<8;bit++) {
        const on=Boolean(glyph & (0x80>>>bit)) !== Boolean(code&0x80);
        const i=(y*verticalScale*width+col*8+bit)*4;
        target[i]  =on?onR:offR;
        target[i+1]=on?onG:offG;
        target[i+2]=on?onB:offB;
        target[i+3]=255;
      }
    }
    // A second identical scanline gives VIDEO64 1:2 display pixel aspect
    // without modifying the emulated computer or smoothing the 8x8 glyphs.
    if (verticalScale===2) {
      const start=(y*2)*stride;
      target.set(target.subarray(start,start+stride),start+stride);
    }
  }
}

// Composite GRAFIK RAM with the text VIDEO signal. The two outputs are ORed,
// and the 512x256 logical bitmap is vertically doubled for a 1:1 display.
// VIDEO32 glyphs span 16 bitmap pixels; VIDEO64 glyphs span 8.
export function rasterizeComposite(vram, font, mode, grafik, target, colors=DEFAULT_COLORS) {
  if (!grafik) return rasterizeText(vram,font,mode,target,colors);
  const [onR,onG,onB]=colors.on, [offR,offG,offB]=colors.off;
  if (font.length<1024 || vram.length<(mode==='VIDEO64'?2048:1024))
    throw new Error('Bad video memory or character ROM');
  if (target.length<512*512*4) throw new Error('GRAFIK requires 512x512 RGBA target');
  const cols=mode==='VIDEO64'?64:32;
  const doubleText=cols===32;
  for(let y=0;y<256;y++){
    const textRow=(y>>>3)*cols;
    const glyphRow=y&7;
    for(let x=0;x<512;x++){
      const textCol=doubleText ? (x>>>4) : (x>>>3);
      const glyphBit=doubleText ? ((x>>>1)&7) : (x&7);
      const code=vram[textRow+textCol];
      const glyph=font[(code&127)*8+glyphRow];
      const textOn=Boolean(glyph & (0x80>>>glyphBit))!==Boolean(code&0x80);
      const graphicOn=grafik.visible && !!(grafik.vram[y*64+(x>>>3)] & (1<<(x&7)));
      const on=textOn||graphicOn;
      const i=((y*2)*512+x)*4;
      target[i]=on?onR:offR; target[i+1]=on?onG:offG; target[i+2]=on?onB:offB; target[i+3]=255;
    }
    const start=y*2*512*4;
    target.set(target.subarray(start,start+512*4),start+512*4);
  }
}
