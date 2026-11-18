/** Wire types shared by server and browser. Written once, imported everywhere. */

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1
export const CODE_LEN = 6;

export const COLORS = ['red', 'blue', 'green', 'yellow'] as const;
export type Color = (typeof COLORS)[number];

/** A board location: 'c17' circuit field, 'h:red:3' red's third home field, 'k:blue:2' blue's second corner slot. */
export type FieldId = string;

export type NoticeCode =
  | 'notYourTurn'
  | 'alreadyRolled'
  | 'illegalMove'
  | 'notStarted'
  | 'finished'
  | 'wrongPhase'
  | 'notAPlayer'
  | 'colorTaken'
  | 'tooFewPlayers'
  | 'notHost'
  | 'unknownCode'
  | 'paused'
  | 'roomClosed';

export type Notice = { code: NoticeCode; detail?: string };

export type EventKind =
  | 'rolled'
  | 'moved'
  | 'captured'
  | 'passed'
  | 'started'
  | 'finished'
  | 'markedOut';

export type EventItem = { id: number; kind: EventKind; payload: Record<string, unknown> };

export type PieceView = { id: string; color: Color; loc: FieldId };

export type MoveView = { pieceId: string; from: FieldId; to: FieldId; capture?: Color };

export type Standing = { color: Color; rank: number; finished: number; advance: number };

export type GamePhase = 'lobby' | 'playing' | 'finished';

export type PlayerView = {
  token: string;
  name: string;
  color: Color | null;
  connected: boolean;
  out: boolean;
  isHost: boolean;
};

export type GameView = {
  turnColor: Color;
  stage: 'awaitRoll' | 'awaitMove';
  die: number | null;
  /** Legal moves for whoever asked for this snapshot; empty for everyone else. */
  legalMoves: MoveView[];
  pieces: PieceView[];
  standings: Standing[] | null;
};

export type Snapshot = {
  rev: number;
  phase: GamePhase;
  code: string;
  /** The token holding the host role, so "you are host" works even before the host takes a color. */
  hostToken: string;
  paused: boolean;
  waitingFor: Color | null;
  players: PlayerView[];
  spectators: string[];
  game: GameView | null;
  events: EventItem[];
  notice: Notice | null;
};

export type Intent =
  | { type: 'rename'; name: string }
  | { type: 'pickColor'; color: Color }
  | { type: 'unpick' }
  | { type: 'start' }
  | { type: 'roll' }
  | { type: 'move'; pieceId: string }
  | { type: 'forceContinue'; color: Color }
  | { type: 'returnToLobby' };

export type ServerMessage =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'notice'; notice: Notice };
