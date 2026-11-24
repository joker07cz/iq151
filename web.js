// web.js — webové čelo emulátoru IQ 151.
// Rozhraní sjednocené s PMD 85 a Ondrou: vlevo obrazovka, vpravo ovládací
// sloupec (video → grafika → modul → média → tlačítka → obraz), pod obrazovkou
// celá obrazovka + stav, dole oddělovač.
import { IQ151 } from './src/iq151.js';
import { installIntelHex } from './src/intel_hex.js';
import { parseProgram } from './src/iq151_program.js';
import { tapeToWav, wavToTape, cswToTape } from './src/iq151_tape.js';
import { displayGeometry, rasterizeComposite } from './src/iq151_video.js';
import { IqSound } from './src/iq151_sound.js';
import { SdDisk } from './src/sd_disk.js';

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
// Verze monitoru (CP/M monitory jsou v nabídce jen pro informaci — bez diskety nejdou využít).
const MONITORS = { std: 'Monitor-std.rom', v84: 'Monitor-v84.rom', dis: 'Monitor-dis.rom' };
let monitorId = 'std';
try { const m = localStorage.getItem('iq151.monitor'); if (MONITORS[m]) monitorId = m; } catch {}
let monitor = await load('./roms/' + MONITORS[monitorId]).catch(() => null);
if (!monitor || monitor.length !== 4096) { monitorId = 'std'; monitor = await load('./roms/Monitor-std.rom'); }
const basic6 = await load('./modules/Basic6.rom');
const basicG = await load('./modules/BasicG.rom');
const basicG2 = await load('./modules/BasicG2.rom');
const sound = new IqSound();

// Web Audio smí začít až po gestu uživatele a po skrytí / návratu karty se musí probudit.
// Do prvního kliknutí / klávesy je ticho a přes obraz svítí hláška (jako SORD M5).
let userGestured = false;
function wakeAudio() { userGestured = true; sound.ensureStarted(); }
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


const videoSelector = segment('video', rebuildMachine);
// GRAFIK je přídavný modul ke kterémukoli VIDEO — samostatný přepínač zap / vyp
// ve stejné liště, se stejným rozhraním jako segment(): value 'grafik' | 'none'.
const grafikSelector = (() => {
  const btn = $('grafik');
  const sel = { value: btn.classList.contains('on') ? 'grafik' : 'none' };
  const show = () => { btn.classList.toggle('on', sel.value === 'grafik'); btn.setAttribute('aria-pressed', String(sel.value === 'grafik')); };
  sel.set = v => { if (v === sel.value) return; sel.value = v; show(); rebuildMachine(); };
  btn.addEventListener('click', () => sel.set(sel.value === 'grafik' ? 'none' : 'grafik'));
  show();
  return sel;
})();
const moduleSelector = segment('module', () => { attachSelectedModule(); resetMachine(); });
const ramSelector = segment('ram', rebuildMachine);
const sdSelector = segment('sdrom', () => { attachSdRom(); resetMachine(); });

let iq;
function attachSelectedModule() {
  if (moduleSelector.value === 'basic6') iq.loadBasic6(basic6);
  else if (moduleSelector.value === 'basicg') iq.loadBasicG(basicG, basicG2);
  else iq.ejectModule();
  iq.reset();
}
function createMachine() {
  const old = iq;
  iq = new IQ151({
    video: videoSelector.value,
    grafik: grafikSelector.value === 'grafik',
    ramKB: Number(ramSelector.value),
  });
  if (old) iq.adoptTape(old);     // kazeta zůstává v magnetofonu i po výměně modulů
  iq.loadMonitor(monitor);
  attachSelectedModule();
  attachSdRom();
  updateCanvas();
}
// --- SD-ROM: virtuální disk v paměti stránky (přežije přestavbu stroje, ne zavření stránky) ---
const sdDisk = new SdDisk({ loader: await load('./programs/__BLOADER.BAS') });
const sdBox = $('sd-box'), sdList = $('sd-list'), sdLed = $('sd-led');
function attachSdRom() {
  const on = sdSelector.value === 'sdrom';
  sdBox.hidden = !on;
  if (on) {
    iq.attachSdRom(sdDisk).onLed = v => sdLed.classList.toggle('on', v);
  } else {
    iq.detachSdRom();
    sdLed.classList.remove('on');
  }
}
const fmtSize = n => n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} kB`;
function renderSdList() {
  sdList.textContent = '';
  const files = sdDisk.allFiles().filter(f => f.path.toLowerCase() !== '/__bloader.bas');
  if (!files.length) {
    const li = document.createElement('li'); li.className = 'sd-empty'; li.textContent = '— disk je prázdný —';
    sdList.append(li);
    return;
  }
  for (const f of files) {
    const li = document.createElement('li'); li.className = 'sd-file';
    const n = document.createElement('span'); n.className = 'n'; n.textContent = f.path; n.title = f.path;
    const sz = document.createElement('span'); sz.className = 'sz'; sz.textContent = fmtSize(f.size);
    const dl = document.createElement('button'); dl.type = 'button'; dl.title = 'Uložit do počítače'; dl.setAttribute('aria-label', 'Uložit do počítače');
    // disketa = uložit do počítače (šipka dolů u šachet ROM / programu znamená opačný směr: nahrát do emulátoru)
    const ic = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); ic.setAttribute('class', 'ic');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#ic-floppy');
    ic.append(use); dl.append(ic);
    dl.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([sdDisk.read(f.path)]));
      a.download = f.path.split('/').pop();
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    const rm = document.createElement('button'); rm.type = 'button'; rm.textContent = '✕'; rm.title = 'Smazat';
    rm.addEventListener('click', () => sdDisk.remove(f.path));
    li.append(n, sz, dl, rm);
    sdList.append(li);
  }
}
sdDisk.onchange = renderSdList;
renderSdList();
$('sd-add').addEventListener('click', () => $('sd-files').click());
$('sd-dir').addEventListener('click', () => $('sd-folder').click());
$('sd-clear').addEventListener('click', () => sdDisk.clear());
for (const id of ['sd-files', 'sd-folder'])
  $(id).addEventListener('change', async e => { await sdDisk.addFiles(e.target.files); e.target.value = ''; });
['dragenter', 'dragover'].forEach(ev => sdList.addEventListener(ev, e => { e.preventDefault(); sdList.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => sdList.addEventListener(ev, e => { e.preventDefault(); sdList.classList.remove('drag'); }));
// Přetažená složka není v dataTransfer.files čitelná; je nutné projít záznamy (webkitGetAsEntry) rekurzivně.
// Stejně jako výběr složky: jméno přetažené (nejvyšší) složky se nepoužije, její obsah patří do kořene disku.
async function entryFiles(entry, prefix = '', top = true) {
  if (entry.isFile) {
    const file = await new Promise((ok, fail) => entry.file(ok, fail));
    file._relPath = prefix + entry.name;
    return [file];
  }
  const reader = entry.createReader();
  const kids = [];
  for (;;) {   // readEntries vrací po částech (v Chromu max. 100 položek)
    const batch = await new Promise((ok, fail) => reader.readEntries(ok, fail));
    if (!batch.length) break;
    kids.push(...batch);
  }
  const out = [];
  const kidPrefix = top ? prefix : prefix + entry.name + '/';
  for (const k of kids) out.push(...await entryFiles(k, kidPrefix, false));
  return out;
}
sdList.addEventListener('drop', async e => {
  e.stopPropagation();
  const dt = e.dataTransfer;
  if (!dt) return;
  // záznamy je nutné získat synchronně, po prvním await už jsou DataTransfer položky neplatné
  const entries = [...(dt.items || [])].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  const files = entries.length ? (await Promise.all(entries.map(en => entryFiles(en)))).flat() : [...dt.files];
  if (files.length) await sdDisk.addFiles(files);
});

function rebuildMachine() { createMachine(); resetMachine(); }

// --- zvuk ---
const sndBtn = document.getElementById('sound');
if (sndBtn) {
  sndBtn.addEventListener('click', () => {
    wakeAudio();
    const on = !sound.enabled;
    sound.setEnabled(on);
    sndBtn.classList.toggle('on', on);
    sndBtn.setAttribute('aria-pressed', String(on));
    sndBtn.textContent = on ? '🔊 ZVUK' : '🔇 ZVUK';
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
// Turbo: dokud se točí páska, běží emulace v dávkách po 20 ms tak dlouho,
// kolik snese snímek (TURBO_BUDGET_MS), nejvýš TURBO_MAX× rychleji. 12 minut
// Města robotů se tak nahraje zhruba za desítky sekund. Zvuk se mezitím
// zahazuje (zrychlený by jen skřípal).
const TURBO_BUDGET_MS = 11;
const TURBO_MAX = 100;
let turbo = false, turboSpeed = 0;
function tick(now = performance.now()) {
  const elapsed = Math.max(0, Math.min(100, now - lastTime)); lastTime = now;
  if (!paused) {
    if (turbo && iq.tape.running) {
      const t0 = performance.now();
      let ms = 0;
      do { iq.advanceWallTime(20); ms += 20; }
      while (iq.tape.running && ms < TURBO_MAX * Math.max(elapsed, 1) && performance.now() - t0 < TURBO_BUDGET_MS);
      turboSpeed = elapsed > 0 ? 0.8 * turboSpeed + 0.2 * (ms / elapsed) : turboSpeed;
      iq.drainSound(); sound.skip(iq.cpu.cycles);
    } else {
      turboSpeed = 0;
      iq.advanceWallTime(elapsed);
      sound.feed(iq.drainSound(), iq.cpu.cycles, iq.clockHz);
    }
    if (iq.tape.atEnd(iq.cpu.cycles)) { iq.tapeStop(); note('■ konec nahrávky na kazetě'); }
    draw();
    if (tapeNote && now > tapeNoteUntil) tapeNote = '';
    status.textContent = tapeNote || `běží · PC ${h4(iq.cpu.pc)}`;
    if (diag) { frameMs.push(elapsed); if (frameMs.length > 60) frameMs.shift(); const avg = frameMs.reduce((a, b) => a + b, 0) / frameMs.length; diag.textContent = `PC=${h4(iq.cpu.pc)} INTE=${+iq.cpu.inte} IRQ#=${iq.irqCount} PIC irr=${iq.pic.irr.toString(16)} isr=${iq.pic.isr.toString(16)} imr=${iq.pic.imr.toString(16)} init=${+iq.pic.initialized} [0006]=${iq.ram[6].toString(16)} frame≈${avg.toFixed(1)}ms max=${Math.max(...frameMs).toFixed(0)}ms held=${[...iq.keyboard.held.keys()].join(',') || '-'}`; }
    status.title = `CPU T=${iq.cpu.cycles}  ROM overlay=${iq.resetOverlay ? 'on' : 'off'}  RAM=${iq.ram.length/1024}kB  Module=${moduleSelector.value}  Video=${iq.video}  GRAFIK=${iq.grafik ? 'installed' : 'absent'}`;
  }
  updateTape();
  updateSoundHint();
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

// Po kliknutí na tlačítko vrať fokus obrazovce, ať klávesnice míří do IQ.
document.addEventListener('click', e => { if (e.target.closest('button')) focusScreen(); });

// --- ROM monitoru: výběr verze, nebo vlastní soubor ---
const romFile = $('romfile');
const romSelect = $('rom-select');
const romFileOpt = $('rom-file-opt');
romSelect.value = monitorId;
$('rom-load').onclick = () => romFile.click();
romFile.addEventListener('change', async () => {
  const file = romFile.files?.[0]; romFile.value = '';
  if (file) await loadMonitorFile(file);
});
async function useMonitor(image, id) {
  if (image.length !== 4096) throw new Error(`ROM monitoru musí mít 4096 B, má ${image.length} B`);
  monitor = image; monitorId = id;
  romSelect.value = id;
  if (id !== 'file') try { localStorage.setItem('iq151.monitor', id); } catch {}
  rebuildMachine();
}
romSelect.addEventListener('change', async () => {
  const id = romSelect.value;
  if (!MONITORS[id]) return;
  try { await useMonitor(await load('./roms/' + MONITORS[id]), id); }
  catch (e) { status.textContent = `monitor nelze načíst: ${e.message}`; romSelect.value = monitorId; }
  focusScreen();
});
async function loadMonitorFile(file) {
  try {
    const image = new Uint8Array(await file.arrayBuffer());
    romFileOpt.textContent = file.name; romFileOpt.hidden = false;
    await useMonitor(image, 'file');
  } catch (e) {
    status.textContent = `ROM ${file.name}: ${e.message}`;
    romSelect.value = monitorId;
    if (monitorId !== 'file') romFileOpt.hidden = true;
  }
}

// --- program: Intel HEX / BIN / HEXBIN ---
// Zavedení souboru je úkon obsluhy, ne periferie IQ 151; vše se ověří dřív,
// než se cokoli zapíše do RAM.
const hexFile = $('hex-file');
const hexEntry = $('hex-entry');
const hexRun = $('hex-run');
const hexStatus = $('hex-status');
const hexName = $('hex-name');
let selectedHex = null, selectedFile = null;
const hexInfo = msg => { hexStatus.textContent = msg; };
$('hex-load').onclick = () => hexFile.click();
hexFile.addEventListener('change', async () => {
  const file = hexFile.files?.[0]; hexFile.value = '';
  if (file) selectProgram(file.name, new Uint8Array(await file.arrayBuffer()));
});
function describe(p) {
  const ranges = p.ranges.map(r => `${h4(r.start)}–${h4(r.end)}`).join(', ');
  const how = p.raw ? ' (prostý BIN: nahraje se od adresy START)'
    : p.explicitEntry ? ' (ze souboru)' : ' (nejnižší adresa dat; lze upravit)';
  return `${p.kind}: ${p.size} bajtů, oblasti ${ranges}. Start ${h4(p.entry)}h${how}.`;
}
function selectProgram(name, data) {
  selectedHex = null; selectedFile = null; hexRun.disabled = true;
  hexName.textContent = name; hexName.classList.remove('set');
  try {
    const parsed = parseProgram(name, data);
    selectedHex = parsed; selectedFile = { name, data };
    hexEntry.value = h4(parsed.entry);
    hexInfo(describe(parsed));
    hexName.classList.add('set');
    hexRun.disabled = false;
    return true;
  } catch (e) { hexInfo(`Chybný program: ${e.message}`); return false; }
}
function runProgram() {
  if (!selectedHex) return false;
  const raw = hexEntry.value.trim();
  if (!/^[0-9a-fA-F]{1,4}$/.test(raw)) { hexInfo('Adresa START musí být 1–4 hexadecimální číslice.'); return false; }
  const entry = parseInt(raw, 16);
  try {
    // prostý BIN: START je zároveň adresa, kam se nahraje
    const prog = selectedHex.raw ? parseProgram(selectedFile.name, selectedFile.data, entry) : selectedHex;
    if (!prog.bytes.some(([a]) => a === entry)) {
      hexInfo(`Start ${h4(entry)}h neleží v nahraném programu. Vyber adresu uvnitř programu.`); return false;
    }
    const loaded = installIntelHex(iq, prog);
    iq.cpu.pc = entry;
    iq.cpu.halted = false;
    iq.keyboard.reset();
    setPaused(false);
    hexInfo(`Nahráno ${loaded} bajtů a spuštěno od ${h4(entry)}h. RESET obsah RAM smaže.`);
    focusScreen();
    return true;
  } catch (e) { hexInfo(`Nelze spustit: ${e.message}`); return false; }
}
hexRun.addEventListener('click', runProgram);

// --- magnetofon ---
const tapeSlot = $('tape-slot');
const MODE_TEXT = { stop: 'stojí', play: 'přehrává', rec: 'nahrává' };
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
let tapeShown = '', tapeNote = '', tapeNoteUntil = 0;
const note = msg => { tapeNote = msg; tapeNoteUntil = performance.now() + 8000; };
function updateTape() {
  const tape = iq.tape, now = iq.cpu.cycles;
  const pos = tape.seconds(now), len = Math.max(tape.length / iq.clockHz, tape.mode === 'rec' ? pos : 0);
  const waiting = tape.mode !== 'stop' && !tape.motor ? ' · čeká na motor' : '';
  const speed = turbo && tape.running && turboSpeed > 1.5 ? ` · ${Math.round(turboSpeed)}×` : '';
  const info = `${mmss(pos)} / ${mmss(len)} · ${MODE_TEXT[tape.mode]}${waiting}${speed}${tape.invert ? ' · obráceně' : ''}`;
  const key = info + tape.name + tape.dirty + turbo + paused + tape.length + tape.invert;
  if (key === tapeShown) return;
  tapeShown = key;
  $('tape-info').textContent = info;
  $('tape-name').textContent = tape.name || 'prázdná kazeta';
  $('tape-name').classList.toggle('set', !!tape.name);
  $('tape-name').classList.toggle('dirty', tape.dirty);
  $('tape-name').title = tape.dirty ? 'nahrávka není uložená' : '';
  $('tape-save').disabled = !tape.length;
  $('tape-play').classList.toggle('on', tape.mode === 'play');
  $('tape-rec').classList.toggle('on', tape.mode === 'rec');
  $('tape-turbo').classList.toggle('on', turbo);
  $('tape-inv').classList.toggle('on', tape.invert);
  $('tape-inv').setAttribute('aria-pressed', String(tape.invert));
  $('tape-turbo').setAttribute('aria-pressed', String(turbo));
  tapeSlot.classList.toggle('running', tape.running && !paused);
  tapeSlot.classList.toggle('turbo', turbo);
}
function tapeCommand(cmd) {
  note('');
  if (cmd === 'play') {
    if (!iq.tape.length) { note('kazeta je prázdná — vložte WAV / CSW, nebo nejdřív nahrajte (W)'); return; }
    iq.tapePlay();
  } else if (cmd === 'rec') iq.tapeRecord();
  else if (cmd === 'stop') iq.tapeStop();
  else if (cmd === 'rew') iq.tapeRewind();
  updateTape();
}
const leaveDirty = () => !iq.tape.dirty || confirm('Nahrávka na kazetě není uložená. Zahodit ji?');
async function insertTape(name, data) {
  try {
    const t = /\.csw$/i.test(name) || String.fromCharCode(...data.subarray(0, 22)) === 'Compressed Square Wave'
      ? await cswToTape(data, iq.clockHz) : wavToTape(data, iq.clockHz);
    iq.tapeStop();
    iq.tape.insert(t.edges, t.length, t.level0, name);
    note(`📼 ${name}: ${mmss(t.length / iq.clockHz)} — v MONITORu L, Enter a ▶`);
  } catch (e) { note(`kazetu ${name} nelze vložit: ${e.message}`); }
  updateTape();
}
function saveTape() {
  const tape = iq.tape;
  if (!tape.length) return;
  iq.tapeStop();
  const blob = new Blob([tapeToWav(tape)], { type: 'audio/wav' });
  const a = document.createElement('a');
  const base = tape.name && tape.name !== 'nahrávka' ? tape.name.replace(/\.(wav|csw)$/i, '') : 'iq151-kazeta';
  a.href = URL.createObjectURL(blob);
  a.download = `${base}.wav`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  tape.dirty = false;
  if (!tape.name || tape.name === 'nahrávka') tape.name = a.download;
  updateTape();
}
const tapeFile = $('tape-file');
$('tape-load').addEventListener('click', () => { if (leaveDirty()) tapeFile.click(); });
tapeFile.addEventListener('change', async () => {
  const f = tapeFile.files?.[0]; tapeFile.value = '';
  if (f) await insertTape(f.name, new Uint8Array(await f.arrayBuffer()));
});
$('tape-save').addEventListener('click', saveTape);
$('tape-eject').addEventListener('click', () => {
  if (!leaveDirty()) return;
  iq.tapeStop(); iq.tape.clear(); note('');
  updateTape();
});
for (const cmd of ['rew', 'play', 'rec', 'stop']) $('tape-' + cmd).addEventListener('click', () => tapeCommand(cmd));
$('tape-turbo').addEventListener('click', () => { turbo = !turbo; updateTape(); });
// Polarita vstupu z kazety (volba se pamatuje; přenáší se i do nově postaveného stroje,
// protože magnetofon je pořád týž objekt).
function setTapeInvert(on) {
  iq.tape.invert = on;
  try { localStorage.setItem('iq151.tapeInvert', on ? '1' : '0'); } catch {}
  updateTape();
}
try { iq.tape.invert = localStorage.getItem('iq151.tapeInvert') === '1'; } catch {}
$('tape-inv').addEventListener('click', () => setTapeInvert(!iq.tape.invert));
window.addEventListener('beforeunload', e => { if (iq.tape.dirty) { e.preventDefault(); e.returnValue = ''; } });

// --- hláška: zvuk čeká na kliknutí ---
const soundHint = $('sound-hint');
function updateSoundHint() {
  const st = sound.ctx?.state;
  const blocked = sound.enabled && !paused && !document.hidden
    && (!userGestured || (st && st !== 'running' && st !== 'closed'));
  if (soundHint.hidden === blocked) soundHint.hidden = !blocked;
}
soundHint.addEventListener('click', () => { wakeAudio(); soundHint.blur(); focusScreen(); });

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

// --- přetažení souboru na obrazovku ---
// .wav/.csw = kazeta, .rom = monitor, .hex/.ihx/.bin/.hexbin = program
// (.bin o velikosti přesně 4 kB = monitor, jako dřív)
['dragenter', 'dragover'].forEach(ev =>
  stage.addEventListener(ev, e => { e.preventDefault(); stage.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev =>
  stage.addEventListener(ev, e => { e.preventDefault(); stage.classList.remove('drag'); }));
stage.addEventListener('drop', async e => {
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  if (/\.(wav|csw)$/i.test(file.name) || file.type.startsWith('audio/')) {
    if (leaveDirty()) await insertTape(file.name, new Uint8Array(await file.arrayBuffer()));
  } else if (/\.rom$/i.test(file.name) || (/\.bin$/i.test(file.name) && file.size === 4096)) await loadMonitorFile(file);
  else selectProgram(file.name, new Uint8Array(await file.arrayBuffer()));
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

// Spustit až teď: tick() používá magnetofon a hlášku zvuku deklarované výše.
setPaused(false);
tick();

// ----------------------------------------------------------------------------
//  Spuštění s parametry URL (jako u Ondry):
//    ?BIN=MESTO_IQ_G       program z bins/ (zkusí .hex, .hexbin, .bin); po
//                          startu monitoru se zavede a spustí
//    ?TAP=MESTO_IQ_G       kazeta z tapes/ (zkusí .csw, .wav); vloží se,
//                          pak v MONITORu L, Enter a ▶
//    ?GRAFIK=1  ?MOD=none|basic6|basicg  ?VIDEO=64  ?RAM=64  ?MON=v86|v84|dis   sestava stroje
//  Názvy parametrů nerozlišují velikost písmen.
// ----------------------------------------------------------------------------
function urlParam(name) {
  for (const [k, v] of new URLSearchParams(location.search)) if (k.toLowerCase() === name.toLowerCase()) return v.trim();
  return null;
}
const safeName = n => /^[A-Za-z0-9_.\-]+$/.test(n) && !n.startsWith('.');
async function fetchMedia(dir, name, exts) {
  const names = /\.[A-Za-z0-9]+$/.test(name) ? [name] : exts.map(e => `${name}.${e}`);
  for (const file of names) {
    const r = await fetch(`${dir}/${file}`);
    if (r.ok) return { file, data: new Uint8Array(await r.arrayBuffer()) };
  }
  throw new Error(`nelze načíst ${dir}/${names.join(' ani ')}`);
}
const waitMs = ms => new Promise(r => setTimeout(r, ms));
(async function startFromUrl() {
  const bin = urlParam('BIN'), tap = urlParam('TAP');
  const grafik = urlParam('GRAFIK'), mod = urlParam('MOD'), video = urlParam('VIDEO'), ram = urlParam('RAM'), mon = urlParam('MON');
  if (!bin && !tap && !grafik && !mod && !video && !ram && !mon) return;
  try {
    if (bin && !safeName(bin)) throw new Error(`neplatný název BIN: ${bin}`);
    if (tap && !safeName(tap)) throw new Error(`neplatný název TAP: ${tap}`);
    const prog = bin ? await fetchMedia('bins', bin, ['hex', 'hexbin', 'bin']) : null;
    const cass = tap ? await fetchMedia('tapes', tap, ['csw', 'wav']) : null;
    if (mon) {
      const id = { v86: 'std', std: 'std', v84: 'v84', dis: 'dis' }[mon.toLowerCase()];
      if (!id) throw new Error(`neznámý monitor ${mon} (v86, v84, dis)`);
      if (id !== monitorId) await useMonitor(await load('./roms/' + MONITORS[id]), id);
    }
    if (video) videoSelector.set(/64/.test(video) ? 'VIDEO64' : 'VIDEO32');
    if (grafik) grafikSelector.set(/^(1|ano|yes|true|grafik)$/i.test(grafik) ? 'grafik' : 'none');
    if (ram) ramSelector.set(/64/.test(ram) ? '64' : '32');
    if (mod) moduleSelector.set({ none: 'none', monitor: 'none', basic6: 'basic6', basicg: 'basicg' }[mod.toLowerCase()] ?? moduleSelector.value);
    if (cass) await insertTape(cass.file, cass.data);
    if (prog && selectProgram(prog.file, prog.data)) {
      hexInfo(`Čekám na start monitoru, pak spustím ${prog.file}…`);
      await waitMs(2000);
      runProgram();
    }
  } catch (e) { status.textContent = `chyba parametrů URL: ${e.message}`; }
})();
