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
  private menu: HTMLElement;
  private hud: HTMLElement;
  private timer: HTMLElement;
  private victory: HTMLElement;
  private playButton: HTMLButtonElement;

  private lobbyOverlay: HTMLDivElement;
  private txtCountdown: HTMLHeadingElement;
  private btnReady: HTMLButtonElement;
  private levelGrid: HTMLDivElement;
  private leaderboardPanel: HTMLDivElement;
  private btnReplay: HTMLButtonElement;

  public onVoteCallback?: (levelId: string) => void;
  public onForceLobbyCallback?: () => void;

  constructor() {

    // Assertions non-null : les éléments sont dans le HTML statique.
    this.menu = document.getElementById('main-menu')!;
    this.hud = document.getElementById('hud')!;
    this.timer = document.getElementById('timer')!;
    this.victory = document.getElementById('victory-message')!;
    this.playButton = document.getElementById('btn-play')! as HTMLButtonElement;

    // Création dynamique du Lobby Overlay
    this.lobbyOverlay = document.createElement('div');
    this.lobbyOverlay.id = 'lobby-overlay';
    this.lobbyOverlay.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:100; display:flex; flex-direction:column; justify-content:center; align-items:center; color:white; font-family:"Fredoka One", sans-serif; pointer-events:auto;';

    this.txtCountdown = document.createElement('h1');
    this.txtCountdown.id = 'txt-countdown';
    this.txtCountdown.style.cssText = 'font-size:8rem; margin:0; text-shadow: 2px 2px 0 #000;';
    this.txtCountdown.textContent = 'ATTENTE...';

    this.btnReady = document.createElement('button');
    this.btnReady.id = 'btn-ready';
    this.btnReady.textContent = 'PRÊT';
    this.btnReady.style.cssText = 'padding:20px 60px; font-size:3rem; font-weight:bold; cursor:pointer; background:#5DAB28; color:white; border:4px solid #fff; border-radius:15px; margin-bottom:40px; font-family:inherit; text-transform:uppercase; box-shadow: 0 8px 0 #3D7A1A; transition: transform 0.1s;';

    // Grille de sélection de niveaux (Sprint 18)
    this.levelGrid = document.createElement('div');
    this.levelGrid.id = 'level-grid';
    this.levelGrid.style.cssText = 'display:flex; gap:16px; margin-bottom:30px; flex-wrap:wrap; justify-content:center;';

    const levels = [
      { id: 'jungle', name: '🌴 Jungle Rush' },
      { id: 'space',  name: '🚀 Galactic Rush' },
      { id: 'park',   name: '🎠 Candy Park' },
      { id: 'ice',    name: '❄️ Winter Wipeout' }
    ];

    levels.forEach(lvl => {
      const card = document.createElement('div');
      card.className = 'level-card';
      card.dataset.level = lvl.id;
      
      const title = document.createElement('span');
      title.innerHTML = lvl.name;
      
      const badge = document.createElement('div');
      badge.className = 'vote-count';
      badge.style.cssText = 'position:absolute; bottom:-12px; left:50%; transform:translateX(-50%); background:#FFD700; color:#000; font-size:0.9rem; padding:4px 10px; border-radius:10px; font-weight:bold; border:2px solid #fff; opacity:0; transition:opacity 0.2s;';
      badge.textContent = '0 vote';
      
      card.appendChild(title);
      card.appendChild(badge);
      card.style.cssText = 'padding:16px 24px; border-radius:12px; cursor:pointer; border:3px solid transparent; font-size:1.4rem; font-family:inherit; background:rgba(255,255,255,0.1); transition: all 0.2s; position:relative; display:flex; flex-direction:column; align-items:center;';
      
      card.onmouseenter = () => { if(!card.classList.contains('selected')) card.style.background = 'rgba(255,255,255,0.2)'; card.style.transform = 'scale(1.05)'; };
      card.onmouseleave = () => { if(!card.classList.contains('selected')) card.style.background = 'rgba(255,255,255,0.1)'; card.style.transform = 'scale(1.0)'; };

      card.onclick = () => {
        // Visual feedback (Polish)
        this.levelGrid.querySelectorAll('.level-card').forEach(c => {
          c.classList.remove('selected');
          (c as HTMLElement).style.borderColor = 'transparent';
          (c as HTMLElement).style.boxShadow = 'none';
          (c as HTMLElement).style.background = 'rgba(255,255,255,0.1)';
        });
        card.classList.add('selected');
        card.style.borderColor = '#FFD700'; // Bordure dorée
        card.style.boxShadow = '0 0 15px rgba(255, 215, 0, 0.5)';
        card.style.background = 'rgba(255,215,0,0.2)';
        
        if (this.onVoteCallback) this.onVoteCallback(lvl.id);
      };

      this.levelGrid.appendChild(card);
    });

    this.lobbyOverlay.appendChild(this.levelGrid);
    this.lobbyOverlay.appendChild(this.btnReady);
    this.lobbyOverlay.appendChild(this.txtCountdown);

    // --- Leaderboard UI (Sprint 21) ---
    this.leaderboardPanel = document.createElement('div');
    this.leaderboardPanel.id = 'leaderboard';
    this.leaderboardPanel.style.cssText = 'display:none; flex-direction:column; background:rgba(0,0,0,0.8); padding:20px; border-radius:15px; border:3px solid #00e5ff; margin-top:20px; min-width:300px; max-height:200px; overflow-y:auto;';
    this.lobbyOverlay.appendChild(this.leaderboardPanel);

    // --- Bouton Rejouer (Sprint 21) ---
    this.btnReplay = document.createElement('button');
    this.btnReplay.id = 'btn-replay';
    this.btnReplay.textContent = 'REJOUER';
    this.btnReplay.style.cssText = 'display:none; padding:15px 40px; font-size:2rem; font-weight:bold; cursor:pointer; background:#ff006e; color:white; border:4px solid #fff; border-radius:15px; margin-top:20px; font-family:inherit; text-transform:uppercase; box-shadow: 0 4px 0 #c90057; transition: transform 0.1s;';
    this.btnReplay.onmousedown = () => this.btnReplay.style.transform = 'scale(0.95)';
    this.btnReplay.onmouseup = () => this.btnReplay.style.transform = 'scale(1)';
    this.lobbyOverlay.appendChild(this.btnReplay);

    document.getElementById('ui-layer')?.appendChild(this.lobbyOverlay);

    // --- Bouton Accueil / Quitter (Sprint 28) ---
    const btnHome = document.createElement('button');
    btnHome.innerHTML = '⚙️ CHANGER DE MODE';
    btnHome.style.cssText = 'position:absolute; top:20px; left:20px; padding:10px 20px; font-size:1.2rem; font-weight:bold; cursor:pointer; background:#ff006e; color:white; border:3px solid #fff; border-radius:10px; z-index:200; font-family:"Fredoka One", sans-serif;';
    document.body.appendChild(btnHome);

    btnHome.onclick = () => {
      // 1. Envoyer le signal pour stopper la partie côté serveur
      if (this.onForceLobbyCallback) {
        this.onForceLobbyCallback();
      }
      // 2. Revenir à l'écran de titre proprement
      setTimeout(() => {
        window.location.href = window.location.pathname; 
      }, 100);
    };
  }

  // ─── Lobby ─────────────────────────────────────────────────

  public hideLobby(): void {
    this.lobbyOverlay.style.display = 'none';
  }

  public showLobby(): void {

    this.lobbyOverlay.style.display = 'flex';
    this.btnReady.style.display = 'block';
    this.btnReady.disabled = false;
    this.btnReady.innerText = "PRÊT";
    this.txtCountdown.innerText = "";
    this.txtCountdown.style.color = "white";

    // Reset sélection niveaux
    this.levelGrid.style.display = 'flex';
    this.levelGrid.querySelectorAll('.level-card').forEach(card => {
      card.classList.remove('selected');
      (card as HTMLElement).style.borderColor = 'transparent';
      (card as HTMLElement).style.background = 'rgba(255,255,255,0.1)';
      const badge = card.querySelector('.vote-count');
      if (badge) badge.textContent = '';
    });

    this.leaderboardPanel.style.display = 'none';
    this.btnReplay.style.display = 'none';
    this.btnReplay.disabled = false;
    this.btnReplay.innerText = "REJOUER";
  }

  public updateVotes(votes: Record<string, number>): void {
    this.levelGrid.querySelectorAll('.level-card').forEach(card => {
      const levelId = (card as HTMLElement).dataset.level;
      if (!levelId) return;
      
      const count = votes[levelId] || 0;
      const badge = card.querySelector('.vote-count') as HTMLElement;
      if (badge) {
        badge.textContent = count > 1 ? `${count} votes` : `${count} vote`;
        badge.style.opacity = count > 0 ? '1' : '0';
      }
    });
  }

  public hideReadyButton(): void {
    this.btnReady.style.display = 'none';
  }

  // ─── Game Over ─────────────────────────────────────────────

  public showGameOver(winners: string[], localSessionId: string): void {
    this.lobbyOverlay.style.display = 'flex';
    this.btnReady.style.display = 'none';
    this.leaderboardPanel.style.display = 'flex';
    this.btnReplay.style.display = 'block';

    const rank = winners.indexOf(localSessionId);
    if (rank !== -1) {
      this.txtCountdown.innerText = `VICTOIRE !\nRang: ${rank + 1}`;
      this.txtCountdown.style.color = "white";
    } else {
      this.showEliminated();
    }
  }

  public showEliminated(): void {
    this.lobbyOverlay.style.display = 'flex';
    this.btnReady.style.display = 'none';
    this.leaderboardPanel.style.display = 'flex';
    this.btnReplay.style.display = 'block';
    this.txtCountdown.innerText = "ÉLIMINÉ";
    this.txtCountdown.style.color = "red";
  }

  // ─── Countdown ─────────────────────────────────────────────

  public updateCountdown(val: number): void {
    // Masquer le bouton PRÊT et la grille dès que le décompte commence
    this.btnReady.style.display = 'none';
    this.levelGrid.style.display = 'none';

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

  // ─── Callbacks ─────────────────────────────────────────────

  public onReadyClicked(callback: () => void): void {
    if (!this.btnReady) return;
    this.btnReady.onclick = () => {
      this.btnReady.disabled = true;
      this.btnReady.innerText = 'EN ATTENTE...';
      callback();
    };
  }

  public onLevelVoted(callback: (levelName: string) => void): void {
    this.levelGrid.querySelectorAll('.level-card').forEach(card => {
      card.addEventListener('click', () => {
        // Retirer .selected de toutes les cartes
        this.levelGrid.querySelectorAll('.level-card').forEach(c => {
          c.classList.remove('selected');
          (c as HTMLElement).style.borderColor = 'transparent';
          (c as HTMLElement).style.background = 'rgba(255,255,255,0.1)';
        });

        // Ajouter .selected à la carte cliquée
        card.classList.add('selected');
        (card as HTMLElement).style.borderColor = 'var(--fg-cyan)';
        (card as HTMLElement).style.background = 'rgba(0,229,255,0.15)';
        
        callback((card as HTMLElement).dataset.level!);
      });
    });
  }



  public updateLeaderboard(scores: Record<string, number>, localSessionId: string): void {
    this.leaderboardPanel.innerHTML = '<h2 style="margin:0 0 10px 0; font-size:1.5rem; text-align:center; color:#ffcc00;">🏆 CLASSEMENT GLOBAL</h2>';
    
    // Trier les scores par ordre décroissant
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);

    sorted.forEach(([id, score], index) => {
      const entry = document.createElement('div');
      const isLocal = id === localSessionId;
      entry.style.cssText = `display:flex; justify-content:space-between; padding:5px 10px; font-size:1.2rem; border-bottom:1px solid rgba(255,255,255,0.1); ${isLocal ? 'color:#ffcc00; font-weight:bold; background:rgba(255,204,0,0.1);' : ''}`;
      
      const name = isLocal ? "MOI" : `Joueur ${id.substring(0, 4)}`;
      entry.innerHTML = `<span>#${index + 1} ${name}</span> <span>${score} pts</span>`;
      this.leaderboardPanel.appendChild(entry);
    });
  }

  public onReplayClicked(callback: () => void): void {
    if (!this.btnReplay) return;
    this.btnReplay.onclick = () => {
      this.btnReplay.disabled = true;
      this.btnReplay.innerText = "ATTENTE...";
      callback();
    };
  }

  /**
   * Enregistre le callback déclenché au clic sur le bouton JOUER.
   */
  onPlayClicked(callback: () => void): void {
    this.playButton.addEventListener('click', () => {
      callback();
      this.playButton.blur();
    });
  }

  /**
   * Transition Menu → HUD.
   */
  showHUD(): void {
    this.menu.style.display = 'none';
    this.hud.style.display = 'block';
    this.timer.style.color = 'var(--fg-cyan)';
    this.timer.textContent = '00:00.00';
  }

  hideMenu(): void {
    this.menu.style.display = 'none';
  }

  /**
   * Met à jour l'affichage du chronomètre au format MM:SS.CC.
   */
  updateTimer(elapsedSeconds: number): void {
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = Math.floor(elapsedSeconds) % 60;
    const hundredths = Math.floor((elapsedSeconds % 1) * 100);

    this.timer.textContent =
      `${String(minutes).padStart(2, '0')}:` +
      `${String(seconds).padStart(2, '0')}.` +
      `${String(hundredths).padStart(2, '0')}`;
  }

  public updateSurvivalTimer(remainingSeconds: number): void {
    if (remainingSeconds < 0) remainingSeconds = 0;
    this.timer.textContent = `SURVIE: ${remainingSeconds}s`;
    this.timer.style.color = remainingSeconds < 10 ? "var(--fg-pink)" : "var(--fg-cyan)";
  }

  public updateGlobalTimer(remainingSeconds: number): void {
    if (remainingSeconds < 0) remainingSeconds = 0;
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    this.timer.textContent = `TEMPS: ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    this.timer.style.color = remainingSeconds < 30 ? "var(--fg-pink)" : "var(--fg-cyan)";
  }

  public updateScore(current: number, target: number): void {
    this.timer.textContent = `OBJETS: ${current} / ${target}`;
    this.timer.style.color = current >= target ? "var(--fg-yellow)" : "var(--fg-cyan)";
  }

  /**
   * Affiche le message "QUALIFIÉ !" avec animation bounce.
   */
  showVictory(): void {
    this.victory.classList.add('visible');
  }

  showQualified(rank: number): void {
    this.victory.textContent = `QUALIFIÉ ! #${rank}`;
    this.victory.classList.add('visible');
  }
}
