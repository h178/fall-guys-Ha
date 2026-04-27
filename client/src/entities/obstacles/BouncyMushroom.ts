import {
  Scene,
  Vector3,
  MeshBuilder,
  Mesh,
  PhysicsBody,
  PhysicsMotionType,
  PhysicsShapeCylinder,
} from '@babylonjs/core';
import type { IObstacle } from './IObstacle';
import { MaterialSystem } from '../../core/MaterialSystem';
import { StandardMaterial, Color3 } from '@babylonjs/core';

export class BouncyMushroom implements IObstacle {
  private pivot: Mesh;
  private trunkMesh: Mesh;
  private capMesh: Mesh;
  private body: PhysicsBody;
  private shape: PhysicsShapeCylinder;
  private cooldown: number = 0;

  constructor(scene: Scene, position: Vector3) {
    this.pivot = MeshBuilder.CreateBox('mushroomPivot', { size: 0.1 }, scene);
    this.pivot.position = position;
    this.pivot.isVisible = false;

    this.trunkMesh = MeshBuilder.CreateCylinder('mushroomTrunk', { height: 1.5, diameter: 1 }, scene);
    this.trunkMesh.parent = this.pivot;
    this.trunkMesh.position.y = 1.5 / 2;
    this.trunkMesh.material = MaterialSystem.createTrunkMaterial(scene);
    
    const redMat = new StandardMaterial('mat_red', scene);
    redMat.diffuseColor = new Color3(1.0, 0.2, 0.2);

    this.capMesh = MeshBuilder.CreateSphere('mushroomCap', { diameter: 3 }, scene);
    this.capMesh.parent = this.pivot;
    this.capMesh.position.y = 1.5;
    this.capMesh.scaling.y = 0.5;
    this.capMesh.material = redMat;

    this.shape = new PhysicsShapeCylinder(
        new Vector3(0, 0, 0),
        new Vector3(0, 1.5, 0),
        0.5,
        scene
    );
    this.body = new PhysicsBody(this.pivot, PhysicsMotionType.STATIC, false, scene);
    this.body.shape = this.shape;
  }

  update(dt: number, players?: { mesh: Mesh }[]): void {
    let player: any = null;
    if (players) {
       for (const p of players) {
          // Identify local player via applyImpulse
          if ('applyImpulse' in p) {
             player = p;
             break;
          }
       }
    }
    if (!player) return;
    if (this.cooldown > 0) this.cooldown -= dt;
    
    if (this.cooldown <= 0 && this.capMesh.intersectsMesh(player.mesh || player.getMesh(), true)) {
      this.cooldown = 0.5;
      const toPlayer = (player.mesh || player.getMesh()).position.subtract(this.pivot.position);
      toPlayer.y = 0;
      toPlayer.normalize();
      toPlayer.y = 1.5; // vecteur ascendant pour l'effets bump
      player.applyImpulse(toPlayer.scale(50)); // BOINC physique !
      player.stun(0.5);
    }
  }

  dispose(): void {
    this.body.dispose();
    this.shape.dispose();
    this.capMesh.dispose();
    this.trunkMesh.dispose();
    this.pivot.dispose();
  }
}
