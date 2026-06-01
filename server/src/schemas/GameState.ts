import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";

export class Player extends Schema {
  // ─ Position ──────────────────────────────────────────
  // float32 : 4 octets fixes, précision 6-7 décimales
  // Suffisant pour des coordonnées de jeu.
  // Migration depuis "number" (encodage variable) → "float32"
  @type("float32") x:  number = 0;
  @type("float32") y:  number = 1;
  @type("float32") z:  number = 0;

  // ─ Rotation (Quaternion) ─────────────────────────────
  // Valeurs entre -1.0 et 1.0 → float32 parfait.
  // Défaut = Identity quaternion (0, 0, 0, 1) = pas de rotation.
  @type("float32") rx: number = 0;
  @type("float32") ry: number = 0;
  @type("float32") rz: number = 0;
  @type("float32") rw: number = 1;

  // ─ Lobby ─────────────────────────────────────────────
  @type("boolean") isReady: boolean = false;
  @type("string") votedLevel: string = "";
  @type("boolean") isEliminated: boolean = false;
  @type("number") roundScore: number = 0;

  // ─ Customisation ─────────────────────────────────────
  @type("float32") skinHue: number = 210; // Bleu par défaut
  @type("float32") costumeHue: number = 35; // Orange par défaut
  @type("string") hatStyle: string = "none"; // none, cap, crown, beanie
  @type("string") emote: string = ""; // Emote courante (😊, 😂, etc.)
  @type("string") gender: string = "female"; // 'female' | 'male'
}

export class GameState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type(["string"]) winners = new ArraySchema<string>();

  @type("string") status: string = "WAITING"; // WAITING, STARTING, PLAYING, FINISHED
  @type("number") countdown: number = 0;
  @type("string") currentLevel: string = "jungle";
  @type("number") remainingTime: number = 0;
  @type({ map: "number" }) globalScores = new MapSchema<number>();
  @type({ map: "number" }) votes = new MapSchema<number>();
}
