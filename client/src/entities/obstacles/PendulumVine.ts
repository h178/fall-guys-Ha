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
import type { IObstacle } from './IObstacle';
import { MaterialSystem } from '../../core/MaterialSystem';

export class PendulumVine implements IObstacle {
  private static readonly SPEED = 2.5;

  private pivot: TransformNode;
  private vineMesh: Mesh;
  private bumperMesh: Mesh;
  private body: PhysicsBody;
  private shape: PhysicsShapeCylinder;
  
  private timer = 0;

  constructor(scene: Scene, position: Vector3) {
    this.pivot = new TransformNode('pendulumPivot', scene);
    // Le pivot est placé en hauteur (la liane pend vers le bas)
    this.pivot.position = new Vector3(position.x, position.y + 8, position.z);
    this.pivot.rotationQuaternion = Quaternion.Identity();

    // La liane (tige) descend à partir du pivot
    this.vineMesh = MeshBuilder.CreateCylinder('pendulumVine', { height: 7, diameter: 0.2 }, scene);
    this.vineMesh.parent = this.pivot;
    this.vineMesh.position.y = -3.5;
    this.vineMesh.material = MaterialSystem.createTrunkMaterial(scene);

    // Le bumper (la boule au bout)
    this.bumperMesh = MeshBuilder.CreateSphere('pendulumBumper', { diameter: 2 }, scene);
    this.bumperMesh.parent = this.pivot;
    this.bumperMesh.position.y = -7.5;
    this.bumperMesh.material = MaterialSystem.createArmMaterial(scene);

    // Collider sur le bumper
    this.shape = new PhysicsShapeCylinder(
      new Vector3(0, 0, 0),
      new Vector3(0, 0.1, 0),
      1,
      scene
    );
    this.body = new PhysicsBody(this.bumperMesh, PhysicsMotionType.ANIMATED, false, scene);
    this.body.shape = this.shape;
    this.body.disablePreStep = false;
  }

  update(dt: number, players?: { mesh: Mesh }[]): void {
    this.timer += dt;
    // Balance entre -45 et +45 degrés sur l'axe Z
    const angle = Math.sin(this.timer * PendulumVine.SPEED) * (Math.PI / 4);
    this.pivot.rotationQuaternion = Quaternion.RotationAxis(Vector3.Forward(), angle);

    // Knockback
    if (players) {
        for (const p of players) {
            if ('applyImpulse' in p && 'stun' in p && this.bumperMesh.intersectsMesh(p.mesh, true)) {
                // Direction : propulse latéralement ou vers l'avant
                const toPlayer = p.mesh.position.subtract(this.bumperMesh.getAbsolutePosition());
                toPlayer.y = 0;
                toPlayer.normalize();
                toPlayer.y = 1.0; // vecteur ascendant
                (p as any).applyImpulse(toPlayer.scale(30)); 
                (p as any).stun(0.8);
            }
        }
    }
  }

  dispose(): void {
    this.body.dispose();
    this.shape.dispose();
    this.bumperMesh.dispose();
    this.vineMesh.dispose();
    this.pivot.dispose();
  }
}
