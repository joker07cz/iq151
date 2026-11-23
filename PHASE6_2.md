# IQ 151 Phase 6.2 — Intel HEX import (experimental)

**Stable reference:** 5.1 (`iq151-v5.1-stable`). This update follows Phase 6.1 (BASIC G/GRAFIK), which remains available separately.

## Scope

- New `src/intel_hex.js`: true Intel HEX records 00 (data), 01 (EOF), 02/04 (extended addresses), 03/05 (explicit start); verifies every checksum, record length, EOF, duplicate writes, and 16-bit IQ 151 address space.
- Sparse records load only the supplied bytes. Loading is atomic on validation failure; no ROM, video RAM, module ROM or I/O is changed through loader.
- New web form: pick `.hex`, inspect proposed address/ranges, optionally edit hex entry address and click **Spustit HEX**. The button loads RAM and sets CPU PC; **it does not emulate a tape drive or intervene in the ROM**. CPU/ROM/PIC/8255/video remain unchanged.
- Included sample `programs/invaders.hex` supplied by tester. Its data uses `0100–1FFF` and `5000–5D8F` (11408 bytes); record checksums validate. No type 03/05 start record exists. Default start `0100h` is the lowest loaded data address, not an instruction heuristic; the first instruction there happens to be `JMP 5000h`. The nonzero address of the EOF record does **not** determine entry.
- The HEX requires GRAFIK: without it the text screen is largely blank. Real CPU execution from 0100h reaches game routines and writes 552 nonzero bytes to GRAFIK RAM in automated smoke test. Visual playability and controls still require browser testing.
- Existing stable base has **no audio output**; hardware speaker is connected to system 8255 PC3. Audio is deliberately not part of this change.

## Test in browser

1. `python3 -m http.server 8000` in extracted project directory; open `http://localhost:8000/`.
2. Select **VIDEO 32** and **GRAFIK**, ideally **Bez modulu (MONITOR)**.
3. Click **Soubor → invaders.hex**, which is included under `programs/` (or use download link).
4. Loader should report `11408` bytes, ranges `0100–1FFF, 5000–5D8F`, entry `0100`.
5. Click **Spustit HEX**. Game code runs under actual i8080; focus returns to the emulated screen for keyboard input. Press RESET to clear loaded RAM.
6. Test other HEX files separately. The default start address is the lowest loaded RAM address unless a type 03/05 start record exists; edit it if the program documentation says otherwise. Different software may require other modules/ROM or memory configurations. Intel HEX is a data format, not a guarantee that any IQ 151 software will run.

## Regression

`node test/hex_loader.mjs` validates Intel HEX parser, rejection before any RAM writes, program entry, real i8080 execution and GRAFIK output.
Run the full suite with `for f in test/*.mjs; do node "$f" || break; done`.

Stable Phase 5.1 has not been modified.
