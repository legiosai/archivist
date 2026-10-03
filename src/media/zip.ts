/**
 * Read single entries out of a ZIP/CBZ without extracting it: the central directory at the end
 * of the file says where each entry starts, so a page costs one seek and one inflate. ZIP64
 * (archives or offsets past 4 GiB) is handled; encrypted entries are refused.
 */
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
  encrypted: boolean;
}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX = 0xffffffff;

function read(fd: number, position: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const n = readSync(fd, buf, done, length - done, position + done);
    if (n === 0) break;
    done += n;
  }
  return done === length ? buf : buf.subarray(0, done);
}

function u64(buf: Buffer, at: number): number {
  return Number(buf.readBigUInt64LE(at));
}

function decodeName(raw: Buffer, utf8: boolean): string {
  return utf8 ? raw.toString("utf8") : raw.toString("latin1");
}

export function readZipIndex(path: string): ZipEntry[] {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const tailLen = Math.min(size, 65_557);
    const tail = read(fd, size - tailLen, tailLen);
    let at = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD) { at = i; break; }
    }
    if (at < 0) throw new Error("not a zip file (no end of central directory)");
    let count = tail.readUInt16LE(at + 10);
    let cdSize = tail.readUInt32LE(at + 12);
    let cdOffset = tail.readUInt32LE(at + 16);
    if (count === 0xffff || cdSize === MAX || cdOffset === MAX) {
      const loc = at - 20;
      if (loc < 0 || tail.readUInt32LE(loc) !== ZIP64_LOCATOR) throw new Error("zip64 locator missing");
      const recAt = u64(tail, loc + 8);
      const rec = read(fd, recAt, 56);
      if (rec.readUInt32LE(0) !== ZIP64_EOCD) throw new Error("zip64 end record missing");
      count = u64(rec, 32);
      cdSize = u64(rec, 40);
      cdOffset = u64(rec, 48);
    }
    const cd = read(fd, cdOffset, cdSize);
    const out: ZipEntry[] = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== CENTRAL) throw new Error("bad central directory entry");
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      let compressedSize = cd.readUInt32LE(p + 20);
      let entrySize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let offset = cd.readUInt32LE(p + 42);
      const name = decodeName(cd.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0);
      let e = p + 46 + nameLen;
      const extraEnd = e + extraLen;
      while (e + 4 <= extraEnd) {               // the zip64 extra field, when a 32-bit value overflowed
        const id = cd.readUInt16LE(e);
        const len = cd.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (entrySize === MAX) { entrySize = u64(cd, q); q += 8; }
          if (compressedSize === MAX) { compressedSize = u64(cd, q); q += 8; }
          if (offset === MAX) { offset = u64(cd, q); }
        }
        e += 4 + len;
      }
      out.push({ name, method, compressedSize, size: entrySize, offset, encrypted: (flags & 1) !== 0 });
      p = extraEnd + commentLen;
    }
    return out;
  } finally {
    closeSync(fd);
  }
}

export function readZipEntry(path: string, entry: ZipEntry): Buffer {
  if (entry.encrypted) throw new Error(`${entry.name}: encrypted entries are not supported`);
  const fd = openSync(path, "r");
  try {
    const head = read(fd, entry.offset, 30);
    if (head.readUInt32LE(0) !== LOCAL) throw new Error(`${entry.name}: bad local header`);
    const start = entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    const data = read(fd, start, entry.compressedSize);
    if (entry.method === 0) return data;
    if (entry.method === 8) return inflateRawSync(data);
    throw new Error(`${entry.name}: compression method ${entry.method} is not supported`);
  } finally {
    closeSync(fd);
  }
}
