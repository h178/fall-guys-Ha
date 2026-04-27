import {
  Scene,
  MeshBuilder,
  PhysicsAggregate,
  PhysicsShapeType,
} from '@babylonjs/core';

/**
 * Scène de validation du moteur physique Havok.
 *
 * Critères de succès visuels :
 *  ✅ La sphère chute depuis Y=8
 *  ✅ Rebondit visiblement sur le sol (>= 2 rebonds observables)
 *  ✅ Se stabilise au repos
 *
 * Diagnostic :
 *  → Sphère traverse le sol → PhysicsAggregate ground mal configuré
 *  → Sphère figée          → enablePhysics() absent ou Havok non init
 */
export function createPhysicsTestScene(scene: Scene): void {
  // ─── SOL STATIQUE ────────────────────────────────────────────────────────────
  const ground = MeshBuilder.CreateGround(
    'ground',
    { width: 20, height: 20 },
    scene
  );
  // mass: 0 → corps statique (ne sera pas affecté par la gravité)
  new PhysicsAggregate(
    ground,
    PhysicsShapeType.BOX,
    { mass: 0 },
    scene
  );

  // ─── SPHÈRE DYNAMIQUE ────────────────────────────────────────────────────────
  const sphere = MeshBuilder.CreateSphere(
    'testSphere',
    { diameter: 1.5 },
    scene
  );
  sphere.position.y = 8; // hauteur de départ suffisante pour observer la chute

  // restitution: 0.7 → rebonds visibles (70% de l'énergie conservée)
  new PhysicsAggregate(
    sphere,
    PhysicsShapeType.SPHERE,
    { mass: 1, restitution: 0.7 },
    scene
  );
}
