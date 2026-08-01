import type { AssetColorMetadata, VoxSceneData } from "../types";

function hexChannel(value: number): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
}

function hue(red: number, green: number, blue: number): number {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 360;
  let result = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  result *= 60;
  return result < 0 ? result + 360 : result;
}

export function analyzeSceneColors(scene: VoxSceneData): AssetColorMetadata {
  const usage = new Map<number, number>();
  for (const instance of scene.instances) {
    const model = scene.models[instance.modelId];
    if (!model) continue;
    for (let offset = 3; offset < model.voxels.length; offset += 4) {
      const colorIndex = model.voxels[offset];
      usage.set(colorIndex, (usage.get(colorIndex) ?? 0) + 1);
    }
  }
  const colors = [...usage.entries()]
    .map(([index, count]) => {
      const color = scene.palette[index] ?? scene.palette[1];
      return { index, count, hex: `#${hexChannel(color.r)}${hexChannel(color.g)}${hexChannel(color.b)}` };
    })
    .sort((left, right) => right.count - left.count);
  const dominant = colors[0];
  const dominantColor = dominant ? scene.palette[dominant.index] ?? scene.palette[1] : { r: 0, g: 0, b: 0 };
  return { colors, colorCount: colors.length, dominantHue: hue(dominantColor.r, dominantColor.g, dominantColor.b) };
}
