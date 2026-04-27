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

  onCreate(): void {
    this.setState(new GameState());

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
}
