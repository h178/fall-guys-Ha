# 🎮 FG — Fall Guys-like Multiplayer Game

Jeu de course d'obstacles multijoueur 3D en ligne, inspiré de Fall Guys. Les joueurs s'affrontent en temps réel sur des parcours délirants. Développé avec Babylon.js pour le rendu, Havok pour la physique, et Colyseus pour le multijoueur.

## 🛠️ Tech Stack

| Technologie   | Version | Rôle                           |
|---------------|---------|--------------------------------|
| Babylon.js    | 7.x     | Moteur de rendu 3D             |
| Havok Physics | —       | Moteur physique (WASM)         |
| Colyseus      | 0.15.x  | Serveur multijoueur temps réel |
| Vite          | 6.x     | Bundler & dev server           |
| TypeScript    | 5.x     | Typage statique                |
| Node.js       | >= 20   | Runtime serveur                |

## 📁 Structure du projet

```
FG/
├── client/          # Application Babylon.js (Vite + TS)
│   └── src/
│       ├── core/        # Moteur de jeu
│       ├── entities/    # Joueurs & obstacles
│       ├── network/     # Client réseau (Sprint 1)
│       ├── scenes/      # Scènes de jeu
│       └── types/       # Types TypeScript
├── server/          # Serveur Colyseus (Sprint 1)
├── shared/          # Types partagés client/serveur
└── README.md
```

## ⚡ Prérequis

- Node.js >= 20 LTS
- npm >= 10

## 🚀 Installation & Lancement

```bash
git clone <repo-url>
cd FG/client
npm install
npm run dev
```

→ Ouvrir http://localhost:5173

## 🗺️ Roadmap

- [x] Sprint 0 — Architecture + Validation Physique Havok
- [ ] Sprint 1 — Serveur Colyseus + Synchronisation multijoueur
- [ ] Sprint 2 — Personnage joueur + Mouvements
- [ ] Sprint 3 — Premier niveau d'obstacles

## 👥 Équipe

(à compléter)
