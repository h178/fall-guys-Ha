import {
  Engine,
  Scene,
  Vector3,
  ArcRotateCamera,
  HemisphericLight,
  DirectionalLight,
  ShadowGenerator,
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
  private shadowGenerator: ShadowGenerator | null = null;

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
    // ─ Lumière ambiante (ciel violet → sol orange doux) ─────────────
    const ambient = new HemisphericLight(
      'ambientLight',
      new Vector3(0, 1, 0),
      this.scene
    );
    ambient.intensity = 0.45;
    ambient.diffuse = new Color3(0.70, 0.68, 1.00);  // violet clair
    ambient.groundColor = new Color3(0.30, 0.20, 0.10);  // ocre chaud
    ambient.specular = Color3.Black();

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

    // ─ Shadow Generator PCF Soft ──────────────────────────────────────
    // mapSize 2048 : bonne qualité sans exploser la VRAM
    // usePercentageCloserFiltering : ombres douces (pas en créneau)
    this.shadowGenerator = new ShadowGenerator(2048, sun);
    this.shadowGenerator.usePercentageCloserFiltering = true;
    this.shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    this.shadowGenerator.bias = 0.001;
  }

  /**
   * Expose le ShadowGenerator pour que GameLevel enregistre
   * les shadow casters (joueur, marteau arm).
   */
  getShadowGenerator(): ShadowGenerator | null {
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
