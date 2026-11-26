// Intel HEX is an interchange format, not a simulated IQ 151 peripheral.
// Parse and validate the whole file before touching any emulated memory.
const hex16 = n => n.toString(16).toUpperCase().padStart(4, '0');
export function parseIntelHex(source) {
  if (typeof source !== 'string') throw new TypeError('Intel HEX input must be text');
  if (source.length > 4_000_000) throw new Error('HEX file is too large');
  let base = 0, eof = false, startAddress = null, eofAddress = 0, count = 0;
  const bytes = new Map();
  const lines = source.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  const error = (line, message) => { throw new Error(`HEX line ${line}: ${message}`); };
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    if (!line) continue;
    const n = idx + 1;
    if (eof) error(n, 'nonempty record after EOF');
    if (!/^:[\da-fA-F]+$/.test(line) || line.length < 11 || (line.length - 1) % 2)
      error(n, 'invalid Intel HEX record');
    const rec = [];
    for (let pos = 1; pos < line.length; pos += 2)
      rec.push(Number.parseInt(line.slice(pos, pos + 2), 16));
    const size = rec[0], offset = (rec[1] << 8) | rec[2], kind = rec[3];
    if (rec.length !== size + 5) error(n, 'incorrect record length');
    if ((rec.reduce((a, b) => a + b, 0) & 255) !== 0)
      error(n, 'checksum mismatch');
    const payload = rec.slice(4, 4 + size);
    count++;
    switch (kind) {
      case 0x00: {
        const begin = base + offset;
        if (begin + size > 0x10000) error(n, 'address exceeds the 16-bit IQ 151 address space');
        for (let i = 0; i < size; i++) {
          const address = begin + i;
          if (bytes.has(address) && bytes.get(address) !== payload[i])
            error(n, `conflicting data at ${hex16(address)}h`);
          bytes.set(address, payload[i]);
        }
        break;
      }
      case 0x01:
        if (size !== 0) error(n, 'EOF record must be empty');
        // Monitor IQ 151 (příkaz L) bere adresu v EOF záznamu jako start:
        // nenulová = po nahrání skočí na ni, 0000 = vrátí se do monitoru.
        eofAddress = offset; eof = true; break;
      case 0x02:
        if (size !== 2 || offset !== 0) error(n, 'invalid segment address record');
        base = (((payload[0] << 8) | payload[1]) << 4); break;
      case 0x04:
        if (size !== 2 || offset !== 0) error(n, 'invalid linear address record');
        base = (((payload[0] << 8) | payload[1]) * 0x10000); break;
      case 0x03:
        if (size !== 4 || offset !== 0) error(n, 'invalid start-segment record');
        startAddress = (((payload[0] << 8) | payload[1]) << 4) + ((payload[2] << 8) | payload[3]);
        if (startAddress > 0xffff) error(n, 'start address exceeds 16 bits');
        break;
      case 0x05:
        if (size !== 4 || offset !== 0) error(n, 'invalid start-linear record');
        startAddress = (payload[0] * 0x1000000) + (payload[1] << 16) + (payload[2] << 8) + payload[3];
        if (startAddress > 0xffff) error(n, 'start address exceeds 16 bits');
        break;
      default:
        error(n, `unsupported record type ${kind.toString(16).toUpperCase().padStart(2, '0')}`);
    }
  }
  if (!eof) throw new Error('HEX file has no EOF record');
  if (!bytes.size) throw new Error('HEX file contains no data');
  const ordered = [...bytes].sort((a, b) => a[0] - b[0]);
  const ranges = [];
  for (const [address] of ordered) {
    const last = ranges[ranges.length - 1];
    if (last && address === last.end + 1) last.end = address;
    else ranges.push({start: address, end: address});
  }
  return {
    bytes: ordered, ranges, records: count, size: ordered.length,
    // Start: záznam 03/05, jinak nenulová adresa EOF (konvence monitoru IQ 151),
    // jinak začátek nejnižší oblasti dat. Skok se z kódu neodhaduje.
    entry: startAddress ?? (eofAddress || ordered[0][0]),
    explicitEntry: startAddress !== null || eofAddress !== 0,
  };
}

// Only ordinary RAM is a valid destination. Never overwrite ROM, VRAM or a
// mapped BASIC module, and do not accidentally make writes through MMIO.
export function installIntelHex(machine, parsed) {
  if (!parsed?.bytes?.length) throw new Error('No HEX program selected');
  for (const [address] of parsed.bytes) {
    const videoStart = machine.video === 'VIDEO64' ? 0xe800 : 0xec00;
    if (address >= machine.ram.length || (address >= videoStart && address < 0xf000) ||
        (machine.module && machine.module.contains(address)) || address >= 0xf000)
      throw new Error(`HEX targets non-writable RAM at ${hex16(address)}h`);
  }
  // All-or-nothing commit after validation. A HEX load must not reset the IQ,
  // and loading it must not change CPU registers, IRQs or the current ROM.
  for (const [address, value] of parsed.bytes) machine.memWrite(address, value);
  return parsed.size;
}
