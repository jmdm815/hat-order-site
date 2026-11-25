// Streaming PNG writer: the gang sheet (7200 px wide, up to 57,600 px tall)
// is far bigger than one canvas, so it is drawn in bands and each band's rows
// are compressed straight into the file (browser-native zlib, CompressionStream).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  const t = new TextEncoder().encode(type);
  out.set(t, 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32([t, data]));
  return out;
}

export type PngSink = (bytes: Uint8Array) => Promise<void>;

/**
 * Begin a PNG; returns `addRows(rgba, rows)` and `finish()`. Rows are RGBA,
 * `width * 4` bytes each. Output goes to `sink` in order.
 */
export async function pngStream(width: number, height: number, dpi: number, sink: PngSink) {
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const phys = new Uint8Array(9);
  const ppm = Math.round(dpi / 0.0254);
  new DataView(phys.buffer).setUint32(0, ppm);
  new DataView(phys.buffer).setUint32(4, ppm);
  phys[8] = 1;
  await sink(sig);
  await sink(chunk("IHDR", ihdr));
  await sink(chunk("pHYs", phys));

  const cs = new CompressionStream("deflate"); // zlib format = what IDAT holds
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();
  // Drain compressed output into IDAT chunks as it arrives.
  const drained = (async () => {
    let pending: Uint8Array[] = [];
    let size = 0;
    const flush = async () => {
      if (!size) return;
      const all = new Uint8Array(size);
      let o = 0;
      for (const p of pending) { all.set(p, o); o += p.length; }
      pending = []; size = 0;
      await sink(chunk("IDAT", all));
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending.push(value); size += value.length;
      if (size > 4 * 1024 * 1024) await flush();
    }
    await flush();
  })();

  const stride = width * 4;
  return {
    async addRows(rgba: Uint8ClampedArray | Uint8Array, rows: number) {
      const buf = new Uint8Array(rows * (stride + 1));
      for (let y = 0; y < rows; y++) {
        buf[y * (stride + 1)] = 0; // filter: none
        buf.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
      }
      await writer.write(buf);
    },
    async finish() {
      await writer.close();
      await drained;
      await sink(chunk("IEND", new Uint8Array(0)));
    },
  };
}
