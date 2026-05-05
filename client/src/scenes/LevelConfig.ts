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
  theme: 'jungle' | 'space' | 'park' | 'ice';
  mode: 'race' | 'survival' | 'collect';
  timeLimit?: number;
  targetScore?: number;
  skyboxAsset?: string;
}

export const LEVEL_JUNGLE: LevelConfig = {
  name: 'Jungle Rush',
  mode: 'race',
  skyboxAsset: 'tropical',
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
  finishZ: 30,
  spawnPoint: { x: 0, y: 2, z: 0 },
  theme: 'jungle',
};

export const LEVEL_SPACE: LevelConfig = {
  name: 'Galactic Rush',
  mode: 'race',
  skyboxAsset: 'nebula',
  gravity: { x: 0, y: -6.87, z: 0 },
  skyColor: { r: 0.04, g: 0.02, b: 0.12, a: 1.0 },
  platforms: [
    { name: 'launch',   width: 8,  depth: 8,  x: 0, z: 0 },
    { name: 'sphere_1', width: 10, depth: 10, x: 0, z: 12 }, // Nouvelle Sphère 1
    { name: 'sphere_2', width: 12, depth: 12, x: 0, z: 24 }, // Nouvelle Sphère 2
    { name: 'sweeper',  width: 14, depth: 14, x: 0, z: 38 },
    { name: 'beacon',   width: 6,  depth: 6,  x: 0, z: 50 },
  ],
  obstacles: [
    { type: 'sweeper',  position: { x: 0, y: 0, z: 38 }, params: { speed: 1.5 } },
    { type: 'mushroom', position: { x: 3, y: 0, z: 12 } },
    { type: 'mushroom', position: { x: -3, y: 0, z: 24 } },
  ],
  finishZ: 50,
  spawnPoint: { x: 0, y: 2, z: 0 },
  theme: 'space',
};

export const LEVEL_PARK: LevelConfig = {
  name: 'Candy Park',
  mode: 'race',
  skyboxAsset: 'sunny',
  gravity: { x: 0, y: -9.81, z: 0 },
  skyColor: { r: 0.6, g: 0.8, b: 1.0, a: 1.0 }, // Ciel clair
  platforms: [
    { name: 'spawn', width: 8, depth: 8, x: 0, z: 0 },
    { name: 'bounce_zone', width: 10, depth: 10, x: 0, z: 12 }, // Avant: 15
    { name: 'slide_alley', width: 12, depth: 20, x: 0, z: 30 }, // Avant: 34
    { name: 'finish', width: 6, depth: 6, x: 0, z: 45 },        // Avant: 50
  ],
  obstacles: [
    { type: 'jumppad',     position: { x: -2, y: 0, z: 7 } },
    { type: 'jumppad',     position: { x: 2, y: 0, z: 7 } },
    { type: 'slidingwall', position: { x: 0, y: 0, z: 26 } },
    { type: 'slidingwall', position: { x: 0, y: 0, z: 34 } },
    { type: 'hammer',      position: { x: 0, y: 0, z: 20 }, params: { speed: 0.5 } },
  ],
  finishZ: 45,
  spawnPoint: { x: 0, y: 2, z: 0 },
  theme: 'park',
};

export const LEVEL_ICE: LevelConfig = {
  name: 'Winter Wipeout',
  mode: 'race',
  skyboxAsset: 'winter',
  gravity: { x: 0, y: -9.81, z: 0 },
  skyColor: { r: 0.9, g: 0.95, b: 1.0, a: 1.0 }, // Ciel blanc/gris clair
  platforms: [
    { name: 'spawn', width: 8, depth: 8, x: 0, z: 0 },
    { name: 'ice_rink', width: 14, depth: 20, x: 0, z: 15 },
    { name: 'trap_zone', width: 10, depth: 10, x: 0, z: 32 },
    { name: 'finish', width: 6, depth: 6, x: 0, z: 42 },      // Avant: 45
  ],
  obstacles: [
    { type: 'traptile', position: { x: -3, y: 0, z: 30 } },
    { type: 'traptile', position: { x: 0,  y: 0, z: 30 } },
    { type: 'traptile', position: { x: 3,  y: 0, z: 30 } },
    { type: 'traptile', position: { x: -3, y: 0, z: 34 } },
    { type: 'traptile', position: { x: 0,  y: 0, z: 34 } },
    { type: 'traptile', position: { x: 3,  y: 0, z: 34 } },
  ],
  finishZ: 42,
  spawnPoint: { x: 0, y: 2, z: 0 },
  theme: 'ice',
};
