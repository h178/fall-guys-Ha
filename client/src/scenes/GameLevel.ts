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
  ParticleSystem,
  DynamicTexture,
  Color4,
  DefaultRenderingPipeline,
} from '@babylonjs/core';
import { PlayerController } from '../entities/PlayerController';
import type { IObstacle } from '../entities/obstacles/IObstacle';
import { RotatingHammer } from '../entities/obstacles/RotatingHammer';
import { BouncyMushroom } from '../entities/obstacles/BouncyMushroom';
import { RotatingLily } from '../entities/obstacles/RotatingLily';
import { Seesaw } from '../entities/obstacles/Seesaw';
import { PendulumVine } from '../entities/obstacles/PendulumVine';
import { RotarySweeper } from '../entities/obstacles/RotarySweeper';
import { MaterialSystem } from '../core/MaterialSystem';
import { NetworkManager } from '../network/NetworkManager';
import { UIManager } from '../ui/UIManager';
import { GameState } from '../core/GameState';
import { type LevelConfig, LEVEL_JUNGLE } from './LevelConfig';

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



  // ─── Propriétés ─────────────────────────────────────────────────────
  private scene:       Scene;
  private config:      LevelConfig;
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
  private elapsedTime: number    = 0;

  constructor(scene: Scene, config: LevelConfig = LEVEL_JUNGLE) {
    this.scene  = scene;
    this.config = config;
  }

  // ─── Initialisation ─────────────────────────────────────────────────

  /**
   * Initialise tout le contenu du niveau.
   * Appelé UNE SEULE FOIS depuis main.ts après initPhysics() et setupCamera().
   */
  setup(camera: ArcRotateCamera, shadowGenerator: ShadowGenerator | null = null): void {
    MaterialSystem.applyThemeSkyColor(this.scene, this.config);

    // Appliquer la gravité de la config
    const g = this.config.gravity;
    this.scene.getPhysicsEngine()!.setGravity(new Vector3(g.x, g.y, g.z));

    this.ui = new UIManager();

    this.createPlatforms(shadowGenerator);
    this.createDecorativeGround();
    if (this.config.theme === 'jungle') this.createVegetation();
    this.createPlayer(camera, shadowGenerator);
    this.createObstacles(shadowGenerator);
    
    if (this.config.theme === 'space') {
        const pipeline = new DefaultRenderingPipeline("defaultPipeline", true, this.scene, [camera]);
        pipeline.bloomEnabled = true;
        pipeline.bloomThreshold = 0.5;
        pipeline.bloomWeight = 0.4;
        pipeline.bloomKernel = 64;
        pipeline.bloomScale = 0.5;
    }

    this.createFinishLine();
    this.registerGameEvents();
    this.registerUpdateLoop();

    // ─ Réseau (connexion async non bloquante) ───────────────────────
    this.network = new NetworkManager(this.scene);
    
    // S'assurer que le joueur est bloqué au début
    this.player?.setInputEnabled(false);

    this.ui?.onReadyClicked(() => {
      this.network?.room?.send("ready");
    });

    this.network?.room?.onMessage("reset_level", () => {
       this.player?.respawn(); // Reset natif parfait via Havok
    });

    this.network.onStatusChange = (status) => {
       if (status === "STARTING") {
          // Optionnel : un son ou effet
       }
       if (status === "PLAYING") {
          this.ui?.hideLobby(); // Sécurité
          this.player?.setInputEnabled(true);
       }
       if (status === "FINISHED") {
          this.player?.setInputEnabled(false);
          if (this.network?.room) {
            const winnersArr = Array.from(this.network.room.state.winners) as string[];
            if (winnersArr.includes(this.network.room.sessionId)) {
              this.ui?.showGameOver(winnersArr, this.network.room.sessionId);
            } else {
              this.ui?.showEliminated();
            }
          }
       }
       if (status === "WAITING") {
          this.ui?.showLobby();
          if (this.player) {
              this.player.isQualified = false;
              this.player.respawn();
              this.player.setInputEnabled(false);
          }
          // (Assurer que le texte redevienne blanc après l'écran rouge d'élimination)
          const txt = document.getElementById('txt-countdown');
          if (txt) txt.style.color = 'white';
       }
    };
    
    this.network.onCountdownChange = (count) => {
       this.ui?.updateCountdown(count);
    };

    this.network.onQualified = (isLocal, rank) => {
       if (isLocal) {
         this.ui?.showQualified(rank);
         // Ajouter l'effet confettis ici en option
         this.launchConfetti();
         this.player?.setInputEnabled(false); 
       }
    };
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
    const groundMat = this.config.theme === 'space'
      ? MaterialSystem.createSpacePlatformMaterial(this.scene)
      : MaterialSystem.createGroundMaterial(this.scene);

    for (const cfg of this.config.platforms) {
      const platform = MeshBuilder.CreateGround(
        `platform_${cfg.name}`,
        { width: cfg.width, height: cfg.depth },
        this.scene
      );
      platform.position = new Vector3(cfg.x, 0, cfg.z);

      // Corps statique : mass:0 → non affecté par la gravité Havok
      new PhysicsAggregate(
        platform,
        PhysicsShapeType.BOX,
        { mass: 0 },
        this.scene
      );

      platform.receiveShadows = true;
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
    const platformZones = this.config.platforms.map(p => ({ z: p.z, hw: p.depth / 2 + 1 }));

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
    const { obstacles } = this.config;

    for (const def of obstacles) {
      const pos = new Vector3(def.position.x, def.position.y, def.position.z);
      switch (def.type) {
        case 'hammer': {
          const h = new RotatingHammer(this.scene, pos);
          this.obstacles.push(h);
          this.hammers.push(h);
          shadowGenerator?.addShadowCaster(h.getArmMesh(), false);
          shadowGenerator?.addShadowCaster(h.getPillarMesh(), false);
          break;
        }
        case 'lily':     this.obstacles.push(new RotatingLily(this.scene, pos)); break;
        case 'mushroom': this.obstacles.push(new BouncyMushroom(this.scene, pos)); break;
        case 'seesaw':   this.obstacles.push(new Seesaw(this.scene, pos)); break;
        case 'pendulum': this.obstacles.push(new PendulumVine(this.scene, pos)); break;
        case 'sweeper':  this.obstacles.push(new RotarySweeper(this.scene, pos)); break;
      }
    }
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
    const fz = this.config.finishZ;
    this.finishZone = MeshBuilder.CreateBox(
      'finishZone',
      { width: 6, height: 4, depth: 0.5 },
      this.scene
    );
    this.finishZone.position = new Vector3(0, 2, fz);

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

      // Créer la liste des joueurs physiques dans la scène
      const physicalPlayers: { mesh: Mesh }[] = [];
      if (this.player) physicalPlayers.push(this.player);

      // Ajouter les joueurs distants
      if (this.network) {
        this.network.getRemotePlayers().forEach((rp: any) => {
          if (rp.mesh) physicalPlayers.push(rp);
        });
      }

      // Passer la liste complète aux obstacles
      for (const obstacle of this.obstacles) {
        obstacle.update(dt, physicalPlayers);
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
        if (this.finishZone && this.player?.mesh.intersectsMesh(this.finishZone, false)) {
          if (this.network && !this.player.isQualified) {
            this.player.isQualified = true; // flag local anti spam
            if (this.network.room) {
              this.network.room.send("finish");
            }
          }
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
  private launchConfetti(): void {
    if (!this.player) return;

    const texSize = 64;
    const dynTex = new DynamicTexture("confettiTex", texSize, this.scene, false);
    const ctx = dynTex.getContext();
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, texSize, texSize);
    dynTex.update();

    const ps = new ParticleSystem("confettis", 500, this.scene);
    ps.particleTexture = dynTex;
    
    ps.emitter = this.player.mesh.position.clone().addInPlace(new Vector3(0, 2, 0));
    ps.createBoxEmitter(new Vector3(0, 1, 0), new Vector3(0, 2, 0), new Vector3(-3, 0, -3), new Vector3(3, 1, 3));
    
    ps.color1 = new Color4(1.0, 0.4, 0.8, 1.0); // Rose
    ps.color2 = new Color4(0.0, 1.0, 1.0, 1.0); // Cyan
    ps.colorDead = new Color4(1.0, 0.9, 0.0, 0.0); // Jaune

    ps.minSize = 0.1;
    ps.maxSize = 0.3;

    ps.minLifeTime = 2.0;
    ps.maxLifeTime = 3.0;

    ps.emitRate = 300;
    ps.manualEmitCount = 500;
    
    ps.minEmitPower = 2;
    ps.maxEmitPower = 5;
    ps.updateSpeed = 0.02;

    ps.gravity = new Vector3(0, -2.0, 0);

    ps.minAngularSpeed = 0;
    ps.maxAngularSpeed = Math.PI;

    ps.targetStopDuration = 3;
    ps.disposeOnStop = true;

    ps.start();
  }
}
