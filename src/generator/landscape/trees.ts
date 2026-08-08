import type { VoxelGrid } from "./grid";
import type { MaterialIndex } from "./palette";
import type { Rng } from "./random";
import type { TreeAlgorithm, TreeSettings } from "./types";

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** One drawn branch in relative units — the skeleton is scaled to the wanted tree height later. */
interface Segment {
  a: Vec3;
  b: Vec3;
  /** Thickness relative to the trunk base (1 = trunk). */
  radius: number;
  /** Crown size factor at the branch tip; 0 leaves the tip bare. */
  leafScale: number;
  wood: boolean;
}

interface Skeleton {
  segments: Segment[];
  /** Height of the skeleton in relative units. */
  height: number;
}

const MAX_SEGMENTS = 2400;

function vec(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function add(a: Vec3, b: Vec3, factor = 1): Vec3 {
  return vec(a.x + b.x * factor, a.y + b.y * factor, a.z + b.z * factor);
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return vec(v.x / length, v.y / length, v.z / length);
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

/** Rodrigues rotation of `v` around the unit `axis`. */
function rotate(v: Vec3, axis: Vec3, radians: number): Vec3 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dot = axis.x * v.x + axis.y * v.y + axis.z * v.z;
  const perpendicular = cross(axis, v);
  return vec(
    v.x * cos + perpendicular.x * sin + axis.x * dot * (1 - cos),
    v.y * cos + perpendicular.y * sin + axis.y * dot * (1 - cos),
    v.z * cos + perpendicular.z * sin + axis.z * dot * (1 - cos),
  );
}

/** Any unit vector perpendicular to `v`. */
function perpendicular(v: Vec3): Vec3 {
  const helper = Math.abs(v.z) < 0.9 ? vec(0, 0, 1) : vec(1, 0, 0);
  return normalize(cross(v, helper));
}

function skeletonHeight(segments: Segment[]): number {
  let maximum = 0;
  for (const segment of segments) maximum = Math.max(maximum, segment.a.z, segment.b.z);
  return Math.max(0.001, maximum);
}

/** Largest horizontal distance from the trunk axis — the natural canopy radius. */
function skeletonSpread(segments: Segment[]): number {
  let maximum = 0;
  for (const segment of segments) {
    maximum = Math.max(maximum, Math.hypot(segment.a.x, segment.a.y), Math.hypot(segment.b.x, segment.b.y));
  }
  return maximum;
}

// ---------------------------------------------------------------------------
// Algorithms
// ---------------------------------------------------------------------------

/** Parametric recursive branching — the default broadleaf model. */
function buildRecursiveSkeleton(settings: TreeSettings, rng: Rng, leaves: boolean): Skeleton {
  const segments: Segment[] = [];
  const depth = Math.max(1, Math.min(7, Math.round(settings.iterations)));
  const splits = Math.max(2, Math.min(5, Math.round(settings.branchSplit)));
  const falloff = Math.min(0.95, Math.max(0.45, settings.lengthFalloff));
  const angle = (settings.branchAngle * Math.PI) / 180;

  const grow = (origin: Vec3, direction: Vec3, length: number, radius: number, level: number): void => {
    if (segments.length >= MAX_SEGMENTS) return;
    const end = add(origin, direction, length);
    const tip = level <= 0 || length < 0.055;
    segments.push({ a: origin, b: end, radius, leafScale: tip && leaves ? 1 : 0, wood: true });
    if (tip) return;
    const side = perpendicular(direction);
    const spin = rng.next() * Math.PI * 2;
    for (let index = 0; index < splits; index += 1) {
      const yaw = spin + (index / splits) * Math.PI * 2 + rng.jitter() * 0.35;
      const pitch = angle * (0.75 + rng.next() * 0.55);
      const axis = normalize(rotate(side, direction, yaw));
      let child = rotate(direction, axis, pitch);
      // A gentle upward bias keeps the crown from collapsing sideways.
      child = normalize(add(child, vec(0, 0, 0.18)));
      grow(end, child, length * falloff * (0.85 + rng.next() * 0.3), radius * 0.68, level - 1);
    }
  };

  const trunkLean = normalize(vec(rng.jitter() * 0.09, rng.jitter() * 0.09, 1));
  const baseLength = (1 - falloff) / (1 - Math.pow(falloff, depth + 1)) * 1.35;
  grow(vec(0, 0, 0), trunkLean, baseLength, 1, depth);
  return { segments, height: skeletonHeight(segments) };
}

const LSYSTEM_RULES = [
  "FF[+F][-F][&F]",
  "F[+F]F[-F][&F]",
  "FF-[-F+F+F]+[+F-F-F]",
  "F[&F][^F][+F][-F]F",
];

/** Turtle interpreted 3D L-system. */
function buildLSystemSkeleton(settings: TreeSettings, rng: Rng, leaves: boolean): Skeleton {
  const generations = Math.max(1, Math.min(4, Math.round(settings.iterations)));
  const rule = rng.pick(LSYSTEM_RULES);
  let sentence = "F";
  for (let generation = 0; generation < generations; generation += 1) {
    let next = "";
    for (const symbol of sentence) next += symbol === "F" ? rule : symbol;
    if (next.length > 24_000) break;
    sentence = next;
  }

  const angle = (settings.branchAngle * Math.PI) / 180;
  const falloff = Math.min(0.95, Math.max(0.55, settings.lengthFalloff));
  const segments: Segment[] = [];
  let position = vec(0, 0, 0);
  let heading = normalize(vec(rng.jitter() * 0.06, rng.jitter() * 0.06, 1));
  let left = perpendicular(heading);
  let length = 1;
  let radius = 1;
  const stack: Array<{ position: Vec3; heading: Vec3; left: Vec3; length: number; radius: number }> = [];

  for (const symbol of sentence) {
    if (segments.length >= MAX_SEGMENTS) break;
    const up = normalize(cross(heading, left));
    const wobble = () => rng.jitter() * 0.22;
    if (symbol === "F") {
      const end = add(position, heading, length);
      segments.push({ a: position, b: end, radius, leafScale: 0, wood: true });
      position = end;
      length *= falloff;
      radius *= 0.82;
    } else if (symbol === "+") {
      heading = normalize(rotate(heading, up, angle + wobble()));
      left = normalize(rotate(left, up, angle));
    } else if (symbol === "-") {
      heading = normalize(rotate(heading, up, -angle + wobble()));
      left = normalize(rotate(left, up, -angle));
    } else if (symbol === "&") {
      heading = normalize(rotate(heading, left, angle + wobble()));
    } else if (symbol === "^") {
      heading = normalize(rotate(heading, left, -angle + wobble()));
    } else if (symbol === "<") {
      left = normalize(rotate(left, heading, angle));
    } else if (symbol === ">") {
      left = normalize(rotate(left, heading, -angle));
    } else if (symbol === "[") {
      stack.push({ position, heading, left, length, radius });
    } else if (symbol === "]") {
      const saved = stack.pop();
      if (saved) {
        if (leaves && segments.length) segments[segments.length - 1].leafScale = 0.85;
        ({ position, heading, left, length, radius } = saved);
      }
    }
  }
  if (leaves && segments.length) segments[segments.length - 1].leafScale = 1;
  return { segments, height: skeletonHeight(segments) };
}

/** Stacked whorls — spruce and fir silhouettes. */
function buildConiferSkeleton(settings: TreeSettings, rng: Rng): Skeleton {
  const segments: Segment[] = [];
  const whorls = Math.max(3, Math.min(14, Math.round(settings.iterations) + 4));
  const angle = (Math.max(20, settings.branchAngle) * Math.PI) / 180;
  const top = vec(rng.jitter() * 0.05, rng.jitter() * 0.05, 1);
  segments.push({ a: vec(0, 0, 0), b: top, radius: 1, leafScale: 0.35, wood: true });

  for (let index = 0; index < whorls; index += 1) {
    const level = 0.18 + (index / whorls) * 0.78;
    const spread = (1 - level) * 0.55 + 0.06;
    const count = Math.max(3, Math.round(3 + (1 - level) * 4));
    const spin = rng.next() * Math.PI * 2;
    for (let branch = 0; branch < count; branch += 1) {
      const yaw = spin + (branch / count) * Math.PI * 2 + rng.jitter() * 0.2;
      const droop = Math.sin(angle) * 0.28;
      const origin = vec(top.x * level, top.y * level, level);
      const end = vec(
        origin.x + Math.cos(yaw) * spread,
        origin.y + Math.sin(yaw) * spread,
        origin.z - droop * spread,
      );
      segments.push({ a: origin, b: end, radius: 0.35 * (1 - level) + 0.1, leafScale: spread * 2.4, wood: true });
    }
  }
  return { segments, height: skeletonHeight(segments) };
}

/** Curved trunk with arching fronds. */
function buildPalmSkeleton(settings: TreeSettings, rng: Rng): Skeleton {
  const segments: Segment[] = [];
  const steps = 7;
  const bend = rng.range(0.1, 0.3) * (rng.chance(0.5) ? 1 : -1);
  const lean = rng.next() * Math.PI * 2;
  let position = vec(0, 0, 0);
  for (let step = 0; step < steps; step += 1) {
    const progress = (step + 1) / steps;
    const offset = bend * progress * progress;
    const next = vec(Math.cos(lean) * offset, Math.sin(lean) * offset, progress);
    segments.push({ a: position, b: next, radius: 1 - progress * 0.45, leafScale: 0, wood: true });
    position = next;
  }

  const fronds = Math.max(5, Math.min(11, Math.round(settings.iterations) + 5));
  const spin = rng.next() * Math.PI * 2;
  for (let index = 0; index < fronds; index += 1) {
    const yaw = spin + (index / fronds) * Math.PI * 2;
    const reach = rng.range(0.3, 0.44);
    let joint = position;
    let height = 0.16;
    for (let piece = 0; piece < 3; piece += 1) {
      const share = reach / 3;
      const next = vec(
        joint.x + Math.cos(yaw) * share,
        joint.y + Math.sin(yaw) * share,
        joint.z + height,
      );
      segments.push({ a: joint, b: next, radius: 0.16, leafScale: piece === 2 ? 0.55 : 0.4, wood: false });
      joint = next;
      height -= 0.13;
    }
  }
  return { segments, height: skeletonHeight(segments) };
}

function buildSkeleton(algorithm: Exclude<TreeAlgorithm, "mixed">, settings: TreeSettings, rng: Rng): Skeleton {
  if (algorithm === "lsystem") return buildLSystemSkeleton(settings, rng, true);
  if (algorithm === "conifer") return buildConiferSkeleton(settings, rng);
  if (algorithm === "palm") return buildPalmSkeleton(settings, rng);
  if (algorithm === "dead") return buildRecursiveSkeleton(settings, rng, false);
  return buildRecursiveSkeleton(settings, rng, true);
}

// ---------------------------------------------------------------------------
// Rasterizing
// ---------------------------------------------------------------------------

function stampDisc(grid: VoxelGrid, center: Vec3, radius: number, material: number): void {
  const limit = Math.max(0, Math.ceil(radius));
  const squared = radius * radius;
  for (let dz = -limit; dz <= limit; dz += 1) {
    for (let dy = -limit; dy <= limit; dy += 1) {
      for (let dx = -limit; dx <= limit; dx += 1) {
        if (dx * dx + dy * dy + dz * dz > squared + 0.25) continue;
        grid.set(Math.round(center.x) + dx, Math.round(center.y) + dy, Math.round(center.z) + dz, material);
      }
    }
  }
}

function drawBranch(grid: VoxelGrid, a: Vec3, b: Vec3, radius: number, material: number): void {
  const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const steps = Math.max(1, Math.ceil(length * 1.6));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const point = vec(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
    if (radius <= 0.62) {
      grid.set(Math.round(point.x), Math.round(point.y), Math.round(point.z), material);
    } else {
      stampDisc(grid, point, radius, material);
    }
  }
}

function leafCluster(
  grid: VoxelGrid,
  center: Vec3,
  radius: number,
  density: number,
  rng: Rng,
  material: MaterialIndex,
): void {
  const limit = Math.ceil(radius);
  const squared = radius * radius;
  const flatten = 0.82;
  for (let dz = -limit; dz <= limit; dz += 1) {
    for (let dy = -limit; dy <= limit; dy += 1) {
      for (let dx = -limit; dx <= limit; dx += 1) {
        const distance = dx * dx + dy * dy + (dz / flatten) * (dz / flatten);
        if (distance > squared) continue;
        // Thin out the shell so crowns look organic instead of like plain spheres.
        const edge = 1 - distance / (squared || 1);
        if (rng.next() > density * (0.45 + edge * 0.75)) continue;
        const shade = rng.next();
        const cell = shade > 0.78 ? material.leafLight : shade < 0.24 ? material.leafDark : material.leaf;
        grid.setIfEmpty(Math.round(center.x) + dx, Math.round(center.y) + dy, Math.round(center.z) + dz, cell);
      }
    }
  }
}

export interface GrowTreeOptions {
  algorithm: Exclude<TreeAlgorithm, "mixed">;
  height: number;
}

/** Grows one tree with its base at (x, y, z) and returns the number of new voxels. */
export function growTree(
  grid: VoxelGrid,
  x: number,
  y: number,
  z: number,
  settings: TreeSettings,
  rng: Rng,
  material: MaterialIndex,
  options: GrowTreeOptions,
): number {
  const before = grid.voxelCount;
  const skeleton = buildSkeleton(options.algorithm, settings, rng);
  const verticalScale = options.height / skeleton.height;
  const base = vec(x, y, z);
  const trunkMaterial = options.algorithm === "dead" ? material.trunkDark : material.trunk;
  const leafFill = Math.min(1, Math.max(0.05, settings.leafDensity));

  // The crown radius describes the canopy of the whole tree, so it stretches the
  // skeleton sideways. Sizing each tip blob by it instead would make one sphere per
  // branch tip, which both looks wrong and costs O(radius³) per tip at fine scales.
  const canopy = Math.max(1, settings.crownRadius * (0.8 + rng.next() * 0.4));
  const spread = skeletonSpread(skeleton.segments);
  const lateralScale = spread > 0.001 ? canopy / spread : verticalScale;

  const place = (point: Vec3): Vec3 =>
    vec(base.x + point.x * lateralScale, base.y + point.y * lateralScale, base.z + point.z * verticalScale);

  for (const segment of skeleton.segments) {
    const a = place(segment.a);
    const b = place(segment.b);
    const radius = Math.max(0.35, settings.trunkThickness * segment.radius);
    drawBranch(grid, a, b, radius, segment.wood ? trunkMaterial : material.leafDark);
    if (segment.leafScale > 0) {
      // Foliage wraps its own twig, so the cost follows the branch length and the
      // union of all tips forms the canopy.
      const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      const blob = Math.min(canopy, Math.max(1, length * 1.15 * segment.leafScale));
      leafCluster(grid, b, blob, leafFill, rng, material);
    }
  }
  return grid.voxelCount - before;
}
