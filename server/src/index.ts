import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GameRoom } from "./rooms/GameRoom";

const PORT = Number(process.env.PORT) || 2567;

const app = express();
app.use(cors());
app.use(express.json());

// Health check pour vérifier que le serveur tourne
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

const httpServer = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

// ⚠️ Le nom "game_room" DOIT être identique côté client
//    dans client.joinOrCreate("game_room")
gameServer.define("game_room", GameRoom);

httpServer.listen(PORT, () => {
  console.log(`🚀 Colyseus server listening on http://localhost:${PORT}`);
  // Build v2 — all handlers registered: finish, transform, ready, vote, customize, emote, replay, force_lobby, eliminate
});
