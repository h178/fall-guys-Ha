import {
  Engine,
  Scene,
  Vector3,
  ArcRotateCamera,
  HemisphericLight,
  DirectionalLight,
  ShadowGenerator,
  CascadedShadowGenerator,
  Color3,
} from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { HavokPlugin } from '@babylonjs/core';

/**
 * Classe centrale du moteur de jeu FG.
 * Responsabilités :
 *  - Création et gestion du moteur Babylon.js (WebGL)
 *  - Initialisation asynchrone du moteur physique Havok
 *  - Cycle de vie de la scène (caméra, lumières, boucle de rendu)
 */
export class Game {
  private engine: Engine;
  private scene: Scene;
  private canvas: HTMLCanvasElement;
  private camera: ArcRotateCamera | null = null;
  private shadowGenerator: CascadedShadowGenerator | null = null;
  private sun: DirectionalLight | null = null;

  constructor(canvasId: string) {
    const element = document.getElementById(canvasId);
    if (element === null) {
      throw new Error(`Canvas element '#${canvasId}' not found in DOM`);
    }
    this.canvas = element as HTMLCanvasElement;

    // Antialiasing activé (2e paramètre à true)
    this.engine = new Engine(this.canvas, true);
    this.scene = new Scene(this.engine);
  }

  /**
   * Initialise le moteur physique Havok de manière asynchrone.
   * DOIT être appelé avant toute création de PhysicsAggregate.
   */
  async initPhysics(): Promise<void> {
    const havokInstance = await HavokPhysics();
    // true = utiliser les coordonnées main-gauche (convention Babylon.js)
    const havokPlugin = new HavokPlugin(true, havokInstance);
    this.scene.enablePhysics(new Vector3(0, -9.81, 0), havokPlugin);
  }

  /**
   * Configure la caméra orbitale principale.
   */
  setupCamera(): void {
    this.camera = new ArcRotateCamera(
      'mainCamera',
      -Math.PI / 2,   // alpha : vue de face
      Math.PI / 3,    // beta  : angle plongeant ~60°
      15,             // radius : distance de recul
      Vector3.Zero(), // cible : centre de la scène
      this.scene
    );
    this.camera.attachControl(this.canvas, true);

    // ─ Contraintes 3ème personne ────────────────────────────
    // Radius : empêche le joueur de zoomer trop près ou trop loin
    this.camera.lowerRadiusLimit = 5;
    this.camera.upperRadiusLimit = 12;

    // Beta : angle vertical (latitudinal)
    // lowerBetaLimit = PI/6 (30°) → empêche la vue top-down extrême
    // upperBetaLimit = PI/2.1 → empêche la caméra de passer SOUS
    //   le sol. Le .1 de marge (≈3°) évite un flickering de la
    //   matrice vue quand beta atteint exactement PI/2.
    this.camera.lowerBetaLimit = Math.PI / 6;
    this.camera.upperBetaLimit = Math.PI / 2.1;
  }

  /**
   * Expose la caméra principale pour les entités qui ont besoin
   * de la manipuler (ex: PlayerController pour le suivi du joueur).
   */
  getCamera(): ArcRotateCamera | null {
    return this.camera;
  }

  /**
   * Configure l'éclairage de la scène :
   *  1. HemisphericLight  : lumière ambiante douce (ciel → sol)
   *  2. DirectionalLight  : lumière principale directionnelle (soleil)
   *  3. ShadowGenerator   : ombres PCF soft 2048px (qualité arcade)
   *
   * Le ShadowGenerator est exposé via getShadowGenerator() pour que
   * GameLevel y enregistre les shadow casters (meshes qui projettent).
   */
  setupLight(): void {
    console.log('🟦 [LIGHT] setupLight()');
    // ─ Lumière ambiante (ciel violet → sol orange doux) ─────────────
    const ambient = new HemisphericLight(
      'ambientLight',
      new Vector3(0, 1, 0),
      this.scene
    );
    ambient.intensity = 0.95;
    ambient.diffuse = new Color3(0.70, 0.68, 1.00);  // violet clair
    ambient.groundColor = new Color3(0.30, 0.20, 0.10);  // ocre chaud
    ambient.specular = Color3.Black();
    console.log('🟩 [LIGHT] HemisphericLight', {
      intensity: ambient.intensity,
      direction: ambient.direction?.toString?.() ?? '(n/a)',
    });

    // ─ Lumière directionnelle (soleil) ───────────────────────────────
    const sun = new DirectionalLight(
      'sunLight',
      new Vector3(-1, -2, -1).normalize(),  // angle 45°, direction sud-ouest
      this.scene
    );
    sun.intensity = 1.2;
    sun.diffuse = new Color3(1.00, 0.96, 0.88);  // blanc chaud
    sun.specular = new Color3(0.50, 0.48, 0.44);
    // Positionner la source loin pour les ombres
    sun.position = new Vector3(20, 40, 20);
    console.log('🟩 [LIGHT] DirectionalLight', {
      intensity: sun.intensity,
      direction: sun.direction.toString(),
      position: sun.position.toString(),
    });

    // ─ Frustum orthographique manuel ─────────────────────────────────
    // Par défaut, autoUpdateExtends = true → Babylon calcule le frustum
    // sur les shadow CASTERS uniquement (capsule + bras du marteau).
    // Le sol (30×30) est un RECEIVER, pas un caster : il n'entre PAS
    // dans ce calcul. Résultat : frustum trop petit → ombres projetées
    // hors de la shadow map → invisibles sur le sol.
    //
    // Solution : frustum fixe qui couvre toute la zone de jeu.
    sun.autoUpdateExtends = false;  // désactive le recalcul auto X/Y
    sun.autoCalcShadowZBounds = false;  // désactive le recalcul auto Z

    // Borne ortho : couvre le parcours complet (Z de -4 à +33, X de -5 à +5)
    sun.orthoLeft = -20;
    sun.orthoRight = 20;
    sun.orthoTop = 40;   // ← élargi (était 20) : couvre jusqu'à Z=33+
    sun.orthoBottom = -10;   // ← ajusté (était -20) : le parcours ne va pas en Z négatif

    // Profondeur : plage Z couvrant tout l'espace de jeu visible
    sun.shadowMinZ = 1;
    sun.shadowMaxZ = 100;

    // ─ Shadow Generator (CSM - Cascaded Shadow Map) ────────────────
    const csm = new CascadedShadowGenerator(2048, sun);
    csm.usePercentageCloserFiltering = true;
    csm.filteringQuality = ShadowGenerator.QUALITY_HIGH;
    csm.stabilizeCascades = true;
    csm.lambda = 0.7;
    csm.shadowMaxZ = 100;
    
    this.shadowGenerator = csm;
    this.sun = sun;
    console.log('🟩 [LIGHT] CascadedShadowGenerator ready');

    // ─ Environment Helper (IBL - Image Based Lighting) ──────────
    // Indispensable pour que les matériaux PBR (Minions, Métal)
    // aient des reflets réalistes du ciel.
    this.scene.createDefaultEnvironment({
      createGround: false,
      createSkybox: false, // On gère notre propre Skybox dans MaterialSystem
      setupImageProcessing: false, // On gère le pipeline manuellement
    });
    if (this.scene.environmentTexture) {
      this.scene.environmentTexture.level = 1.0;
    }
  }

  public updateShadowFrustum(maxZ: number): void {
    if (!this.sun) return;
    // Note: CSM gère ses propres cascades, on ajuste juste le frustum global du soleil
    this.sun.orthoTop = maxZ + 10;
    this.sun.orthoBottom = -10;
  }

  /**
   * Expose le ShadowGenerator pour que GameLevel enregistre
   * les shadow casters (joueur, marteau arm).
   */
  getShadowGenerator(): CascadedShadowGenerator | null {
    return this.shadowGenerator;
  }

  /**
   * Lance la boucle de rendu et écoute les redimensionnements.
   * À appeler en dernier, une fois la scène entièrement construite.
   */
  start(): void {
    this.engine.runRenderLoop(() => {
      this.scene.render();
    });

    window.addEventListener('resize', () => {
      this.engine.resize();
    });
  }

  /**
   * Expose la scène pour que les modules externes (scènes, entités)
   * puissent y ajouter des meshes et de la physique.
   */
  getScene(): Scene {
    return this.scene;
  }
}
