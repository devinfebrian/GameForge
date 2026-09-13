import { describe, expect, test } from "bun:test";
import { buildZip, crc32, type ZipEntry } from "@/lib/export/zip";

/**
 * A minimal reader, written here rather than imported.
 *
 * The point of these tests is that the archive is well-formed for a real
 * unzipper, so the assertions run against the byte layout (signatures, central
 * directory, offsets) instead of against this module's own idea of the output.
 */
interface ReadEntry {
  readonly path: string;
  readonly method: number;
  readonly crc: number;
  readonly bytes: Uint8Array;
}

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;

function readZip(archive: Uint8Array): ReadonlyArray<ReadEntry> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const decoder = new TextDecoder();

  let end = -1;

  for (let offset = archive.length - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === END_SIGNATURE) {
      end = offset;
      break;
    }
  }

  if (end === -1) {
    throw new Error("no end-of-central-directory record");
  }

  const total = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  let cursor = view.getUint32(end + 16, true);

  if (cursor + centralSize !== end) {
    throw new Error("central directory does not end where the record says it does");
  }

  const entries: Array<ReadEntry> = [];

  for (let index = 0; index < total; index += 1) {
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      throw new Error(`entry ${index}: bad central header signature`);
    }

    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const path = decoder.decode(archive.subarray(cursor + 46, cursor + 46 + nameLength));

    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
      throw new Error(`entry ${index}: bad local header signature`);
    }

    const dataStart =
      localOffset +
      30 +
      view.getUint16(localOffset + 26, true) +
      view.getUint16(localOffset + 28, true);

    entries.push({
      path,
      method,
      crc,
      bytes: archive.slice(dataStart, dataStart + size),
    });

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

const FIXED_DATE = new Date("2026-09-13T12:00:00Z");

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe("crc32", () => {
  test("matches the standard check value", () => {
    expect(crc32(encode("123456789"))).toBe(0xcbf43926);
  });

  test("is zero for no input", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  test("is order sensitive", () => {
    expect(crc32(encode("ab"))).not.toBe(crc32(encode("ba")));
  });
});

describe("buildZip", () => {
  test("round-trips text entries with matching CRCs", () => {
    const entries = readZip(buildZip([{ path: "hello.txt", bytes: encode("hello") }], {
      modifiedAt: FIXED_DATE,
    }));

    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe("hello.txt");
    expect(entries[0]?.method).toBe(0);
    expect(entries[0]?.crc).toBe(crc32(encode("hello")));
    expect(new TextDecoder().decode(entries[0]?.bytes)).toBe("hello");
  });

  test("round-trips binary data byte for byte", () => {
    // Every byte value, which is what would break a signed or UTF-8 round trip.
    const png = new Uint8Array(256);

    for (let index = 0; index < png.length; index += 1) {
      png[index] = index;
    }

    const entries = readZip(
      buildZip([{ path: "assets/player.png", bytes: png }], { modifiedAt: FIXED_DATE }),
    );

    expect(entries[0]?.bytes).toEqual(png);
  });

  test("preserves entry order and nested paths", () => {
    const input: ReadonlyArray<ZipEntry> = [
      { path: "index.html", bytes: encode("<html></html>") },
      { path: "vendor/jsfxr/riffwave.js", bytes: encode("js") },
      { path: "assets/player.png", bytes: new Uint8Array([1, 2, 3]) },
    ];

    const entries = readZip(buildZip(input, { modifiedAt: FIXED_DATE }));

    expect(entries.map((entry) => entry.path)).toEqual(input.map((entry) => entry.path));
  });

  test("produces a valid archive with no entries", () => {
    expect(readZip(buildZip([], { modifiedAt: FIXED_DATE }))).toEqual([]);
  });

  test("refuses more entries than the format can count", () => {
    const entries: ReadonlyArray<ZipEntry> = Array.from(
      { length: 0x10000 },
      (_, index) => ({ path: `file-${index}`, bytes: new Uint8Array(0) }),
    );

    expect(() => buildZip(entries, { modifiedAt: FIXED_DATE })).toThrow("65535");
  });

  test("handles a name long enough to need the full length field", () => {
    const path = `${"a".repeat(200)}.js`;
    const entries = readZip(buildZip([{ path, bytes: encode("x") }], { modifiedAt: FIXED_DATE }));

    expect(entries[0]?.path).toBe(path);
  });

  test("is reproducible for a fixed date", () => {
    const entries: ReadonlyArray<ZipEntry> = [{ path: "a.txt", bytes: encode("a") }];

    expect(buildZip(entries, { modifiedAt: FIXED_DATE })).toEqual(
      buildZip(entries, { modifiedAt: FIXED_DATE }),
    );
  });
});
