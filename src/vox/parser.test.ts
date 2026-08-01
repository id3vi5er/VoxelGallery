import { describe, expect, it } from "vitest";
import { parseVox } from "./parser";
import { buildVoxGeometry } from "./geometry";

const encoder = new TextEncoder();
type Bytes = Uint8Array<ArrayBufferLike>;

function concat(...parts: Bytes[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function int32(value: number): Uint8Array {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setInt32(0, value, true);
  return result;
}

function chunk(id: string, content: Bytes = new Uint8Array(), children: Bytes = new Uint8Array()): Uint8Array<ArrayBuffer> {
  return concat(encoder.encode(id), int32(content.length), int32(children.length), content, children);
}

function dictionary(values: Record<string, string>): Uint8Array {
  const entries = Object.entries(values);
  return concat(
    int32(entries.length),
    ...entries.flatMap(([key, value]) => {
      const keyBytes = encoder.encode(key);
      const valueBytes = encoder.encode(value);
      return [int32(keyBytes.length), keyBytes, int32(valueBytes.length), valueBytes];
    }),
  );
}

function voxFile(...chunks: Uint8Array[]): Uint8Array {
  const children = concat(...chunks);
  return concat(encoder.encode("VOX "), int32(150), chunk("MAIN", new Uint8Array(), children));
}

describe("parseVox", () => {
  it("parses model dimensions and voxel colors", () => {
    const palette = new Uint8Array(1024);
    palette.set([12, 34, 56, 255], 0);
    const data = voxFile(
      chunk("SIZE", concat(int32(2), int32(1), int32(1))),
      chunk("XYZI", concat(int32(2), new Uint8Array([0, 0, 0, 1, 1, 0, 0, 1]))),
      chunk("RGBA", palette),
    );
    const result = parseVox(data);
    expect(result.version).toBe(150);
    expect(result.models).toHaveLength(1);
    expect(result.models[0].size).toEqual([2, 1, 1]);
    expect(result.models[0].voxelCount).toBe(2);
    expect(result.models[0].voxels).toHaveLength(8);
    expect(result.palette[1]).toEqual({ r: 12, g: 34, b: 56, a: 255 });
  });

  it("resolves modern scene graph translations", () => {
    const transform = concat(
      int32(0), dictionary({}), int32(1), int32(-1), int32(0), int32(1), dictionary({ _t: "5 6 7" }),
    );
    const shape = concat(int32(1), dictionary({}), int32(1), int32(0), dictionary({}));
    const data = voxFile(
      chunk("SIZE", concat(int32(1), int32(1), int32(1))),
      chunk("XYZI", concat(int32(1), new Uint8Array([0, 0, 0, 1]))),
      chunk("nTRN", transform),
      chunk("nSHP", shape),
    );
    expect(parseVox(data).instances[0].transform.translation).toEqual([5, 6, 7]);
  });

  it("removes the shared internal faces of adjacent voxels", () => {
    const data = voxFile(
      chunk("SIZE", concat(int32(2), int32(1), int32(1))),
      chunk("XYZI", concat(int32(2), new Uint8Array([0, 0, 0, 1, 1, 0, 0, 1]))),
    );
    const result = buildVoxGeometry(parseVox(data));
    expect(result.voxelCount).toBe(2);
    expect(result.geometry.getIndex()?.count).toBe(60);
    result.geometry.dispose();
  });

  it("rejects files without the VOX signature", () => {
    expect(() => parseVox(new Uint8Array(16))).toThrow(/VOX-Header/);
  });

  it("stops overly complex geometry with a controlled error", () => {
    const data = voxFile(
      chunk("SIZE", concat(int32(1), int32(1), int32(1))),
      chunk("XYZI", concat(int32(1), new Uint8Array([0, 0, 0, 1]))),
    );
    const scene = parseVox(data);
    scene.models[0].voxelCount = 20_000_001;
    expect(() => buildVoxGeometry(scene)).toThrow(/zu viele Voxel/);
  });
});
