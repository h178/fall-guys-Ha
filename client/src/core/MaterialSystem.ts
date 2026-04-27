import {
  Scene,
  StandardMaterial,
  PBRMaterial,
  Color3,
  Color4,
  Texture,
  DynamicTexture,
  Mesh,
} from '@babylonjs/core';
import type { LevelConfig } from '../scenes/LevelConfig';

/**
 * Système de matériaux centralisé pour FG.
 *
 * Principe : les matériaux sont créés UNE SEULE FOIS et réutilisés.
 * Ce module est le seul endroit où les couleurs du jeu sont définies.
 *
 * Palette arcade Fall Guys :
 *  - Sol      : damier blanc/lavande clair (pattern signature)
 *  - Joueur   : cyan/turquoise vif (visible, distinctif)
 *  - Pilier   : gris anthracite satiné
 *  - Bras     : rouge vif avec légère métallicité
 *  - Skybox   : dégradé bleu/violet défini via scene.clearColor
 */
export class MaterialSystem {

  // ─── Couleurs de la palette (Thème Forêt) ─────────────────────────────
  static readonly COLOR = {
    PLAYER:       new Color3(0.05, 0.85, 0.90),  // cyan vif
    GROUND_A:     new Color3(0.28, 0.65, 0.15),  // vert herbe
    GROUND_B:     new Color3(0.18, 0.45, 0.10),  // vert foncé
    PILLAR:       new Color3(0.35, 0.20, 0.08),  // marron bois
    ARM:          new Color3(0.55, 0.35, 0.15),  // marron clair
    EMISSIVE_ARM: new Color3(0.05, 0.02, 0.00),  // lueur bois sombre
  };

  // ─── Matériau Joueur (PBR) ───────────────────────────────────────────

  /**
   * Crée un matériau PBR pour la capsule joueur.
   * Légère brillance (metallicity 0.3) + couleur cyan arcade.
   * freezeActiveMeshes() après application → gain perf.
   */
  static createPlayerMaterial(scene: Scene): PBRMaterial {
    const mat = new PBRMaterial('mat_player', scene);
    mat.albedoColor    = MaterialSystem.COLOR.PLAYER;
    mat.metallic       = 0.2;
    mat.roughness      = 0.5;
    mat.emissiveColor  = new Color3(0.00, 0.10, 0.12);  // légère auto-lueur
    return mat;
  }

  // ─── Matériau Sol (damier procédural) ────────────────────────────────

  /**
   * Génère une texture damier via DynamicTexture (aucun asset externe).
   * 8×8 cases, couleurs issues de la palette.
   * La texture est mise en cache sur la scène (réutilisable).
   */
  static createGroundMaterial(scene: Scene): StandardMaterial {
    const mat = new StandardMaterial('mat_ground', scene);

    const texSize     = 512;
    const cellCount   = 8;
    const cellSize    = texSize / cellCount;

    const dynTex = new DynamicTexture('tex_ground_checker', texSize, scene, false);
    dynTex.wrapU = Texture.WRAP_ADDRESSMODE;
    dynTex.wrapV = Texture.WRAP_ADDRESSMODE;

    const ctx = dynTex.getContext();
    const colA = '#EBEBFF';  // blanc lavande
    const colB = '#B8ADFA';  // violet clair

    for (let row = 0; row < cellCount; row++) {
      for (let col = 0; col < cellCount; col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? colA : colB;
        ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
      }
    }
    dynTex.update();

    mat.diffuseTexture   = dynTex;
    mat.specularColor    = new Color3(0.1, 0.1, 0.1);  // quasi mat
    mat.emissiveColor    = new Color3(0.02, 0.02, 0.04);

    // Tiling : la texture se répète 4× sur le sol 30×30
    (mat.diffuseTexture as DynamicTexture).uScale = 4;
    (mat.diffuseTexture as DynamicTexture).vScale = 4;

    return mat;
  }

  // ─── Matériaux Marteau ───────────────────────────────────────────────

  /**
   * Pilier : gris anthracite satiné.
   * Pilier statique → material.freeze() pour éliminer les recalculs.
   */
  static createPillarMaterial(scene: Scene): PBRMaterial {
    const mat = new PBRMaterial('mat_pillar', scene);
    mat.albedoColor = MaterialSystem.COLOR.PILLAR;
    mat.metallic    = 0.6;
    mat.roughness   = 0.4;
    mat.freeze();  // corps statique → matériau figé
    return mat;
  }

  /**
   * Bras/tête du marteau : rouge vif arcade avec légère émission.
   * L'émission donne l'impression que le marteau "brille" légèrement,
   * signal visuel d'un obstacle dangereux.
   */
  static createArmMaterial(scene: Scene): PBRMaterial {
    const mat = new PBRMaterial('mat_arm', scene);
    mat.albedoColor   = MaterialSystem.COLOR.ARM;
    mat.metallic      = 0.5;
    mat.roughness     = 0.3;
    mat.emissiveColor = MaterialSystem.COLOR.EMISSIVE_ARM;
    return mat;
  }

  // ─── Matériaux Végétation ───────────────────────────────────────────

  /** Troncs d'arbres décoratifs : bois brut marron foncé. */
  static createTrunkMaterial(scene: Scene): PBRMaterial {
    const mat = new PBRMaterial('mat_trunk', scene);
    mat.albedoColor = new Color3(0.25, 0.14, 0.05);
    mat.metallic    = 0.0;
    mat.roughness   = 0.9;
    mat.freeze();
    return mat;
  }

  /** Feuillage d'arbres décoratifs : vert saturé avec micro-émission. */
  static createFoliageMaterial(scene: Scene): PBRMaterial {
    const mat = new PBRMaterial('mat_foliage', scene);
    mat.albedoColor   = new Color3(0.12, 0.55, 0.08);
    mat.metallic      = 0.0;
    mat.roughness     = 0.7;
    mat.emissiveColor = new Color3(0.02, 0.08, 0.01);
    mat.freeze();
    return mat;
  }

  // ─── Sky Color ───────────────────────────────────────────────────────

  /**
   * Applique un fond de ciel violet/bleu profond à la scène.
   */
  static applySkyColor(scene: Scene): void {
    // Bleu ciel diurne (thème forêt/jungle)
    scene.clearColor = new Color4(0.53, 0.81, 0.92, 1.0);
  }

  /**
   * Applique la couleur du ciel selon la config de niveau.
   */
  static applyThemeSkyColor(scene: Scene, config: LevelConfig): void {
    const c = config.skyColor;
    scene.clearColor = new Color4(c.r, c.g, c.b, c.a);
  }

  // ─── Thème Space ────────────────────────────────────────────────

  /** Plateforme spatiale : PBR noir brillant avec damier sombre. */
  static createSpacePlatformMaterial(scene: Scene): PBRMaterial {
    const mat = new PBRMaterial('mat_space_platform', scene);
    mat.albedoColor = new Color3(0.08, 0.08, 0.12);
    mat.metallic    = 0.8;
    mat.roughness   = 0.2;

    // Damier sombre en DynamicTexture
    const texSize  = 512;
    const cellCount = 8;
    const cellSize  = texSize / cellCount;
    const dynTex   = new DynamicTexture('tex_space_checker', texSize, scene, false);
    dynTex.wrapU   = Texture.WRAP_ADDRESSMODE;
    dynTex.wrapV   = Texture.WRAP_ADDRESSMODE;
    const ctx = dynTex.getContext();
    for (let row = 0; row < cellCount; row++) {
      for (let col = 0; col < cellCount; col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? '#151520' : '#252540';
        ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
      }
    }
    dynTex.update();
    mat.albedoTexture = dynTex;
    (mat.albedoTexture as DynamicTexture).uScale = 4;
    (mat.albedoTexture as DynamicTexture).vScale = 4;

    return mat;
  }

  /** Matériau néon émissif pour les obstacles spatiaux. */
  static createNeonMaterial(scene: Scene, color: Color3): PBRMaterial {
    const mat = new PBRMaterial(`mat_neon_${Math.random().toFixed(4)}`, scene);
    mat.albedoColor   = color;
    mat.emissiveColor = color;
    mat.emissiveIntensity = 3.0; // Augmenté pour un effet "glow" plus prononcé
    mat.metallic      = 0.3;
    mat.roughness     = 0.4;
    return mat;
  }

  // ─── Helper : appliquer un matériau à un mesh ────────────────────────

  /**
   * Applique un matériau PBR ou Standard à un mesh et freeze la matrice
   * monde si le mesh est statique (optimisation frustum culling).
   */
  static apply(mesh: Mesh, mat: PBRMaterial | StandardMaterial, isStatic = false): void {
    mesh.material = mat;
    if (isStatic) {
      mesh.freezeWorldMatrix();
    }
  }
}
