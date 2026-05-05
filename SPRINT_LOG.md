# SPRINT LOG — Jungle Guys (Fall Guys Clone)

> **Stack** : Babylon.js 9.2 · Havok Physics 1.3 · Colyseus 0.15 · Vite/TypeScript  
> **Architecture** : Monorepo `client/` + `server/`

---

## Sprint 0–4 : Fondations (✅ Validé)
- Initialisation du monorepo Vite/TS
- Bootstrap Babylon.js + chargement WASM Havok
- Scène de test physique fonctionnelle

## Sprint 5–6 : PlayerController (✅ Validé)
- Capsule Havok avec inertie verrouillée (anti-bascule)
- Mouvement WASD relatif caméra (ArcRotateCamera)
- Saut avec anti-bunny-hop (reset input `Space`)
- Respawn OOB avec gestion `disablePreStep` (anti-rubber-banding)

## Sprint 7–8 : Camera & Rotation (✅ Validé)
- Mouvement en coordonnées caméra (forward/right calculés depuis `camera.alpha`)
- Rotation Slerp du personnage vers la direction de mouvement
- Fix "shortest path" quaternion (dot product négatif → inversion)

## Sprint 9–10 : Multijoueur Colyseus (✅ Validé)
- Connexion WebSocket avec fallback solo silencieux
- Synchronisation transforms (position + quaternion) via `float32`
- Interpolation remote players : Lerp (position) + Slerp (rotation)
- Throttle hybride (temporel 50ms + spatial 0.1u)

## Sprint 11 : Obstacles Jungle (✅ Validé)
- Interface `IObstacle` (update/dispose)
- 7 obstacles : RotatingHammer, BouncyMushroom, RotatingLily, Seesaw, PendulumVine, RotarySweeper, TrapTile
- Système de collision joueur/obstacle avec stun + camera shake

## Sprint 12 : Qualification & FinishLine (✅ Validé)
- Validation finish côté serveur (anti-cheat Z-check)
- `ArraySchema<string>` pour les winners
- UI "QUALIFIÉ !" avec animation bounce
- Confetti VFX à la qualification

---

## Sprint 13 : Game Loop Complet (✅ Validé — fixé 04/05/2026)
### Fonctionnalités
- **Lobby** : Overlay dynamique avec bouton PRÊT
- **Countdown** : Serveur `Clock.setInterval` (5→0), synchronisé via `state.countdown`
- **Transitions d'état** : WAITING → STARTING → PLAYING → FINISHED → Reset (10s) → WAITING
- **Fin de manche** : `MAX_WINNERS = 3` ou timeout 60s → FINISHED
- **Reset automatique** : Vide winners, reset positions, remet `isReady = false`

### Bugs corrigés
- `GameRoom.ts` : Accolades cassées dans les handlers `ready`/`finish` (parse error fatal)
- `UIManager.ts` : Méthodes imbriquées illégalement dans `showGameOver()` (parse error fatal)
- `NetworkManager.ts` : JSDoc de classe piégé dans l'interface `RemotePlayer`
- **Lobby invisible** : `#main-menu` avec `pointer-events:auto` bloquait le lobby overlay
- **Lobby auto-caché** : Listener `countdown` tirait `0` initial → `hideLobby()` immédiat
- **pointer-events** : Lobby overlay héritait `none` de `#ui-layer`

## Sprint 14 : Thème Space — Galactic Rush (✅ Validé)
### Fonctionnalités
- Configuration `LEVEL_SPACE` : gravité 0.7x, skyColor violet profond
- Obstacle `RotarySweeper` : plateforme circulaire avec barres rotatives
- Matériaux néon cyan via `MaterialSystem.createNeonMaterial()`

## Sprint 15 : Thème Park — Candy Park (✅ Validé)
### Fonctionnalités
- Configuration `LEVEL_PARK` : skyColor bleu ciel, matériaux pastels
- Obstacle `JumpPad` : impulsion verticale (~18) + animation squash
- Obstacle `SlidingWall` : mouvement sinusoïdal axe X, pousse le joueur

### Hotfix V1.3
- JumpPad : impulsion réduite de 180 → 18
- PlayerController : vélocité en Lerp au lieu d'écrasement (permet poussée externe)

## Sprint 16 : Thème Ice — Winter Wipeout (✅ Validé)
### Fonctionnalités
- Configuration `LEVEL_ICE` : skyColor blanc, friction 0.05
- Obstacle `TrapTile` : vibration 0.5s → chute → respawn 3s
- Physique de glisse : Lerp factor 0.03 (vs 0.3 normal), damping réduit
- Matériaux `createIceMaterial()` + `createSnowMaterial()`

## Sprint 17 : Rotation de Niveaux (✅ Validé — 04/05/2026)
### Fonctionnalités
- **Serveur** : `GameState.currentLevel` (string synchronisé)
- **Serveur** : Tableau `LEVELS[]` avec `finishZ` dynamique par niveau
- **Serveur** : Rotation automatique dans `endGame()` (Jungle → Space → Park → Ice → cycle)
- **Client** : Dictionnaire `LEVEL_MAP` pour lookup par nom de thème
- **Client** : `reloadLevel(levelName)` : dispose + re-setup avec nouvelle config
- **Client** : Écoute `reset_level` + détection changement `currentLevel`

---

## Systèmes Transversaux (✅ Validés)

### MaterialSystem (V1.5)
- `getThemeMaterial(scene, theme, type)` : dispatch centralisé pour 4 thèmes × 5 types
- Matériaux PBR/Standard spécialisés : Ground, Ice, Snow, Neon, Park pastels

### VFXSystem
- Particules poolées par thème (jungle=terre/feuille, space=cyan, ice=cristaux)
- Throttle : 1 burst toutes les 10 frames de course

### Modèle 3D (HVGirl.glb)
- 4 animations : Idle, Run, Fall, Brake
- Speed ratio synchronisé à la vélocité réelle (anti-moonwalk)
- `forceVisualSanity()` : garantie de visibilité post-load

### Shadow Frustum Dynamique
- `Game.updateShadowFrustum(maxZ)` : ajuste le frustum CSM selon la longueur du niveau

---

## Build Status
```
Server : npx tsc --noEmit → ✅ 0 errors
Client : npx tsc --noEmit → ✅ 0 errors
```
