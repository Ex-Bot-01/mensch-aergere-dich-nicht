import type { Color, Standing } from '@madn/shared';

import { legalMoves, stepOf, type Move } from './moves.js';
import { appendEvent, cornerId, type EngineError, type GameState } from './state.js';

/** Colors still in play, in seat order. */
export function activeOrder(state: GameState): Color[] {
  return state.players.filter((color) => !state.out.includes(color));
}

function nextSeat(state: GameState, color: Color): Color {
  const order = activeOrder(state);
  return order[(order.indexOf(color) + 1) % order.length]!;
}

/** Hand the turn to the next seat that is still in play. */
export function advanceTurn(state: GameState): GameState {
  return {
    ...state,
    turn: { color: nextSeat(state, state.turn.color), stage: 'awaitRoll', die: null },
  };
}

/** The roll produced no legal move: announce it and pass on. Pieces are untouched. */
export function passTurn(state: GameState): GameState {
  return advanceTurn(appendEvent(state, 'passed', { color: state.turn.color }));
}

const slotOf = (pieceId: string): number => Number(pieceId.split(':')[1]);

/** Pieces standing inside a color's home column — safe, and finished once all four are. */
function piecesInHome(state: GameState, color: Color): number {
  return state.pieces.filter((p) => p.color === color && p.loc.startsWith(`h:${color}:`)).length;
}

/** How far a color has come, used only to rank players who did not win. */
function distanceCovered(state: GameState, color: Color): number {
  return state.pieces
    .filter((p) => p.color === color)
    .reduce((sum, p) => sum + (stepOf(color, p.loc) ?? 0), 0);
}

function rank(state: GameState, winner: Color): Standing[] {
  const rows = state.players.map((color) => ({
    color,
    finished: piecesInHome(state, color),
    advance: distanceCovered(state, color),
  }));
  const rest = rows
    .filter((row) => row.color !== winner)
    .sort((a, b) => b.finished - a.finished || b.advance - a.advance);

  return [rows.find((row) => row.color === winner)!, ...rest].map((row, index) => ({
    rank: index + 1,
    color: row.color,
    finished: row.finished,
    advance: row.advance,
  }));
}

/** Play the move the player chose. Anything not on the legal list is refused. */
export function applyMove(
  state: GameState,
  move: Move,
  byColor: Color,
): GameState | EngineError {
  if (state.phase !== 'playing') return { code: 'finished' };
  if (!state.players.includes(byColor) || state.out.includes(byColor)) {
    return { code: 'notAPlayer' };
  }
  if (state.turn.color !== byColor) return { code: 'notYourTurn' };

  const die = state.turn.die;
  if (state.turn.stage !== 'awaitMove' || die === null) {
    return { code: 'wrongPhase', detail: 'roll first' };
  }
  const legal = legalMoves(state).some((m) => m.pieceId === move.pieceId && m.to === move.to);
  if (!legal) return { code: 'illegalMove' };

  const victim = state.pieces.find((p) => p.loc === move.to && p.color !== byColor);
  const pieces = state.pieces.map((piece) => {
    if (piece.id === move.pieceId) return { ...piece, loc: move.to };
    if (victim && piece.id === victim.id) {
      return { ...piece, loc: cornerId(victim.color, slotOf(piece.id)) };
    }
    return piece;
  });

  let next: GameState = { ...state, pieces };
  next = appendEvent(next, 'moved', {
    color: byColor,
    pieceId: move.pieceId,
    from: move.from,
    to: move.to,
  });
  if (victim) {
    next = appendEvent(next, 'captured', {
      color: victim.color,
      pieceId: victim.id,
      field: move.to,
    });
  }

  if (piecesInHome(next, byColor) === 4) {
    const won: GameState = { ...next, phase: 'finished', standings: rank(next, byColor) };
    return appendEvent(won, 'finished', { color: byColor });
  }

  // A six always earns another roll; otherwise the seat to the left is up.
  return die === 6
    ? { ...next, turn: { color: byColor, stage: 'awaitRoll', die: null } }
    : advanceTurn(next);
}
