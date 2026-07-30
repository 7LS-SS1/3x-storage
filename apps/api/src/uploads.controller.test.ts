import { describe, expect, it } from "vitest";
import { hasVideoSignature } from "./uploads.controller";

function bytesWithAscii(offset: number, value: string, length = 512) {
  const bytes = Buffer.alloc(length);
  bytes.write(value, offset, "ascii");
  return bytes;
}

describe("video file signatures", () => {
  it("accepts ISO BMFF files only when ftyp is at byte 4", () => {
    expect(hasVideoSignature(".mp4", bytesWithAscii(4, "ftyp"))).toBe(true);
    expect(hasVideoSignature(".mp4", bytesWithAscii(0, "ftyp"))).toBe(false);
  });

  it("recognizes WebM and Matroska EBML headers", () => {
    const bytes = Buffer.alloc(512);
    bytes.set([0x1a, 0x45, 0xdf, 0xa3], 0);
    expect(hasVideoSignature(".webm", bytes)).toBe(true);
    expect(hasVideoSignature(".mkv", bytes)).toBe(true);
  });

  it("checks repeated MPEG-TS sync bytes", () => {
    const valid = Buffer.alloc(512);
    valid[0] = 0x47;
    valid[188] = 0x47;
    const invalid = Buffer.from(valid);
    invalid[188] = 0;
    expect(hasVideoSignature(".ts", valid)).toBe(true);
    expect(hasVideoSignature(".ts", invalid)).toBe(false);
  });

  it("rejects an executable signature renamed as a video", () => {
    expect(hasVideoSignature(".mp4", bytesWithAscii(0, "MZ"))).toBe(false);
    expect(hasVideoSignature(".avi", bytesWithAscii(0, "MZ"))).toBe(false);
  });
});
