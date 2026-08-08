import { describe, expect, it } from "vitest";
import { parseVox } from "../../vox/parser";
import { createGeneratedVoxFile } from "../voxExport";
import {
  DEFAULT_LANDSCAPE_SETTINGS,
  LANDSCAPE_PRESETS,
  MAX_AXIS,
  clampLandscapeSettings,
  generateLandscape,
} from "./index";
import type { LandscapeSettings } from "./types";

function settings(overrides: Partial<LandscapeSettings> = {}): LandscapeSettings {
  const base = DEFAULT_LANDSCAPE_SETTINGS;
  return clampLandscapeSettings({
    ...base,
    ...overrides,
    size: { x: 32, y: 32, z: 32, ...overrides.size },
    terrain: { ...base.terrain, ...overrides.terrain },
    water: { ...base.water, ...overrides.water },
    trees: { ...base.trees, ...overrides.trees },
    scatter: { ...base.scatter, ...overrides.scatter },
  });
}

function fingerprint(voxels: Array<{ x: number; y: number; z: number; color: number }>): number {
  let hash = 17;
  for (const voxel of voxels) {
    hash = (Math.imul(hash, 31) + voxel.x * 7 + voxel.y * 13 + voxel.z * 17 + voxel.color * 3) | 0;
  }
  return hash;
}

describe("landscape generator", () => {
  it("reproduces the identical landscape for the same seed", () => {
    const first = generateLandscape(settings({ seed: "alpha" }));
    const second = generateLandscape(settings({ seed: "alpha" }));
    expect(first.stats.voxels).toBe(second.stats.voxels);
    expect(fingerprint(first.scene.voxels)).toBe(fingerprint(second.scene.voxels));
  });

  it("produces a different landscape for a different seed", () => {
    const first = generateLandscape(settings({ seed: "alpha" }));
    const second = generateLandscape(settings({ seed: "beta" }));
    expect(fingerprint(first.scene.voxels)).not.toBe(fingerprint(second.scene.voxels));
  });

  it("keeps every voxel inside the model and inside the palette", () => {
    const result = generateLandscape(settings({ seed: "bounds", size: { x: 48, y: 40, z: 36 } }));
    expect(result.scene.voxels.length).toBeGreaterThan(0);
    expect(result.scene.palette.length).toBeLessThanOrEqual(255);
    for (const voxel of result.scene.voxels) {
      expect(voxel.x).toBeGreaterThanOrEqual(0);
      expect(voxel.y).toBeGreaterThanOrEqual(0);
      expect(voxel.z).toBeGreaterThanOrEqual(0);
      expect(voxel.x).toBeLessThan(48);
      expect(voxel.y).toBeLessThan(40);
      expect(voxel.z).toBeLessThan(36);
      expect(voxel.color).toBeGreaterThanOrEqual(0);
      expect(voxel.color).toBeLessThan(result.scene.palette.length);
    }
  });

  it("never emits two voxels at the same coordinate", () => {
    const result = generateLandscape(settings({ seed: "unique" }));
    const seen = new Set(result.scene.voxels.map((voxel) => `${voxel.x},${voxel.y},${voxel.z}`));
    expect(seen.size).toBe(result.scene.voxels.length);
  });

  it("exports a landscape that the VOX parser can read back", () => {
    const result = generateLandscape(settings({ seed: "export" }));
    const parsed = parseVox(createGeneratedVoxFile(result.scene));
    expect(parsed.models[0].size).toEqual([32, 32, 32]);
    expect(parsed.models[0].voxelCount).toBe(result.scene.voxels.length);
  });

  it("adds water voxels only while water is enabled", () => {
    const wet = generateLandscape(settings({ seed: "lake", water: { enabled: true, level: 0.4, beach: 2 } }));
    const dry = generateLandscape(settings({ seed: "lake", water: { enabled: false, level: 0.4, beach: 2 } }));
    expect(wet.stats.waterVoxels).toBeGreaterThan(0);
    expect(dry.stats.waterVoxels).toBe(0);
  });

  it("skips tree voxels when trees are disabled", () => {
    const planted = generateLandscape(settings({ seed: "forest", trees: { ...DEFAULT_LANDSCAPE_SETTINGS.trees, density: 1 } }));
    const bare = generateLandscape(settings({ seed: "forest", trees: { ...DEFAULT_LANDSCAPE_SETTINGS.trees, enabled: false } }));
    expect(planted.stats.trees).toBeGreaterThan(0);
    expect(planted.stats.treeVoxels).toBeGreaterThan(0);
    expect(bare.stats.trees).toBe(0);
    expect(bare.stats.treeVoxels).toBe(0);
  });

  it("grows every tree algorithm without leaving the model", () => {
    for (const algorithm of ["recursive", "lsystem", "conifer", "palm", "dead", "mixed"] as const) {
      const result = generateLandscape(settings({
        seed: `tree-${algorithm}`,
        trees: { ...DEFAULT_LANDSCAPE_SETTINGS.trees, algorithm, density: 0.9 },
      }));
      expect(result.stats.trees, algorithm).toBeGreaterThan(0);
      expect(result.scene.voxels.every((voxel) => voxel.z < 32), algorithm).toBe(true);
    }
  });

  it("builds terrain for every algorithm", () => {
    for (const algorithm of ["hills", "mountains", "plains", "islands", "canyon", "dunes"] as const) {
      const result = generateLandscape(settings({
        seed: "terrain",
        terrain: { ...DEFAULT_LANDSCAPE_SETTINGS.terrain, algorithm },
      }));
      expect(result.stats.terrainVoxels, algorithm).toBeGreaterThan(0);
    }
  });

  it("reports the covered world area for the chosen voxel scale", () => {
    const coarse = generateLandscape(settings({ seed: "scale", metersPerVoxel: 10 }));
    const fine = generateLandscape(settings({ seed: "scale", metersPerVoxel: 0.5 }));
    expect(coarse.stats.extent).toEqual({ x: 320, y: 320, z: 320 });
    expect(fine.stats.extent).toEqual({ x: 16, y: 16, z: 16 });
    expect(coarse.scene.size).toEqual(fine.scene.size);
  });

  it("grows taller trees in voxels when a voxel covers less world space", () => {
    const base = { ...DEFAULT_LANDSCAPE_SETTINGS.trees, algorithm: "conifer" as const, density: 0.9, minHeight: 12, maxHeight: 12 };
    const coarse = generateLandscape(settings({ seed: "scaled-trees", size: { x: 64, y: 64, z: 64 }, metersPerVoxel: 4, trees: base }));
    const fine = generateLandscape(settings({ seed: "scaled-trees", size: { x: 64, y: 64, z: 64 }, metersPerVoxel: 0.5, trees: base }));
    // Same 12 m tree: three voxels tall when coarse, twenty-four when fine.
    expect(fine.stats.treeVoxels / Math.max(1, fine.stats.trees))
      .toBeGreaterThan(coarse.stats.treeVoxels / Math.max(1, coarse.stats.trees));
  });

  it("still plants trees when the model is too short for their full height", () => {
    // 8 m trees need 80 voxels at 0.1 m per voxel but the model is only 32 tall.
    const result = generateLandscape(settings({
      seed: "short",
      metersPerVoxel: 0.1,
      trees: { ...DEFAULT_LANDSCAPE_SETTINGS.trees, density: 0.9 },
    }));
    expect(result.stats.trees).toBeGreaterThan(0);
    expect(result.stats.treesShortened).toBeGreaterThan(0);
    expect(result.scene.voxels.every((voxel) => voxel.z < 32)).toBe(true);
  });

  it("scales the canopy with the crown radius instead of every branch tip", () => {
    const grow = (crownRadius: number) => generateLandscape(settings({
      seed: "canopy",
      size: { x: 64, y: 64, z: 64 },
      trees: { ...DEFAULT_LANDSCAPE_SETTINGS.trees, algorithm: "recursive", density: 0.9, crownRadius },
    }));
    const small = grow(2);
    const large = grow(9);
    expect(large.stats.treeVoxels).toBeGreaterThan(small.stats.treeVoxels);
    // Per tip spheres grew with the cube of the radius; a canopy must stay far below that.
    expect(large.stats.treeVoxels).toBeLessThan(small.stats.treeVoxels * 30);
  });

  it("keeps fine scale generation fast enough for the live preview", () => {
    const started = Date.now();
    generateLandscape(settings({
      seed: "fine",
      size: { x: 64, y: 64, z: 128 },
      metersPerVoxel: 0.1,
      trees: { ...DEFAULT_LANDSCAPE_SETTINGS.trees, algorithm: "recursive", density: 0.6, crownRadius: 8 },
    }));
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("keeps planting across the whole map as the model grows taller", () => {
    // Relief is a share of the model height, so a taller map puts the same hills on a
    // steeper gradient. The slope limit must not turn that into a treeless map.
    const counts = [96, 128, 256].map((axis) => {
      const result = generateLandscape({
        ...DEFAULT_LANDSCAPE_SETTINGS,
        seed: "tall",
        size: { x: axis, y: axis, z: axis },
      });
      return { axis, ...result.stats };
    });
    for (const entry of counts) expect(entry.trees, `${entry.axis}³`).toBeGreaterThan(20);
    // More ground has to mean more trees, not fewer.
    expect(counts[2].trees).toBeGreaterThan(counts[0].trees);
  });

  it("spreads trees over both halves of a large map", () => {
    const result = generateLandscape({
      ...DEFAULT_LANDSCAPE_SETTINGS,
      seed: "halves",
      size: { x: 192, y: 192, z: 192 },
    });
    const trunks = result.scene.voxels.filter((voxel) => voxel.color === 11 || voxel.color === 12);
    const near = trunks.filter((voxel) => voxel.y < 96).length;
    const far = trunks.filter((voxel) => voxel.y >= 96).length;
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(0);
    expect(Math.min(near, far) / Math.max(near, far)).toBeGreaterThan(0.25);
  });

  it("keeps a metre based crust at least one voxel thick at coarse scales", () => {
    const result = generateLandscape(settings({
      seed: "crust",
      metersPerVoxel: 10,
      terrain: { ...DEFAULT_LANDSCAPE_SETTINGS.terrain, crustDepth: 4 },
    }));
    // A 4 m crust rounds to 0 voxels at 10 m per voxel — it must not become a solid fill.
    expect(result.stats.terrainVoxels).toBeLessThan(32 * 32 * 32 * 0.5);
  });

  it("clamps settings to values the VOX format supports", () => {
    const clamped = clampLandscapeSettings({
      ...DEFAULT_LANDSCAPE_SETTINGS,
      size: { x: 4096, y: -20, z: 999 },
      trees: { ...DEFAULT_LANDSCAPE_SETTINGS.trees, minHeight: 40, maxHeight: 5, iterations: 99 },
    });
    expect(clamped.size.x).toBe(MAX_AXIS);
    expect(clamped.size.y).toBe(16);
    expect(clamped.size.z).toBe(MAX_AXIS);
    expect(clamped.trees.maxHeight).toBeGreaterThanOrEqual(clamped.trees.minHeight);
    expect(clamped.trees.iterations).toBeLessThanOrEqual(7);
  });

  it("generates a usable model for every preset", () => {
    for (const item of LANDSCAPE_PRESETS) {
      const result = generateLandscape({ ...item.settings, size: { x: 48, y: 48, z: 48 } });
      expect(result.stats.voxels, item.id).toBeGreaterThan(100);
    }
  });
});
