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

export class TrapTile implements IObstacle {
  private mesh: Mesh;
  private body: PhysicsBody;
  private shape: PhysicsShapeBox;

  private state: 'IDLE' | 'TRIGGERED' | 'FALLING' | 'WAITING' = 'IDLE';
  private timer: number = 0;
  private baseY: number;

  constructor(scene: Scene, position: Vector3, theme: 'jungle' | 'space' | 'park' | 'ice') {
    this.baseY = position.y;

    this.mesh = MeshBuilder.CreateBox('trapTile', { width: 2.8, height: 0.5, depth: 2.8 }, scene);
    this.mesh.position = position.clone();
    this.mesh.material = MaterialSystem.getThemeMaterial(scene, theme, 'trap');

    this.shape = new PhysicsShapeBox(
      Vector3.Zero(),
      this.mesh.rotationQuaternion || Quaternion.Identity(),
      new Vector3(2.8, 0.5, 2.8),
      scene
    );

    this.body = new PhysicsBody(this.mesh, PhysicsMotionType.ANIMATED, false, scene);
    this.body.shape = this.shape;
    this.body.disablePreStep = false;
  }

  update(dt: number, players?: any[]): void {
    switch (this.state) {
      case 'IDLE':
        if (players) {
          for (const p of players) {
            if (this.mesh.intersectsMesh(p.mesh || p.getMesh(), false)) {
              this.state = 'TRIGGERED';
              this.timer = 0.5; // Temps de vibration avant chute
              break;
            }
          }
        }
        break;

      case 'TRIGGERED':
        this.timer -= dt;
        // Vibration visuelle
        this.mesh.position.y = this.baseY + Math.sin(this.timer * 50) * 0.05;
        if (this.timer <= 0) {
          this.state = 'FALLING';
          this.mesh.isVisible = false; // Ou le faire chuter visuellement
          // Désactiver la collision physique en le déplaçant très bas
          this.mesh.position.y = -50; 
          this.timer = 3.0; // Temps avant repop
        }
        break;

      case 'FALLING':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.state = 'IDLE';
          this.mesh.position.y = this.baseY;
          this.mesh.isVisible = true;
        }
        break;
    }
  }

  dispose(): void {
    this.body.dispose();
    this.shape.dispose();
    this.mesh.dispose();
  }
}
