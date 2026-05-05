import { Client, Room } from "colyseus.js";
import {
  Scene,
  Vector3,
  Quaternion,
  MeshBuilder,
  Mesh,
  PBRMaterial,
  Color3,
  SceneLoader,
  TransformNode,
  AnimationGroup,
} from "@babylonjs/core";

/**
 * Structure d'un joueur distant : mesh 3D + cibles pour interpolation.
 * Les cibles sont mises à jour par les listen() callbacks du schema,
 * et le Lerp/Slerp dans updateRemotePlayers() fait la transition fluide.
 */
interface RemotePlayer {
  mesh: Mesh;
  targetPosition: Vector3;
  targetRotation: Quaternion;
  lastPosition: Vector3;
  animIdle?: AnimationGroup;
  animRun?: AnimationGroup;
  animFall?: AnimationGroup;
  currentAnim?: AnimationGroup;
}

/**
 * Gestionnaire de connexion réseau Colyseus.
 *
 * Sprint 9 — Responsabilités :
 *  - Se connecter au serveur Colyseus (ou échouer silencieusement)
 *  - Créer/supprimer des capsules visuelles pour les joueurs distants
 *  - Écouter les changements de position ET rotation via player.listen() (API 0.15)
 *  - Interpoler (Lerp position + Slerp rotation) les remote players chaque frame
 *  - Envoyer le transform (position + rotation) du joueur local avec throttle hybride
 *  - Nettoyer les ressources en cas de déconnexion
 *
 * Mode solo fallback :
 *   Si le serveur est indisponible, connect() catch l'erreur,
 *   affiche un warning, et le jeu continue normalement sans réseau.
 */
export class NetworkManager {
  private static readonly SERVER_URL = "ws://localhost:2567";

  // ─── Interpolation ──────────────────────────────────────
  /** Coefficient de Lerp/Slerp par frame — 0.15 = mouvement fluide à 60fps */
  private static readonly LERP_FACTOR = 0.15;
  /** Si distance > SNAP_DISTANCE → position directe, pas de Lerp (respawn distant) */
  private static readonly SNAP_DISTANCE = 5;

  // ─── Throttle d'envoi ───────────────────────────────────
  /** Intervalle minimum entre deux envois de transform (ms) — max 20 msg/sec */
  private static readonly SEND_INTERVAL = 50;
  /** Seuil de distance minimum pour déclencher un envoi (unités) */
  private static readonly SEND_THRESHOLD = 0.05;

  // ─── Propriétés ─────────────────────────────────────────
  private scene: Scene;
  public room: Room | null = null;
  private remotePlayers: Map<string, RemotePlayer> = new Map();

  public onQualified: (isLocal: boolean, rank: number) => void = () => { };
  public onStatusChange: (status: string) => void = () => { };
  public onCountdownChange: (count: number) => void = () => { };
  public onGameOver: (winners: string[]) => void = () => { };
  public onLevelChange: (levelName: string) => void = () => { };
  public onResetLevel: () => void = () => { };
  public onVotesChange: (votes: Record<string, number>) => void = () => { };
  public onScoresChange: (scores: Record<string, number>) => void = () => {};
  public onRemainingTimeChange: (time: number) => void = () => {};
  public onScoreChange: (score: number) => void = () => {};
  public onPlayersListChange: () => void = () => {};

  /** Dernière position envoyée au serveur — pour le seuil de distance */
  private lastSentPosition: Vector3 = Vector3.Zero();
  /** Timestamp du dernier envoi — pour le seuil temporel */
  private lastSendTime: number = 0;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  public sendReadyState(): void {
    if (!this.room) return;
    console.log('🟦 [NET] Sending ready state to server');
    this.room.send("ready");
  }

  public sendEliminate(): void {
    if (!this.room) return;
    this.room.send("eliminate");
  }

  public sendCollect(): void {
    if (!this.room) return;
    this.room.send("collect");
  }

  // ─── Connexion ─────────────────────────────────────────
  /**
   * Tente de se connecter au serveur Colyseus.
   * Si le serveur est indisponible, le jeu continue en mode solo.
   * Cette méthode NE DOIT PAS être await dans GameLevel.setup()
   * (fire & forget — le jeu démarre immédiatement).
   */
  async connect(): Promise<void> {
    try {
      console.log(`🟦 [NET] Connecting to ${NetworkManager.SERVER_URL} (room: game_room)…`);
      const client = new Client(NetworkManager.SERVER_URL);
      this.room = await client.joinOrCreate("game_room");

      console.log(
        `🟩 [NET] Connected — sessionId: ${this.room.sessionId}`
      );

      this.setupStateListeners();
    } catch (error) {
      console.warn(
        "🟨 [NET] Could not connect — Mode Solo activé",
        error
      );
      // Le jeu continue normalement sans réseau.
      // Aucun crash, aucun blocage.
    }
  }

  // ─── Listeners d'état ──────────────────────────────────

  /**
   * Configure les callbacks de synchronisation d'état.
   *
   * ATTENTION — Signature Colyseus 0.15 :
   *   players.onAdd((player, key) => {...})   ← APPEL DE MÉTHODE
   *   PAS players.onAdd = (player, key) => {...}  ← ANCIEN (0.14)
   *
   * PIÈGE CRITIQUE — listen() vs onChange() :
   *   player.onChange((changes) => {...})  ← ANCIEN 0.14 — NE FONCTIONNE PLUS
   *   player.listen("x", (val) => {...})  ← CORRECT 0.15
   *
   * onAdd est exécuté IMMÉDIATEMENT pour tous les joueurs déjà
   * connectés quand ce client rejoint la room. On filtre le
   * joueur local via room.sessionId.
   */
  private setupStateListeners(): void {
    if (!this.room) return;

    const room = this.room;  // capture pour les closures

    room.state.listen("status", (newStatus: string) => {
      this.onStatusChange(newStatus);
      console.log('🟦 [NET] status:', newStatus);
      if (newStatus === "FINISHED") {
        const winners = Array.from(room.state.winners as unknown as Iterable<string>);
        this.onGameOver(winners);
      }
    });
    room.state.listen("countdown", (newCount: number) => {
      this.onCountdownChange(newCount);
    });
    room.state.listen("currentLevel", (newLevel: string) => {
      this.onLevelChange(newLevel);
    });

    // Écouter les votes de tous les joueurs (Sprint 18)
    const updateVotes = () => {
      const votes: Record<string, number> = {};
      room.state.players.forEach((p: { votedLevel?: string }) => {
        if (p.votedLevel) {
          votes[p.votedLevel] = (votes[p.votedLevel] || 0) + 1;
        }
      });
      this.onVotesChange(votes);
    };

    room.onMessage("reset_level", () => {
      this.onResetLevel();
    });

    // Écouter les scores globaux (Sprint 21)
    const updateScores = () => {
      const scores: Record<string, number> = {};
      room.state.globalScores.forEach((value: number, key: string) => { scores[key] = value; });
      this.onScoresChange(scores);
    };
    room.state.globalScores.onAdd(() => updateScores());
    room.state.globalScores.onChange(() => updateScores());

    room.state.listen("remainingTime", (newTime: number) => {
      this.onRemainingTimeChange(newTime);
    });

    room.state.winners.onAdd((sessionId: string, index: number) => {
      const isLocal = sessionId === room.sessionId;
      this.onQualified(isLocal, index + 1);
    });

    // ─ Nouveau joueur ──────────────────────────────────
    room.state.players.onAdd((player: any, sessionId: string) => {
      this.onPlayersListChange(); // MAJ LIGNE DE DÉPART

      // Listeners communs (Local + Remote)
      player.listen("roundScore", (val: number) => {
        if (sessionId === room.sessionId) this.onScoreChange(val);
      });
      player.listen("votedLevel", () => updateVotes());

      // Ignorer le joueur LOCAL pour la suite (capsule 3D)
      if (sessionId === room.sessionId) return;

      console.log(`👤 Remote player joined: ${sessionId}`);

      // ─ Création du collider mesh (invisible) ──────────────────────────────
      const mesh = MeshBuilder.CreateCapsule(
        `remote_${sessionId}`,
        {
          height: 2,
          radius: 0.5,
          tessellation: 16,
          subdivisions: 2,
          capSubdivisions: 6,
        },
        this.scene
      );
      mesh.isVisible = false; // Le collider est invisible

      // Position initiale reçue du serveur
      mesh.position = new Vector3(player.x, player.y, player.z);

      // ⚠️ CRITIQUE — initialiser rotationQuaternion (null par défaut)
      mesh.rotationQuaternion = new Quaternion(
        player.rx, player.ry, player.rz, player.rw
      );

      // ─ Ancre visuelle (Taille Minion) ──────────────────
      const visualAnchor = new TransformNode(`anchor_${sessionId}`, this.scene);
      visualAnchor.parent = mesh;
      visualAnchor.scaling.setAll(0.08);

      // ─ Chargement du modèle Minion (HVGirl) ─────────────
      SceneLoader.ImportMeshAsync(null, "https://models.babylonjs.com/", "HVGirl.glb", this.scene).then((result) => {
        const root = result.meshes[0];
        root.parent = visualAnchor;
        root.rotation.y = Math.PI; // Faire face à Z+

        // Coloriser pour différencier les joueurs
        const hue = (parseInt(sessionId.substring(0, 4), 16) % 360);
        const mat = new PBRMaterial(`mat_remote_${sessionId}`, this.scene);
        mat.albedoColor = Color3.FromHSV(hue, 0.8, 1);
        mat.metallic = 0.2;
        mat.roughness = 0.4;
        
        result.meshes.forEach(m => {
          if (m.name.includes("Head") || m.name.includes("Body") || m.name.includes("Arm")) {
             (m as Mesh).material = mat;
          }
          m.renderingGroupId = 1;
        });

        // Animations de base
        const idle = result.animationGroups.find(ag => ag.name === 'Idle');
        if (idle) idle.play(true);

        const rp = this.remotePlayers.get(sessionId);
        if (rp) {
            rp.animIdle = result.animationGroups.find(ag => ag.name === 'Idle') || undefined;
            rp.animRun = result.animationGroups.find(ag => ag.name === 'Run') || undefined;
            rp.animFall = result.animationGroups.find(ag => (ag.name === 'Fall' || ag.name === 'Falling')) || undefined;
            rp.currentAnim = rp.animIdle;
            if (rp.currentAnim) rp.currentAnim.play(true);
        }
      });

      // ─ Structure RemotePlayer avec targets ────────────
      const remote: RemotePlayer = {
        mesh,
        targetPosition: new Vector3(player.x, player.y, player.z),
        targetRotation: new Quaternion(player.rx, player.ry, player.rz, player.rw),
        lastPosition: new Vector3(player.x, player.y, player.z),
      };
      this.remotePlayers.set(sessionId, remote);

      // ─ Position listeners (API 0.15 — listen par propriété) ──
      player.listen("x", (newX: number) => {
        const rp = this.remotePlayers.get(sessionId);
        if (rp) rp.targetPosition.x = newX;
      });
      player.listen("y", (newY: number) => {
        const rp = this.remotePlayers.get(sessionId);
        if (rp) rp.targetPosition.y = newY;
      });
      player.listen("z", (newZ: number) => {
        const rp = this.remotePlayers.get(sessionId);
        if (rp) rp.targetPosition.z = newZ;
      });

      // ─ Rotation listeners (API 0.15 — listen par propriété) ──
      player.listen("rx", (val: number) => {
        const rp = this.remotePlayers.get(sessionId);
        if (rp) rp.targetRotation.x = val;
      });
      player.listen("ry", (val: number) => {
        const rp = this.remotePlayers.get(sessionId);
        if (rp) rp.targetRotation.y = val;
      });
      player.listen("rz", (val: number) => {
        const rp = this.remotePlayers.get(sessionId);
        if (rp) rp.targetRotation.z = val;
      });
      player.listen("rw", (val: number) => {
        const rp = this.remotePlayers.get(sessionId);
        if (rp) rp.targetRotation.w = val;
      });

      player.listen("votedLevel", () => {
        updateVotes();
      });

      // Déclencher un update initial si le joueur a déjà voté
      if (player.votedLevel) updateVotes();
    });

    // IMPORTANT : Également écouter le joueur LOCAL pour ses propres votes
    room.state.players.onAdd((player: any, sessionId: string) => {
      if (sessionId !== room.sessionId) return;
      player.listen("votedLevel", () => {
        updateVotes();
      });
    });

    // ─ Joueur déconnecté ───────────────────────────────
    room.state.players.onRemove((_player: any, sessionId: string) => {
      this.onPlayersListChange();
      console.log(`👋 Remote player left: ${sessionId}`);
      const remote = this.remotePlayers.get(sessionId);
      if (remote) {
        remote.mesh.material?.dispose();
        remote.mesh.dispose();
        this.remotePlayers.delete(sessionId);
      }
    });

    // ─ Déconnexion du serveur ──────────────────────────
    room.onLeave((code: number) => {
      console.warn(`🔌 Disconnected from server (code: ${code})`);
      this.disposeAllRemotePlayers();
      this.room = null;
    });
  }

  // ─── Interpolation des joueurs distants ────────────────

  /**
   * Interpole les capsules distantes vers leur position et rotation cible.
   * Appelé chaque frame depuis GameLevel.registerUpdateLoop().
   *
   * Position (Lerp) :
   *  - Distance > SNAP_DISTANCE → snap direct (respawn distant)
   *  - Distance > 0.001 → Lerp fluide vers la cible
   *
   * Rotation (Slerp) :
   *  - |dot| > 0.9999 → quasi-identique, skip
   *  - dot < 0 → shortest path fix (copie inversée)
   *  - Slerp in-place avec même coefficient que position
   *
   * @param _dt DeltaTime (non utilisé — coefficients fixes pour la simplicité)
   */
  updateRemotePlayers(_dt: number): void {
    for (const [, remote] of this.remotePlayers) {
      // ─ POSITION (Lerp) ───────────────────────────────
      const distance = Vector3.Distance(
        remote.mesh.position, remote.targetPosition
      );

      if (distance > NetworkManager.SNAP_DISTANCE) {
        // Snap : le joueur distant s'est téléporté (respawn après OOB)
        remote.mesh.position.copyFrom(remote.targetPosition);
      } else if (distance > 0.001) {
        // Lerp : mouvement fluide vers la cible
        Vector3.LerpToRef(
          remote.mesh.position,
          remote.targetPosition,
          NetworkManager.LERP_FACTOR,
          remote.mesh.position  // résultat écrit in-place
        );
      }

      // ─ ROTATION (Slerp) ──────────────────────────────
      if (remote.mesh.rotationQuaternion) {
        const dot = Quaternion.Dot(
          remote.mesh.rotationQuaternion,
          remote.targetRotation
        );

        // Si les quaternions sont quasi-identiques → skip
        if (Math.abs(dot) > 0.9999) continue;

        // Fix "shortest path" : si dot < 0, utiliser une copie
        // inversée pour que le Slerp prenne le chemin court (< 180°).
        // On utilise .scale(-1) (copie) au lieu de .scaleInPlace(-1)
        // pour ne pas muter targetRotation (qui sera ré-écrite par
        // les listen() callbacks au prochain patch serveur).
        const slerpTarget = dot < 0
          ? remote.targetRotation.scale(-1)
          : remote.targetRotation;

        // Slerp in-place (0 allocation sauf cas dot < 0, rare)
        Quaternion.SlerpToRef(
          remote.mesh.rotationQuaternion,
          slerpTarget,
          NetworkManager.LERP_FACTOR,
          remote.mesh.rotationQuaternion
        );
      }

      // ─ ANIMATIONS (Sync visuelle) ────────────────────
      // Calcul de la vitesse réelle (distance parcourue ce frame)
      const moveDistance = Vector3.Distance(remote.lastPosition, remote.mesh.position);
      const velocityY = remote.mesh.position.y - remote.lastPosition.y;
      remote.lastPosition.copyFrom(remote.mesh.position);

      let targetAnim = remote.animIdle;

      // Logique simple d'état
      if (velocityY < -0.05) {
          targetAnim = remote.animFall;
      } else if (moveDistance > 0.01) {
          targetAnim = remote.animRun;
      }

      // Transition fluide si l'animation change
      if (targetAnim && targetAnim !== remote.currentAnim) {
          remote.currentAnim?.stop();
          remote.currentAnim = targetAnim;
          remote.currentAnim.play(true);
      }
    }
  }

  /**
   * Retourne la liste des joueurs distants.
   */
  getRemotePlayers(): any[] {
    return Array.from(this.remotePlayers.values());
  }

  // ─── Sérialisation du Transform ────────────────────────

  /**
   * Envoie la position ET la rotation du joueur local au serveur.
   * Throttle HYBRIDE :
   *  - N'envoie PAS si le dernier envoi date de < SEND_INTERVAL ms
   *  - N'envoie PAS si la distance < SEND_THRESHOLD (joueur immobile)
   *  - N'envoie PAS si pas de room connectée (mode solo)
   *
   * Le throttle par distance suffit pour couvrir la rotation car
   * la rotation du joueur ne change QUE quand il bouge (Sprint 8).
   *
   * @param position Position actuelle (Vector3)
   * @param rotation Rotation actuelle (Quaternion) — peut être null
   */
  sendTransform(position: Vector3, rotation: Quaternion | null): void {
    if (!this.room) return;  // Mode solo — no-op silencieux

    const now = performance.now();
    if (now - this.lastSendTime < NetworkManager.SEND_INTERVAL) return;

    const distance = Vector3.Distance(position, this.lastSentPosition);
    if (distance < NetworkManager.SEND_THRESHOLD) return;

    this.room.send("transform", {
      x: position.x,
      y: position.y,
      z: position.z,
      rx: rotation ? rotation.x : 0,
      ry: rotation ? rotation.y : 0,
      rz: rotation ? rotation.z : 0,
      rw: rotation ? rotation.w : 1,
    });

    this.lastSentPosition.copyFrom(position);
    this.lastSendTime = now;
  }

  sendVote(levelId: string): void {
    if (!this.room) return;
    this.room.send("vote_level", { level: levelId });
  }

  sendForceLobby(): void {
    if (!this.room) return;
    this.room.send("force_lobby");
  }

  // ─── Nettoyage ─────────────────────────────────────────

  private disposeAllRemotePlayers(): void {
    for (const [, remote] of this.remotePlayers) {
      remote.mesh.material?.dispose();
      remote.mesh.dispose();
    }
    this.remotePlayers.clear();
  }

  dispose(): void {
    this.room?.leave();
    this.disposeAllRemotePlayers();
  }
}
