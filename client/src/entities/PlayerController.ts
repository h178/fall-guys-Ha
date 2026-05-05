import {
  Scene,
  Vector3,
  MeshBuilder,
  PhysicsAggregate,
  PhysicsShapeType,
  PhysicsRaycastResult,
  KeyboardEventTypes,
  ArcRotateCamera,
  Mesh,
  StandardMaterial,
  TransformNode,
  HavokPlugin,
  Quaternion,
  SceneLoader,
  AnimationGroup,
  AnimationPropertiesOverride,
  ParticleSystem,
  Color4,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { VFXSystem } from '../core/VFXSystem';

/**
 * Contrôleur de personnage pour FG.
 *
 * Architecture :
 *  - Physique CAPSULE Havok (masse 1, rotation verrouillée)
 *  - Mouvement ARCADE via setLinearVelocity (réponse immédiate)
 *  - Input map basée sur event.code (layout-agnostic AZERTY/QWERTY)
 *  - Détection de sol par Raycast descendant
 *  - Saut à usage unique par appui (anti bunny-hop)
 *  - Out of Bounds + Respawn avec gestion disablePreStep Havok
 *
 * Cycle de vie :
 *   const player = new PlayerController(scene, camera, spawnPoint?);
 *   scene.onBeforeRenderObservable.add(() => {
 *     player.update(scene.getEngine().getDeltaTime() / 1000);
 *   });
 *   // ... plus tard :
 *   player.dispose();
 */
export class PlayerController {
  // ─── Constantes de gameplay ─────────────────────────────────────────
  private static readonly MOVE_SPEED = 5;    // unités/seconde
  private static readonly JUMP_IMPULSE = 5;    // vitesse verticale au saut
  private static readonly CAPSULE_HEIGHT = 2;    // hauteur de la capsule
  private static readonly CAPSULE_RADIUS = 0.5;
  /** Profondeur Y sous laquelle le joueur est considéré hors-jeu. */
  private static readonly KILL_Y = -2.0;
  /** Coefficient de Slerp pour la rotation du mesh.
   * 0.15 = rotation douce et naturelle (style Fall Guys).
   * Plus élevé = plus réactif. Plus bas = plus "flottant". */
  private static readonly ROTATION_SLERP = 0.15;
  /** Facteur d'échelle du modèle GLB. Ajuster ICI si le modèle est trop grand/petit. */
  /** Facteur d'échelle du modèle GLB. Ajuster ICI si le modèle est trop grand/petit. */
  private static readonly MODEL_SCALE = 0.08;

  // ─── Propriétés privées ─────────────────────────────────────────────
  public conveyorVelocity: Vector3 = Vector3.Zero();
  public isStunned: boolean = false;
  private stunTimer: number = 0;

  public isQualified: boolean = false;
  private trauma: number = 0;

  private scene: Scene;
  private camera: ArcRotateCamera;
  public mesh: Mesh;
  private visualAnchor: TransformNode;
  private aggregate: PhysicsAggregate;

  /** Point de réapparition. Cloné au constructeur pour éviter les mutations. */
  private readonly spawnPoint: Vector3;

  /**
   * Vrai pendant la séquence de respawn (disablePreStep toggling).
   * Empêche les appels multiples si le joueur passe plusieurs frames sous KILL_Y.
   */
  private isRespawning = false;
  private canDoubleJump: boolean = false;

  /**
   * Contrôle si les inputs clavier/manette sont actifs.
   * false par défaut — le joueur ne bouge pas au menu.
   * Activé par GameLevel quand le joueur clique JOUER.
   */
  private inputEnabled = false;

  /**
   * Input map : clé = event.code (position physique sur le clavier),
   * valeur = true si la touche est actuellement enfoncée.
   * Utiliser event.code garantit la compatibilité AZERTY/QWERTY
   * sans aucune logique de mappage supplémentaire.
   */
  private inputMap: Record<string, boolean> = {};
  public isOnIce: boolean = false;
  public currentLevelTheme: string = 'jungle';
  public currentMode: 'race' | 'survival' | 'collect' = 'race';
  public onEliminated: () => void = () => {};
  private lastSpeed: number = 0;
  private inputX: number = 0;
  private inputZ: number = 0;

  // ─── Animations ─────────────────────────────────────────────────────
  private isLoaded: boolean = false;
  private animIdle: AnimationGroup | null = null;
  private animRun: AnimationGroup | null = null;
  private animFall: AnimationGroup | null = null;
  private animBrake: AnimationGroup | null = null;
  private currentAnim: AnimationGroup | null = null;
  private vfxFrameCount: number = 0;

  // ─── Particules ─────────────────────────────────────────────────────
  private dustSystem: ParticleSystem | null = null;

  // ─── Constructeur ───────────────────────────────────────────────────

  /**
   * @param scene      La scène Babylon.js
   * @param camera     La caméra orbitale principale
   * @param spawnPoint Position initiale et de respawn (défaut: Y=2 → retombe via gravité, évite pénétration sol)
   */
  constructor(
    scene: Scene,
    camera: ArcRotateCamera,
    spawnPoint: Vector3 = new Vector3(0, 2, 0)
  ) {
    this.scene = scene;
    this.camera = camera;
    this.spawnPoint = spawnPoint.clone();  // clone : immunise contre les mutations externes

    this.mesh = this.createMesh();
    // Ancre visuelle : permet de garder la capsule invisible sans cacher le modèle GLB.
    // Le modèle est parenté à ce TransformNode (pas directement à this.mesh).
    this.visualAnchor = new TransformNode('player_visual_anchor', this.scene);
    this.visualAnchor.parent = this.mesh;
    this.mesh.setEnabled(true);
    this.visualAnchor.setEnabled(true);
    console.log('🟩 [PLAYER INIT] Collider mesh created', {
      position: this.mesh.position.toString(),
      enabled: this.mesh.isEnabled(),
      isVisible: this.mesh.isVisible,
    });
    this.aggregate = this.createPhysicsBody();
    this.registerInputs();

    // ─ Configuration Blending pour transitions douces ───────────────────
    if (!this.scene.animationPropertiesOverride) {
      this.scene.animationPropertiesOverride = new AnimationPropertiesOverride();
      this.scene.animationPropertiesOverride.enableBlending = true;
      this.scene.animationPropertiesOverride.blendingSpeed = 0.05;
    }

    this.loadModel();
    this.createDustSystem();
    this.camera.alpha = -Math.PI / 2;
  }

  // ─── Méthodes d'initialisation (privées) ───────────────────────────

  /**
   * Crée la capsule représentant visuellement le joueur.
   * Y=1 → le centre est à 1 unité au-dessus du sol (Y=0),
   * donc le bas de la capsule (centre - hauteur/2 = 1 - 1 = 0)
   * est parfaitement tangent au sol au spawn.
   */
  private createMesh(): Mesh {
    const mesh = MeshBuilder.CreateCapsule(
      'player',
      {
        height: PlayerController.CAPSULE_HEIGHT,
        radius: PlayerController.CAPSULE_RADIUS,
        tessellation: 16,
        subdivisions: 2,
        capSubdivisions: 6,
      },
      this.scene
    );
    // Utiliser spawnPoint plutôt qu'un Vector3 hardcodé
    mesh.position = this.spawnPoint.clone();
    const transparentMat = new StandardMaterial('mat_collider_hidden', this.scene);
    transparentMat.alpha = 0;
    mesh.material = transparentMat;
    // Collider invisible (contrat): on cache la capsule.
    mesh.isPickable = false;
    mesh.isVisible = false;

    // Initialiser le quaternion de rotation AVANT la liaison physics.
    // Une fois défini, Babylon ignore mesh.rotation (Euler) et
    // utilise UNIQUEMENT rotationQuaternion. C'est un switch one-way.
    mesh.rotationQuaternion = Quaternion.Identity();

    return mesh;
  }

  /**
   * Crée le corps physique Havok associé à la capsule.
   *
   * Points critiques :
   *  - restitution: 0  → pas de rebond (le joueur n'est pas une balle)
   *  - friction: 0.5   → adhérence modérée (ni glissant, ni collant)
   *  - inertia: Zero   → verrouille TOUTES les rotations du corps.
   *    Sans cela, la capsule bascule et tombe à chaque collision.
   */
  private createPhysicsBody(): PhysicsAggregate {
    const aggregate = new PhysicsAggregate(
      this.mesh,
      PhysicsShapeType.CAPSULE,
      {
        mass: 1,
        restitution: 0.0,
        friction: 0.5,
      },
      this.scene
    );

    // Verrouillage de toutes les rotations du corps physique.
    // L'inertia nulle empêche tout couple de rotation — la capsule
    // reste verticale quelles que soient les forces appliquées.
    aggregate.body.setMassProperties({
      inertia: Vector3.ZeroReadOnly,
    });

    return aggregate;
  }

  /**
   * S'abonne à l'observable clavier de Babylon.js pour maintenir
   * une input map cohérente entre keydown et keyup.
   *
   * Utilisation de event.code (NOT event.key) :
   *  - event.code = "KeyW"  → position physique W sur le clavier
   *  - Fonctionne identiquement sur AZERTY (Z physique = "KeyW")
   *    et QWERTY (W physique = "KeyW")
   */
  private registerInputs(): void {
    this.scene.onKeyboardObservable.add((kbInfo) => {
      switch (kbInfo.type) {
        case KeyboardEventTypes.KEYDOWN:
          this.inputMap[kbInfo.event.code] = true;
          break;
        case KeyboardEventTypes.KEYUP:
          this.inputMap[kbInfo.event.code] = false;
          break;
      }
    });
  }

  // ─── Boucle de mise à jour (publique) ──────────────────────────────

  public applyImpulse(direction: Vector3): void {
    this.aggregate.body.applyImpulse(direction, this.mesh.getAbsolutePosition());
  }

  public stun(duration: number): void {
    this.isStunned = true;
    this.stunTimer = duration;
    this.trauma = 0.8;
  }

  /**
   * Configure le profil physique du joueur selon le thème du niveau.
   * Appeler depuis createPlayer() dans GameLevel après assignation de currentLevelTheme.
   */
  public setThemePhysics(theme: string): void {
    this.currentLevelTheme = theme;
    switch (theme) {
      case 'ice':
        this.isOnIce = true;
        break;
      case 'space':
        this.isOnIce = false;
        break;
      default:
        this.isOnIce = false;
        break;
    }
  }

  /**
   * Doit être appelée à chaque frame depuis la render loop.
   * @param _deltaTime Temps écoulé depuis la dernière frame, en SECONDES.
   *                   (obtenu via scene.getEngine().getDeltaTime() / 1000)
   *
   * Note : le paramètre deltaTime est disponible pour une utilisation
   * future (animations, cooldowns). Le mouvement arcade via
   * setLinearVelocity est naturellement indépendant du framerate
   * (la vélocité est une valeur absolue, pas un incrément).
   */
  update(_deltaTime: number): void {
    // --- SANITY CHECK DE VISIBILITÉ ---
    if (this.isLoaded) {
        // 1. Force l'activation du node racine
        const root = this.visualAnchor.getChildren()[0] as Mesh;
        if (root && !root.isEnabled()) root.setEnabled(true);
        
        // 2. Force la visibilité de TOUS les sous-meshes du modèle GLB
        //    mais exclut le collider capsule (this.mesh)
        this.visualAnchor.getChildMeshes().forEach(m => {
            m.isVisible = true;
            m.visibility = 1.0;
            m.renderingGroupId = 1; // Priorité de rendu
        });

        // 3. Sécurité de Position (Anti-Void)
        if (this.mesh.position.y < -20 || isNaN(this.mesh.position.y)) {
            console.warn("Position aberrante détectée, respawn forcé.");
            this.respawn();
        }
    }

    // ─ Out of Bounds — vérification EN PREMIER (early return) ────────
    // Si un respawn est déjà en cours, ne rien faire pendant ce frame.
    // Sans ce guard, applyMovement() écraserait la vélocité qu'on vient
    // de mettre à zéro dans respawn(), causant une chute fantôme.
    if (this.isRespawning) return;

    if (this.mesh.position.y < PlayerController.KILL_Y) {
      this.respawn();
      return;  // ← ne pas exécuter mouvement/saut/caméra sur ce frame
    }

    // Gestion du Stun : on laisse Havok gérer la trajectoire
    if (this.isStunned) {
      this.stunTimer -= _deltaTime;
      if (this.stunTimer <= 0) {
        this.isStunned = false;
      }
      this.followCamera();
      this.updateAnimation();
      return;
    }

    // ─ Mouvement / Saut — guardé par inputEnabled ──────────────────────
    // Au menu (inputEnabled = false), le joueur reste immobile.
    // La caméra continue de le suivre pour l'afficher correctement.
    if (this.inputEnabled) {
      this.applyMovement(_deltaTime);
      this.applyJump();
    }

    // followCamera() tourne TOUJOURS — même au menu et après victoire
    this.followCamera();

    // ─ Animation State Machine ──────────────────────────────────────────
    this.updateAnimation();
  }

  // ─── Méthodes de mouvement (privées) ───────────────────────────────

  /**
   * Calcule et applique la vélocité en COORDONNÉES CAMÉRA.
   *
   * Avant Sprint 8, le mouvement était en axes monde absolus :
   *   W = +Z monde, D = +X monde
   * Maintenant, W = "avancer vers là où la caméra regarde".
   *
   * Mathématiques :
   *   forward = (-sin(alpha), 0, -cos(alpha))  → direction "devant" sur le plan XZ
   *   right   = ( cos(alpha), 0, -sin(alpha))  → direction "droite" sur le plan XZ
   *
   * Ces vecteurs sont déjà normalisés (sin²+cos²=1) → pas de
   * normalisation nécessaire pour les bases vectorielles.
   *
   * La composante Y est toujours 0 → le joueur ne s'envole pas
   * et ne s'enfonce pas (la gravité Havok gère le Y).
   *
   * Règle critique : ne JAMAIS modifier la composante Y de la vélocité
   * lors du déplacement horizontal. Écraser Y annulerait la gravité
   * Havok et le saut en cours.
   */
  private applyMovement(_deltaTime: number): void {
    this.inputX = 0;
    this.inputZ = 0;
    if (this.inputMap['KeyW']) this.inputZ = 1;
    if (this.inputMap['KeyS']) this.inputZ = -1;
    if (this.inputMap['KeyA']) this.inputX = -1;
    if (this.inputMap['KeyD']) this.inputX = 1;

    const currentVel = this.aggregate.body.getLinearVelocity();

    // 1. Damping : Ne freiner fort QUE si on ne bouge pas ET qu'on n'est pas poussé
    if (this.inputZ === 0 && this.inputX === 0 && this.conveyorVelocity.lengthSquared() === 0) {
      this.aggregate.body.setLinearDamping(this.isOnIce ? 1.0 : 10.0);
    } else {
      this.aggregate.body.setLinearDamping(this.isOnIce ? 0.5 : 2.0);
    }

    // 2. Vecteurs de direction (Input)
    const alpha = this.camera.alpha;
    const forward = new Vector3(-Math.cos(alpha), 0, -Math.sin(alpha));
    const right = new Vector3(-Math.sin(alpha), 0, Math.cos(alpha));
    const moveDir = forward.scale(this.inputZ).add(right.scale(this.inputX));
    if (moveDir.lengthSquared() > 0) moveDir.normalize();

    // 3. Calcul de la vitesse cible (Input + Tapis roulant/Roues)
    // On ajoute conveyorVelocity MÊME SI le joueur ne presse aucune touche !
    const targetVx = moveDir.x * PlayerController.MOVE_SPEED + this.conveyorVelocity.x;
    const targetVz = moveDir.z * PlayerController.MOVE_SPEED + this.conveyorVelocity.z;

    // on interpole. Un Lerp faible sur la glace donne une accélération lente.
    const lerpFactor = this.isOnIce ? 0.03 : 0.3; // Ajuster selon le Game Feel
    const newVx = currentVel.x + (targetVx - currentVel.x) * lerpFactor;
    const newVz = currentVel.z + (targetVz - currentVel.z) * lerpFactor;

    this.aggregate.body.setLinearVelocity(new Vector3(newVx, currentVel.y, newVz));
    this.conveyorVelocity.setAll(0);
    this.applyRotation(moveDir);

    // (inputX/inputZ sont reset au début de la fonction)
  }

  /**
   * Pivote le mesh du joueur vers la direction de mouvement
   * via Quaternion.Slerp (interpolation sphérique).
   *
   * Sécurité Havok :
   *   Le body DYNAMIC a inertia=ZeroReadOnly → Havok ne calcule
   *   aucune rotation angulaire pour ce body. Le post-step physics
   *   écrit la rotation du body sur le mesh MAIS cette rotation
   *   ne change jamais (identity). Notre Slerp s'exécute dans
   *   onBeforeRenderObservable, qui tourne APRÈS le physics step
   *   dans le pipeline Babylon.js v7 → notre rotation visuelle
   *   est appliquée en dernier → visible à l'écran. ✅
   *
   * "Shortest path" fix :
   *   Si Quaternion.Dot(current, target) < 0, les deux quaternions
   *   sont "de l'autre côté de la sphère". Slerp prendrait le
   *   chemin long (360° - angle). On inverse le target pour forcer
   *   le chemin court.
   *
   * @param moveDirection Vecteur de mouvement normalisé sur le plan XZ
   */
  private applyRotation(moveDirection: Vector3): void {
    if (!this.visualAnchor.rotationQuaternion) return;

    // 1. Calculer la direction cible
    const targetQuat = Quaternion.FromLookDirectionLH(moveDirection, Vector3.Up());

    // 2. IMPORTANT : Le modèle HVGirl regarde Z- par défaut. 
    // On lui applique une rotation de 180° (Math.PI) pour qu'il donne son dos !
    const flip180 = Quaternion.RotationAxis(Vector3.Up(), Math.PI);
    const finalTargetQuat = targetQuat.multiply(flip180);

    // 3. Dot Product (Shortest path)
    if (Quaternion.Dot(this.visualAnchor.rotationQuaternion, finalTargetQuat) < 0) {
      finalTargetQuat.scaleInPlace(-1);
    }

    // 4. On Slerp DIRECTEMENT sur visualAnchor, car Havok bloque this.mesh !
    Quaternion.SlerpToRef(
      this.visualAnchor.rotationQuaternion,
      finalTargetQuat,
      PlayerController.ROTATION_SLERP,
      this.visualAnchor.rotationQuaternion
    );
  }

  /**
   * Applique une impulsion verticale si le joueur est au sol et
   * appuie sur Espace.
   * Applique une impulsion verticale (Saut et Double Saut).
   */
  private applyJump(): void {
    const isGrounded = this.isGrounded();

    // Reset du double saut si on est au sol (et qu'on ne saute pas à cette frame)
    if (isGrounded && !this.inputMap['Space']) {
      this.canDoubleJump = false;
    }

    if (this.inputMap['Space']) {
      if (isGrounded) {
        // --- PREMIER SAUT ---
        this.executeJumpForce(1.0);
        this.canDoubleJump = true; // Autoriser le 2ème saut
        this.inputMap['Space'] = false;
      } 
      else if (this.canDoubleJump) {
        // --- DOUBLE SAUT (en l'air) ---
        // On donne une impulsion légèrement réduite (80%) pour le double saut
        this.executeJumpForce(0.8);
        this.canDoubleJump = false; // Bloquer les sauts infinis
        this.inputMap['Space'] = false;

        // Feedback visuel (VFX) du double saut sous les pieds
        const feetPosition = this.mesh.position.clone();
        feetPosition.y -= 1.0;
        VFXSystem.emit(this.scene, feetPosition, this.currentLevelTheme);
      }
    }
  }

  /**
   * Applique la force physique du saut.
   */
  private executeJumpForce(multiplier: number): void {
    const jumpForce = this.currentLevelTheme === 'space'
      ? PlayerController.JUMP_IMPULSE * 0.85 * multiplier
      : PlayerController.JUMP_IMPULSE * multiplier;
      
    const currentVel = this.aggregate.body.getLinearVelocity();
    
    // On écrase la vélocité Y pour garantir un saut consistant
    // même si le joueur commençait déjà à retomber lourdement
    this.aggregate.body.setLinearVelocity(
      new Vector3(currentVel.x, jumpForce, currentVel.z)
    );
  }

  /**
   * Met à jour le target de la caméra orbitale pour qu'elle suive
   * le centre du personnage à chaque frame.
   */
  private followCamera(): void {
    // Réduire le trauma progressivement
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - this.scene.getEngine().getDeltaTime() / 1000);
    }
    // Application 
    const shake = this.trauma * this.trauma;
    const shakeX = (Math.random() - 0.5) * shake * 1.5;
    const shakeY = (Math.random() - 0.5) * shake * 1.5;
    const shakeZ = (Math.random() - 0.5) * shake * 1.5;

    // La target originelle de la camera était this.mesh.position, on y ajoute le shake
    this.camera.target = this.mesh.position.add(new Vector3(shakeX, 2 + shakeY, shakeZ));
  }

  // ─── Détection de sol (privée) ──────────────────────────────────────

  /**
   * Détecte si le joueur est en contact avec le sol via un raycast
   * Havok descendant.
   *
   * Géométrie du raycast :
   *  - Start : centre du mesh (this.mesh.position)
   *  - End   : 1.2 unités en dessous du centre
   *    → La demi-hauteur de la capsule est 1.0 (hauteur 2 / 2)
   *    → La marge de 0.2 permet de détecter le sol avec fiabilité
   *      même quand le joueur "rebondit" légèrement sur la surface
   *
   * Note sur l'auto-collision : le raycast part du CENTRE du mesh,
   * soit à l'intérieur du collider capsule. Havok ne devrait pas
   * détecter le propre corps du joueur car le ray origin est dans
   * le volume du shape. Si des faux positifs surviennent, décaler
   * start à (position.y - 0.9) pour partir juste au-dessus des pieds.
   */
  private isGrounded(): boolean {
    // En Babylon.js v7 Physics V2, le raycast est exposé sur IPhysicsEnginePluginV2
    // via scene.getPhysicsEngine(). La méthode exacte est raycast() (pas raycastToRef).
    const plugin = this.scene.getPhysicsEngine()?.getPhysicsPlugin() as HavokPlugin | null;
    if (!plugin) return false;

    const raycastResult = new PhysicsRaycastResult();
    const start = this.mesh.position.clone();
    // Demi-hauteur (1.0) + marge de détection (0.2) = 1.2
    const end = start.add(new Vector3(0, -(PlayerController.CAPSULE_HEIGHT / 2 + 0.2), 0));

    plugin.raycast(start, end, raycastResult);

    return raycastResult.hasHit;
  }

  // ─── Input Enable/Disable (public) ────────────────────────────────────

  /**
   * Active ou désactive les inputs du joueur.
   * Utilisé par GameLevel pour :
   *  - Désactiver au menu (état MENU)
   *  - Activer quand le joueur clique JOUER (état PLAYING)
   *  - Désactiver après la victoire (état WON)
   *
   * Quand on désactive : reset des vélocités horizontales pour
   * stopper le joueur net (sans inertie résiduelle).
   */
  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    if (!enabled) {
      // Conserver la vélocité Y (gravité / chute en cours)
      // mais annuler X et Z pour arrêter le mouvement horizontal
      const currentVel = this.aggregate.body.getLinearVelocity();
      this.aggregate.body.setLinearVelocity(
        new Vector3(0, currentVel.y, 0)
      );
    }
  }

  // ─── Out of Bounds / Respawn (public) ───────────────────────────────

  /**
   * Téléporte le joueur au spawn point et annule toutes ses vélocités.
   *
   * ⚠️  PIÈGE HAVOK — body.disablePreStep :
   *  Par défaut, les DYNAMIC bodies ont disablePreStep = true, ce qui
   *  signifie que Havok IGNORE les modifications de mesh.position.
   *  Le body conserve sa position interne → rubber-banding au respawn.
   *
   *  Pattern correct :
   *  1. disablePreStep = false  → ouvre la synchro mesh → physics
   *  2. mesh.position.copyFrom  → Havok lira cette valeur au prochain step
   *  3. reset vélocités         → annule la gravité accumulée pendant la chute
   *  4. disablePreStep = true   → referme AU FRAME SUIVANT via addOnce
   *     (pas immédiatement — Havok doit lire la nouvelle position d'abord)
   */
  respawn(): void {
    if (this.isRespawning) return;
    this.isRespawning = true;

    // 1. Ouvrir la synchronisation mesh → physics body
    this.aggregate.body.disablePreStep = false;

    // 2. Téléporter le joueur et forcer le calcul de la matrice
    this.mesh.position.copyFrom(this.spawnPoint);
    this.mesh.computeWorldMatrix(true);

    if (this.mesh.rotationQuaternion) {
      this.mesh.rotationQuaternion.copyFrom(Quaternion.Identity());
    }
    this.camera.alpha = -Math.PI / 2;
    this.vfxFrameCount = 0;

    // 3. Annuler les vélocités
    this.aggregate.body.setLinearVelocity(Vector3.Zero());
    this.aggregate.body.setAngularVelocity(Vector3.Zero());

    // 4. Refermer la synchro avec un délai garanti (indépendant du framerate)
    setTimeout(() => {
      if (this.aggregate && this.aggregate.body) {
        this.aggregate.body.disablePreStep = true;
      }
      this.isRespawning = false;
    }, 50);
  }

  // ─── Animations (privées) ───────────────────────────────────────────

  /**
   * Charge le modèle GLB et configure ses animations.
   */
  private async loadModel(): Promise<void> {
    try {
      console.log('🟦 [PLAYER INIT] Loading model HVGirl.glb…');
      const result = await SceneLoader.ImportMeshAsync(
        null,
        "https://models.babylonjs.com/",
        "HVGirl.glb",
        this.scene
      );

      const rootNode = result.meshes[0];
      console.log('🟩 [PLAYER INIT] Model loaded', {
        meshes: result.meshes.length,
        anims: result.animationGroups.length,
        rootName: rootNode?.name,
      });

      // Parenter au collider — la rotation et la position MONDE
      // du root node seront désormais relatives à la capsule parent.
      rootNode.parent = this.visualAnchor;
      rootNode.setEnabled(true);
      this.visualAnchor.setEnabled(true);

      // ─ SCALING (CORRECTIF CRITIQUE) ────────────────────────────────
      // HVGirl.glb est exporté à ~66 unités de hauteur (échelle Blender).
      // La capsule Havok fait 2 unités. Facteur : 2 / 66 ≈ 0.03.
      // setAll() écrit X, Y, Z en une seule opération (pas de new Vector3).
      // Ajuster MODEL_SCALE (constante de classe) pour retuner la taille.
      rootNode.scaling.setAll(PlayerController.MODEL_SCALE);
      if (rootNode.scaling.lengthSquared() < 1e-8) {
        rootNode.scaling.setAll(PlayerController.MODEL_SCALE);
      }

      // ─ ROTATION DE BASE ─────────────────────────────────────────────
      // HVGirl est exportée dos à la caméra par rapport à la convention
      // Babylon.js (Z+ = avant). Rotation Y de π (180°) sur le CHILD
      // pour la faire face à la direction de mouvement.
      // Correction : HVGirl.glb regarde Z- par défaut. On la pivote de 180°
      // pour qu'elle regarde Z+ (Forward) en accord avec le controlleur.
      // ─ ROTATION DE BASE (FIX DÉFINITIF DU DOS À LA CAMÉRA) ─────────
      // HVGirl est exportée de face (Z-). Les animations GLB écrasent 
      // la rotation du rootNode. On applique donc la rotation de 180° 
      // (Math.PI) directement sur le visualAnchor avec un Quaternion !
      this.visualAnchor.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), Math.PI);
      
      // On s'assure que le rootNode garde une identité neutre
      rootNode.rotationQuaternion = Quaternion.Identity();

      // ─ OFFSET VERTICAL ──────────────────────────────────────────────
      // Décaler vers le bas pour que les pieds de l'avatar s'alignent
      // au bas de la capsule Havok = -(hauteur_capsule / 2) = -1.
      rootNode.position.y = -PlayerController.CAPSULE_HEIGHT / 2; // -1.0 si hauteur=2

      // ─ Sanity visuel post-load : forcer visibilité/enabled sur tous les submeshes ─
      this.visualAnchor.getChildMeshes().forEach(m => {
        m.setEnabled(true);
        m.isVisible = true;
        m.visibility = 1.0;
        m.renderingGroupId = 1;
      });
      console.log('🟩 [PLAYER INIT] Visual sanity applied', {
        colliderPos: this.mesh.position.toString(),
        rootPos: rootNode.getAbsolutePosition().toString(),
        rootScaling: rootNode.scaling.toString(),
        childMeshes: this.visualAnchor.getChildMeshes().length,
      });

      // Arrêter toutes les animations lues (Babylon autoplay souvent la première)
      result.animationGroups.forEach(ag => ag.stop());

      // Assigner les animations trouvées via toLowerCase().includes()
      this.animIdle = result.animationGroups.find(ag => ag.name.toLowerCase().includes('idle')) || null;
      this.animRun = result.animationGroups.find(ag => ag.name.toLowerCase().includes('run')) || null;
      this.animFall = result.animationGroups.find(ag => ag.name.toLowerCase().includes('fall') || ag.name.toLowerCase().includes('jump')) || null;
      this.animBrake = result.animationGroups.find(ag => ag.name.toLowerCase().includes('brake') || ag.name.toLowerCase().includes('stop')) || null;

      this.isLoaded = true;
    } catch (error) {
      console.error("🟥 [PLAYER INIT] Erreur de chargement du modèle 3D :", error);
      // Fallback visuel minimal : rendre la capsule visible si le GLB échoue,
      // pour éviter un joueur “invisible” total pendant le debug.
      this.mesh.isVisible = true;
      const mat = this.mesh.material as StandardMaterial | null;
      if (mat) mat.alpha = 0.35;
      console.log('🟨 [PLAYER INIT] Fallback capsule visible', {
        position: this.mesh.position.toString(),
        alpha: mat ? mat.alpha : '(no-mat)',
      });
    }
  }

  public forceVisualSanity(): void {
    console.log('🟦 [PLAYER INIT] forceVisualSanity()', {
      colliderPos: this.mesh.position.toString(),
      colliderEnabled: this.mesh.isEnabled(),
      colliderVisible: this.mesh.isVisible,
      anchorEnabled: this.visualAnchor.isEnabled(),
      childMeshes: this.visualAnchor.getChildMeshes().length,
    });
    this.mesh.setEnabled(true);
    this.visualAnchor.setEnabled(true);
    this.visualAnchor.getChildMeshes().forEach(m => {
      m.setEnabled(true);
      m.isVisible = true;
      m.visibility = 1.0;
      m.renderingGroupId = 1;
    });
  }

  /**
   * Crée le système de particules de poussière aux pieds du joueur.
   * emitRate = 0 par défaut — activé par updateAnimation() pendant Run.
   */
  private createDustSystem(): void {
    const dust = new ParticleSystem('runDust', 30, this.scene);
    dust.emitter = this.mesh;
    dust.minEmitBox = new Vector3(-0.3, -PlayerController.CAPSULE_HEIGHT / 2, -0.3);
    dust.maxEmitBox = new Vector3(0.3, -PlayerController.CAPSULE_HEIGHT / 2, 0.3);
    dust.color1 = new Color4(0.45, 0.30, 0.15, 0.6);  // marron terre
    dust.color2 = new Color4(0.30, 0.50, 0.10, 0.4);  // vert feuille
    dust.minSize = 0.05;
    dust.maxSize = 0.15;
    dust.minLifeTime = 0.2;
    dust.maxLifeTime = 0.5;
    dust.emitRate = 0;  // désactivé par défaut
    dust.gravity = new Vector3(0, -2, 0);
    dust.direction1 = new Vector3(-0.5, 0.3, -0.5);
    dust.direction2 = new Vector3(0.5, 0.8, 0.5);
    dust.start();  // démarrer le système (emitRate=0 → aucune particule jusqu'à Run)
    this.dustSystem = dust;
  }

  /**
   * Pilote le controller d'animations (Idle / Run / Fall).
   */
  private updateAnimation(): void {
    if (!this.isLoaded) return;

    const vel = this.aggregate.body.getLinearVelocity();
    const horizSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    let targetAnim: AnimationGroup | null = null;

    if (!this.isGrounded()) {
      targetAnim = this.animFall;
    } else {
      if (horizSpeed > 0.5) {
        targetAnim = this.animRun;
        // Effet de poussière sous les pieds
        if (this.vfxFrameCount++ % 10 === 0) {
          const feetPosition = this.mesh.position.clone();
          feetPosition.y -= 1.0;
          VFXSystem.emit(this.scene, feetPosition, this.currentLevelTheme);
        }
      } else {
        targetAnim = this.animIdle;
      }

      // Freinage brutal
      const deceleration = this.lastSpeed - horizSpeed;
      if (this.inputX === 0 && this.inputZ === 0 && deceleration > 10) {
        if (this.animBrake) targetAnim = this.animBrake;
      }
    }

    this.lastSpeed = horizSpeed;

    // Lancer l'animation si elle change
    if (targetAnim && targetAnim !== this.currentAnim) {
      if (this.currentAnim) this.currentAnim.stop();
      targetAnim.play(true);
      this.currentAnim = targetAnim;
    }

    // LE FIX CRITIQUE : Calibrer la vitesse des pieds sur la vélocité
    if (this.currentAnim && this.currentAnim === this.animRun) {
      // 5.0 correspond au MOVE_SPEED de base.
      // Si on va plus vite (tapis roulant), les pieds bougent plus vite !
      this.currentAnim.speedRatio = horizSpeed / 5.0;
    }

    // ACTIVATION DES PARTICULES (EFFET DE PIEDS)
    // On émet 30 particules/sec quand on court, 0 sinon.
    if (this.dustSystem) {
      this.dustSystem.emitRate = (this.currentAnim === this.animRun && horizSpeed > 1.0) ? 30 : 0;
    }
  }

  // ─── Nettoyage (public) ─────────────────────────────────────────────

  /**
   * Expose le mesh principal du joueur.
   * Utilisé par GameLevel pour enregistrer le joueur comme shadow caster.
   */
  getMesh(): Mesh {
    return this.mesh;
  }

  dispose(): void {
    this.dustSystem?.dispose();
    this.aggregate.dispose();
    this.mesh.dispose();
  }
}
