import { deflateSync } from "node:zlib";

/**
 * bakim #8 (plan §6): tiny, valid image fixtures built in memory, no dependency.
 * Only headers matter to `imageInfo`, but the PNG is a full decodable file.
 */

const CRC_TABLE = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Solid-colour RGB PNG of the given size (default red). */
export function pngBytes(width = 1, height = 1, rgb: [number, number, number] = [255, 0, 0]): Buffer {
  const row = 1 + width * 3;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw.set(rgb, y * row + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** SOI + APP0 (JFIF) + SOF0 header with the given size (enough for sniffing). */
export function jpegBytes(width = 3, height = 2): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

/** GIF89a logical screen header with the given size. */
export function gifBytes(width = 2, height = 2): Buffer {
  const b = Buffer.alloc(13);
  b.write("GIF89a", 0, "latin1");
  b.writeUInt16LE(width, 6);
  b.writeUInt16LE(height, 8);
  return Buffer.concat([b, Buffer.from([0x3b])]);
}

/** RIFF/WEBP with a VP8L (lossless) header. */
export function webpBytes(width = 5, height = 4): Buffer {
  const w = width - 1;
  const h = height - 1;
  const bits = Buffer.from([0x2f, w & 0xff, ((w >> 8) & 0x3f) | ((h & 0x03) << 6), (h >> 2) & 0xff, (h >> 10) & 0x0f]);
  const body = Buffer.concat([Buffer.from("WEBPVP8L", "latin1"), Buffer.from([bits.length, 0, 0, 0]), bits]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

/** RIFF/WEBP with a VP8 (lossy) key-frame header. */
export function webpVp8Bytes(width = 7, height = 6): Buffer {
  const frame = Buffer.alloc(10);
  frame.set([0x9d, 0x01, 0x2a], 3);
  frame.writeUInt16LE(width & 0x3fff, 6);
  frame.writeUInt16LE(height & 0x3fff, 8);
  const body = Buffer.concat([Buffer.from("WEBPVP8 ", "latin1"), Buffer.from([frame.length, 0, 0, 0]), frame]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

/** RIFF/WEBP with a VP8X (extended) canvas header. */
export function webpVp8xBytes(width = 300, height = 200): Buffer {
  const data = Buffer.alloc(10);
  data.writeUIntLE(width - 1, 4, 3);
  data.writeUIntLE(height - 1, 7, 3);
  const body = Buffer.concat([Buffer.from("WEBPVP8X", "latin1"), Buffer.from([data.length, 0, 0, 0]), data]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

/** A PNG header padded to exactly `size` bytes (limit tests). */
export function pngOfSize(size: number): Buffer {
  const head = pngBytes(1, 1);
  const out = Buffer.alloc(size);
  head.copy(out, 0, 0, Math.min(head.length, size));
  return out;
}
