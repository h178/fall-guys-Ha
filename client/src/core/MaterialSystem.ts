import {
  Scene,
  StandardMaterial,
  PBRMaterial,
  Color3,
  Color4,
  Texture,
  CubeTexture,
  Mesh,
  MeshBuilder
} from '@babylonjs/core';
import type { LevelConfig } from '../scenes/LevelConfig';

export class MaterialSystem {

  static readonly COLOR = {
    PLAYER:       new Color3(0.05, 0.85, 0.90),
    PILLAR:       new Color3(0.35, 0.20, 0.08),
    ARM:          new Color3(0.55, 0.35, 0.15),
    EMISSIVE_ARM: new Color3(0.05, 0.02, 0.00),
  };

  static createPlayerMaterial(scene: Scene): PBRMaterial {
    const mat = new PBRMaterial('mat_player', scene);
    mat.albedoColor    = MaterialSystem.COLOR.PLAYER;
    mat.metallic       = 0.3;
    mat.roughness      = 0.2;
    mat.emissiveColor  = new Color3(0.00, 0.10, 0.12);
    return mat;
  }

  static createGroundMaterial(scene: Scene): PBRMaterial {
    const mat = new PBRMaterial('mat_ground', scene);
    
    const diffuseTex = new Texture("https://playground.babylonjs.com/textures/grass.png", scene);
    diffuseTex.uScale = 4;
    diffuseTex.vScale = 4;
    
    mat.albedoTexture = diffuseTex;
    const bumpTex = new Texture("https://playground.babylonjs.com/textures/grassn.png", scene);
    bumpTex.uScale = 4;
    bumpTex.vScale = 4;
    mat.bumpTexture = bumpTex;
    
    mat.metallic = 0.05;
    mat.roughness = 0.9;
    
    return mat;
  }

  static createPillarMaterial(scene: Scene): PBRMaterial {
    const mat = new PBRMaterial('mat_pillar', scene);
    mat.albedoColor = MaterialSystem.COLOR.PILLAR;
    mat.metallic    = 0.6;
    mat.roughness   = 0.4;
    mat.freeze();
    return mat;
  }

  static createArmMaterial(scene: Scene): PBRMaterial {
    const mat = new PBRMaterial('mat_arm', scene);
    mat.albedoColor   = MaterialSystem.COLOR.ARM;
    mat.metallic      = 0.5;
    mat.roughness     = 0.3;
    mat.emissiveColor = MaterialSystem.COLOR.EMISSIVE_ARM;
    return mat;
  }

  static createTrunkMaterial(scene: Scene): PBRMaterial {
    const mat = new PBRMaterial('mat_trunk', scene);
    const tex = new Texture('https://playground.babylonjs.com/textures/rock.png', scene); // Used as bark
    tex.uScale = 2;
    tex.vScale = 5;
    mat.albedoTexture = tex;
    mat.albedoColor = new Color3(0.4, 0.25, 0.15); // Tint brown
    mat.metallic    = 0.0;
    mat.roughness   = 0.9;
    mat.freeze();
    return mat;
  }

  static createFoliageMaterial(scene: Scene): PBRMaterial {
    const mat = new PBRMaterial('mat_foliage', scene);
    mat.albedoColor   = new Color3(0.12, 0.55, 0.08);
    mat.metallic      = 0.0;
    mat.roughness     = 0.7;
    mat.emissiveColor = new Color3(0.02, 0.08, 0.01);
    mat.freeze();
    return mat;
  }

  static createSkybox(scene: Scene, config: LevelConfig): void {
    const skybox = MeshBuilder.CreateBox("skyBox", { size: 1000.0 }, scene);
    const skyboxMaterial = new StandardMaterial("skyBox", scene);
    skyboxMaterial.backFaceCulling = false;
    
    let texturePath = "https://playground.babylonjs.com/textures/skybox/skybox";
    if (config.theme === 'jungle') texturePath = "https://playground.babylonjs.com/textures/TropicalSunnyDay";
    if (config.theme === 'space') texturePath = "https://playground.babylonjs.com/textures/Space/space";
    
    skyboxMaterial.reflectionTexture = new CubeTexture(texturePath, scene);
    skyboxMaterial.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;
    skyboxMaterial.diffuseColor = new Color3(0, 0, 0);
    skyboxMaterial.specularColor = new Color3(0, 0, 0);
    skybox.material = skyboxMaterial;
    skybox.infiniteDistance = true;
    skybox.renderingGroupId = 0;
  }

  static applyThemeSkyColor(scene: Scene, config: LevelConfig): void {
    const c = config.skyColor;
    scene.clearColor = new Color4(c.r, c.g, c.b, c.a);
    this.createSkybox(scene, config);
    
    // Setup HDRI for realistic reflections
    let envPath = "https://playground.babylonjs.com/textures/environment.dds";
    scene.environmentTexture = CubeTexture.CreateFromPrefilteredData(envPath, scene);
    scene.environmentIntensity = 0.8;
  }

  public static createSnowMaterial(scene: Scene): PBRMaterial {
    const mat = new PBRMaterial('mat_snow', scene);
    const tex = new Texture('https://playground.babylonjs.com/textures/floor.png', scene);
    tex.uScale = 4;
    tex.vScale = 4;
    mat.albedoTexture = tex;
    mat.metallic = 0.0;
    mat.roughness = 0.9;
    return mat;
  }

  public static createIceMaterial(scene: Scene): PBRMaterial {
    const mat = new PBRMaterial('mat_ice', scene);
    mat.albedoColor = new Color3(0.7, 0.9, 1.0);
    mat.metallic = 0.1;
    mat.roughness = 0.05;
    mat.alpha = 0.85;
    mat.transparencyMode = 2; // MATERIAL_ALPHABLEND
    
    const bumpTex = new Texture("https://playground.babylonjs.com/textures/waterbump.png", scene);
    bumpTex.uScale = 6;
    bumpTex.vScale = 6;
    mat.bumpTexture = bumpTex;
    
    return mat;
  }

  static createParkPlatformMaterial(scene: Scene): PBRMaterial {
    const mat = new PBRMaterial('mat_park_platform', scene);
    mat.albedoColor = new Color3(1.0, 0.6, 0.8);
    mat.metallic = 0.1;
    mat.roughness = 0.2;
    
    const noiseTex = new Texture("https://playground.babylonjs.com/textures/rock.png", scene);
    noiseTex.uScale = 2;
    noiseTex.vScale = 2;
    mat.ambientTexture = noiseTex;
    
    return mat;
  }

  static createSpacePlatformMaterial(scene: Scene): PBRMaterial {
    const mat = new PBRMaterial('mat_space_platform', scene);
    mat.albedoColor = new Color3(0.2, 0.2, 0.3);
    mat.metallic = 0.8;
    mat.roughness = 0.3;
    
    const floorTex = new Texture("https://playground.babylonjs.com/textures/floor.png", scene);
    floorTex.uScale = 4;
    floorTex.vScale = 4;
    mat.albedoTexture = floorTex;
    
    const bumpTex = new Texture("https://playground.babylonjs.com/textures/floor_bump.png", scene);
    bumpTex.uScale = 4;
    bumpTex.vScale = 4;
    mat.bumpTexture = bumpTex;

    return mat;
  }

  static createNeonMaterial(scene: Scene, color: Color3): PBRMaterial {
    const mat = new PBRMaterial(`mat_neon_${Math.random().toFixed(4)}`, scene);
    mat.albedoColor   = color;
    mat.emissiveColor = color;
    mat.emissiveIntensity = 3.0;
    mat.metallic      = 0.3;
    mat.roughness     = 0.4;
    return mat;
  }

  static apply(mesh: Mesh, mat: PBRMaterial | StandardMaterial, isStatic = false): void {
    mesh.material = mat;
    if (isStatic) {
      mesh.freezeWorldMatrix();
    }
  }

  static getThemeMaterial(scene: Scene, theme: 'jungle' | 'space' | 'park' | 'ice', type: 'ground' | 'platform' | 'pillar' | 'obstacle' | 'trap'): PBRMaterial | StandardMaterial {
    switch (theme) {
      case 'jungle':
        if (type === 'ground' || type === 'platform' || type === 'trap') return this.createGroundMaterial(scene);
        if (type === 'pillar') return this.createPillarMaterial(scene);
        if (type === 'obstacle') return this.createArmMaterial(scene);
        break;
      case 'space':
        if (type === 'ground' || type === 'platform') return this.createSpacePlatformMaterial(scene);
        if (type === 'pillar' || type === 'obstacle') return this.createNeonMaterial(scene, new Color3(0.1, 0.8, 1.0));
        if (type === 'trap') return this.createSpacePlatformMaterial(scene);
        break;
      case 'park':
        if (type === 'ground' || type === 'platform' || type === 'trap') return this.createParkPlatformMaterial(scene);
        if (type === 'pillar') return this.createPillarMaterial(scene);
        if (type === 'obstacle') return this.createArmMaterial(scene);
        break;
      case 'ice':
        if (type === 'ground' || type === 'trap') return this.createSnowMaterial(scene);
        if (type === 'platform') return this.createIceMaterial(scene);
        if (type === 'pillar') return this.createPillarMaterial(scene);
        if (type === 'obstacle') return this.createArmMaterial(scene);
        break;
    }
    return this.createGroundMaterial(scene);
  }
}
