import type {
  RgbaColor,
  Vector3Tuple,
  VoxInstance,
  VoxModel,
  VoxSceneData,
  VoxTransform,
} from "../types";

const IDENTITY: VoxTransform = {
  matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  translation: [0, 0, 0],
};

interface TransformNode {
  kind: "transform";
  child: number;
  transform: VoxTransform;
}

interface GroupNode {
  kind: "group";
  children: number[];
}

interface ShapeNode {
  kind: "shape";
  models: number[];
}

type SceneNode = TransformNode | GroupNode | ShapeNode;

class VoxReader {
  private readonly view: DataView;
  private readonly decoder = new TextDecoder();
  offset = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get length(): number {
    return this.bytes.byteLength;
  }

  ensure(size: number): void {
    if (size < 0 || this.offset + size > this.length) {
      throw new Error("Die VOX-Datei endet unerwartet.");
    }
  }

  int32(): number {
    this.ensure(4);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  uint8(): number {
    this.ensure(1);
    return this.bytes[this.offset++];
  }

  text(length: number): string {
    this.ensure(length);
    const value = this.decoder.decode(this.bytes.subarray(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }

  bytesView(length: number): Uint8Array {
    this.ensure(length);
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  dictionary(): Record<string, string> {
    const count = this.int32();
    if (count < 0 || count > 100_000) {
      throw new Error("Ungültiges Dictionary in der VOX-Datei.");
    }
    const result: Record<string, string> = {};
    for (let index = 0; index < count; index += 1) {
      const keyLength = this.int32();
      if (keyLength < 0 || keyLength > this.length) throw new Error("Ungültiger Dictionary-Schlüssel.");
      const key = this.text(keyLength);
      const valueLength = this.int32();
      if (valueLength < 0 || valueLength > this.length) throw new Error("Ungültiger Dictionary-Wert.");
      result[key] = this.text(valueLength);
    }
    return result;
  }
}

function defaultPalette(): RgbaColor[] {
  const colors: RgbaColor[] = [{ r: 0, g: 0, b: 0, a: 0 }];
  const levels = [255, 204, 153, 102, 51, 0];
  for (const b of levels) {
    for (const g of levels) {
      for (const r of levels) {
        if (r !== 0 || g !== 0 || b !== 0) colors.push({ r, g, b, a: 255 });
      }
    }
  }
  const ramp = [238, 221, 187, 170, 136, 119, 85, 68, 34, 17];
  ramp.forEach((r) => colors.push({ r, g: 0, b: 0, a: 255 }));
  ramp.forEach((g) => colors.push({ r: 0, g, b: 0, a: 255 }));
  ramp.forEach((b) => colors.push({ r: 0, g: 0, b, a: 255 }));
  ramp.forEach((value) => colors.push({ r: value, g: value, b: value, a: 255 }));
  return colors.slice(0, 256);
}

function parseTranslation(value?: string): Vector3Tuple {
  if (!value) return [0, 0, 0];
  const parts = value.trim().split(/\s+/).map(Number);
  return parts.length === 3 && parts.every(Number.isFinite)
    ? [parts[0], parts[1], parts[2]]
    : [0, 0, 0];
}

function parseRotation(value?: string): VoxTransform["matrix"] {
  if (!value) return [...IDENTITY.matrix];
  const encoded = Number(value);
  if (!Number.isInteger(encoded) || encoded < 0 || encoded > 255) return [...IDENTITY.matrix];
  const firstAxis = encoded & 0x3;
  const secondAxis = (encoded >> 2) & 0x3;
  if (firstAxis > 2 || secondAxis > 2 || firstAxis === secondAxis) return [...IDENTITY.matrix];
  const thirdAxis = 3 - firstAxis - secondAxis;
  const matrix = [0, 0, 0, 0, 0, 0, 0, 0, 0] as VoxTransform["matrix"];
  matrix[firstAxis] = encoded & 0x10 ? -1 : 1;
  matrix[3 + secondAxis] = encoded & 0x20 ? -1 : 1;
  matrix[6 + thirdAxis] = encoded & 0x40 ? -1 : 1;
  return matrix;
}

function multiply(a: VoxTransform, b: VoxTransform): VoxTransform {
  const matrix = new Array<number>(9).fill(0) as unknown as VoxTransform["matrix"];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      matrix[row * 3 + column] =
        a.matrix[row * 3] * b.matrix[column] +
        a.matrix[row * 3 + 1] * b.matrix[3 + column] +
        a.matrix[row * 3 + 2] * b.matrix[6 + column];
    }
  }
  const [x, y, z] = b.translation;
  return {
    matrix,
    translation: [
      a.matrix[0] * x + a.matrix[1] * y + a.matrix[2] * z + a.translation[0],
      a.matrix[3] * x + a.matrix[4] * y + a.matrix[5] * z + a.translation[1],
      a.matrix[6] * x + a.matrix[7] * y + a.matrix[8] * z + a.translation[2],
    ],
  };
}

function resolveInstances(nodes: Map<number, SceneNode>, modelCount: number): VoxInstance[] {
  if (nodes.size === 0) {
    const matrix: VoxTransform["matrix"] = [...IDENTITY.matrix];
    return modelCount ? [{ modelId: 0, transform: { matrix, translation: [0, 0, 0] } }] : [];
  }

  const referenced = new Set<number>();
  for (const node of nodes.values()) {
    if (node.kind === "transform") referenced.add(node.child);
    if (node.kind === "group") node.children.forEach((child) => referenced.add(child));
  }
  const roots = [...nodes.keys()].filter((id) => !referenced.has(id));
  const instances: VoxInstance[] = [];
  const active = new Set<number>();

  const visit = (nodeId: number, parent: VoxTransform): void => {
    if (active.has(nodeId)) return;
    const node = nodes.get(nodeId);
    if (!node) return;
    active.add(nodeId);
    if (node.kind === "transform") visit(node.child, multiply(parent, node.transform));
    if (node.kind === "group") node.children.forEach((child) => visit(child, parent));
    if (node.kind === "shape") {
      node.models.forEach((modelId) => {
        if (modelId >= 0 && modelId < modelCount) instances.push({ modelId, transform: parent });
      });
    }
    active.delete(nodeId);
  };

  (roots.length ? roots : [0]).forEach((root) => visit(root, IDENTITY));
  return instances.length ? instances : resolveInstances(new Map(), modelCount);
}

export function parseVox(input: Uint8Array | ArrayBuffer): VoxSceneData {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const reader = new VoxReader(bytes);
  if (reader.text(4) !== "VOX ") throw new Error("Die Datei besitzt keinen gültigen VOX-Header.");
  const version = reader.int32();
  if (version <= 0 || version > 10_000) throw new Error(`Nicht unterstützte VOX-Version: ${version}`);

  const models: VoxModel[] = [];
  const nodes = new Map<number, SceneNode>();
  let palette = defaultPalette();
  let pendingSize: Vector3Tuple | null = null;

  while (reader.offset + 12 <= reader.length) {
    const chunkId = reader.text(4);
    const contentSize = reader.int32();
    const childrenSize = reader.int32();
    if (contentSize < 0 || childrenSize < 0) throw new Error(`Ungültige Größe im Chunk ${chunkId}.`);
    const contentStart = reader.offset;
    const contentEnd = contentStart + contentSize;
    if (contentEnd > reader.length) throw new Error(`Der Chunk ${chunkId} ist unvollständig.`);

    if (chunkId === "SIZE" && contentSize >= 12) {
      pendingSize = [reader.int32(), reader.int32(), reader.int32()];
    } else if (chunkId === "XYZI" && contentSize >= 4) {
      const count = reader.int32();
      if (count < 0 || count > (contentEnd - reader.offset) / 4) throw new Error("Ungültige Voxelanzahl.");
      const voxels = reader.bytesView(count * 4);
      models.push({ size: pendingSize ?? [256, 256, 256], voxels, voxelCount: count });
      pendingSize = null;
    } else if (chunkId === "RGBA" && contentSize >= 1024) {
      const parsed = defaultPalette();
      for (let index = 0; index < 256; index += 1) {
        const color = { r: reader.uint8(), g: reader.uint8(), b: reader.uint8(), a: reader.uint8() };
        parsed[index === 255 ? 0 : index + 1] = color;
      }
      palette = parsed;
    } else if (chunkId === "nTRN") {
      const nodeId = reader.int32();
      reader.dictionary();
      const child = reader.int32();
      reader.int32();
      reader.int32();
      const frameCount = reader.int32();
      let frame: Record<string, string> = {};
      for (let index = 0; index < frameCount; index += 1) {
        const current = reader.dictionary();
        if (index === 0) frame = current;
      }
      nodes.set(nodeId, {
        kind: "transform",
        child,
        transform: { matrix: parseRotation(frame._r), translation: parseTranslation(frame._t) },
      });
    } else if (chunkId === "nGRP") {
      const nodeId = reader.int32();
      reader.dictionary();
      const count = reader.int32();
      const children: number[] = [];
      for (let index = 0; index < count; index += 1) children.push(reader.int32());
      nodes.set(nodeId, { kind: "group", children });
    } else if (chunkId === "nSHP") {
      const nodeId = reader.int32();
      reader.dictionary();
      const count = reader.int32();
      const modelIds: number[] = [];
      for (let index = 0; index < count; index += 1) {
        modelIds.push(reader.int32());
        reader.dictionary();
      }
      nodes.set(nodeId, { kind: "shape", models: modelIds });
    }

    reader.offset = contentEnd;
  }

  if (!models.length) throw new Error("Die VOX-Datei enthält keine Modelle.");
  return { version, models, palette, instances: resolveInstances(nodes, models.length) };
}
