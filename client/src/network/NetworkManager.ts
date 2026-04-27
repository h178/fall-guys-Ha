import { Client, Room } from "colyseus.js";
import {
  Scene,
  Vector3,
  Quaternion,
  MeshBuilder,
  Mesh,
  PBRMaterial,
  Color3,
} from "@babylonjs/core";

/**
 * Structure d'un joueur distant : mesh 3D + cibles pour interpolation.
 * Les cibles sont mises à jour par les listen() callbacks du schema,
 * et le Lerp/Slerp dans updateRemotePlayers() fait la transition fluide.
 */
interface RemotePlayer {
  mesh:           Mesh;
  targetPosition: Vector3;
  targetRotation: Quaternion;
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
  private static readonly LERP_FACTOR   = 0.15;
  /** Si distance > SNAP_DISTANCE → position directe, pas de Lerp (respawn distant) */
  private static readonly SNAP_DISTANCE = 5;

  // ─── Throttle d'envoi ───────────────────────────────────
  /** Intervalle minimum entre deux envois de transform (ms) — max 20 msg/sec */
  private static readonly SEND_INTERVAL  = 50;
  /** Seuil de distance minimum pour déclencher un envoi (unités) */
  private static readonly SEND_THRESHOLD = 0.05;

  // ─── Propriétés ─────────────────────────────────────────
  private scene: Scene;
  public room: Room | null = null;
  private remotePlayers: Map<string, RemotePlayer> = new Map();

  public onQualified: (isLocal: boolean, rank: number) => void = () => {};
  public onStatusChange: (status: string) => void = () => {};
  public onCountdownChange: (count: number) => void = () => {};

  /** Dernière position envoyée au serveur — pour le seuil de distance */
  private lastSentPosition: Vector3 = Vector3.Zero();
  /** Timestamp du dernier envoi — pour le seuil temporel */
  private lastSendTime: number = 0;

  constructor(scene: Scene) {
    this.scene = scene;
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
      const client = new Client(NetworkManager.SERVER_URL);
      this.room = await client.joinOrCreate("game_room");

      console.log(
        `🌐 Connected to server — sessionId: ${this.room.sessionId}`
      );

      this.setupStateListeners();
    } catch (error) {
      console.warn(
        "⚠️ Could not connect to server — Mode Solo activé",
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
    });
    room.state.listen("countdown", (newCount: number) => {
      this.onCountdownChange(newCount);
    });

    room.state.winners.onAdd((sessionId: string, index: number) => {
      const isLocal = sessionId === room.sessionId;
      this.onQualified(isLocal, index + 1);
    });

    // ─ Nouveau joueur ──────────────────────────────────
    room.state.players.onAdd((player: any, sessionId: string) => {
      // Ignorer le joueur LOCAL — sa capsule cyan est gérée
      // par PlayerController, pas par le réseau.
      if (sessionId === room.sessionId) return;

      console.log(`👤 Remote player joined: ${sessionId}`);

      // ─ Création du mesh ──────────────────────────────
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

      // Position initiale reçue du serveur
      mesh.position = new Vector3(player.x, player.y, player.z);

      // ⚠️ CRITIQUE — initialiser rotationQuaternion (null par défaut)
      // Sans cette ligne, le premier SlerpToRef crashe.
      mesh.rotationQuaternion = new Quaternion(
        player.rx, player.ry, player.rz, player.rw
      );

      // Matériau PBR ORANGE — distingue visuellement les
      // joueurs distants du joueur local (cyan)
      const mat = new PBRMaterial(
        `mat_remote_${sessionId}`,
        this.scene
      );
      mat.albedoColor   = new Color3(1.0, 0.55, 0.0);  // orange vif
      mat.metallic      = 0.2;
      mat.roughness     = 0.5;
      mat.emissiveColor = new Color3(0.15, 0.08, 0.0);  // lueur chaude
      mesh.material = mat;

      // ─ Structure RemotePlayer avec targets ────────────
      const remote: RemotePlayer = {
        mesh,
        targetPosition: new Vector3(player.x, player.y, player.z),
        targetRotation: new Quaternion(player.rx, player.ry, player.rz, player.rw),
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
    });

    // ─ Joueur déconnecté ───────────────────────────────
    room.state.players.onRemove((_player: any, sessionId: string) => {
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
      x:  position.x,
      y:  position.y,
      z:  position.z,
      rx: rotation ? rotation.x : 0,
      ry: rotation ? rotation.y : 0,
      rz: rotation ? rotation.z : 0,
      rw: rotation ? rotation.w : 1,
    });

    this.lastSentPosition.copyFrom(position);
    this.lastSendTime = now;
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
