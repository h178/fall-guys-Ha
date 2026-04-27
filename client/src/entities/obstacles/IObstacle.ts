import type { Mesh } from '@babylonjs/core';
/**
 * Contrat commun de tous les obstacles du jeu FG.
 *
 * Chaque obstacle DOIT implémenter :
 *  - update(deltaTime)  : logique frame-par-frame (animation, état)
 *  - dispose()          : libération des ressources (meshes, bodies)
 *
 * Usage dans GameLevel :
 *   const obstacles: IObstacle[] = [new RotatingHammer(...), ...];
 *   obstacles.forEach(o => o.update(dt));
 */
export interface IObstacle {
  /**
   * Met à jour l'état de l'obstacle pour la frame courante.
   * @param deltaTime Temps écoulé depuis la dernière frame, en SECONDES.
   * @param players Liste de tous les joueurs (local + distants) pour la physique
   */
  update(deltaTime: number, players?: { mesh: Mesh }[]): void;

  /**
   * Libère toutes les ressources créées par cet obstacle
   * (meshes, physics bodies, shapes, observables).
   * À appeler avant de supprimer l'obstacle de la scène.
   */
  dispose(): void;
}
