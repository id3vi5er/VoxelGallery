import type { GeneratedVoxelScene, GenerationSize, PromptOptions, SceneParseResult } from "./types";

export const BASE_SYSTEM_PROMPT = `You are a voxel asset designer. Return ONLY valid JSON with this exact shape:
{
  "name": "asset-name",
  "description": "short description",
  "size": { "x": 16, "y": 16, "z": 16 },
  "palette": [{ "name": "material name", "hex": "#RRGGBB" }],
  "voxels": [{ "x": 0, "y": 0, "z": 0, "color": 0 }]
}

Rules:
- x is width, y is depth, z is height.
- Coordinates start at 0 and must be inside size.
- color is a zero-based index into palette.
- Maximum size is 64 on each axis, maximum 50000 voxels, maximum 255 colors.
- Build a coherent, recognizable, game-ready asset standing on z=0.
- Avoid duplicate coordinates.
- Use compact JSON and no markdown fences.`;

export const VOXEL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", description: "Short filesystem-safe asset name." },
    description: { type: "string", description: "One-sentence description of the generated asset." },
    size: {
      type: "object",
      additionalProperties: false,
      properties: {
        x: { type: "integer", description: "Width from 1 to 64." },
        y: { type: "integer", description: "Depth from 1 to 64." },
        z: { type: "integer", description: "Height from 1 to 64." },
      },
      required: ["x", "y", "z"],
    },
    palette: {
      type: "array",
      description: "One to 32 named RGB colors.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { name: { type: "string" }, hex: { type: "string", description: "RGB color formatted as #RRGGBB." } },
        required: ["name", "hex"],
      },
    },
    voxels: {
      type: "array",
      description: "At most 50000 unique voxel coordinates.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          x: { type: "integer" }, y: { type: "integer" }, z: { type: "integer" }, color: { type: "integer" },
        },
        required: ["x", "y", "z", "color"],
      },
    },
  },
  required: ["name", "description", "size", "palette", "voxels"],
} as const;

const hexPattern = /^#[0-9a-fA-F]{6}$/;

export function buildSystemPrompt(options: PromptOptions): string {
  const detailInstruction = {
    simple: "Use a sparse, iconic low-detail silhouette with few colors.",
    balanced: "Balance a clear silhouette with readable medium detail.",
    detailed: "Use rich surface detail while keeping the silhouette clean and the JSON within limits.",
  }[options.detail];
  return `${BASE_SYSTEM_PROMPT}

This request requires the exact model size ${options.size.x} × ${options.size.y} × ${options.size.z}. The returned size values MUST match exactly.
${detailInstruction}
${options.extraInstructions.trim() ? `Additional user instructions: ${options.extraInstructions.trim()}` : ""}`;
}

export function buildUserPrompt(prompt: string, options: PromptOptions): string {
  return `${prompt.trim()}

Required dimensions: x=${options.size.x}, y=${options.size.y}, z=${options.size.z}. Use the available volume intentionally and keep every coordinate inside it.`;
}

export function validateGeneratedScene(value: unknown, expectedSize?: GenerationSize): SceneParseResult {
  if (!value || typeof value !== "object") throw new Error("Das JSON muss ein Objekt sein.");
  const scene = value as Partial<GeneratedVoxelScene>;
  if (!scene.size || !scene.palette || !scene.voxels) throw new Error("size, palette und voxels werden benötigt.");
  const { x, y, z } = scene.size;
  if (![x, y, z].every((number) => Number.isInteger(number) && Number(number) > 0 && Number(number) <= 64)) {
    throw new Error("Die Modellgröße muss je Achse zwischen 1 und 64 liegen.");
  }
  if (expectedSize && (x !== expectedSize.x || y !== expectedSize.y || z !== expectedSize.z)) {
    throw new Error(`Das LLM lieferte ${x} × ${y} × ${z} statt ${expectedSize.x} × ${expectedSize.y} × ${expectedSize.z}.`);
  }
  if (!Array.isArray(scene.palette) || scene.palette.length < 1 || scene.palette.length > 255) {
    throw new Error("Die Palette benötigt 1 bis 255 Farben.");
  }
  scene.palette.forEach((color, index) => {
    if (!color || typeof color.name !== "string" || !hexPattern.test(color.hex)) {
      throw new Error(`Palettenfarbe ${index + 1} ist ungültig.`);
    }
  });
  if (!Array.isArray(scene.voxels) || scene.voxels.length > 50_000) {
    throw new Error("voxels muss ein Array mit maximal 50.000 Einträgen sein.");
  }
  const occupied = new Map<string, GeneratedVoxelScene["voxels"][number]>();
  scene.voxels.forEach((voxel, index) => {
    if (!voxel || !Number.isInteger(voxel.x) || !Number.isInteger(voxel.y) || !Number.isInteger(voxel.z) ||
      voxel.x < 0 || voxel.y < 0 || voxel.z < 0 || voxel.x >= x! || voxel.y >= y! || voxel.z >= z!) {
      throw new Error(`Voxel ${index + 1} liegt außerhalb des Modells.`);
    }
    if (!Number.isInteger(voxel.color) || voxel.color < 0 || voxel.color >= scene.palette!.length) {
      throw new Error(`Voxel ${index + 1} verweist auf eine unbekannte Farbe.`);
    }
    occupied.set(`${voxel.x},${voxel.y},${voxel.z}`, { ...voxel });
  });
  const voxels = [...occupied.values()];
  return {
    scene: {
      name: typeof scene.name === "string" && scene.name.trim() ? scene.name.trim() : "voxel-asset",
      description: typeof scene.description === "string" ? scene.description : "",
      size: { x: x!, y: y!, z: z! },
      palette: scene.palette,
      voxels,
    },
    duplicatesRemoved: scene.voxels.length - voxels.length,
  };
}

export function parseGeneratedJson(text: string, expectedSize: GenerationSize): SceneParseResult {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return validateGeneratedScene(JSON.parse(cleaned), expectedSize);
}
