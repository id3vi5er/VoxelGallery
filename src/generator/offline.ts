import type { GeneratedVoxel, GeneratedVoxelScene, GenerationSize } from "./types";

function addVoxel(map: Map<string, GeneratedVoxel>, size: GenerationSize, x: number, y: number, z: number, color: number): void {
  const point = { x: Math.round(x), y: Math.round(y), z: Math.round(z), color };
  if (point.x < 0 || point.y < 0 || point.z < 0 || point.x >= size.x || point.y >= size.y || point.z >= size.z) return;
  map.set(`${point.x},${point.y},${point.z}`, point);
}

export async function generateOffline(prompt: string, size: GenerationSize): Promise<GeneratedVoxelScene> {
  await new Promise((resolve) => window.setTimeout(resolve, 550));
  const voxels = new Map<string, GeneratedVoxel>();
  const normalized = prompt.toLocaleLowerCase("de");
  const centerX = (size.x - 1) / 2;
  const centerY = (size.y - 1) / 2;
  const radiusX = Math.max(1, Math.floor(size.x * 0.34));
  const radiusY = Math.max(1, Math.floor(size.y * 0.34));
  const bodyHeight = Math.max(2, Math.floor(size.z * 0.66));

  for (let x = 0; x < size.x; x += 1) {
    for (let y = 0; y < size.y; y += 1) {
      const dx = (x - centerX) / radiusX;
      const dy = (y - centerY) / radiusY;
      if (dx * dx + dy * dy <= 1) addVoxel(voxels, size, x, y, 0, 3);
    }
  }

  const isRobot = /robot|mech|drohne|android/.test(normalized);
  const isHouse = /haus|house|hütte|cottage|gebäude|building/.test(normalized);
  for (let z = 1; z <= bodyHeight; z += 1) {
    const taper = isRobot ? (z > bodyHeight * 0.72 ? 0.22 : 0.08) : z / Math.max(1, size.z) * 0.45;
    for (let x = 0; x < size.x; x += 1) {
      for (let y = 0; y < size.y; y += 1) {
        const dx = Math.abs(x - centerX) / Math.max(1, radiusX);
        const dy = Math.abs(y - centerY) / Math.max(1, radiusY);
        if (dx <= 0.55 - taper && dy <= 0.55 - taper) addVoxel(voxels, size, x, y, z, isHouse ? 0 : 1);
      }
    }
  }
  const accentZ = Math.max(1, Math.min(size.z - 1, Math.round(bodyHeight * 0.72)));
  for (let x = Math.floor(centerX - radiusX * 0.3); x <= Math.ceil(centerX + radiusX * 0.3); x += 1) {
    addVoxel(voxels, size, x, Math.max(0, Math.floor(centerY - radiusY * 0.58)), accentZ, 2);
  }

  return {
    name: isRobot ? "scout-robot" : isHouse ? "voxel-house" : "mystic-asset",
    description: prompt,
    size,
    palette: [
      { name: "Grundmaterial", hex: isHouse ? "#D8C49D" : "#6E7790" },
      { name: "Schatten", hex: "#3E4659" },
      { name: "Akzent", hex: "#63E2D2" },
      { name: "Boden", hex: "#536B43" },
    ],
    voxels: [...voxels.values()],
  };
}
