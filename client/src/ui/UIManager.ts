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

  private lobbyOverlay: HTMLDivElement;
  private txtCountdown: HTMLHeadingElement;
  private btnReady: HTMLButtonElement;

  constructor() {
    // Assertions non-null : les éléments sont dans le HTML statique.
    // Un ID mal typé → ReferenceError immédiat → debug facile.
    this.menu       = document.getElementById('main-menu')!;
    this.hud        = document.getElementById('hud')!;
    this.timer      = document.getElementById('timer')!;
    this.victory    = document.getElementById('victory-message')!;
    this.playButton = document.getElementById('btn-play')! as HTMLButtonElement;

    // Création dynamique du Lobby Overlay
    this.lobbyOverlay = document.createElement('div');
    this.lobbyOverlay.id = 'lobby-overlay';
    this.lobbyOverlay.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:100; display:flex; flex-direction:column; justify-content:center; align-items:center; color:white; font-family:"Fredoka One", sans-serif;';
    
    this.txtCountdown = document.createElement('h1');
    this.txtCountdown.id = 'txt-countdown';
    this.txtCountdown.style.cssText = 'font-size:8rem; margin:0; text-shadow: 2px 2px 0 #000;';
    this.txtCountdown.textContent = 'ATTENTE...';
    
    this.btnReady = document.createElement('button');
    this.btnReady.id = 'btn-ready';
    this.btnReady.textContent = 'PRÊT';
    this.btnReady.style.cssText = 'padding:20px 60px; font-size:3rem; font-weight:bold; cursor:pointer; background:#5DAB28; color:white; border:4px solid #fff; border-radius:15px; margin-bottom:40px; font-family:inherit; text-transform:uppercase; box-shadow: 0 8px 0 #3D7A1A; transition: transform 0.1s;';
    
    this.lobbyOverlay.appendChild(this.btnReady);
    this.lobbyOverlay.appendChild(this.txtCountdown);
    document.getElementById('ui-layer')?.appendChild(this.lobbyOverlay);
  }

  public hideLobby(): void { this.lobbyOverlay.style.display = 'none'; }
  public showLobby(): void { 
    this.lobbyOverlay.style.display = 'flex'; 
    this.btnReady.style.display = 'block'; 
    this.btnReady.disabled = false;
    this.btnReady.innerText = "PRÊT";
    this.txtCountdown.innerText = "";
  }
  
  public showGameOver(winners: string[], localSessionId: string): void {
    this.lobbyOverlay.style.display = 'flex';
    this.btnReady.style.display = 'none';
    
    const rank = winners.indexOf(localSessionId);
    if (rank !== -1) {
      this.txtCountdown.innerText = `VICTOIRE !\nRang: ${rank + 1}`;
      this.txtCountdown.style.color = "white"; // réinitialiser au cas où
    } else {
      this.showEliminated();
    }
  }

  public showEliminated(): void {
    this.lobbyOverlay.style.display = 'flex';
    this.btnReady.style.display = 'none';
    this.txtCountdown.innerText = "ÉLIMINÉ";
    this.txtCountdown.style.color = "red";
  }

  public updateCountdown(val: number): void {
    // Masquer le bouton PRÊT dès que le décompte commence
    this.btnReady.style.display = 'none'; 
    
    if (val > 0) {
        this.txtCountdown.innerText = val.toFixed(0);
    } else {
        this.txtCountdown.innerText = "GO!";
        // Masquage final après 1s
        setTimeout(() => { 
          if (this.txtCountdown.innerText === "GO!") this.hideLobby(); 
        }, 1000);
    }
  }
  
  public onReadyClicked(callback: () => void): void { 
    this.btnReady.addEventListener('click', () => {
      this.btnReady.disabled = true;
      this.btnReady.style.opacity = '0.5';
      this.btnReady.innerText = 'EN ATTENTE...';
      callback();
    });
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

  showQualified(rank: number): void {
    this.victory.textContent = `QUALIFIÉ ! #${rank}`;
    this.victory.classList.add('visible');
  }
}
