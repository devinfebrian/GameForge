import { describe, expect, test } from "bun:test";
import {
  fileExtension,
  mimeTypeFor,
  toBase64,
  toDataUri,
} from "@/lib/export/assets";

describe("fileExtension", () => {
  test("reads the extension from a bucket URL", () => {
    expect(
      fileExtension(
        "https://example.supabase.co/storage/v1/object/public/game-assets/space-shooter/player_ship.png",
      ),
    ).toBe("png");
  });

  test("ignores a query string", () => {
    expect(fileExtension("https://example.test/a/sprite.PNG?token=abc")).toBe("png");
  });

  test("returns an empty string when there is no extension", () => {
    expect(fileExtension("https://example.test/assets/sprite")).toBe("");
    expect(fileExtension("https://example.test/assets/")).toBe("");
  });
});

describe("mimeTypeFor", () => {
  test("maps the sprite formats the catalog uses", () => {
    expect(mimeTypeFor("png")).toBe("image/png");
    expect(mimeTypeFor("webp")).toBe("image/webp");
  });

  test("falls back rather than guessing", () => {
    expect(mimeTypeFor("")).toBe("application/octet-stream");
    expect(mimeTypeFor("psd")).toBe("application/octet-stream");
  });
});

describe("toBase64", () => {
  test("encodes to the same value btoa produces for ASCII", () => {
    const bytes = new TextEncoder().encode("GameForge");

    expect(toBase64(bytes)).toBe(Buffer.from("GameForge").toString("base64"));
  });

  test("handles high bytes that a naive string cast would corrupt", () => {
    const bytes = new Uint8Array([0x00, 0x7f, 0x80, 0xff]);

    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  test("handles an input long enough to overflow a spread call", () => {
    const bytes = new Uint8Array(200_000).fill(0xab);

    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});

describe("toDataUri", () => {
  test("builds a data URI from the bytes and mime type", () => {
    const uri = toDataUri(new Uint8Array([1, 2, 3]), "image/png");

    expect(uri).toBe(`data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}`);
  });
});
