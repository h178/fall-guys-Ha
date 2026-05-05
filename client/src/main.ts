import './styles/ui.css';
import { Game } from './core/Game';
import { GameLevel } from './scenes/GameLevel';

// PhysicsTestScene.ts conservé dans src/scenes/ pour debug futur.
// RotatingHammer, PlayerController, sol → tout dans GameLevel.

(async () => {
  console.log('🟦 [BOOT] main.ts start');
  const game = new Game('renderCanvas');
  console.log('🟩 [BOOT] Game created');

  game.setupCamera();
  game.setupLight();
  console.log('🟩 [BOOT] Camera + Light ready');

  // Démarrer la boucle de rendu ASAP (ne pas bloquer sur Havok).
  game.start();
  console.log('🟩 [BOOT] RenderLoop started');

  const camera = game.getCamera();
  if (!camera) throw new Error('Camera not initialized — appeler setupCamera() avant GameLevel');

  console.log('🟦 [BOOT] Init Havok physics…');
  game.initPhysics()
    .then(async () => {
      console.log('🟩 [BOOT] Havok physics OK');

      const { LEVEL_JUNGLE } = await import('./scenes/LevelConfig');
      console.log('🟩 [BOOT] LevelConfig loaded:', LEVEL_JUNGLE.name);

      const level = new GameLevel(game.getScene(), LEVEL_JUNGLE);
      console.log('🟦 [BOOT] GameLevel created');

      level.setup(camera, game.getShadowGenerator(), game);
      console.log('✅ [BOOT] Level setup done');
    })
    .catch((err) => {
      console.error('🟥 [BOOT] Havok init FAILED — rendu actif, niveau non chargé', err);
    });
})();
