import {
  Scene,
  ArcRotateCamera,
  MeshBuilder,
  PhysicsAggregate,
  PhysicsShapeType,
  ShadowGenerator,
  StandardMaterial,
  Color3,
  Vector3,
  Mesh,
} from '@babylonjs/core';
import { PlayerController } from '../entities/PlayerController';
import type { IObstacle } from '../entities/obstacles/IObstacle';
import { RotatingHammer } from '../entities/obstacles/RotatingHammer';
import { MaterialSystem } from '../core/MaterialSystem';
import { NetworkManager } from '../network/NetworkManager';
import { UIManager } from '../ui/UIManager';
import { GameState } from '../core/GameState';

/**
 * Gestionnaire de contenu du niveau FG.
 *
 * Sprint 6 — Game Loop complète :
 *  - Machine à états : MENU → PLAYING → WON
 *  - Multi-plateformes avec gaps sautables
 *  - Ligne d'arrivée (intersectsMesh AABB, pas de physique)
 *  - UIManager (menu, HUD, chrono, victoire)
 *  - PlayerController.inputEnabled : immobile au menu et après victoire
 *
 * Principe : main.ts ne contient AUCUNE logique de scène.
 * Toute création de mesh, physique et update est ici.
 */
export class GameLevel {

  // ─── Layout du parcours ─────────────────────────────────────────────
  /**
   * Définition des plateformes en DONNÉES, pas en code.
   * Modifier ici pour changer le layout — aucun autre fichier à toucher.
   *
   * Position (x, z) = CENTRE de la plateforme au sol (y = 0).
   *
   * Gaps calculés :
   *  spawn    → bridge : (Z=10 - depth/2=3) - (Z=0 + depth/2=4)  = 3 unités ✅ sautables
   *  bridge   → hammer : (Z=20 - depth/2=5) - (Z=10 + depth/2=3) = 2 unités ✅
   *  hammer   → finish : (Z=30 - depth/2=3) - (Z=20 + depth/2=5) = 2 unités ✅
   */
  private static readonly PLATFORMS = [
    { name: 'spawn',  width: 8,  depth: 8,  x: 0, z: 0  },
    { name: 'bridge', width: 3,  depth: 6,  x: 0, z: 10 },
    { name: 'hammer', width: 10, depth: 10, x: 0, z: 20 },
    { name: 'finish', width: 6,  depth: 6,  x: 0, z: 30 },
  ] as const;

  // ─── Propriétés ─────────────────────────────────────────────────────
  private scene:       Scene;
  private player:      PlayerController | null = null;
  private obstacles:   IObstacle[]             = [];
  private hammers:     RotatingHammer[]        = [];
  private network:     NetworkManager | null   = null;
  private platforms:   Mesh[]                  = [];
  private finishZone:  Mesh | null             = null;
  private ui:          UIManager | null        = null;
  private decorativeGround: Mesh | null        = null;
  private vegetationMeshes: Mesh[]             = [];

  // ─── Machine à états ────────────────────────────────────────────────
  private state:       GameState = GameState.MENU;
  /**
   * Durée de jeu en secondes, incrémentée par deltaTime — PAS par
   * performance.now() (instable en arrière-plan, throttlé par le navigateur).
   */
  private elapsedTime: number    = 0;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  // ─── Initialisation ─────────────────────────────────────────────────

  /**
   * Initialise tout le contenu du niveau.
   * Appelé UNE SEULE FOIS depuis main.ts après initPhysics() et setupCamera().
   */
  setup(camera: ArcRotateCamera, shadowGenerator: ShadowGenerator | null = null): void {
    MaterialSystem.applySkyColor(this.scene);

    this.ui = new UIManager();

    this.createPlatforms(shadowGenerator);
    this.createDecorativeGround();
    this.createVegetation();
    this.createPlayer(camera, shadowGenerator);
    this.createObstacles(shadowGenerator);
    this.createFinishLine();
    this.registerGameEvents();
    this.registerUpdateLoop();

    // ─ Réseau (connexion async non bloquante) ───────────────────────
    this.network = new NetworkManager(this.scene);
    this.network.connect();
  }

  // ─── Création du contenu ─────────────────────────────────────────────

  /**
   * Crée le parcours multi-plateformes depuis le tableau PLATFORMS.
   *
   * Chaque plateforme est un mesh indépendant avec :
   *  - Son propre PhysicsAggregate (mass:0) → corps statique
   *  - receiveShadows = true
   *  - Matériau damier (réutilisé depuis MaterialSystem)
   *  - freezeWorldMatrix via MaterialSystem.apply(..., true)
   */
  private createPlatforms(shadowGenerator: ShadowGenerator | null): void {
    // Créer un matériau damier réutilisé sur toutes les plateformes
    const groundMat = MaterialSystem.createGroundMaterial(this.scene);

    for (const config of GameLevel.PLATFORMS) {
      const platform = MeshBuilder.CreateGround(
        `platform_${config.name}`,
        { width: config.width, height: config.depth },
        this.scene
      );
      platform.position = new Vector3(config.x, 0, config.z);

      // Corps statique : mass:0 → non affecté par la gravité Havok
      new PhysicsAggregate(
        platform,
        PhysicsShapeType.BOX,
        { mass: 0 },
        this.scene
      );

      platform.receiveShadows = true;
      // freeze = true → optimisation : la matrice monde est calculée 1 seule fois
      MaterialSystem.apply(platform, groundMat, true);
      shadowGenerator?.addShadowCaster(platform, false);

      this.platforms.push(platform);
    }
  }

  /**
   * Instancie le PlayerController avec le spawn au centre de la 1re plateforme.
   * inputEnabled reste false jusqu'au clic JOUER (état MENU).
   */
  private createPlayer(camera: ArcRotateCamera, shadowGenerator: ShadowGenerator | null): void {
    // Spawn = centre de la plateforme "spawn" (Z=0, X=0) à Y=2 → retombe via gravité Havok
    this.player = new PlayerController(this.scene, camera, new Vector3(0, 2, 0));
    shadowGenerator?.addShadowCaster(this.player.getMesh(), false);
    // N.B. : inputEnabled = false par défaut dans PlayerController
  }

  /**
   * Sol décoratif étendu sous les plateformes.
   * Pas de PhysicsAggregate → le joueur travers en OOB (KILL_Y = -10).
   * Y = -0.5 pour être légèrement sous les plateformes (Y=0) visuellement.
   */
  private createDecorativeGround(): void {
    this.decorativeGround = MeshBuilder.CreateGround(
      'decorativeGround',
      { width: 200, height: 200 },
      this.scene
    );
    this.decorativeGround.position.y = -0.5;
    const mat = MaterialSystem.createGroundMaterial(this.scene);
    this.decorativeGround.material = mat;
    this.decorativeGround.receiveShadows = true;
    this.decorativeGround.freezeWorldMatrix();
  }

  /**
   * Végétation procédurale : 25 instances d'un arbre master (tronc + feuillage).
   * Positionées aléatoirement autour du parcours, hors zones de gameplay.
   * Aucun PhysicsAggregate — décor pur.
   */
  private createVegetation(): void {
    const trunkMat   = MaterialSystem.createTrunkMaterial(this.scene);
    const foliageMat = MaterialSystem.createFoliageMaterial(this.scene);

    // Tronc
    const trunk = MeshBuilder.CreateCylinder(
      'treeTrunk',
      { height: 3, diameter: 0.6, tessellation: 8 },
      this.scene
    );
    trunk.material = trunkMat;

    // Feuillage
    const canopy = MeshBuilder.CreateSphere(
      'treeCanopy',
      { diameter: 2.5, segments: 6 },
      this.scene
    );
    canopy.position.y = 2.5;
    canopy.material   = foliageMat;
    canopy.parent     = trunk;

    // Merge trunk + canopy en un seul mesh master
    const masterTree = Mesh.MergeMeshes(
      [trunk, canopy],
      true,   // disposeSource
      true,   // allow32BitsIndices
      undefined,
      false,  // subdivideWithSubMeshes
      true    // multiMultiMaterials
    );
    if (!masterTree) return;
    masterTree.name = 'masterTree';
    masterTree.setEnabled(false); // le master est invisible — seules les instances comptent

    // Zones à éviter : |X| < 6 et Z ∈ plateformes ± 4
    const platformZones = GameLevel.PLATFORMS.map(p => ({ z: p.z, hw: p.depth / 2 + 1 }));

    const rnd    = (min: number, max: number) => Math.random() * (max - min) + min;
    const count  = 25;
    let   placed = 0;
    let   attempts = 0;

    while (placed < count && attempts < 500) {
      attempts++;
      const x = rnd(-15, 15);
      const z = rnd(-5, 35);

      // Exclure corridor central de gameplay
      const inCorridor = Math.abs(x) < 6 &&
        platformZones.some(pz => z >= pz.z - pz.hw && z <= pz.z + pz.hw);
      if (inCorridor) continue;

      const instance = masterTree.createInstance(`tree_${placed}`);
      instance.position.set(x, 0, z);
      instance.scaling.setAll(rnd(0.8, 1.3));
      instance.rotation.y = rnd(0, Math.PI * 2);
      this.vegetationMeshes.push(instance as unknown as Mesh);
      placed++;
    }

    this.vegetationMeshes.push(masterTree);
  }

  /**
   * Marteau repositionné à Z=20 (centre de la plateforme "hammer").
   */
  private createObstacles(shadowGenerator: ShadowGenerator | null): void {
    const hammer = new RotatingHammer(this.scene, new Vector3(0, 0, 20));
    this.obstacles.push(hammer);
    this.hammers.push(hammer);

    shadowGenerator?.addShadowCaster(hammer.getArmMesh(), false);
    shadowGenerator?.addShadowCaster(hammer.getPillarMesh(), false);
  }

  /**
   * Zone de fin : box semi-transparente sans physique.
   *
   * ⚠️  PAS de PhysicsAggregate — la zone ne doit PAS bloquer le joueur.
   *     La détection de victoire se fait via intersectsMesh() (AABB),
   *     qui fonctionne sur la geometry visuelle, pas la physique.
   *
   * Positionnement : Z=33 = bord avant de la plateforme "finish" (Z=30, depth=6 → bord à Z=33)
   */
  private createFinishLine(): void {
    this.finishZone = MeshBuilder.CreateBox(
      'finishZone',
      { width: 6, height: 4, depth: 0.5 },
      this.scene
    );
    this.finishZone.position = new Vector3(0, 2, 33);

    // Matériau or semi-transparent — signal visuel "ligne d'arrivée"
    const mat = new StandardMaterial('mat_finish', this.scene);
    mat.diffuseColor  = new Color3(1.0, 0.84, 0.0);
    mat.alpha         = 0.35;
    mat.emissiveColor = new Color3(0.3, 0.25, 0.0);
    this.finishZone.material = mat;
  }

  // ─── Machine à états ─────────────────────────────────────────────────

  /**
   * Enregistre les callbacks UI → états du jeu.
   * Le bouton JOUER n'est actif que depuis l'état MENU.
   */
  private registerGameEvents(): void {
    this.ui?.onPlayClicked(() => {
      if (this.state !== GameState.MENU) return;
      this.startGame();
    });
  }

  /**
   * Transition MENU → PLAYING.
   * Active les inputs du joueur, affiche le HUD, remet le chrono à zéro.
   */
  private startGame(): void {
    this.state       = GameState.PLAYING;
    this.elapsedTime = 0;
    this.player?.setInputEnabled(true);
    this.ui?.showHUD();
    console.log('🎮 Game started!');
  }

  /**
   * Transition PLAYING → WON.
   * Désactive les inputs, gèle le chrono, affiche "QUALIFIÉ !".
   * Les obstacles continuent de tourner (ambiance visuelle).
   */
  private winGame(): void {
    this.state = GameState.WON;
    this.player?.setInputEnabled(false);
    this.ui?.showVictory();
    console.log(`🏆 Victory! Time: ${this.elapsedTime.toFixed(2)}s`);
  }

  // ─── Boucle de mise à jour ────────────────────────────────────────────

  /**
   * UNE SEULE boucle d'update pour tous les éléments.
   *
   * Ordre d'exécution :
   *  1. player.update()      — OOB + inputs (toujours)
   *  2. obstacles.update()   — marteau tourne (toujours)
   *  3. chrono + victoire    — UNIQUEMENT en état PLAYING
   */
  private registerUpdateLoop(): void {
    this.scene.onBeforeRenderObservable.add(() => {
      const dt = this.scene.getEngine().getDeltaTime() / 1000;

      // PlayerController gère OOB/respawn + caméra même au menu/WON
      this.player?.update(dt);

      // Les obstacles tournent dans TOUS les états (ambiance)
      for (const obstacle of this.obstacles) {
        obstacle.update(dt);
      }

      // ─ RÉSEAU : interpolation des joueurs distants ──────────
      // Tourne dans TOUS les states — les remote players bougent
      // même quand le joueur local est au menu ou a gagné
      this.network?.updateRemotePlayers(dt);

      // Logique de jeu : uniquement pendant PLAYING
      if (this.state === GameState.PLAYING) {
        // Chrono : deltaTime cumulé (stable, indépendant de l'onglet au premier plan)
        this.elapsedTime += dt;
        this.ui?.updateTimer(this.elapsedTime);

        // ─ RÉSEAU : envoi du transform (uniquement PLAYING) ──
        // On n'envoie pas au menu/WON (le joueur ne bouge pas)
        if (this.player && this.network) {
          this.network.sendTransform(
            this.player.getMesh().position,
            this.player.getMesh().rotationQuaternion
          );
        }

        // Détection ligne d'arrivée via AABB (intersectsMesh, pas de physique)
        // false = pas de précision au triangle — AABB suffit et est O(1)
        if (this.finishZone && this.player?.getMesh().intersectsMesh(this.finishZone, false)) {
          this.winGame();
        }
      }
    });
  }

  // ─── Nettoyage ──────────────────────────────────────────────────────

  dispose(): void {
    this.network?.dispose();
    this.player?.dispose();
    for (const obstacle of this.obstacles) {
      obstacle.dispose();
    }
    for (const platform of this.platforms) {
      platform.dispose();
    }
    this.finishZone?.dispose();
    this.decorativeGround?.dispose();
    for (const mesh of this.vegetationMeshes) {
      mesh.dispose();
    }
  }
}
