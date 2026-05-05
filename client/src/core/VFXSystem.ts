import {
  Scene,
  Vector3,
  Texture,
  Color4,
  ParticleSystem,
} from '@babylonjs/core';

export class VFXSystem {
    private static systems: Map<string, ParticleSystem> = new Map();

    /**
     * Déclenche un burst de particules sans réinstanciation (Pooling).
     */
    public static emit(scene: Scene, position: Vector3, theme: string): void {
        let ps = this.systems.get(theme);

        if (!ps) {
            ps = new ParticleSystem("contactParticles_" + theme, 500, scene);
            
            // Configuration commune
            ps.minSize = 0.05;
            ps.maxSize = 0.2;
            ps.gravity = new Vector3(0, -2, 0);
            ps.minEmitBox = new Vector3(-0.2, -0.1, -0.2);
            ps.maxEmitBox = new Vector3(0.2, 0.1, 0.2);
            ps.renderingGroupId = 0; // Isoler derrière le joueur (layer 1)
            ps.emitRate = 0; // burst uniquement via manualEmitCount (pas d'émission continue)
            ps.disposeOnStop = false;
            ps.targetStopDuration = 0.12; // stop auto rapide après burst

            // Thématique
            if (theme === 'jungle') {
                ps.particleTexture = new Texture("assets/textures/grass_particle.png", scene);
                ps.color1 = new Color4(0.1, 0.5, 0.1, 1);
            } else if (theme === 'ice') {
                ps.particleTexture = new Texture("assets/textures/ice_shard.png", scene);
                ps.color1 = new Color4(0.8, 0.9, 1.0, 1);
            } else {
                ps.particleTexture = new Texture("assets/textures/dust_puff.png", scene);
                ps.color1 = new Color4(0.9, 0.9, 0.8, 1);
            }

            this.systems.set(theme, ps);
        }

        ps.emitter = position;
        ps.manualEmitCount = 30;
        if (ps.isStarted()) ps.stop();
        ps.start();
    }
}
