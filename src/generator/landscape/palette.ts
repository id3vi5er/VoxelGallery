import type { GeneratedPaletteColor } from "../types";
import type { Season } from "./types";

export const MATERIAL_KEYS = [
  "deepWater", "water", "sand", "dirt", "grass", "grassDark", "grassLight",
  "stone", "stoneDark", "gravel", "snow",
  "trunk", "trunkDark", "leaf", "leafDark", "leafLight", "blossom",
  "boulder", "tuft", "flowerA", "flowerB",
] as const;

export type MaterialKey = (typeof MATERIAL_KEYS)[number];

export type MaterialIndex = Record<MaterialKey, number>;

export interface LandscapePalette {
  colors: GeneratedPaletteColor[];
  index: MaterialIndex;
}

const SEASON_COLORS: Record<Season, Partial<Record<MaterialKey, string>>> = {
  spring: { grass: "#6FA83F", grassDark: "#548A31", grassLight: "#8DC356", leaf: "#7CC24B", leafDark: "#569338", leafLight: "#A6DC6C", blossom: "#F5C2DC", flowerA: "#F2E06A", flowerB: "#E88CB4" },
  summer: { grass: "#5C9438", grassDark: "#3F742A", grassLight: "#79B049", leaf: "#4E9B39", leafDark: "#34702A", leafLight: "#71BC4F", blossom: "#EBE3A6", flowerA: "#EFD34F", flowerB: "#D9614F" },
  autumn: { grass: "#8A8B3C", grassDark: "#6B6C2E", grassLight: "#A9A452", leaf: "#C9752A", leafDark: "#9A4A1E", leafLight: "#E2A63C", blossom: "#E8B26A", flowerA: "#D98A2B", flowerB: "#B04B2C" },
  winter: { grass: "#7C8A76", grassDark: "#5E6B5A", grassLight: "#9BA894", leaf: "#4A6B52", leafDark: "#37503D", leafLight: "#D8E3E8", blossom: "#EAF2F6", flowerA: "#CBD9DE", flowerB: "#A9BAC4" },
};

const BASE_COLORS: Record<MaterialKey, { name: string; hex: string }> = {
  deepWater: { name: "Tiefes Wasser", hex: "#1B3A6B" },
  water: { name: "Wasser", hex: "#2D6BA8" },
  sand: { name: "Sand", hex: "#D9C48C" },
  dirt: { name: "Erde", hex: "#6B4E33" },
  grass: { name: "Gras", hex: "#5C9438" },
  grassDark: { name: "Gras dunkel", hex: "#3F742A" },
  grassLight: { name: "Gras hell", hex: "#79B049" },
  stone: { name: "Stein", hex: "#7A7C85" },
  stoneDark: { name: "Stein dunkel", hex: "#575A63" },
  gravel: { name: "Geröll", hex: "#95928C" },
  snow: { name: "Schnee", hex: "#EDF3F7" },
  trunk: { name: "Stamm", hex: "#6B4426" },
  trunkDark: { name: "Stamm dunkel", hex: "#4A2F1B" },
  leaf: { name: "Laub", hex: "#4E9B39" },
  leafDark: { name: "Laub dunkel", hex: "#34702A" },
  leafLight: { name: "Laub hell", hex: "#71BC4F" },
  blossom: { name: "Blüten", hex: "#EBE3A6" },
  boulder: { name: "Felsblock", hex: "#6E6F76" },
  tuft: { name: "Grasbüschel", hex: "#6FA845" },
  flowerA: { name: "Blume hell", hex: "#EFD34F" },
  flowerB: { name: "Blume dunkel", hex: "#D9614F" },
};

export function buildLandscapePalette(season: Season): LandscapePalette {
  const overrides = SEASON_COLORS[season];
  const colors: GeneratedPaletteColor[] = [];
  const index = {} as MaterialIndex;
  MATERIAL_KEYS.forEach((key, position) => {
    index[key] = position;
    colors.push({ name: BASE_COLORS[key].name, hex: overrides[key] ?? BASE_COLORS[key].hex });
  });
  return { colors, index };
}
