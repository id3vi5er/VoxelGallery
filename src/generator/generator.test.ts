import { describe, expect, it } from "vitest";
import { validateGeneratedScene } from "./schema";
import { createGeneratedVoxFile } from "./voxExport";
import { parseVox } from "../vox/parser";
import { analyzeSceneColors } from "../vox/colors";

const generated = {
  name: "test-asset",
  description: "Test",
  size: { x: 4, y: 5, z: 6 },
  palette: [{ name: "Rot", hex: "#ff0000" }, { name: "Blau", hex: "#0000ff" }],
  voxels: [
    { x: 0, y: 0, z: 0, color: 0 },
    { x: 1, y: 0, z: 0, color: 0 },
    { x: 2, y: 0, z: 0, color: 1 },
  ],
};

describe("LLM voxel pipeline", () => {
  it("validates the exact requested dimensions", () => {
    expect(validateGeneratedScene(generated, { x: 4, y: 5, z: 6 }).scene.size).toEqual(generated.size);
    expect(() => validateGeneratedScene(generated, { x: 8, y: 8, z: 8 })).toThrow(/statt 8 × 8 × 8/);
  });

  it("exports generated JSON as a readable VOX file", () => {
    const parsed = parseVox(createGeneratedVoxFile(generated));
    expect(parsed.models[0].voxelCount).toBe(3);
    expect(parsed.models[0].size).toEqual([4, 5, 6]);
  });

  it("reports used colors ordered by voxel count", () => {
    const parsed = parseVox(createGeneratedVoxFile(generated));
    const metadata = analyzeSceneColors(parsed);
    expect(metadata.colorCount).toBe(2);
    expect(metadata.colors[0]).toMatchObject({ hex: "#ff0000", count: 2 });
    expect(metadata.colors[1]).toMatchObject({ hex: "#0000ff", count: 1 });
  });
});
