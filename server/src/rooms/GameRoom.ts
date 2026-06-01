import { Room, Client } from "colyseus";
import { GameState, Player } from "../schemas/GameState";

/** Structure des messages "transform" reçus du client. */
interface TransformMessage {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  rw: number;
}

export class GameRoom extends Room<GameState> {
  maxClients = 10;
  private readonly MAX_WINNERS = 3;
  private roundTimer: any = null;
  private gameTimeout: any = null;
  private replayVotes = new Set<string>();
  private startReadyTimeout: any = null;

  private static readonly LEVELS = [
    { name: 'jungle', finishZ: 30, mode: 'race' }, // MAJ: Centré à 30
    { name: 'space',  finishZ: 50, mode: 'race' }, // MAJ: Centré à 50
    { name: 'park',   finishZ: 45, mode: 'race' }, // Reste à 45
    { name: 'ice',    finishZ: 42, mode: 'race' }, // MAJ: Centré à 42
  ];
  private currentLevelIndex = 0;

  onCreate(): void {
    this.setState(new GameState());

    // ─ Message handler : finish ────────────────────────────
    this.onMessage("finish", (client) => {
      if (this.state.status !== "PLAYING") return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      // Validation côté serveur dynamique selon le niveau
      const levelInfo = GameRoom.LEVELS[this.currentLevelIndex];
      if (player.z < levelInfo.finishZ - 15) {
        console.warn(`Anti-cheat: ${client.sessionId} trop loin (Z=${player.z}, need ${levelInfo.finishZ})`);
        return;
      }

      if (!this.state.winners.includes(client.sessionId)) {
        this.state.winners.push(client.sessionId);
        
        // Attribution des points : 1 point par victoire (Sprint 26)
        const currentScore = this.state.globalScores.get(client.sessionId) || 0;
        this.state.globalScores.set(client.sessionId, currentScore + 1);

        // Fin de la partie dès qu'on a un gagnant (Sprint 28)
        if (this.roundTimer) this.roundTimer.clear();
        this.endGame();
      }
    });

    // ─ Message handler : transform du joueur ────────────────
    this.onMessage("transform", (client: Client, data: TransformMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      // Position — clamp basique
      player.x = Math.max(-50, Math.min(50, data.x));
      player.y = Math.max(-20, Math.min(50, data.y));
      player.z = Math.max(-50, Math.min(200, data.z));

      // Rotation — quaternion unitaire, composantes [-1,1] par nature
      player.rx = data.rx;
      player.ry = data.ry;
      player.rz = data.rz;
      player.rw = data.rw;
    });

    // ─ Message handler : ready (Lobby) ────────────────────────
    this.onMessage("ready", (client) => {
      if (this.state.status !== "WAITING") return;

      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      player.isReady = true;

      // Vérifier si tous les joueurs sont prêts
      let allReady = true;
      this.state.players.forEach((p) => {
        if (!p.isReady) allReady = false;
      });

      if (allReady && this.state.players.size >= 2) {
        if (this.startReadyTimeout) { this.startReadyTimeout.clear(); this.startReadyTimeout = null; }
        this.startCountdown();
      } else if (allReady && this.state.players.size > 0) {
        // Watchdog: tous prêts mais un seul joueur → armer un départ différé
        if (this.startReadyTimeout) this.startReadyTimeout.clear();
        this.startReadyTimeout = this.clock.setTimeout(() => {
          if (this.state.status === "WAITING") {
            this.startCountdown();
          }
        }, 3000);
      }
    });

    this.onMessage("vote_level", (client, data: { level: string }) => {
      if (this.state.status !== "WAITING") return;
      const validLevels = GameRoom.LEVELS.map(l => l.name);
      if (!validLevels.includes(data.level)) return;
      
      const player = this.state.players.get(client.sessionId);
      if (player) player.votedLevel = data.level;
    });

    this.onMessage("customize", (client, data: { skinHue: number, costumeHue: number, hatStyle: string, gender?: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      // Validation basique
      player.skinHue = Math.max(0, Math.min(360, data.skinHue));
      player.costumeHue = Math.max(0, Math.min(360, data.costumeHue));
      
      const validHats = ["none", "cap", "crown", "beanie"];
      if (validHats.includes(data.hatStyle)) {
        player.hatStyle = data.hatStyle;
      }
      if (data.gender && (data.gender === 'male' || data.gender === 'female')) {
        player.gender = data.gender;
      }
      
      console.log(`🎨 Player ${client.sessionId} customized: skin=${player.skinHue}, hat=${player.hatStyle}`);
    });

    this.onMessage("emote", (client, data: { emote: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (player) {
        player.emote = data.emote;
        // Reset automatique après 3 secondes pour faire disparaître la bulle
        this.clock.setTimeout(() => {
          if (player.emote === data.emote) player.emote = "";
        }, 3000);
      }
    });

    this.onMessage("replay", (client) => {
      if (this.state.status !== "FINISHED") return;
      this.replayVotes.add(client.sessionId);
      
      // Si la majorité des joueurs présents vote "replay", forcer le reset
      if (this.replayVotes.size >= Math.ceil(this.state.players.size / 2)) {
        if (this.gameTimeout) this.gameTimeout.clear();
        this.resetGame();
      }
    });

    this.onMessage("force_lobby", (client) => {
      console.log(`[ROOM] Player ${client.sessionId} force le retour au lobby.`);
      if (this.gameTimeout) this.gameTimeout.clear();
      if (this.roundTimer) this.roundTimer.clear();
      this.resetGame(); // Renvoie tout le monde dans le lobby (WAITING)
    });

    this.onMessage("eliminate", (client) => {
      if (this.state.status !== "PLAYING") return;
      const player = this.state.players.get(client.sessionId);
      if (player && !player.isEliminated) {
        player.isEliminated = true;
        console.log(`💀 Player eliminated: ${client.sessionId}`);
        
        // Tous les niveaux sont en mode "race" maintenant.
        // On vérifie simplement si TOUS les joueurs sont éliminés pour clore la partie
        // sans vainqueur (tout le monde est tombé).
        let allEliminated = true;
        this.state.players.forEach((p) => {
          if (!p.isEliminated) allEliminated = false;
        });
        
        if (allEliminated) {
           console.log("🏁 Tous les joueurs sont éliminés ! Fin de la manche.");
           if (this.roundTimer) this.roundTimer.clear();
           this.endGame();
        }
      }
    });

    console.log("🎮 GameRoom created");
  }

  onJoin(client: Client): void {
    console.log(`➕ Player joined: ${client.sessionId}`);

    const player = new Player();
    player.x = (Math.random() - 0.5) * 4;
    player.y = 1;
    player.z = (Math.random() - 0.5) * 4;

    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client): void {
    console.log(`➖ Player left: ${client.sessionId}`);
    this.state.players.delete(client.sessionId);
    if (this.startReadyTimeout) {
      this.startReadyTimeout.clear();
      this.startReadyTimeout = null;
    }
  }

  onDispose(): void {
    console.log("🗑️ GameRoom disposed");
  }

  // ─── Décompte & Transition ────────────────────────────────
  private startCountdown(): void {
    // Sécurité : ne pas démarrer si la room est vide
    if (this.state.players.size === 0) return;

    // Résoudre le vote : niveau avec le plus de voix (fallback = rotation)
    const votes: Record<string, number> = {};
    this.state.players.forEach(p => {
      if (p.votedLevel) votes[p.votedLevel] = (votes[p.votedLevel] || 0) + 1;
    });

    const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      const winnerName = sorted[0][0];
      const idx = GameRoom.LEVELS.findIndex(l => l.name === winnerName);
      if (idx !== -1) this.currentLevelIndex = idx;
    } else {
      // Rotation fallback (Sprint 22)
      this.currentLevelIndex = (this.currentLevelIndex + 1) % GameRoom.LEVELS.length;
    }
    
    const level = GameRoom.LEVELS[this.currentLevelIndex];
    this.state.remainingTime = 120; // Unifié : 2 minutes (120 secondes)
    
    this.state.currentLevel = level.name;
    this.state.status = "STARTING";
    this.state.countdown = 5;

    const interval = this.clock.setInterval(() => {
      this.state.countdown -= 1;
      if (this.state.countdown <= 0) {
        interval.clear();
        this.state.status = "PLAYING";

        // Timer global pour la manche
        this.roundTimer = this.clock.setInterval(() => {
          this.state.remainingTime--;
          
          if (this.state.remainingTime <= 0) {
            this.roundTimer.clear();
            
            // Course : le temps est écoulé, ceux qui n'ont pas fini sont éliminés
            this.state.players.forEach((p, id) => {
              if (!this.state.winners.includes(id)) {
                p.isEliminated = true;
              }
            });
            this.endGame();
          }
        }, 1000);
      }
    }, 1000);
  }

  private endGame(): void {
    this.state.status = "FINISHED";
    this.replayVotes.clear();

    // Transition vers le reset automatique après 10 secondes
    this.gameTimeout = this.clock.setTimeout(() => {
      this.resetGame();
    }, 10000);
  }

  private resetGame(): void {
    if (this.gameTimeout) this.gameTimeout.clear();
    
    this.state.status = "WAITING";
    this.state.countdown = 0;
    this.state.winners.clear();
    this.replayVotes.clear();
    
    this.state.players.forEach((p) => {
      p.isReady = false;
      p.votedLevel = "";
      p.isEliminated = false;
      p.roundScore = 0;
      p.x = 0;
      p.y = 5;
      p.z = 0;
    });

    this.state.remainingTime = 0;
    this.broadcast("reset_level");
  }
}
