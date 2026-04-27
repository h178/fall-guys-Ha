/**
 * Contrôleur DOM de l'UI overlay (menu + HUD).
 *
 * Principe : ce module ne connaît PAS Babylon.js. Il ne manipule
 * que le DOM HTML pur. La communication avec GameLevel se fait
 * via des callbacks (pas de couplage direct).
 *
 * Éléments gérés :
 *  - #main-menu  : écran de démarrage (affiché au lancement)
 *  - #hud        : chronomètre + message victoire (caché au démarrage)
 *  - #timer      : affichage MM:SS.CC
 *  - #victory-message : "QUALIFIÉ !" avec animation bounce
 *  - #btn-play   : bouton JOUER
 */
export class UIManager {
  private menu:       HTMLElement;
  private hud:        HTMLElement;
  private timer:      HTMLElement;
  private victory:    HTMLElement;
  private playButton: HTMLButtonElement;

  constructor() {
    // Assertions non-null : les éléments sont dans le HTML statique.
    // Un ID mal typé → ReferenceError immédiat → debug facile.
    this.menu       = document.getElementById('main-menu')!;
    this.hud        = document.getElementById('hud')!;
    this.timer      = document.getElementById('timer')!;
    this.victory    = document.getElementById('victory-message')!;
    this.playButton = document.getElementById('btn-play')! as HTMLButtonElement;
  }

  /**
   * Enregistre le callback déclenché au clic sur le bouton JOUER.
   *
   * ⚠️  playButton.blur() est CRITIQUE après le clic.
   *     Sans cela, le focus clavier reste sur le bouton → les pressions
   *     WASD sont interprétées comme des actions sur le bouton (scroll,
   *     activation) au lieu d'arriver au canvas Babylon.js.
   */
  onPlayClicked(callback: () => void): void {
    this.playButton.addEventListener('click', () => {
      callback();
      // Rendre le focus au canvas pour que WASD fonctionne immédiatement
      this.playButton.blur();
    });
  }

  /**
   * transition Menu → HUD.
   * Cache le menu (et son overlay pointer-events:auto qui bloquait le canvas).
   * Affiche le HUD (chrono en mode pointer-events:none pour ne pas bloquer).
   */
  showHUD(): void {
    this.menu.style.display = 'none';
    this.hud.style.display  = 'block';
  }

  /**
   * Met à jour l'affichage du chronomètre au format MM:SS.CC.
   * @param elapsedSeconds Temps écoulé en SECONDES (deltaTime cumulé).
   *
   * Format :  00:00.00
   *           MM:SS.CC  (CC = centièmes de seconde)
   */
  updateTimer(elapsedSeconds: number): void {
    const minutes    = Math.floor(elapsedSeconds / 60);
    const seconds    = Math.floor(elapsedSeconds) % 60;
    const hundredths = Math.floor((elapsedSeconds % 1) * 100);

    this.timer.textContent =
      `${String(minutes).padStart(2, '0')}:` +
      `${String(seconds).padStart(2, '0')}.` +
      `${String(hundredths).padStart(2, '0')}`;
  }

  /**
   * Affiche le message "QUALIFIÉ !" avec une animation bounce.
   * L'animation est définie en CSS via la classe .visible (scale 0 → 1).
   */
  showVictory(): void {
    this.victory.classList.add('visible');
  }
}
