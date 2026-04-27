import './styles/ui.css';
import { Game } from './core/Game';
import { GameLevel } from './scenes/GameLevel';

// PhysicsTestScene.ts conservé dans src/scenes/ pour debug futur.
// RotatingHammer, PlayerController, sol → tout dans GameLevel.

(async () => {
  const game = new Game('renderCanvas');

  await game.initPhysics();
  game.setupCamera();
  game.setupLight();

  const camera = game.getCamera();
  if (!camera) throw new Error('Camera not initialized — appeler setupCamera() avant GameLevel');

  const level = new GameLevel(game.getScene());
  level.setup(camera, game.getShadowGenerator());

  game.start();

  console.log('✅ FG Game initialized — Level loaded');
})();
