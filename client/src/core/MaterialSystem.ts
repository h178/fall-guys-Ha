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

  // ─── Couleurs de la palette ──────────────────────────────────────────
  static readonly COLOR = {
    PLAYER:       new Color3(0.05, 0.85, 0.90),  // cyan vif
    GROUND_A:     new Color3(0.92, 0.92, 1.00),  // blanc lavande
    GROUND_B:     new Color3(0.72, 0.68, 0.98),  // violet clair
    PILLAR:       new Color3(0.20, 0.22, 0.28),  // anthracite
    ARM:          new Color3(0.95, 0.18, 0.20),  // rouge vif arcade
    EMISSIVE_ARM: new Color3(0.15, 0.00, 0.00),  // lueur rouge sombre
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

  // ─── Sky Color ───────────────────────────────────────────────────────

  /**
   * Applique un fond de ciel violet/bleu profond à la scène.
   * Utilise scene.clearColor (RGBA) — pas de skybox mesh pour économiser
   * des draw calls. Cohérent avec la palette arcade.
   *
   * Note : scene.clearColor attend Color4 (RGBA), pas Color3.
   */
  static applySkyColor(scene: Scene): void {
    // Bleu nuit légèrement violacé, pleinement opaque
    scene.clearColor = new Color4(0.06, 0.04, 0.14, 1.0);
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
