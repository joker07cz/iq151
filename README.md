# IQ 151 — magnetofon a programy (HEX / BIN / HEXBIN)

**Magnetofon** (`src/iq151_tape.js`): kazeta WAV nebo CSW (v1, v2 RLE / Z-RLE), uložení jako WAV 44,1 kHz.
Zapojení podle JIQ151 a rutin monitoru: PC1 = motor, PC0 = data ven (klopný obvod 1 kHz, XOR s hodinami →
dvoufázový kód, buňka 1 ms), PC7 = data z pásky, PC5 = hodiny 1 kHz (při běžícím motoru). Páska se posouvá
jen při ▶ / ● a sepnutém motoru. Monitor po startu má IOBYTE 69h, takže **L** čte Intel HEX z pásky a po EOF
záznamu s nenulovou adresou program spustí, **W od,do,start** zapisuje. Tlačítko ⏩ TURBO pouští emulaci,
dokud se točí páska, tak rychle, jak prohlížeč stačí (až 100×).

**Programy** (`src/iq151_program.js`): `.hex` (start = záznam 03/05, jinak adresa EOF jako u L), `.bin`
blokový jako u Ondry (`01 adr délka data… 02 start`), jinak prostý od adresy START, `.hexbin` (turbo zavaděč
v HEX + blokový BIN, jak je vyrábí Hexbin2WAV).

URL: `?TAP=MESTO_IQ_G` (z `tapes/`, zkusí .csw a .wav), `?BIN=MESTO_IQ_G` (z `bins/`, zkusí .hex, .hexbin, .bin),
sestava `?GRAFIK=1&MOD=none&VIDEO=64&RAM=64`.

Testy: `node test/tape.mjs` (W → páska → WAV → L), `node test/program.mjs`.

# IQ 151 — Phase 6.2 (experimental)

Intel HEX program loading. See **[PHASE6_2.md](PHASE6_2.md)** for test steps, entry address, Invaders requirements and limitations. Phase 5.1 remains the unchanged stable reference.

# IQ 151 — Phase 6.1 (experimental)

**Stable reference is Phase 5.1.** Phase 6.1 adds the original BASIC G EPROM module to the Phase 6.0 GRAFIK hardware; it does not alter the stable reference.

See [PHASE6_1.md](PHASE6_1.md) for exact memory windows, manual demonstration and verification commands.

# IQ 151 — první boot monitoru (Phase 1)

Opraveno resetové mapování monitoru na adresu 0000h (zrcadlení horních 2 kB ROM F800-FFFF), odpojení resetového překryvu přes port 80h bit 0. Startuje původní Monitor-std.rom; VIDEO32 používá chars.bin 8x8.

## Spuštění

Z adresáře projektu: `python3 -m http.server 8000`, otevřít `http://localhost:8000/`.

Test: `node test/boot_assert.mjs`.

## Stav

Testováno: skutečný resetový skok 0000 -> F818, vypnutí resetového mapování portem 80, inicializace paměti, VIDEO32 a běh monitorové smyčky v ROM (300000 instrukcí).

Omezení: Porty 8255/8259 zatím pouze minimální registry bez přesné emulace časování a přerušení; klávesnice není implementována. Zobrazení používá přímé čtení znakové RAM, potřebuje prohlížečové ověření polohy a polarity znaků. Při výpisu zatím nelze zadávat příkazy. Cykly zatím nejsou synchronizované s reálnými 2 MHz; cíl této fáze je funkční inicializace monitoru.

## Phase 2: 8255 keyboard
8255 mode-0 port directions/BSR and 8x8 active-low keyboard scan. Key positions derived from supplied reference emulator.jar original key mappings. Run `node test/ppi.mjs`. PIC/8259 interrupts are not implemented.

## Phase 3: 8259 and real-time IRQ6

- `src/i8259.js`: ICW/OCW, IRR/ISR/IMR, fixed priorities, EOI, MCS-80/85 `CALL` vector.
- IRQ6 every 20 ms; wall-clock pacing independent of the display refresh rate, with matching 2 MHz CPU execution budget.
- Main loop caps a single catch-up interval to 100 ms to avoid huge jumps after browser-tab suspension. No 50 Hz IRQ is inferred from `requestAnimationFrame`.
- `node test/interrupt.mjs` verifies three consecutive press/release cycles through the original monitor ROM.
- Actual browser behavior is still to be validated by hand. Cassette/module expansion is unchanged.

## Phase 3.2 browser keyboard regression fix

Browser `KeyboardEvent.keyCode` uses 13 for Enter and 8 for Backspace,
while the original Java keyboard map uses 10 and 127 respectively.
`IQ151.setKey()` translates these codes before accessing the 8x8 matrix.
No ROM, CPU, PIC, PPI, or screen logic was changed.

Verified with `node test/keymap_regression.mjs`: typing `XA55` and Enter
stores `55h` at RAM `0023h`; the monitor display is not cleared.
Other regression tests remain passing.

## Phase 4: BASIC 6 EPROM module (hardware-only)

- `src/iq151_module.js` models the BASIC 6 ROM module as four 2 KB EPROMs in the read-only address range `C800h–E7FFh`.
- `IQ151.loadBasic6()` attaches it, `IQ151.ejectModule()` removes it. No jump to BASIC is injected: the original monitor detects the ROM and starts it through its own code.
- The web UI provides `BASIC 6` / `Bez modulu (MONITOR)` selector. Switching resets the machine (like changing a physical expansion module with power off). Default: BASIC 6.
- `node test/basic6.mjs` checks open bus without module, original monitor, read-only ROM decoding, automatic BASIC banner/READY and `10 PRINT 42` followed by `RUN`.
- Original working Intel 8080, 8255, 8259, VIDEO 32 and keyboard implementations remain unchanged. Cassette and other modules are not part of this phase.

Run from project root: `python3 -m http.server 8000` and open `http://localhost:8000/`.

## Phase 4.1: Host keyboard characters and SHIFT line

- Web keyboard events use `event.key` (resulting character), not bare `keyCode`, for printable characters. Mapping is extracted from the reference Java smart keyboard's `keyPressDecodeByChar`, including 95 printable ASCII characters.
- `SHIFT` is an active-low **PC4 input of the 8255**, not a key in the 8×8 matrix. Also mapped PC5/6/7 for CTRL/FA/FB.
- Original Java smart-keyboard letter-case translation was inverted relative to actual BASIC 6 behavior (it entered `print`, causing BASIC error 21); the browser adapter swaps alphabetic Shift *only*, based on executing `10 PRINT "!$"`/`RUN` on the original ROM. The matrix and PC4 signal remain physical.
- `event.code` tracks physical key releases even if the Shift state changes while a key is down.
- Existing `setKey(numericKeyCode, pressed)` API remains for legacy tests. New browser path is `setBrowserKey(event, pressed)`.
- No changes to CPU, ROM, 8259, timer or BASIC module. Non-ASCII national/dead keys need a separate localization policy; this phase covers printable ASCII.

Run `node test/keychars.mjs` plus previous test scripts.

## Phase 4.2: Authentic letter case on the IQ keyboard

- Correct host-to-IQ keyboard adapter: **unshifted alphabetic keys produce uppercase** in the original monitor/BASIC; holding the IQ SH modifier produces lowercase. This behavior is documented in the period IQ 151 user manual.
- Host Caps Lock does not invert the IQ SH line. Printable punctuation still follows the original character-to-matrix table.
- No changes to 8255 electrical levels, monitor/BASIC ROM, CPU, video, 8259 or timing.
- Added regression test for typing the host's lowercase `10 print 42` as the IQ's uppercase `10 PRINT 42`, as well as original SH+letter, Caps Lock and the BASIC punctuation test.

Run `node test/keycase.mjs` to verify. Original `node test/keychars.mjs` still applies.

## Phase 4.3: Host Shift/Option/AltGr keyboard bridge

The first 4.2 tests sent printable symbols directly (`key='!'`), not as
physical modifier combinations. This phase changes only the host-keyboard
adapter. It distinguishes physical Shift/Option/AltGr from the modifier lines
of the IQ 151 when typing a printable character. The character's own IQ SH
requirement is still forwarded through 8255 PC4; printable characters typed
via Option or AltGr no longer also assert IQ FA/CTRL during the keypress.
Simultaneously held printable keys use the newest one to determine IQ SH.

`node test/real_keyboard.mjs` exercises `10 print "!$"` and `run` with
physical Shift, Option and Ctrl+Alt (AltGr) events. The tests do not prove
behavior of every national/macOS keyboard layout.

For diagnosis of a host layout, open the web page with `?debugKeys=1`.
An eight-event log below the status shows the raw browser key, physical
code, modifier flags and mapped IQ SH/FA signals. The log changes no
machine hardware. If a particular symbol is still missed, this log
should identify whether the browser reports `Dead`, an unexpected Unicode
character, or a correctly translated key.

CPU, 8255, 8259, ROMs, BASIC and video are unchanged.

## Phase 4.4: Czech number-row mapping

- On a Czech Mac keyboard, `Digit1` emits the literal `+` without modifiers,
  while `Digit2` through `Digit0` emit Czech accented letters. The old adapter
  interpreted `+` as IQ Shift+';', but fell back to digits for accented chars.
- Unmodified physical `Digit0`–`Digit9` now consistently generate the numeric
  keys on IQ 151. With Shift/Option/AltGr, resulting printable symbols still
  use the existing character-to-matrix translation.
- No changes to the IQ keyboard matrix, 8255, CPU, ROM, BASIC, display, or 8259.
- Reproduced and regression-tested with `node test/czech_digits.mjs`, including
  a real BASIC `PRINT 12` path using raw Czech `+` and `ě` host key values.

## Phase 5: VIDEO 64 interchangeable display module

- Web selector now switches between VIDEO 32 and VIDEO 64, reconstructing the machine (power-off module change) and keeping the BASIC6/monitor ROM selector.
- VIDEO 64 has **2 KiB of video RAM at E800–EFFF**, 64 columns × 32 rows and returns `FEh` on inputs `FCh–FFh`. VIDEO 32 has 1 KiB at EC00–EFFF, 32 columns × 32 rows and returns `FFh` on these ports.
- Writes `OUT FCh–FFh` on VIDEO 64 set the module's double-width-enable latch (bit 0). **The actual control-character-based double-width rendering is not implemented yet**; it should be a separate stage with its own reference tests.
- The 512×256 browser raster currently uses the `chars.bin` bundled with the Java reference emulator, rendering each character as an 8×8 cell, as the Java emulation does. Fidelity to a distinct physical VIDEO 64 character-generator EPROM has not been verified.
- Boot behavior is not patched: stock monitor discovers VIDEO64, puts `64` into RAM `001Fh`, sets the video pointer to `E800h`, detects BASIC 6 and enters `READY`.
- `node test/video64.mjs` verifies both memory maps, port detection, the latch, ROM boot, BASIC startup, raster dimensions and **real BASIC 6 `10 PRINT 42` / `RUN` in VIDEO64**. All previous regression tests also pass.
- Timing/CPU/8255/8259/keyboard remain unchanged.

Run the project server normally (`python3 -m http.server 8000`) and select `VIDEO 64` in the UI. Check both BASIC 6 and MONITOR without a ROM module, plus text alignment, cursor and scrolling on the real browser display.

## Phase 5.1: Correct VIDEO 64 display aspect (visual-only)

- VIDEO 32 is still displayed as 256×256 with square pixels.
- VIDEO 64 still has **512×256 logical pixels** and 64×32 character cells, but
  the browser's **presentation buffer is 512×512**. Every logical scanline is
  duplicated vertically (1:2 pixel aspect). Both display modes therefore have
  a square screen footprint instead of VIDEO 64 looking like a 2:1 panorama.
- No changes to VIDEO 64 memory decoding, its `FC`–`FF` registers, CPU,
  interrupts, timings, BASIC, font, or text geometry.
- `node test/video64.mjs` checks unchanged logical geometry and precise 2×
  vertical scanline duplication, in addition to monitor and BASIC boot tests.
