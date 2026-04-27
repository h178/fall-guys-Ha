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
} from '@babylonjs/core';
import type { IObstacle } from './IObstacle';
import { MaterialSystem } from '../../core/MaterialSystem';

export class Seesaw implements IObstacle {
  private pivot: TransformNode;
  private boardMesh: Mesh;
  private baseMesh: Mesh;
  private body: PhysicsBody;
  private shape: PhysicsShapeBox;

  private currentAngle = 0;
  private angularVelocity = 0;

  constructor(scene: Scene, position: Vector3) {
    this.pivot = new TransformNode('seesawPivot', scene);
    // Le pivot est placé légèrement en hauteur pour pouvoir basculer
    this.pivot.position = new Vector3(position.x, position.y + 1, position.z);
    this.pivot.rotationQuaternion = Quaternion.Identity();

    this.baseMesh = MeshBuilder.CreateCylinder('seesawBase', { diameter: 1, height: 4 }, scene);
    this.baseMesh.position = new Vector3(position.x, position.y + 0.5, position.z);
    this.baseMesh.rotation.z = Math.PI / 2;
    this.baseMesh.material = MaterialSystem.createPillarMaterial(scene);

    this.boardMesh = MeshBuilder.CreateBox('seesawBoard', { width: 4, height: 0.5, depth: 15 }, scene);
    this.boardMesh.parent = this.pivot;
    this.boardMesh.material = MaterialSystem.createArmMaterial(scene);

    this.shape = new PhysicsShapeBox(
      new Vector3(0, 0, 0),
      Quaternion.Identity(),
      new Vector3(4, 0.5, 15),
      scene
    );

    this.body = new PhysicsBody(this.pivot, PhysicsMotionType.ANIMATED, false, scene);
    this.body.shape = this.shape;
    this.body.disablePreStep = false;
  }

  update(dt: number, players?: { mesh: Mesh }[]): void {
    const MAX_ANGLE = Math.PI / 6; // 30 degrés
    const DAMPING = 0.95;
    const SPRING_FACTOR = 2.0; // Force qui ramène à 0
    const WEIGHT_FACTOR = 0.5; // Influence par joueur

    let torque = 0;
    if (players) {
      for (const p of players) {
        if (this.boardMesh.intersectsMesh(p.mesh, false)) {
          // Calcul du levier par rapport au centre sur l'axe Z local
          const distZ = p.mesh.position.z - this.pivot.position.z; 
          torque += distZ * WEIGHT_FACTOR;
        }
      }
    }

    // Ressort qui pousse l'angle vers 0
    torque += (0 - this.currentAngle) * SPRING_FACTOR;

    this.angularVelocity += torque * dt;
    this.angularVelocity *= DAMPING;
    this.currentAngle += this.angularVelocity * dt;

    // Limites
    this.currentAngle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, this.currentAngle));

    // Application
    this.pivot.rotationQuaternion = Quaternion.RotationAxis(Vector3.Right(), this.currentAngle);
  }

  dispose(): void {
    this.body.dispose();
    this.shape.dispose();
    this.boardMesh.dispose();
    this.baseMesh.dispose();
    this.pivot.dispose();
  }
}
