/**
 * États possibles du jeu FG.
 *
 * Utilisation d'un objet const + type union au lieu d'un enum TS :
 *  - Compatible avec l'option erasableSyntaxOnly du tsconfig
 *  - Même comportement runtime (string literals discriminés)
 *  - Autocompletion identique dans l'IDE
 */
export const GameState = {
  MENU:    'MENU',
  WAITING: 'WAITING',
  STARTING: 'STARTING',
  PLAYING: 'PLAYING',
  WON:     'WON',
  FINISHED: 'FINISHED',
} as const;

export type GameState = typeof GameState[keyof typeof GameState];
