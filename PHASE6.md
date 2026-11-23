# IQ 151 Phase 6.0 — GRAFIK hardware only (experimental)

Starting point: **unmodified stable Phase 5.1**, tagged `iq151-v5.1-stable` in the separate Git snapshot.

Implemented separately:
- Optional GRAFIK expansion with its own **16 KiB** RAM, **512×256** bitmap, **not memory-mapped** on the CPU bus.
- I/O **D0** x-byte, **D1** Y from lower edge, **D2** control, **D3** 8255 mode/BSR, **D4** bitmap transfer.
- 8255 init `OUT D3,80h`; D2 bit7 `SEL` (bus access), bit3 `EV` (video signal), bit1 `PEN*`, bit0 `ALL`.
- Byte access or single bit through D4 high three bits, 1 bit per pixel with stored bit0 leftmost.
- Independent VIDEO32/VIDEO64 + GRAFIK composite; logical 512×256, presented 512×512 (aspect 1:1), OR with text.
- Hardware-level test `node test/grafik.mjs`. Existing test suite retained.

**Not implemented:** BASIC G EPROM mapping `B000–BFFF` and related BASIC interpreter behavior. Actual BASIC G software integration has **not** been tested. Video emulation omits physical pixel contention/FAST* artifacts and color add-on; these are separate steps.

Source: P. Přívětivý, *Školní mikropočítač IQ 151*, section 8, technical docs at sapi.cz; cross-check with `machine.Grafik` class of supplied Java emulator.
