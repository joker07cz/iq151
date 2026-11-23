# IQ 151 – Phase 6.1: BASIC G + GRAFIK (experimental)

Phase 5.1 remains the stable reference. Phase 6.0 implemented the standalone GRAFIK hardware. This iteration adds the **original BASIC G ROM expansion** and tests CPU-driven graphics.

## Hardware

- `modules/BasicG.rom` – 8 KiB mapped at `C800–E7FF` (replaces BASIC 6)
- `modules/BasicG2.rom` – 4 KiB mapped at `B000–BFFF` (graphics extension)
- Both windows are read-only; selecting BASIC 6 or no module restores the previous configurations.
- GRAFIK still has independent 16 KiB pixel RAM accessed by original CPU I/O through `D0–D4`.
- No BASIC or drawing statements are simulated in JS; commands execute inside the original BASIC G ROM.

## Manual browser test

1. Start local HTTP server in the project directory: `python3 -m http.server 8000`.
2. Open `http://localhost:8000/`.
3. Select `VIDEO 64`, enable `GRAFIK`, and select `BASIC G` as the ROM module.
4. The startup banner must show `BASIC-G`, followed by `READY`.
5. Enter, one at a time:

```
ERASE 255
ERASE 0
VIDEO 1
FRAME
```

Expected: the first fills the bitmap plane, the second clears it, VIDEO 1 enables graphics, and FRAME draws a visible rectangle. GRAFIK can also be combined with VIDEO 32.

**Why simply inserting GRAFIK changes nothing:** It is an independent, initially empty bitmap RAM. It needs software to write pixels and enable its video signal. BASIC 6 has no native access to these graphics commands.

## Automated verification

`node test/basicg.mjs` validates ROM mapping, read-only behavior, BASIC G startup and `PRINT 42`.

`node test/basicg_graphics.mjs` uses real keyboard input to execute the original BASIC G commands `ERASE 255`, `VIDEO 1`, `ERASE 0` and `FRAME`, checks the 16 KiB bitmap RAM and verifies that graphics change output pixels.

All earlier tests in `test/*.mjs` remain available. Browser interactivity and exact analog display behavior require user validation; this phase is not a new stable baseline.
