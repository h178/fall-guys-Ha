export interface PlatformDef {
  name: string; width: number; depth: number; x: number; z: number;
}

export interface ObstacleDef {
  type: string;
  position: { x: number; y: number; z: number };
  params?: Record<string, number>;
}

export interface LevelConfig {
  name: string;
  gravity: { x: number; y: number; z: number };
  skyColor: { r: number; g: number; b: number; a: number };
  platforms: PlatformDef[];
  obstacles: ObstacleDef[];
  finishZ: number;
  spawnPoint: { x: number; y: number; z: number };
  theme: 'jungle' | 'space';
}

export const LEVEL_JUNGLE: LevelConfig = {
  name: 'Jungle Rush',
  gravity: { x: 0, y: -9.81, z: 0 },
  skyColor: { r: 0.53, g: 0.81, b: 0.92, a: 1.0 },
  platforms: [
    { name: 'spawn',  width: 8,  depth: 8,  x: 0, z: 0 },
    { name: 'bridge', width: 3,  depth: 6,  x: 0, z: 10 },
    { name: 'hammer', width: 10, depth: 10, x: 0, z: 20 },
    { name: 'finish', width: 6,  depth: 6,  x: 0, z: 30 },
  ],
  obstacles: [
    { type: 'hammer',   position: { x: 0, y: 0, z: 20 } },
    { type: 'mushroom', position: { x: 3, y: 0, z: 15 } },
    { type: 'lily',     position: { x: 0, y: 0, z: 10 } },
  ],
  finishZ: 33,
  spawnPoint: { x: 0, y: 2, z: 0 },
  theme: 'jungle',
};

export const LEVEL_SPACE: LevelConfig = {
  name: 'Galactic Rush',
  gravity: { x: 0, y: -6.87, z: 0 },   // 0.7× gravité terrestre
  skyColor: { r: 0.04, g: 0.02, b: 0.12, a: 1.0 },  // violet profond
  platforms: [
    { name: 'launch',   width: 8,  depth: 8,  x: 0, z: 0 },
    { name: 'asteroid', width: 6,  depth: 6,  x: 0, z: 12 },
    { name: 'sweeper',  width: 14, depth: 14, x: 0, z: 26 },
    { name: 'beacon',   width: 6,  depth: 6,  x: 0, z: 40 },
  ],
  obstacles: [
    { type: 'sweeper', position: { x: 0, y: 0, z: 26 } },
  ],
  finishZ: 43,
  spawnPoint: { x: 0, y: 2, z: 0 },
  theme: 'space',
};
