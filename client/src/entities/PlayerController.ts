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
  HavokPlugin,
  Quaternion,
  SceneLoader,
  AnimationGroup,
  AnimationPropertiesOverride,
  ParticleSystem,
  Color4,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { MaterialSystem } from '../core/MaterialSystem';

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
  private static readonly MODEL_SCALE = 0.2

  // ─── Propriétés privées ─────────────────────────────────────────────
  public conveyorVelocity: Vector3 = Vector3.Zero();
  public isStunned: boolean = false;
  private stunTimer: number = 0;

  private scene: Scene;
  private camera: ArcRotateCamera;
  public mesh: Mesh;
  private aggregate: PhysicsAggregate;

  /** Point de réapparition. Cloné au constructeur pour éviter les mutations. */
  private readonly spawnPoint: Vector3;

  /**
   * Vrai pendant la séquence de respawn (disablePreStep toggling).
   * Empêche les appels multiples si le joueur passe plusieurs frames sous KILL_Y.
   */
  private isRespawning = false;

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

  // ─── Animations ─────────────────────────────────────────────────────
  private isLoaded: boolean = false;
  private animIdle: AnimationGroup | null = null;
  private animRun: AnimationGroup | null = null;
  private animFall: AnimationGroup | null = null;
  private currentAnim: AnimationGroup | null = null;

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
    mesh.material = MaterialSystem.createPlayerMaterial(this.scene);
    mesh.receiveShadows = true;
    mesh.isVisible = false; // Le collider de physique devient invisible

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
    // 1. Capturer les inputs bruts
    let inputZ = 0;
    let inputX = 0;
    if (this.inputMap['KeyW']) inputZ = 1;
    if (this.inputMap['KeyS']) inputZ = -1;
    if (this.inputMap['KeyA']) inputX = -1;
    if (this.inputMap['KeyD']) inputX = 1;

    // 2. Calculer la direction de base
    if (inputZ === 0 && inputX === 0) {
      // Pas d'input → on ne génère pas de mouvement propre, mais on préserve le conveyor
    }

    // 3. Calculer les vecteurs forward/right depuis camera.alpha
    const alpha = this.camera.alpha;
    const forward = new Vector3(-Math.sin(alpha), 0, -Math.cos(alpha));
    const right = new Vector3(Math.cos(alpha), 0, -Math.sin(alpha));

    // 4. Combiner inputs × vecteurs caméra
    const moveDir = forward.scale(inputZ).add(right.scale(inputX));

    // 5. Normaliser (la diagonale serait ~1.41× sinon)
    if (moveDir.lengthSquared() > 0) {
      moveDir.normalize();
    }

    // 6. Appliquer la vélocité avec ANTI-SNAP (Lerp) et CONVEYOR
    const currentVel = this.aggregate.body.getLinearVelocity();
    
    const targetVelX = moveDir.x * PlayerController.MOVE_SPEED + this.conveyorVelocity.x;
    const targetVelZ = moveDir.z * PlayerController.MOVE_SPEED + this.conveyorVelocity.z;

    let newVx = targetVelX;
    let newVz = targetVelZ;

    // Calcul des vitesses horizontales carrées
    const currentSpeedSq = currentVel.x * currentVel.x + currentVel.z * currentVel.z;
    const targetSpeedSq = targetVelX * targetVelX + targetVelZ * targetVelZ;
    const normalSpeedSq = PlayerController.MOVE_SPEED * PlayerController.MOVE_SPEED;

    // Si le joueur va très vite (saut champignon) et qu'on essaie de ralentir → ANTI-SNAP
    if (currentSpeedSq > targetSpeedSq && currentSpeedSq > normalSpeedSq * 1.5) {
      // Décélération/frottement doux au lieu d'un écrasement brutal
      const friction = Math.min(_deltaTime * 3, 1);
      newVx = currentVel.x + (targetVelX - currentVel.x) * friction;
      newVz = currentVel.z + (targetVelZ - currentVel.z) * friction;
    }

    this.aggregate.body.setLinearVelocity(
      new Vector3(newVx, currentVel.y, newVz)
    );
    this.conveyorVelocity.setAll(0); // Reset systématique

    // 7. Rotation du mesh vers la direction du mouvement (seulement si input actif)
    if (moveDir.lengthSquared() > 0) {
      this.applyRotation(moveDir);
    }
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
    if (!this.mesh.rotationQuaternion) return;  // safety guard

    // Quaternion cible : "regarde dans la direction du mouvement"
    // FromLookDirectionLH prend (forward, up) et retourne le quaternion
    const targetQuat = Quaternion.FromLookDirectionLH(
      moveDirection,
      Vector3.Up()
    );

    // Fix "shortest path" : si le dot product est négatif,
    // inverser le target pour que le Slerp prenne le chemin court.
    if (Quaternion.Dot(this.mesh.rotationQuaternion, targetQuat) < 0) {
      targetQuat.scaleInPlace(-1);
    }

    // Slerp : interpolation sphérique fluide (écriture in-place)
    Quaternion.SlerpToRef(
      this.mesh.rotationQuaternion,
      targetQuat,
      PlayerController.ROTATION_SLERP,
      this.mesh.rotationQuaternion  // résultat écrit en place
    );
  }

  /**
   * Applique une impulsion verticale si le joueur est au sol et
   * appuie sur Espace.
   *
   * Anti bunny-hop : la touche est immédiatement effacée de l'input map
   * après le saut. Le joueur doit physiquement relâcher et ré-appuyer
   * sur Espace pour déclencher un nouveau saut au prochain contact sol.
   */
  private applyJump(): void {
    if (this.inputMap['Space'] && this.isGrounded()) {
      const currentVel = this.aggregate.body.getLinearVelocity();
      this.aggregate.body.setLinearVelocity(
        new Vector3(currentVel.x, PlayerController.JUMP_IMPULSE, currentVel.z)
      );
      // Efface immédiatement la pression de Espace → empêche le
      // bunny-hop (maintenir Espace = sauter en boucle indésirable)
      this.inputMap['Space'] = false;
    }
  }

  /**
   * Met à jour le target de la caméra orbitale pour qu'elle suive
   * le centre du personnage à chaque frame.
   */
  private followCamera(): void {
    this.camera.target = this.mesh.position;
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
    if (this.isRespawning) return;  // anti-spam : une seule séquence à la fois
    this.isRespawning = true;

    // 1. Ouvrir la synchronisation mesh → physics body
    this.aggregate.body.disablePreStep = false;

    // 2. Téléporter : copyFrom() est plus efficace que l'assignation d'un new Vector3
    this.mesh.position.copyFrom(this.spawnPoint);

    // 2b. Reset la rotation visuelle : le joueur regarde vers Z+ au respawn
    if (this.mesh.rotationQuaternion) {
      this.mesh.rotationQuaternion.copyFrom(Quaternion.Identity());
    }

    // 3. Annuler toutes les vélocités accumulées
    //    Sans cela : la vitesse de chute (−9.81 × t) ferait traverser le sol au respawn.
    this.aggregate.body.setLinearVelocity(Vector3.Zero());
    //    setAngularVelocity est défensif ici (inertia = ZeroReadOnly → no-op),
    //    conservé comme mesure de sécurité "belt and suspenders".
    this.aggregate.body.setAngularVelocity(Vector3.Zero());

    // 4. Refermer la synchro après DEUX frames.
    //    Frame 1 : Havok lit la nouvelle position (disablePreStep = false).
    //    Frame 2 : le body est stabilisé → on referme en sécurité.
    //    Double addOnce : chaque callback se désinscrit automatiquement.
    this.scene.onAfterRenderObservable.addOnce(() => {
      this.scene.onAfterRenderObservable.addOnce(() => {
        this.aggregate.body.disablePreStep = true;
        this.isRespawning = false;
      });
    });
  }

  // ─── Animations (privées) ───────────────────────────────────────────

  /**
   * Charge le modèle GLB et configure ses animations.
   */
  private async loadModel(): Promise<void> {
    try {
      const result = await SceneLoader.ImportMeshAsync(
        null,
        "https://models.babylonjs.com/",
        "HVGirl.glb",
        this.scene
      );

      const rootNode = result.meshes[0];

      // Parenter au collider — la rotation et la position MONDE
      // du root node seront désormais relatives à la capsule parent.
      rootNode.parent = this.mesh;

      // ─ SCALING (CORRECTIF CRITIQUE) ────────────────────────────────
      // HVGirl.glb est exporté à ~66 unités de hauteur (échelle Blender).
      // La capsule Havok fait 2 unités. Facteur : 2 / 66 ≈ 0.03.
      // setAll() écrit X, Y, Z en une seule opération (pas de new Vector3).
      // Ajuster MODEL_SCALE (constante de classe) pour retuner la taille.
      rootNode.scaling.setAll(PlayerController.MODEL_SCALE);

      // ─ ROTATION DE BASE ─────────────────────────────────────────────
      // HVGirl est exportée dos à la caméra par rapport à la convention
      // Babylon.js (Z+ = avant). Rotation Y de π (180°) sur le CHILD
      // pour la faire face à la direction de mouvement.
      // ⚠️ Cette rotation est en Euler et s'applique uniquement au child.
      //    La capsule PARENT utilise rotationQuaternion — aucun conflit,
      //    Babylon résout correctement parent(quat) × enfant(euler).
      rootNode.rotation.y = Math.PI;

      // ─ OFFSET VERTICAL ──────────────────────────────────────────────
      // Décaler vers le bas pour que les pieds de l'avatar s'alignent
      // au bas de la capsule Havok = -(hauteur_capsule / 2) = -1.
      rootNode.position.y = -PlayerController.CAPSULE_HEIGHT / 2;

      // Arrêter toutes les animations lues (Babylon autoplay souvent la première)
      result.animationGroups.forEach(ag => ag.stop());

      // Assigner les animations trouvées
      this.animIdle = result.animationGroups.find(ag => ag.name === 'Idle') || null;
      this.animRun = result.animationGroups.find(ag => ag.name === 'Run') || null;
      this.animFall = result.animationGroups.find(ag => ag.name === 'Falling' || ag.name === 'Fall') || null;

      this.isLoaded = true;
    } catch (error) {
      console.error("Erreur de chargement du modèle 3D :", error);
    }
  }

  /**
   * Crée le système de particules de poussière aux pieds du joueur.
   * emitRate = 0 par défaut — activé par updateAnimation() pendant Run.
   */
  private createDustSystem(): void {
    const dust = new ParticleSystem('runDust', 30, this.scene);
    dust.emitter        = this.mesh;
    dust.minEmitBox     = new Vector3(-0.3, -PlayerController.CAPSULE_HEIGHT / 2, -0.3);
    dust.maxEmitBox     = new Vector3( 0.3, -PlayerController.CAPSULE_HEIGHT / 2,  0.3);
    dust.color1         = new Color4(0.45, 0.30, 0.15, 0.6);  // marron terre
    dust.color2         = new Color4(0.30, 0.50, 0.10, 0.4);  // vert feuille
    dust.minSize        = 0.05;
    dust.maxSize        = 0.15;
    dust.minLifeTime    = 0.2;
    dust.maxLifeTime    = 0.5;
    dust.emitRate       = 0;  // désactivé par défaut
    dust.gravity        = new Vector3(0, -2, 0);
    dust.direction1     = new Vector3(-0.5, 0.3, -0.5);
    dust.direction2     = new Vector3( 0.5, 0.8,  0.5);
    dust.start();  // démarrer le système (emitRate=0 → aucune particule jusqu'à Run)
    this.dustSystem = dust;
  }

  /**
   * Pilote le controller d'animations (Idle / Run / Fall).
   */
  private updateAnimation(): void {
    if (!this.isLoaded) return;

    let targetAnim: AnimationGroup | null = null;
    let wantDust = false;

    if (!this.isGrounded()) {
      targetAnim = this.animFall;
    } else {
      const vel = this.aggregate.body.getLinearVelocity();
      const horizSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

      if (horizSpeed > 0.1) {
        targetAnim = this.animRun;
        wantDust   = true;
      } else {
        targetAnim = this.animIdle;
      }
    }

    // Pilotage particules
    if (this.dustSystem) {
      this.dustSystem.emitRate = wantDust ? 20 : 0;
    }

    // On ne stoppe et on ne trigger le play que s'il y a un changement d'état (anti play cumulatifs)
    if (targetAnim && targetAnim !== this.currentAnim) {
      if (this.currentAnim) {
        this.currentAnim.stop();
      }
      targetAnim.play(true);
      this.currentAnim = targetAnim;
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
