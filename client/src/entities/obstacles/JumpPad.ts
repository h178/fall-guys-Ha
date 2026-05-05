import {
  Scene,
  Vector3,
  TransformNode,
  MeshBuilder,
  Mesh,
  PhysicsAggregate,
  PhysicsShapeType,
  Color3,
  StandardMaterial,
} from '@babylonjs/core';
import type { IObstacle } from './IObstacle';

export class JumpPad implements IObstacle {
  private pivot: TransformNode;
  private baseMesh: Mesh;
  private triggerMesh: Mesh;

  private timer: number = 0;
  private squashY: number = 1.0;

  constructor(scene: Scene, position: Vector3) {
    this.pivot = new TransformNode('jumpPadPivot', scene);
    this.pivot.position = position.clone();

    // Base visuelle verte flashy
    this.baseMesh = MeshBuilder.CreateCylinder('jumpPadBase', { height: 0.4, diameter: 3 }, scene);
    this.baseMesh.parent = this.pivot;
    const baseMat = new StandardMaterial('mat_jumppad', scene);
    baseMat.diffuseColor = new Color3(0.2, 1.0, 0.2);
    this.baseMesh.material = baseMat;

    // Physique base (statique)
    new PhysicsAggregate(
      this.baseMesh,
      PhysicsShapeType.CYLINDER,
      { mass: 0, friction: 0.5, restitution: 0.0 }, // Pas de restitution Havok
      scene
    );

    // Trigger invisible de détection
    this.triggerMesh = MeshBuilder.CreateCylinder('jumpPadTrigger', { height: 0.1, diameter: 2.8 }, scene);
    this.triggerMesh.parent = this.pivot;
    this.triggerMesh.position.y = 0.25; // Juste au-dessus de la base
    this.triggerMesh.isVisible = false;
  }

  update(dt: number, players?: { mesh?: Mesh; getMesh?: () => Mesh }[]): void {
    if (this.timer > 0) this.timer -= dt;

    // Interpolation du "Squash" (retour progressif à scale=1)
    this.squashY += (1.0 - this.squashY) * 10 * dt;
    this.baseMesh.scaling.y = this.squashY;

    if (this.timer <= 0 && players) {
      let hit = false;
      for (const p of players) {
        const pMesh = p.mesh || (p.getMesh ? p.getMesh() : null);
        if (pMesh && 'applyImpulse' in p && this.triggerMesh.intersectsMesh(pMesh, false)) {
          (p as any).applyImpulse(new Vector3(0, 20, 0)); // Hotfix Havok 1.3
          hit = true;
        }
      }
      if (hit) {
        this.timer = 0.5; // Cooldown
        this.squashY = 0.2; // Déclenche le Squash visuel
      }
    }
  }

  dispose(): void {
    this.triggerMesh.dispose();
    this.baseMesh.dispose();
    this.pivot.dispose();
  }
}
