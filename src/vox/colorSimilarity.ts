import type { AssetColorMetadata } from "../types";

type Oklab = [number, number, number];

function hexToOklab(hex: string): Oklab {
  const value = Number.parseInt(hex.replace(/^#/, ""), 16);
  const linear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const red = linear((value >> 16) & 255);
  const green = linear((value >> 8) & 255);
  const blue = linear(value & 255);
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

export function colorSimilarityDistance(metadata: AssetColorMetadata | undefined, targetHex: string): number {
  if (!metadata?.colors.length) return Number.POSITIVE_INFINITY;
  const target = hexToOklab(targetHex);
  let nearest = Number.POSITIVE_INFINITY;
  for (const color of metadata.colors) {
    const candidate = hexToOklab(color.hex);
    const distance = Math.hypot(candidate[0] - target[0], candidate[1] - target[1], candidate[2] - target[2]);
    nearest = Math.min(nearest, distance);
  }
  return nearest;
}
