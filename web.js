// web.js — webové čelo emulátoru IQ 151.
// Rozhraní sjednocené s PMD 85 a Ondrou: vlevo obrazovka, vpravo ovládací
// sloupec (video → grafika → modul → média → tlačítka → obraz), pod obrazovkou
// celá obrazovka + stav, dole oddělovač.
import { IQ151 } from './src/iq151.js';
import { parseIntelHex, installIntelHex } from './src/intel_hex.js';
import { displayGeometry, rasterizeComposite } from './src/iq151_video.js';
import { IqSound } from './src/iq151_sound.js';

const $ = id => document.getElementById(id);
const canvas = $('screen');
const ctx = canvas.getContext('2d', { alpha: false });
const status = $('status');
const led = $('led');
const pauseBtn = $('pause');

// ----------------------------------------------------------------------------
//  Měřítko obrazovky a scanlines ve FYZICKÝCH pixelech (převzato z Ondry)
//
//  IQ 151 má vždy 256 obrazových řádků. Při devicePixelRatio 1,25 / 1,5
//  (škálování systému, zoom prohlížeče) by pevných 512 CSS px znamenalo
//  2,5 device px na řádek — rasterizér pak dělá řádky střídavě 2 a 3 px,
//  písmena se trhají a scanlines se rozjedou. Proto volíme celé k (device px
//  na řádek) a CSS velikost dopočítáme jako k / dpr. Obraz je čtvercový, takže
//  VIDEO 64 a GRAFIK (512 bodů na šířku) potřebují sudé k, aby i sloupce
//  vyšly po celých pixelech.
// ----------------------------------------------------------------------------
const SRC_LINES = 256;                 // obrazové řádky IQ 151
const SCAN_ALPHA = 0.65;               // tmavost mezery mezi řádky
const DESK_MAX_CSS = 600;              // široké okno: cíl 512 CSS px, strop 600
const NARROW_MQ = matchMedia('(max-width: 900px)');
const stage = $('stage');
const crt = $('crt');
const tube = $('tube');
const scanCanvas = $('scanlines');
const scanCtx = scanCanvas.getContext('2d');
let crtK = 0, crtDpr = 0;

function chooseScale(dpr) {
  let avail;                           // dostupná velikost čtverce v CSS px
  if (document.fullscreenElement === stage) avail = Math.min(innerWidth, innerHeight);
  else if (!NARROW_MQ.matches) avail = DESK_MAX_CSS;
  else {
    const cs = getComputedStyle(crt);
    avail = crt.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  }
  let k = Math.max(1, Math.floor(avail * dpr / SRC_LINES));
  if (canvas.width > SRC_LINES && k > 1) k -= k % 2;   // 512 bodů na šířku → sudé k
  return k;
}

function drawScanlines() {
  const H = scanCanvas.height;
  scanCtx.clearRect(0, 0, scanCanvas.width, H);
  if (crtK < 2) return;                // pod 2 device px na řádek se linka nevejde
  const dark = Math.floor(crtK / 2);   // k=2→1, k=3→1, k=4→2 …
  scanCtx.fillStyle = `rgba(0,0,0,${SCAN_ALPHA})`;
  for (let y = crtK - dark; y < H; y += crtK) scanCtx.fillRect(0, y, scanCanvas.width, dark);
}

function fitCrt() {
  const dpr = window.devicePixelRatio || 1;
  const k = chooseScale(dpr);
  const css = (SRC_LINES * k / dpr) + 'px';
  tube.style.width = css;
  tube.style.height = css;
  if (k !== crtK || dpr !== crtDpr) {
    crtK = k;
    crtDpr = dpr;
    scanCanvas.height = SRC_LINES * k; // šířka 1 px stačí, vodorovně se jen roztáhne
    drawScanlines();
  }
}

let crtFitPending = false;
function requestFitCrt() {
  if (crtFitPending) return;
  crtFitPending = true;
  requestAnimationFrame(() => { crtFitPending = false; fitCrt(); });
}

// Změna DPR (jiný monitor, zoom). Dotaz platí pro jednu hodnotu, po změně se zakládá znovu.
function watchDpr() {
  const mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  mq.addEventListener('change', () => { requestFitCrt(); watchDpr(); }, { once: true });
}
window.addEventListener('resize', requestFitCrt);
document.addEventListener('fullscreenchange', requestFitCrt);
NARROW_MQ.addEventListener('change', requestFitCrt);
watchDpr();

const load = async path => new Uint8Array(await (await fetch(path)).arrayBuffer());
const font = await load('./roms/chars.bin');
let monitor = await load('./roms/Monitor-std.rom');
const basic6 = await load('./modules/Basic6.rom');
const basicG = await load('./modules/BasicG.rom');
const basicG2 = await load('./modules/BasicG2.rom');
const sound = new IqSound();

// Web Audio smí začít až po gestu uživatele a po skrytí / návratu karty se musí probudit.
function wakeAudio() { sound.ensureStarted(); }
window.addEventListener('pointerdown', wakeAudio);
window.addEventListener('keydown', wakeAudio);
window.addEventListener('focus', () => sound.wake());
document.addEventListener('visibilitychange', () => sound.wake());

// --- segmentové přepínače ---
function segment(id, onChange) {
  const box = $(id);
  const sel = { value: box.querySelector('button.on').dataset.value };
  box.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.dataset.value === sel.value) return;
    box.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    sel.value = b.dataset.value;
    onChange();
  });
  sel.set = v => { box.querySelector(`button[data-value="${v}"]`)?.click(); };
  return sel;
}

const MODULE_NAMES = { basic6: 'Basic6.rom', basicg: 'BasicG.rom + BasicG2.rom', none: null };
const modName = $('mod-name');
const modEject = $('mod-eject');

const videoSelector = segment('video', rebuildMachine);
const grafikSelector = segment('grafik', rebuildMachine);
const moduleSelector = segment('module', () => { attachSelectedModule(); resetMachine(); });
const ramSelector = segment('ram', rebuildMachine);

let iq;
function attachSelectedModule() {
  if (moduleSelector.value === 'basic6') iq.loadBasic6(basic6);
  else if (moduleSelector.value === 'basicg') iq.loadBasicG(basicG, basicG2);
  else iq.ejectModule();
  iq.reset();
  const name = MODULE_NAMES[moduleSelector.value];
  modName.textContent = name ?? '— prázdno —';
  modName.classList.toggle('set', !!name);
  modEject.disabled = !name;
}
function createMachine() {
  iq = new IQ151({
    video: videoSelector.value,
    grafik: grafikSelector.value === 'grafik',
    ramKB: Number(ramSelector.value),
  });
  iq.loadMonitor(monitor);
  attachSelectedModule();
  updateCanvas();
}
function rebuildMachine() { createMachine(); resetMachine(); }
modEject.addEventListener('click', () => moduleSelector.set('none'));

// --- zvuk ---
const sndBtn = document.getElementById('sound');
if (sndBtn) {
  sndBtn.addEventListener('click', () => {
    wakeAudio();
    const on = !sound.enabled;
    sound.setEnabled(on);
    sndBtn.classList.toggle('on', on);
  });
}

// Barva stínítka — IQ 151 se připojovalo k černobílé televizi nebo monitoru; výchozí je bílá.
const DISPLAY_COLORS = {
  white: { label: 'Bílá',          on: [255, 255, 255], off: [0, 0, 0], css: '#ffffff' },
  green: { label: 'Zelený fosfor', on: [51, 255, 102],  off: [0, 0, 0], css: '#33ff66' },
  amber: { label: 'Jantar',        on: [255, 176, 0],   off: [0, 0, 0], css: '#ffb000' },
};
let displayColor = 'white';

let frame;
function updateCanvas() {
  const g = displayGeometry(iq.video, Boolean(iq.grafik));
  canvas.width = g.width; canvas.height = g.height;
  frame = ctx.createImageData(g.width, g.height);
  fitCrt();   // VIDEO 64 / GRAFIK mohou vyžadovat sudé měřítko
}
createMachine();

const diag = new URLSearchParams(location.search).has('debugKeys') ? document.createElement('pre') : null;
const frameMs = [];
const debugBox = diag ? document.createElement('div') : null;
if (diag) { debugBox.id = 'keydebug'; diag.style.cssText = 'color:#c9a24b;white-space:pre-wrap;margin:0 0 6px'; debugBox.append(diag); document.querySelector('.under').after(debugBox); }
let paused = false;
let lastTime = performance.now();
const h4 = n => n.toString(16).toUpperCase().padStart(4, '0');
function draw() {
  rasterizeComposite(iq.vram, font, iq.video, iq.grafik, frame.data, DISPLAY_COLORS[displayColor]);
  ctx.putImageData(frame, 0, 0);
}
function tick(now = performance.now()) {
  const elapsed = Math.max(0, Math.min(100, now - lastTime)); lastTime = now;
  if (!paused) {
    iq.advanceWallTime(elapsed);
    sound.feed(iq.drainSound(), iq.cpu.cycles, iq.clockHz);
    draw();
    status.textContent = `běží · PC ${h4(iq.cpu.pc)}`;
    if (diag) { frameMs.push(elapsed); if (frameMs.length > 60) frameMs.shift(); const avg = frameMs.reduce((a, b) => a + b, 0) / frameMs.length; diag.textContent = `PC=${h4(iq.cpu.pc)} INTE=${+iq.cpu.inte} IRQ#=${iq.irqCount} PIC irr=${iq.pic.irr.toString(16)} isr=${iq.pic.isr.toString(16)} imr=${iq.pic.imr.toString(16)} init=${+iq.pic.initialized} [0006]=${iq.ram[6].toString(16)} frame≈${avg.toFixed(1)}ms max=${Math.max(...frameMs).toFixed(0)}ms held=${[...iq.keyboard.held.keys()].join(',') || '-'}`; }
    status.title = `CPU T=${iq.cpu.cycles}  ROM overlay=${iq.resetOverlay ? 'on' : 'off'}  RAM=${iq.ram.length/1024}kB  Module=${moduleSelector.value}  Video=${iq.video}  GRAFIK=${iq.grafik ? 'installed' : 'absent'}`;
  }
  requestAnimationFrame(tick);
}
function setPaused(p) {
  paused = p; lastTime = performance.now();
  pauseBtn.textContent = paused ? '▶ BĚH' : '⏸ PAUZA';
  led.classList.toggle('on', !paused);
  if (paused) status.textContent = 'pauza';
}
const focusScreen = () => canvas.focus({ preventScroll: true });
function resetMachine() { iq.reset(); setPaused(false); focusScreen(); }
$('reset').onclick = resetMachine;
pauseBtn.onclick = () => setPaused(!paused);
// BR: jeden stisk = jedno přerušení IR5; fokus zpět na obraz, ať jde psát dál.
$('brk').onclick = () => { iq.pressBreak(); focusScreen(); };
setPaused(false);
tick();

// Po kliknutí na tlačítko vrať fokus obrazovce, ať klávesnice míří do IQ.
document.addEventListener('click', e => { if (e.target.closest('button')) focusScreen(); });

// --- ROM monitoru ---
const romFile = $('romfile');
$('rom-load').onclick = () => romFile.click();
romFile.addEventListener('change', async () => {
  const file = romFile.files?.[0]; romFile.value = '';
  if (file) await loadMonitorFile(file);
});
async function loadMonitorFile(file) {
  monitor = new Uint8Array(await file.arrayBuffer());
  $('rom-name').textContent = file.name;
  rebuildMachine();
}

// --- Intel HEX ---
// Host-side Intel HEX import. File loading is an operator action, not an IQ 151
// hardware peripheral; validation is completed before any emulated RAM writes.
const hexFile = $('hex-file');
const hexEntry = $('hex-entry');
const hexRun = $('hex-run');
const hexStatus = $('hex-status');
const hexName = $('hex-name');
let selectedHex = null;
const hexInfo = msg => { hexStatus.textContent = msg; };
$('hex-load').onclick = () => hexFile.click();
hexFile.addEventListener('change', async () => {
  const file = hexFile.files?.[0]; hexFile.value = '';
  if (file) await selectHexFile(file);
});
async function selectHexFile(file) {
  selectedHex = null; hexRun.disabled = true;
  hexName.textContent = file.name; hexName.classList.remove('set');
  try {
    const parsed = parseIntelHex(await file.text());
    selectedHex = parsed;
    hexEntry.value = h4(parsed.entry);
    const ranges = parsed.ranges.map(r => `${h4(r.start)}–${h4(r.end)}`).join(', ');
    hexInfo(`${parsed.size} bajtů, oblasti ${ranges}. Vstup ${h4(parsed.entry)}h${parsed.explicitEntry ? ' (HEX záznam)' : ' (nejnižší adresa dat; lze upravit)'}.`);
    hexName.classList.add('set');
    hexRun.disabled = false;
  } catch (e) { hexInfo(`Chybný HEX: ${e.message}`); }
}
hexRun.addEventListener('click', () => {
  if (!selectedHex) return;
  const raw = hexEntry.value.trim();
  if (!/^[0-9a-fA-F]{1,4}$/.test(raw)) { hexInfo('Vstupní adresa musí být 1–4 hexadecimální číslice.'); return; }
  const entry = parseInt(raw, 16);
  if (!selectedHex.bytes.some(([a]) => a === entry)) {
    hexInfo(`Vstup ${h4(entry)}h neleží v nahraném HEX. Vyber adresu uvnitř programu.`); return;
  }
  try {
    const loaded = installIntelHex(iq, selectedHex);
    iq.cpu.pc = entry;
    iq.cpu.halted = false;
    iq.keyboard.reset();
    setPaused(false);
    hexInfo(`Nahráno ${loaded} bajtů a spuštěno od ${h4(entry)}h. RESET obsah RAM smaže.`);
    focusScreen();
  } catch (e) { hexInfo(`Nelze spustit HEX: ${e.message}`); }
});

// --- obraz: barva stínítka (volba se pamatuje) ---
function applyDisplayColor(id) {
  if (!DISPLAY_COLORS[id]) return;
  displayColor = id;
  document.querySelectorAll('#display .swatch[data-color]').forEach(s =>
    s.classList.toggle('on', s.dataset.color === id));
  try { localStorage.setItem('iq151.color', id); } catch {}
  draw();   // překresli hned, i když je stroj pozastavený
}
{
  const box = $('display');
  for (const [id, c] of Object.entries(DISPLAY_COLORS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.dataset.color = id;
    b.innerHTML = `<span class="chips"><i style="background:${c.css}"></i><i style="background:#000"></i></span><span class="lbl">${c.label}</span>`;
    b.addEventListener('click', () => applyDisplayColor(id));
    box.insertBefore(b, $('btn-scanlines'));
  }
  let saved = null;
  try { saved = localStorage.getItem('iq151.color'); } catch {}
  applyDisplayColor(DISPLAY_COLORS[saved] ? saved : 'white');
}

// --- obraz: scanlines (volba se pamatuje) ---
const scanBtn = $('btn-scanlines');
function setScanlines(on) {
  crt.classList.toggle('no-scanlines', !on);
  scanBtn.classList.toggle('on', on);
  scanBtn.setAttribute('aria-pressed', String(on));
  try { localStorage.setItem('iq151.scanlines', on ? '1' : '0'); } catch {}
}
let scanPref = '1';
try { scanPref = localStorage.getItem('iq151.scanlines') ?? '1'; } catch {}
setScanlines(scanPref !== '0');
scanBtn.onclick = () => setScanlines(crt.classList.contains('no-scanlines'));

// --- celá obrazovka ---
const fsBtn = $('fullscreen');
function toggleFullscreen() {
  if (!document.fullscreenElement) stage.requestFullscreen?.();
  else document.exitFullscreen?.();
}
fsBtn.addEventListener('click', toggleFullscreen);
canvas.addEventListener('dblclick', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  fsBtn.textContent = document.fullscreenElement ? '⛶ Zpět z celé obrazovky' : '⛶ Celá obrazovka';
});

// --- přetažení souboru na obrazovku (.hex/.ihx = program, .rom/.bin = monitor) ---
['dragenter', 'dragover'].forEach(ev =>
  stage.addEventListener(ev, e => { e.preventDefault(); stage.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev =>
  stage.addEventListener(ev, e => { e.preventDefault(); stage.classList.remove('drag'); }));
stage.addEventListener('drop', async e => {
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  if (/\.(rom|bin)$/i.test(file.name)) await loadMonitorFile(file);
  else await selectHexFile(file);
});

// --- klávesnice ---
// Physical-key mapping; listen globally so keys work without focusing canvas.
// Optional diagnostics: append ?debugKeys=1 to the page URL. Shows the native
// KeyboardEvent values without changing the emulated 8255 or the BASIC ROM.
const debugKeys = new URLSearchParams(location.search).has('debugKeys');
const keyDebug = debugKeys ? document.createElement('pre') : null;
if (keyDebug) {
  keyDebug.style.cssText = 'white-space:pre-wrap;margin:0';
  debugBox.append(keyDebug);
}
const keyLog = [];
function handleKey(e, down) {
  // Do not steal text-entry keys from HEX entry and other browser controls.
  if (e.target?.closest?.('input, textarea, select, button')) return;
  const handled = iq.setBrowserKey(e, down);
  if (keyDebug) {
    keyLog.push(`${down ? 'DOWN' : 'UP  '} key=${JSON.stringify(e.key)} code=${e.code} shift=${+e.shiftKey} alt=${+e.altKey} ctrl=${+e.ctrlKey} handled=${+handled} IQ_SH=${+iq.keyboard.shift} IQ_FA=${+iq.keyboard.fa}`);
    if (keyLog.length > 8) keyLog.shift();
    keyDebug.textContent = keyLog.join('\n');
  }
  if (handled) e.preventDefault();
}
window.addEventListener('keydown', e => handleKey(e, true));
window.addEventListener('keyup', e => handleKey(e, false));
window.addEventListener('blur', () => iq.keyboard.reset());
