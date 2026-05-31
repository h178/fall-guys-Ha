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
  Texture,
  Color4,
  DefaultRenderingPipeline,
} from '@babylonjs/core';
import { PlayerController } from '../entities/PlayerController';
import { Game } from '../core/Game';
import type { IObstacle } from '../entities/obstacles/IObstacle';
import { RotatingHammer } from '../entities/obstacles/RotatingHammer';
import { BouncyMushroom } from '../entities/obstacles/BouncyMushroom';
import { RotatingLily } from '../entities/obstacles/RotatingLily';
import { Seesaw } from '../entities/obstacles/Seesaw';
import { PendulumVine } from '../entities/obstacles/PendulumVine';
import { RotarySweeper } from '../entities/obstacles/RotarySweeper';
import { JumpPad } from '../entities/obstacles/JumpPad';
import { SlidingWall } from '../entities/obstacles/SlidingWall';
import { TrapTile } from '../entities/obstacles/TrapTile';
import { MaterialSystem } from '../core/MaterialSystem';
import { NetworkManager } from '../network/NetworkManager';
import { UIManager } from '../ui/UIManager';
import { GameState } from '../core/GameState';
import { type LevelConfig, LEVEL_JUNGLE, LEVEL_SPACE, LEVEL_PARK, LEVEL_ICE } from './LevelConfig';

const LEVEL_MAP: Record<string, LevelConfig> = {
  jungle: LEVEL_JUNGLE,
  space:  LEVEL_SPACE,
  park:   LEVEL_PARK,
  ice:    LEVEL_ICE,
};

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
  // ─── Web Audio (musique procédurale) ──────────────────────────────
  private audioCtx:    AudioContext | null      = null;
  private beatInterval: ReturnType<typeof setInterval> | null = null;
  private beatBpm:     number                  = 128;
  private obstacles:   IObstacle[]             = [];
  private hammers:     RotatingHammer[]        = [];
  private network:     NetworkManager | null   = null;
  private platforms:   Mesh[]                  = [];
  private finishZone:  Mesh | null             = null;
  private ui:          UIManager | null        = null;
  private decorativeGround: Mesh | null        = null;
  private vegetationMeshes: Mesh[]             = [];
  private collectibles: Mesh[]                 = [];

  // ─── Machine à états ────────────────────────────────────────────────
  private state:       GameState = GameState.MENU;
  private elapsedTime: number    = 0;

  // ─── Setup Context (V1.7) ───────────────────────────────────────────
  private lastCamera: ArcRotateCamera | null = null;
  private lastShadowGenerator: ShadowGenerator | null = null;
  private lastGame: Game | null = null;

  constructor(scene: Scene, config: LevelConfig = LEVEL_JUNGLE) {
    this.scene  = scene;
    this.config = config;
  }

  // ─── Initialisation ─────────────────────────────────────────────────

  /**
   * Initialise tout le contenu du niveau.
   * Appelé UNE SEULE FOIS depuis main.ts après initPhysics() et setupCamera().
   */
  setup(camera: ArcRotateCamera, shadowGenerator: ShadowGenerator | null = null, game?: Game): void {
    MaterialSystem.applyThemeSkyColor(this.scene, this.config);

    // Appliquer la gravité de la config
    const g = this.config.gravity;
    this.scene.getPhysicsEngine()!.setGravity(new Vector3(g.x, g.y, g.z));

    this.ui = new UIManager();
    console.log('🟦 [LEVEL] UIManager ready', Date.now());

    // Afficher l'écran d'accueil contextuel au démarrage
    this.ui.showIntro();

    // ─ Post-Processing Pipeline (Sprint 25) ──────────────────────
    const pipeline = new DefaultRenderingPipeline("defaultPipeline", true, this.scene, [camera]);
    pipeline.samples = 4; // MSAA 4x
    pipeline.fxaaEnabled = true;
    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 0.8;
    pipeline.bloomWeight = 0.3;
    
    // SSAO 2 (Ombres de contact) - nécessite SSAO2RenderingPipeline séparé
    // pipeline.ssaoEnabled = true;
    // pipeline.ssaoRatio = 0.5;
    
    // Tone Mapping (ACES)
    pipeline.imageProcessingEnabled = true;
    pipeline.imageProcessing.toneMappingEnabled = true;
    pipeline.imageProcessing.toneMappingType = 1; // ACES

    this.lastCamera = camera;
    this.lastShadowGenerator = shadowGenerator;
    this.lastGame = game ?? null;

    // ─ Réseau (Cœur de la synchro) ──────────────────────────────────
    this.network = new NetworkManager(this.scene);
    
    this.network.onResetLevel = () => {
        // Forcer la reconstruction complète des meshes pour réinitialiser les pièges (TrapTiles, etc.)
        const sLevel = this.network?.room?.state?.currentLevel || this.config.theme;
        this.reloadLevel(sLevel);
        
        // S'assurer que le joueur est bien remis au spawn
        this.player?.respawn();
    };

    this.network.onVotesChange = (votes) => {
        this.ui?.updateVotes(votes);
    };

    this.network.onScoresChange = (scores) => {
        const localId = this.network?.room?.sessionId || "";
        this.ui?.updateLeaderboard(scores, localId);
    };

    this.network.onLevelChange = (newLevel) => {
        console.log(`🟦 [GAME] Niveau changé via vote : ${newLevel}`);
        this.reloadLevel(newLevel);
        this.alignPlayerOnGrid(); // MAJ au lieu de simple respawn
    };

    this.network.onStatusChange = (status) => {
        if (status === "WAITING") {
            this.ui?.hideMenu();   // ← CRITIQUE : cacher le menu pour débloquer le lobby
            this.ui?.showLobby();
            
            // Check rotation de niveau (V1.7)
            const newLevel = this.network?.room?.state?.currentLevel;
            if (newLevel && LEVEL_MAP[newLevel] && newLevel !== this.config.theme) {
              console.log(`🔄 [LEVEL] Rotating to ${newLevel}`);
              this.reloadLevel(newLevel);
              return;
            }

            if (this.player) {
                this.player.isQualified = false;
                this.alignPlayerOnGrid(); // MAJ au lieu de simple respawn
                this.player.setInputEnabled(false);
            }
        }
        if (status === "STARTING" && this.state !== GameState.STARTING) {
            this.state = GameState.STARTING;
            this.ui?.showCountdown();
            this.beatBpm = 128;
            this.startBeat(); // 🎵 Lancer la musique procédurale
            this.alignPlayerOnGrid();
        }
        if (status === "PLAYING") {
            this.beatBpm = 128; // Retour BPM normal au GO!
            // Afficher "GO!" pendant 1 seconde avant de cacher le lobby
            if (this.ui) {
                this.ui.hideReadyButton();
                const txt = document.getElementById('txt-countdown');
                if (txt) txt.innerText = "GO!";
                setTimeout(() => {
                    this.ui?.hideLobby();
                }, 1000);
            }
            this.startGame(); 
        }
        if (status === "FINISHED") {
            this.stopBeat(); // 🔇 Arrêt de la musique
            this.player?.setInputEnabled(false);
        }
    };

    this.network.onCountdownChange = (count) => {
        if (count > 0) {
            this.ui?.updateCountdown(count);
            // Le beat s'accélère pendant le compte à rebours (128 → 180 BPM)
            this.beatBpm = 128 + (5 - count) * 13;
        }
    };

    this.network.onQualified = (isLocal, rank) => {
        if (isLocal) {
            this.player!.isQualified = true;
            this.ui?.showQualified(rank);
            this.launchConfetti();
            this.player?.setInputEnabled(false);
        }
    };

    this.network.onGameOver = (winners) => {
        const sessionId = this.network?.room?.sessionId;
        if (!sessionId) return;
        this.ui?.showGameOver(winners, sessionId);
    };

    this.network.onPlayersListChange = () => {
        const serverStatus = this.network?.room?.state?.status;
        if (serverStatus === "WAITING" || serverStatus === "STARTING") {
            this.alignPlayerOnGrid();
        }
    };

    this.network.connect(); // Lancer la connexion Colyseus

    // Construction du contenu initial (Tâche 1 - BuildScene)
    this.buildScene(camera, shadowGenerator);

    this.registerGameEvents();
    this.registerUpdateLoop();

    // État initial (Local)
    this.state = GameState.MENU;
    this.player?.setInputEnabled(false);
  }

  private buildScene(camera: ArcRotateCamera, shadowGenerator: ShadowGenerator | null): void {
    const maxZ = Math.max(...this.config.platforms.map(p => p.z + p.depth / 2));
    if (this.lastGame) this.lastGame.updateShadowFrustum(maxZ);

    this.createPlatforms(shadowGenerator);
    this.createDecorativeGround();
    this.createObstacles(shadowGenerator);
    if (this.config.theme === 'jungle') this.createVegetation();
    this.createPlayer(camera, shadowGenerator);

    if (this.config.mode === 'race') {
      this.createFinishLine();
    } else if (this.config.mode === 'collect') {
      this.createCollectibles(shadowGenerator);
    }

    // Particules environnementales (Sprint 25)
    this.spawnParticles();
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
    const groundMat = MaterialSystem.getThemeMaterial(this.scene, this.config.theme, 'platform');

    for (const cfg of this.config.platforms) {
      let platform: Mesh;
      let shapeType: PhysicsShapeType;

      // Détection des plateformes sphériques "modernes"
      if (cfg.name.includes('sphere')) {
        platform = MeshBuilder.CreateSphere(
          `platform_${cfg.name}`,
          { diameterX: cfg.width, diameterY: 4, diameterZ: cfg.depth, segments: 32 },
          this.scene
        );
        // On la descend un peu pour que le sommet soit à Y=0
        platform.position = new Vector3(cfg.x, -2, cfg.z);
        shapeType = PhysicsShapeType.SPHERE;
      } else {
        platform = MeshBuilder.CreateGround(
          `platform_${cfg.name}`,
          { width: cfg.width, height: cfg.depth },
          this.scene
        );
        platform.position = new Vector3(cfg.x, 0, cfg.z);
        shapeType = PhysicsShapeType.BOX;
      }

      new PhysicsAggregate(
        platform,
        shapeType,
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
    this.player = new PlayerController(this.scene, camera, new Vector3(0, 2, 0));
    // setThemePhysics() configure isOnIce, currentLevelTheme et tout profil futur
    this.player.setThemePhysics(this.config.theme);
    shadowGenerator?.addShadowCaster(this.player.getMesh(), false);
    console.log('🟩 [PLAYER INIT] Position:', this.player.getMesh().position.toString());
    console.log('🟩 [CAM] After player create', {
      alpha: camera.alpha,
      beta: camera.beta,
      radius: camera.radius,
      target: camera.target.toString(),
    });
    this.player.forceVisualSanity();
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
    const mat = MaterialSystem.getThemeMaterial(this.scene, this.config.theme, 'ground');
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
      let obstacle: IObstacle | null = null;
      const pos = new Vector3(def.position.x, def.position.y, def.position.z);
      switch (def.type) {
        case 'hammer': {
          const h = new RotatingHammer(this.scene, pos);
          this.hammers.push(h);
          obstacle = h;
          shadowGenerator?.addShadowCaster(h.getArmMesh(), false);
          shadowGenerator?.addShadowCaster(h.getPillarMesh(), false);
          break;
        }
        case 'lily':        obstacle = new RotatingLily(this.scene, pos); break;
        case 'mushroom':    obstacle = new BouncyMushroom(this.scene, pos); break;
        case 'seesaw':      obstacle = new Seesaw(this.scene, pos); break;
        case 'pendulum':    obstacle = new PendulumVine(this.scene, pos); break;
        case 'sweeper':     obstacle = new RotarySweeper(this.scene, pos); break;
        case 'jumppad':     obstacle = new JumpPad(this.scene, pos); break;
        case 'slidingwall': obstacle = new SlidingWall(this.scene, pos); break;
        case 'traptile':    obstacle = new TrapTile(this.scene, pos, this.config.theme); break;
        default: console.warn(`[GameLevel] Unknown obstacle type: "${def.type}"`);
      }
      if (obstacle) this.obstacles.push(obstacle);
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

  // ─── Musique procédurale Web Audio ────────────────────────────────────

  /**
   * Génère un kick drum synthétique via WebAudio.
   * Pas de fichier audio requis — 100% garanti de fonctionner !
   */
  private playKick(): void {
    if (!this.audioCtx) return;
    const ctx = this.audioCtx;
    const now = ctx.currentTime;

    // Oscillateur de basse fréquence (kick)
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(0.01, now + 0.3);
    gain.gain.setValueAtTime(1.0, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.start(now);
    osc.stop(now + 0.4);
  }

  /** Génère un hi-hat synthétique */
  private playHihat(): void {
    if (!this.audioCtx) return;
    const ctx = this.audioCtx;
    const now = ctx.currentTime;

    const bufferSize = ctx.sampleRate * 0.05;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(now);
  }

  /** Lance le beat en boucle avec le BPM courant */
  private startBeat(): void {
    // AudioContext doit être créé après un geste utilisateur (bouton PRÊT)
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    this.stopBeat(); // Sécurité : stoppe l'ancien intervalle si existant

    let tick = 0;
    const schedule = () => {
      const msPerBeat = 60000 / this.beatBpm;
      this.playKick();
      if (tick % 2 === 1) this.playHihat(); // Hi-hat sur les temps pairs
      tick++;

      // Re-schedule avec le BPM mis à jour (pour l'accélération)
      this.beatInterval = setTimeout(schedule, msPerBeat);
    };
    schedule();
  }

  /** Arrête le beat */
  private stopBeat(): void {
    if (this.beatInterval !== null) {
      clearTimeout(this.beatInterval);
      this.beatInterval = null;
    }
  }


  private alignPlayerOnGrid(): void {
    if (!this.player || !this.network?.room) return;

    // Récupérer et trier les IDs pour avoir un index déterministe (le même pour tous)
    const sessionIds = Array.from(this.network.room.state.players.keys());
    sessionIds.sort(); 
    
    const myIndex = sessionIds.indexOf(this.network.room.sessionId);
    if (myIndex === -1) return;

    // Grille de départ : 4 joueurs par ligne, espacés de 2 unités
    const cols = 4;
    const col = myIndex % cols;
    const row = Math.floor(myIndex / cols);

    const offsetX = (col - (cols - 1) / 2) * 2; // Centre la ligne autour de X=0
    const offsetZ = -row * 2; // Les lignes s'empilent vers l'arrière (Z-)

    const baseSpawn = this.config.spawnPoint;
    // On met à jour le spawnPoint officiel de l'instance locale
    this.player.spawnPoint = new Vector3(baseSpawn.x + offsetX, baseSpawn.y, baseSpawn.z + offsetZ);
    this.player.respawn(); // Téléportation immédiate sur la grille
  }

  // ─── Machine à états ─────────────────────────────────────────────────

  /**
   * Enregistre les callbacks UI → états du jeu.
   * Le bouton JOUER n'est actif que depuis l'état MENU.
   */
   private registerGameEvents(): void {
    console.log('🟦 [UI] registerGameEvents() wiring');
    this.ui?.onPlayClicked(() => {
      if (this.state !== GameState.MENU) return;
      this.ui?.showLobby();
      this.ui?.hideMenu();
    });

    this.ui?.onReadyClicked(() => {
        console.log('🟩 [UI] Ready callback (GameLevel)');
        try {
          const room = this.network?.room;
          if (!room) {
            console.error('🟥 [NETWORK] room undefined au clic PRÊT');
            return;
          }
          room.send("ready");
          console.log('🟩 [NETWORK] Message ready envoyé au serveur');
        } catch (e) {
          console.error('🟥 [NETWORK] Erreur lors de l\'envoi de ready:', e);
        }
    });

    if (this.ui) {
      this.ui.onVoteCallback = (levelId) => {
        console.log(`🟩 [UI] Vote pour ${levelId}`);
        this.network?.sendVote(levelId);
      };

      this.ui.onForceLobbyCallback = () => {
        this.network?.sendForceLobby();
      };
    }

    this.ui?.onReplayClicked(() => {
        this.network?.room?.send("replay");
    });

    if (this.player) {
      this.player.currentMode = this.config.mode;
      this.player.onEliminated = () => {
        this.network?.sendEliminate();
        this.ui?.showEliminated();
      };
    }

    if (this.network) {
      this.network.onRemainingTimeChange = (time) => {
        if (this.config.mode === 'survival') {
          this.ui?.updateSurvivalTimer(time);
        } else {
          this.ui?.updateGlobalTimer(time);
        }
      };
      this.network.onScoreChange = (score) => {
        if (this.config.mode === 'collect') this.ui?.updateScore(score, this.config.targetScore || 5);
      };
    }
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

        // ─ MODE COLLECT : Détection objets ──────────────────────
        if (this.config.mode === 'collect') {
          for (let i = this.collectibles.length - 1; i >= 0; i--) {
            const c = this.collectibles[i];
            if (this.player?.mesh.intersectsMesh(c, false)) {
              this.network?.sendCollect();
              c.dispose();
              this.collectibles.splice(i, 1);
              // Repop aléatoire pour garder le niveau vivant
              this.spawnOneCollectible(this.lastShadowGenerator);
            }
          }
        }

        // Détection ligne d'arrivée via AABB (intersectsMesh, pas de physique)
        if (this.config.mode === 'race' && this.finishZone && this.player?.mesh.intersectsMesh(this.finishZone, false)) {
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

  private createCollectibles(shadowGenerator: ShadowGenerator | null): void {
    const count = 8;
    for (let i = 0; i < count; i++) {
      this.spawnOneCollectible(shadowGenerator);
    }
  }

  private spawnOneCollectible(shadowGenerator: ShadowGenerator | null): void {
    const star = MeshBuilder.CreatePolyhedron("star", { type: 1, size: 0.5 }, this.scene);
    const mat = new StandardMaterial("starMat", this.scene);
    mat.emissiveColor = new Color3(1, 0.8, 0);
    star.material = mat;

    // Position sur une plateforme au hasard (sauf spawn)
    const platIdx = Math.floor(Math.random() * (this.config.platforms.length - 1)) + 1;
    const plat = this.config.platforms[platIdx];
    // Marge de sécurité pour ne pas mettre les étoiles au bord du précipice
    const marginX = plat.width > 4 ? 4 : 2;
    const marginZ = plat.depth > 4 ? 4 : 2;
    
    star.position.set(
      plat.x + (Math.random() - 0.5) * (plat.width - marginX),
      1.5,
      plat.z + (Math.random() - 0.5) * (plat.depth - marginZ)
    );

    // Animation de rotation
    this.scene.onBeforeRenderObservable.add(() => {
      star.rotation.y += 0.05;
    });

    shadowGenerator?.addShadowCaster(star);
    this.collectibles.push(star);
  }

  private spawnParticles(): void {
    if (this.config.theme === 'ice') {
      // Tempête de neige
      const snow = new ParticleSystem("snow", 1000, this.scene);
      snow.particleTexture = new Texture("https://playground.babylonjs.com/textures/flare.png", this.scene);
      snow.emitter = new Vector3(0, 15, 25);
      snow.minEmitBox = new Vector3(-20, 0, -30);
      snow.maxEmitBox = new Vector3(20, 0, 30);
      snow.color1 = new Color4(1, 1, 1, 0.8);
      snow.minSize = 0.1;
      snow.maxSize = 0.3;
      snow.minLifeTime = 2;
      snow.maxLifeTime = 5;
      snow.emitRate = 200;
      snow.gravity = new Vector3(0, -1, 0);
      snow.direction1 = new Vector3(-1, -1, -1);
      snow.direction2 = new Vector3(1, -1, 1);
      snow.start();
    } else if (this.config.theme === 'jungle') {
      // Lucioles
      const flies = new ParticleSystem("flies", 100, this.scene);
      flies.particleTexture = new Texture("https://playground.babylonjs.com/textures/flare.png", this.scene);
      flies.emitter = new Vector3(0, 5, 20);
      flies.minEmitBox = new Vector3(-15, -5, -20);
      flies.maxEmitBox = new Vector3(15, 5, 20);
      flies.color1 = new Color4(0.8, 1, 0.2, 0.8);
      flies.minSize = 0.05;
      flies.maxSize = 0.1;
      flies.emitRate = 20;
      flies.start();
    }
  }

  // ─── Nettoyage ──────────────────────────────────────────────────────

  dispose(): void {
    this.network?.dispose();
    this.clearSceneMeshes();
  }

  private clearSceneMeshes(): void {
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
    for (const c of this.collectibles) {
      c.dispose();
    }
    this.collectibles = [];
    this.vegetationMeshes = [];
    this.platforms = [];
    this.obstacles = [];
    this.hammers = [];
  }

  public reloadLevel(levelName: string): void {
    console.log(`🔃 [LEVEL] Reloading to ${levelName}...`);
    this.clearSceneMeshes();
    this.config = LEVEL_MAP[levelName] || LEVEL_JUNGLE;
    
    if (this.lastCamera) {
        // Mettre à jour la couleur du ciel et la gravité
        MaterialSystem.applyThemeSkyColor(this.scene, this.config);
        const g = this.config.gravity;
        this.scene.getPhysicsEngine()!.setGravity(new Vector3(g.x, g.y, g.z));
        // Reconstruire uniquement les meshes
        this.buildScene(this.lastCamera, this.lastShadowGenerator);
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
