import {
  Scene,
  Vector3,
  Quaternion,
  TransformNode,
  MeshBuilder,
  Mesh,
  PhysicsBody,
  PhysicsMotionType,
  PhysicsShapeCylinder,
} from '@babylonjs/core';
import { MaterialSystem } from '../../core/MaterialSystem';
import type { IObstacle } from './IObstacle';

/**
 * Marteau rotatif — obstacle dynamique de type Fall Guys.
 *
 * Architecture physique :
 *  - Un TransformNode "pivot" positionné au CENTRE du pilier
 *  - Pilier + bras sont des meshes ENFANTS du pivot (parenting visuel)
 *  - UN SEUL PhysicsBody ANIMATED sur le pivot (box englobant le bras)
 *  - body.disablePreStep = false → synchronisation Havok ↔ TransformNode
 *
 * Rotation :
 *  - Axe Y (horizontal) : le bras tourne comme une barrière de parking
 *  - Via Quaternion.RotationAxis() × multiply() (JAMAIS rotation.y +=)
 *
 * Interaction :
 *  - ANIMATED = pousse les corps DYNAMIC (joueur) sans être affecté
 *  - Le joueur ne peut PAS arrêter ou dévier le marteau
 *
 * Cycle de vie :
 *   const hammer = new RotatingHammer(scene, new Vector3(0, 0, 8));
 *   // dans la boucle :
 *   hammer.update(deltaTime);
 *   // nettoyage :
 *   hammer.dispose();
 */
export class RotatingHammer implements IObstacle {
  // ─── Constantes de géométrie et gameplay ────────────────────────────
  private static readonly PILLAR_HEIGHT   = 4;    // hauteur du pilier central
  private static readonly PILLAR_DIAMETER = 0.6;  // diamètre du pilier
  private static readonly ARM_LENGTH      = 6;    // longueur totale du bras
  private static readonly ARM_HEIGHT      = 1;    // épaisseur verticale du bras
  private static readonly ROTATION_SPEED  = 1.5;  // radians/seconde ≈ 1 tour/4s

  // ─── Propriétés privées ─────────────────────────────────────────────
  private pivot:          TransformNode;
  private pillar:         Mesh;
  private arm:            Mesh;
  private collisionShape: PhysicsShapeCylinder;
  private body:           PhysicsBody;

  // ─── Constructeur ───────────────────────────────────────────────────

  /**
   * @param scene    La scène Babylon.js
   * @param position Centre de la BASE du pilier (là où il touche le sol).
   *                 Ex: new Vector3(0, 0, 8) = base au sol à Z=8
   */
  constructor(scene: Scene, position: Vector3) {
    this.pivot          = this.createPivot(scene, position);
    this.pillar         = this.createPillar(scene);
    this.arm            = this.createArm(scene);
    this.collisionShape = this.createCollisionShape(scene);
    this.body           = this.createPhysicsBody(scene);
  }

  // ─── Méthodes d'initialisation ──────────────────────────────────────

  /**
   * Crée le nœud pivot, racine de toute la hiérarchie du marteau.
   *
   * Placement :
   *  - X, Z = position passée en paramètre
   *  - Y = position.y + PILLAR_HEIGHT/2
   *    → Le pivot est au CENTRE DU PILIER (mi-hauteur)
   *    → Si base à Y=0 et pilier fait 4 unités, pivot à Y=2
   *
   * Le rotationQuaternion DOIT être initialisé avant toute liaison
   * avec un PhysicsBody. Si null, Babylon utilise les Euler par défaut
   * ce qui entre en conflit avec le système de quaternions de Havok.
   */
  private createPivot(scene: Scene, basePosition: Vector3): TransformNode {
    const pivot = new TransformNode('hammerPivot', scene);
    pivot.position = new Vector3(
      basePosition.x,
      basePosition.y + RotatingHammer.PILLAR_HEIGHT / 2,
      basePosition.z
    );
    // Initialisation OBLIGATOIRE du quaternion avant liaison physics
    pivot.rotationQuaternion = Quaternion.Identity();
    return pivot;
  }

  /**
   * Crée le cylindre visuel du pilier central.
   * Parent = pivot → le pilier tourne avec le pivot.
   * Position locale (0,0,0) = centré sur le pivot (mi-hauteur).
   */
  private createPillar(scene: Scene): Mesh {
    const pillar = MeshBuilder.CreateCylinder(
      'hammerPillar',
      {
        height:       RotatingHammer.PILLAR_HEIGHT,
        diameter:     RotatingHammer.PILLAR_DIAMETER,
        tessellation: 12,
      },
      scene
    );
    pillar.parent       = this.pivot;
    pillar.material     = MaterialSystem.createPillarMaterial(scene);
    pillar.receiveShadows = true;
    return pillar;
  }

  /**
   * Crée le rondin cylindrique horizontal du bras (reskin Forêt).
   * Visuel : cylindre couché sur l'axe X (rotation locale Z = π/2).
   * Physique : le PhysicsShapeBox reste identique (approximation valide).
   */
  private createArm(scene: Scene): Mesh {
    const arm = MeshBuilder.CreateCylinder(
      'hammerArm',
      {
        height:       RotatingHammer.ARM_LENGTH,
        diameter:     RotatingHammer.ARM_HEIGHT,
        tessellation: 10,
      },
      scene
    );
    arm.parent = this.pivot;
    arm.position = new Vector3(RotatingHammer.ARM_LENGTH / 2, 0, 0);
    // Orienter le cylindre horizontalement sur l'axe X
    arm.rotation.z = Math.PI / 2;
    arm.material   = MaterialSystem.createTrunkMaterial(scene);
    arm.receiveShadows = true;
    return arm;
  }

  /**
   * Crée la shape de collision (box englobante du bras).
   *
   * La shape est exprimée en ESPACE LOCAL du pivot (body parent).
   *  - center  = Vector3(ARM_LENGTH/2, 0, 0) → aligne la box sur le bras visuel
   *  - extents = dimensions réelles du bras
   *
   * Note : On ne crée PAS de shape pour le pilier — sa géométrie
   * cylindrique fine génère rarement des collisions significatives
   * avec la capsule du joueur. Simplification volontaire Sprint 2.
   */
  private createCollisionShape(scene: Scene): PhysicsShapeCylinder {
    const shape = new PhysicsShapeCylinder(
        new Vector3(-RotatingHammer.ARM_LENGTH / 2, 0, 0), // Point A (base)
        new Vector3(RotatingHammer.ARM_LENGTH / 2, 0, 0),  // Point B (top)
        RotatingHammer.ARM_HEIGHT / 2,                     // Rayon
        scene
    );
    return shape;
  }

  /**
   * Crée le corps physique Havok ANIMATED sur le pivot.
   *
   * ANIMATED vs DYNAMIC vs STATIC :
   *  - STATIC   : immobile, ignore toutes les forces → ne peut pas tourner
   *  - DYNAMIC  : affecté par le moteur physique → le joueur pourrait l'arrêter
   *  - ANIMATED : contrôlé par le code (nous), pousse les DYNAMIC, n'est
   *               JAMAIS affecté par les corps dynamiques. Correct pour un obstacle.
   *
   * PIÈGE CRITIQUE — disablePreStep :
   *  - Par défaut, disablePreStep = true pour les bodies ANIMATED
   *  - Avec disablePreStep = true, Havok recalcule la position du body
   *    depuis le TransformNode UNE SEULE FOIS à l'init, puis l'ignore.
   *  - Le marteau tourne visuellement mais son collider reste figé.
   *  - En mettant disablePreStep = false, Havok synchronise le body
   *    avec le TransformNode à CHAQUE step physique → collision correcte.
   */
  private createPhysicsBody(scene: Scene): PhysicsBody {
    const body = new PhysicsBody(
      this.pivot,
      PhysicsMotionType.ANIMATED,
      false,   // startsAsleep = false → actif immédiatement
      scene
    );

    body.shape = this.collisionShape;

    // ⚠️ LIGNE CRITIQUE — sans elle, le collider ne suit pas la rotation
    body.disablePreStep = false;

    return body;
  }

  // ─── Boucle de mise à jour ──────────────────────────────────────────

  /**
   * Fait tourner le marteau autour de l'axe Y (rotation horizontale).
   * Doit être appelée à chaque frame depuis GameLevel.
   *
   * @param deltaTime Temps en SECONDES depuis la dernière frame.
   *
   * Technique de rotation quaternion :
   *  - On calcule un quaternion INCRÉMENTAL pour cette frame
   *  - On le MULTIPLIE au quaternion courant (composition de rotations)
   *  - NE PAS écrire rotation.y += angle : l'Euler conflict avec Havok
   *  - NE PAS utiliser setTargetTransform() : on met à jour le TN directement,
   *    disablePreStep=false s'occupe de la synchronisation physique.
   */
  update(deltaTime: number, _players?: { mesh: Mesh }[]): void {
    const angle     = RotatingHammer.ROTATION_SPEED * deltaTime;
    const increment = Quaternion.RotationAxis(Vector3.Up(), angle);

    // Composition : rotation_finale = rotation_actuelle × incrément
    this.pivot.rotationQuaternion =
      this.pivot.rotationQuaternion!.multiply(increment);
  }

  // ─── Nettoyage ──────────────────────────────────────────────────────

  /**
   * Libère toutes les ressources dans l'ordre correct :
   * body → shape → meshes → pivot.
   * Le pivot EN DERNIER car les meshes enfants en dépendent.
   */
  dispose(): void {
    this.body.dispose();
    this.collisionShape.dispose();
    this.arm.dispose();
    this.pillar.dispose();
    this.pivot.dispose();
  }

  /** Expose le bras pour l'enregistrement comme shadow caster. */
  getArmMesh(): Mesh  { return this.arm; }

  /** Expose le pilier pour l'enregistrement comme shadow caster. */
  getPillarMesh(): Mesh { return this.pillar; }
}
