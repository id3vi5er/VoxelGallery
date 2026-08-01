export interface GeneratedVoxel {
  x: number;
  y: number;
  z: number;
  color: number;
}

export interface GeneratedPaletteColor {
  name: string;
  hex: string;
}

export interface GeneratedVoxelScene {
  name: string;
  description?: string;
  size: { x: number; y: number; z: number };
  palette: GeneratedPaletteColor[];
  voxels: GeneratedVoxel[];
}

export interface GenerationSize {
  x: number;
  y: number;
  z: number;
}

export interface PromptOptions {
  size: GenerationSize;
  detail: "simple" | "balanced" | "detailed";
  extraInstructions: string;
}

export interface LlmConfig {
  mode: "offline" | "openai" | "anthropic" | "gemini" | "compatible";
  endpoint: string;
  model: string;
  apiKey: string;
  rememberKey: boolean;
}

export interface SceneParseResult {
  scene: GeneratedVoxelScene;
  duplicatesRemoved: number;
}
