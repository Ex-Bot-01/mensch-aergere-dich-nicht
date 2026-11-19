import type { Color, GameView, PlayerView, Snapshot } from '@madn/shared';

/** A snapshot built by hand, because these tests have no server. */
export function fixture(overrides: Partial<Snapshot> = {}): Snapshot {
  const players: PlayerView[] = [
    { token: 'tab-one', name: 'anna', color: 'red', connected: true, out: false, isHost: true },
    { token: 'tab-two', name: 'ben', color: 'blue', connected: true, out: false, isHost: false },
  ];

  const game: GameView = {
    turnColor: 'red',
    stage: 'awaitMove',
    die: 6,
    legalMoves: [{ pieceId: 'red:0', from: 'k:red:0', to: 'c0' }],
    pieces: [
      { id: 'red:0', color: 'red', loc: 'k:red:0' },
      { id: 'red:1', color: 'red', loc: 'k:red:1' },
      { id: 'blue:0', color: 'blue', loc: 'k:blue:0' },
      { id: 'blue:1', color: 'blue', loc: 'c12' },
    ],
    standings: null,
  };

  return {
    rev: 7,
    phase: 'playing',
    code: 'K7M2QP',
    hostToken: 'tab-one',
    paused: false,
    waitingFor: null,
    players,
    spectators: [],
    game,
    events: [],
    notice: null,
    ...overrides,
  };
}

/** The same table with nobody on turn and no legal moves: a spectator's view. */
export function spectatorView(): Snapshot {
  const base = fixture();
  return {
    ...base,
    game: base.game ? { ...base.game, legalMoves: [] } : null,
  };
}

export const LOBBY: Snapshot = (() => {
  const base = fixture({ phase: 'lobby', game: null });
  return {
    ...base,
    players: [
      { token: 'tab-one', name: 'anna', color: 'red', connected: true, out: false, isHost: true },
      { token: 'tab-two', name: 'ben', color: null, connected: true, out: false, isHost: false },
    ],
  };
})();

export const FINISHED: Snapshot = (() => {
  const base = fixture({ phase: 'finished' });
  return {
    ...base,
    game: base.game
      ? {
          ...base.game,
          standings: [
            { color: 'red', rank: 1, finished: 4, advance: 172 },
            { color: 'blue', rank: 2, finished: 2, advance: 90 },
          ],
        }
      : null,
  };
})();

export const colorsTaken = (snapshot: Snapshot): Color[] =>
  snapshot.players.flatMap((player) => (player.color ? [player.color] : []));
