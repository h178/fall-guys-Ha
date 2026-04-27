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

export class RotatingLily implements IObstacle {
  private static readonly SPEED = 2.0;

  private pivot: TransformNode;
  private mesh: Mesh;
  private body: PhysicsBody;
  private shape: PhysicsShapeCylinder;

  constructor(scene: Scene, position: Vector3) {
    this.pivot = new TransformNode('lilyPivot', scene);
    this.pivot.position = position;
    this.pivot.rotationQuaternion = Quaternion.Identity();

    this.mesh = MeshBuilder.CreateCylinder('lilyMesh', { height: 0.5, diameter: 10 }, scene);
    this.mesh.parent = this.pivot;
    this.mesh.material = MaterialSystem.createFoliageMaterial(scene);
    this.mesh.position.y = 0.25;

    this.shape = new PhysicsShapeCylinder(
        new Vector3(0, 0, 0),
        new Vector3(0, 0.5, 0),
        5,
        scene
    );
    this.body = new PhysicsBody(this.pivot, PhysicsMotionType.ANIMATED, false, scene);
    this.body.shape = this.shape;
    this.body.disablePreStep = false;
  }

  update(dt: number, players?: { mesh: Mesh }[]): void {
    const angle = RotatingLily.SPEED * dt;
    const increment = Quaternion.RotationAxis(Vector3.Up(), angle);
    this.pivot.rotationQuaternion = this.pivot.rotationQuaternion!.multiply(increment);

    let player: any = null;
    if (players) {
       for (const p of players) {
          if ('conveyorVelocity' in p) {
             player = p;
             break;
          }
       }
    }

    if (player && this.mesh.intersectsMesh(player.mesh || player.getMesh(), true)) {
      const toPlayer = (player.mesh || player.getMesh()).position.subtract(this.pivot.position);
      toPlayer.y = 0;
      // Force de rotation convertie en vélocité de tapis roulant
      const tangent = Vector3.Cross(new Vector3(0, Math.sign(RotatingLily.SPEED), 0), toPlayer).normalize();
      player.conveyorVelocity = tangent.scale(1.2 * Math.abs(RotatingLily.SPEED)); // (valeur ajustée)
    }
  }

  dispose(): void {
    this.body.dispose();
    this.shape.dispose();
    this.mesh.dispose();
    this.pivot.dispose();
  }
}
