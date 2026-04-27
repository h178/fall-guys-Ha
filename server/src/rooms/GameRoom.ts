import { Room, Client } from "colyseus";
import { GameState, Player } from "../schemas/GameState";

/** Structure des messages "transform" reçus du client. */
interface TransformMessage {
  x:  number;
  y:  number;
  z:  number;
  rx: number;
  ry: number;
  rz: number;
  rw: number;
}

export class GameRoom extends Room<GameState> {
  maxClients = 10;
  private readonly MAX_WINNERS = 3;

  onCreate(): void {
    this.setState(new GameState());

    this.onMessage("finish", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      
      // Validation côté serveur (Le finish est approximativement vers Z=30)
      if (player.z < 25) {
         console.warn(`Anti-cheat: ${client.sessionId} a envoyé finish trop loin (Z=${player.z})`);
         return;
      }
      
      if (!this.state.winners.includes(client.sessionId)) {
        this.state.winners.push(client.sessionId);
        if (this.state.winners.length >= this.MAX_WINNERS) {
          this.state.status = "FINISHED";
          if (gameTimeout) gameTimeout.clear();
          this.endGame();
        }
      }
    });

    // ─ Message handler : transform du joueur ────────────────
    // Le client envoie sa position + rotation post-physics. Le serveur :
    //  1. Retrouve le Player dans le state via sessionId
    //  2. Clamp les positions (anti-triche basique)
    //  3. Assigne position + rotation sur le schema
    //  4. Colyseus broadcast automatiquement via patchRate
    this.onMessage("transform", (client: Client, data: TransformMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      // Position — clamp basique (empêche les valeurs absurdes)
      player.x = Math.max(-50, Math.min(50, data.x));
      player.y = Math.max(-20, Math.min(50, data.y));
      player.z = Math.max(-50, Math.min(50, data.z));

      // Rotation — pas de clamp (quaternion unitaire, composantes [-1,1] par nature)
      player.rx = data.rx;
      player.ry = data.ry;
      player.rz = data.rz;
      player.rw = data.rw;
    });

    // ─ Game Loop (Lobby) ────────────────────────
    let countdownInterval: any;
    let gameTimeout: any;

    this.onMessage("ready", (client) => {
      if (this.state.status !== "WAITING") return;
      const player = this.state.players.get(client.sessionId);
      if (player) {
        player.isReady = true;
      }

      // Vérifier si 100% des joueurs présents sont ready (et au moins 1 joueur)
      let allReady = true;
      this.state.players.forEach(p => { if (!p.isReady) allReady = false; });
      
      if (allReady && this.state.players.size > 0) {
        this.state.status = "STARTING";
        this.state.countdown = 5; // 5 secondes
        
        // Utiliser Clock pour tick 1 fois par seconde
        countdownInterval = this.clock.setInterval(() => {
          this.state.countdown--;
          if (this.state.countdown <= 0) {
            this.state.status = "PLAYING";
            countdownInterval.clear(); // Terminer

            gameTimeout = this.clock.setTimeout(() => {
              if (this.state.status === "PLAYING") this.endGame();
            }, 60000);
          }
        }, 1000);
      }
    });

    console.log("🎮 GameRoom created");
  }

  onJoin(client: Client): void {
    console.log(`➕ Player joined: ${client.sessionId}`);

    const player = new Player();
    // Offset aléatoire en X/Z pour que les capsules ne soient
    // pas empilées au même point (visuellement invérifiable sinon)
    player.x = (Math.random() - 0.5) * 4;  // entre -2 et +2
    player.y = 1;                            // centre capsule au sol
    player.z = (Math.random() - 0.5) * 4;

    // La clé de la MapSchema = sessionId du client
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client): void {
    console.log(`➖ Player left: ${client.sessionId}`);
    this.state.players.delete(client.sessionId);
  }

  onDispose(): void {
    console.log("🗑️ GameRoom disposed");
  }

  private endGame(): void {
    this.state.status = "FINISHED";
    
    // Transition vers le reset après 10 secondes
    this.clock.setTimeout(() => {
      this.state.status = "WAITING";
      this.state.winners.clear();
      this.state.players.forEach(p => {
        p.isReady = false;
        // Téléporte tous les joueurs à (0, 5, 0)
        p.x = 0;
        p.y = 5;
        p.z = 0;
      });
      
      // Ordre RPC aux clients pour reset leur physique locale
      this.broadcast("reset_level");
    }, 10000);
  }
}
