import {
  Scene,
  Vector3,
  Quaternion,
  TransformNode,
  MeshBuilder,
  Mesh,
  PhysicsBody,
  PhysicsMotionType,
  PhysicsShapeBox,
  PhysicsShapeContainer,
  Color3,
} from '@babylonjs/core';
import type { IObstacle } from './IObstacle';
import { MaterialSystem } from '../../core/MaterialSystem';

export class RotarySweeper implements IObstacle {
  private static readonly BASE_SPEED    = 1.5;
  private static readonly SPEED_VARIANCE = 1.0;

  private pivot:   TransformNode;
  private pillar:  Mesh;
  private armLow:  Mesh;
  private armHigh: Mesh;
  private body:    PhysicsBody;
  private shape:   PhysicsShapeContainer;

  private timer = 0;

  constructor(scene: Scene, position: Vector3) {
    // Pivot
    this.pivot = new TransformNode('sweeperPivot', scene);
    this.pivot.position       = position.clone();
    this.pivot.rotationQuaternion = Quaternion.Identity();

    // Pilier décoratif
    this.pillar = MeshBuilder.CreateCylinder('sweeperPillar', { height: 5, diameter: 0.8, tessellation: 12 }, scene);
    this.pillar.parent     = this.pivot;
    this.pillar.position.y = 2.5;
    this.pillar.material   = MaterialSystem.createNeonMaterial(scene, new Color3(0, 0.9, 1.0));

    // Bras bas (Y=0.8) — le joueur SAUTE par-dessus
    this.armLow = MeshBuilder.CreateBox('sweeperArmLow', { width: 8, height: 0.8, depth: 0.8 }, scene);
    this.armLow.parent     = this.pivot;
    this.armLow.position.y = 0.8;
    this.armLow.material   = MaterialSystem.createNeonMaterial(scene, new Color3(0, 0.9, 1.0));

    // Bras haut (Y=2.5, décalé de π/2) — le joueur passe DESSOUS
    this.armHigh = MeshBuilder.CreateBox('sweeperArmHigh', { width: 8, height: 0.8, depth: 0.8 }, scene);
    this.armHigh.parent     = this.pivot;
    this.armHigh.position.y = 2.5;
    this.armHigh.rotation.y = Math.PI / 2;
    this.armHigh.material   = MaterialSystem.createNeonMaterial(scene, new Color3(1.0, 0.1, 0.8));

    // Physique : PhysicsShapeContainer avec 2 bras
    this.shape = new PhysicsShapeContainer(scene);

    const shapeLow = new PhysicsShapeBox(
      new Vector3(0, 0.8, 0),
      Quaternion.Identity(),
      new Vector3(8, 0.8, 0.8),
      scene
    );
    const shapeHigh = new PhysicsShapeBox(
      new Vector3(0, 2.5, 0),
      Quaternion.RotationAxis(Vector3.Up(), Math.PI / 2),
      new Vector3(8, 0.8, 0.8),
      scene
    );

    this.shape.addChildFromParent(this.pivot, shapeLow, this.pivot);
    this.shape.addChildFromParent(this.pivot, shapeHigh, this.pivot);

    this.body = new PhysicsBody(this.pivot, PhysicsMotionType.ANIMATED, false, scene);
    this.body.shape = this.shape;
    this.body.disablePreStep = false;
  }

  update(dt: number, _players?: { mesh: Mesh }[]): void {
    this.timer += dt;
    const speed = RotarySweeper.BASE_SPEED
      + Math.sin(this.timer * 0.3) * RotarySweeper.SPEED_VARIANCE;
    const angle     = speed * dt;
    const increment = Quaternion.RotationAxis(Vector3.Up(), angle);
    this.pivot.rotationQuaternion = this.pivot.rotationQuaternion!.multiply(increment);
  }

  dispose(): void {
    this.body.dispose();
    this.shape.dispose();
    this.armHigh.dispose();
    this.armLow.dispose();
    this.pillar.dispose();
    this.pivot.dispose();
  }
}
