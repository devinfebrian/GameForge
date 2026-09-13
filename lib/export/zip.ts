/**
 * A minimal ZIP writer.
 *
 * Hand-rolled rather than pulling in a dependency: a store-only archive is a
 * few dozen lines of fixed-layout headers, and `AGENTS.md` sets a high bar for
 * adding one. Store-only (method 0) is a deliberate choice, not a shortcut —
 * the payload is dominated by `phaser.min.js`, already-minified JavaScript, and
 * PNGs, both of which barely compress, while the single-file HTML ships
 * uncompressed anyway. Compression would add an async code path and a
 * `CompressionStream` fallback for a few percent.
 *
 * The layout implemented here is the one every unzipper accepts: a local header
 * and data per entry, then one central directory, then the end-of-central-
 * directory record. Sizes and CRCs are known before writing, so no data
 * descriptors and no streaming are needed.
 */

export interface ZipEntry {
  /** Forward-slash separated, relative, e.g. `assets/player.png`. */
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface ZipOptions {
  /** Injectable so an archive is reproducible in tests. */
  readonly modifiedAt?: Date;
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

/** 2.0 — the version that introduced the store and deflate methods. */
const VERSION_NEEDED = 20;
const VERSION_MADE_BY = 20;

/** Bit 11 tells the reader the file name is UTF-8 rather than CP437. */
const UTF8_NAME_FLAG = 0x0800;

const METHOD_STORE = 0;

/** ZIP cannot represent a year before 1980, and DOS time has 2-second ticks. */
const DOS_EPOCH_YEAR = 1980;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
})();

/** The standard CRC-32 (IEEE 802.3) used by ZIP. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date: Date): { readonly time: number; readonly date: number } {
  const year = Math.max(DOS_EPOCH_YEAR, date.getFullYear());

  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day =
    ((year - DOS_EPOCH_YEAR) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

  return { time: time & 0xffff, date: day & 0xffff };
}

/**
 * `Uint8Array<ArrayBuffer>` rather than plain `Uint8Array`: the buffer is freshly
 * allocated here and never shared, and the narrower type is what `Blob` accepts
 * without a cast at the call site.
 */
function concat(chunks: ReadonlyArray<Uint8Array>): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);

  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

/** A little-endian writer over a fixed-size header buffer. */
function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

export function buildZip(
  entries: ReadonlyArray<ZipEntry>,
  options: ZipOptions = {},
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const { time, date } = toDosDateTime(options.modifiedAt ?? new Date());

  const localChunks: Array<Uint8Array> = [];
  const centralChunks: Array<Uint8Array> = [];

  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const crc = crc32(entry.bytes);

    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);

    writeUint32(localView, 0, LOCAL_HEADER_SIGNATURE);
    writeUint16(localView, 4, VERSION_NEEDED);
    writeUint16(localView, 6, UTF8_NAME_FLAG);
    writeUint16(localView, 8, METHOD_STORE);
    writeUint16(localView, 10, time);
    writeUint16(localView, 12, date);
    writeUint32(localView, 14, crc);
    writeUint32(localView, 18, entry.bytes.length);
    writeUint32(localView, 22, entry.bytes.length);
    writeUint16(localView, 26, name.length);
    writeUint16(localView, 28, 0);
    local.set(name, 30);

    localChunks.push(local, entry.bytes);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);

    writeUint32(centralView, 0, CENTRAL_HEADER_SIGNATURE);
    writeUint16(centralView, 4, VERSION_MADE_BY);
    writeUint16(centralView, 6, VERSION_NEEDED);
    writeUint16(centralView, 8, UTF8_NAME_FLAG);
    writeUint16(centralView, 10, METHOD_STORE);
    writeUint16(centralView, 12, time);
    writeUint16(centralView, 14, date);
    writeUint32(centralView, 16, crc);
    writeUint32(centralView, 20, entry.bytes.length);
    writeUint32(centralView, 24, entry.bytes.length);
    writeUint16(centralView, 28, name.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, localOffset);
    central.set(name, 46);

    centralChunks.push(central);

    localOffset += local.length + entry.bytes.length;
  }

  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);

  writeUint32(endView, 0, END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, entries.length);
  writeUint16(endView, 10, entries.length);
  writeUint32(endView, 12, centralSize);
  writeUint32(endView, 16, localOffset);
  writeUint16(endView, 20, 0);

  return concat([...localChunks, ...centralChunks, end]);
}
