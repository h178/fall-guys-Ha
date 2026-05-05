import {
  Scene,
  Vector3,
  MeshBuilder,
  Mesh,
  PhysicsBody,
  PhysicsMotionType,
  PhysicsShapeBox,
  Quaternion,
} from '@babylonjs/core';
import type { IObstacle } from './IObstacle';
import { MaterialSystem } from '../../core/MaterialSystem';

export class SlidingWall implements IObstacle {
  private mesh: Mesh;
  private body: PhysicsBody;
  private shape: PhysicsShapeBox;

  private time: number = 0;
  private startX: number;

  constructor(scene: Scene, position: Vector3) {
    this.startX = position.x;

    this.mesh = MeshBuilder.CreateBox('slidingWall', { width: 8, height: 4, depth: 1.5 }, scene);
    // Y=2 pour poser la base du mur (hauteur 4) au sol (Y=0)
    this.mesh.position = position.clone();
    this.mesh.position.y = 2;
    
    // Matériau au choix, ex: rouge/rose
    this.mesh.material = MaterialSystem.createPillarMaterial(scene); // Réutilisation ou autre couleur

    this.shape = new PhysicsShapeBox(
      Vector3.Zero(),
      this.mesh.rotationQuaternion || Quaternion.Identity(),
      new Vector3(8, 4, 1.5),
      scene
    );

    this.body = new PhysicsBody(this.mesh, PhysicsMotionType.ANIMATED, false, scene);
    this.body.shape = this.shape;
    this.body.disablePreStep = false;
  }

  update(dt: number): void {
    this.time += dt;
    // Glisse sur l'axe X : ±6 unités. Ajuster la vitesse via le facteur time.
    this.mesh.position.x = this.startX + Math.sin(this.time * 2) * 6;
  }

  dispose(): void {
    this.body.dispose();
    this.shape.dispose();
    this.mesh.dispose();
  }
}
