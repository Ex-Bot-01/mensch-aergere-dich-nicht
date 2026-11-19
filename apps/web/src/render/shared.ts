import type { Color, Notice, Snapshot } from '@madn/shared';

/** What a screen may ask the server to do. `me` is this tab's token. */
export type Actions = {
  me: string;
  /** False when this tab cannot reach the server, so nothing may look tappable. */
  online?: boolean;

  roll: () => void;
  move: (pieceId: string) => void;
  pickColor: (color: Color) => void;
  unpick: () => void;
  start: () => void;
  forceContinue: (color: Color) => void;
  returnToLobby: () => void;
};

export type HomeApi = {
  name: string;
  code?: string;
  notice: Notice | null;
  create: (name: string) => void;
  join: (code: string, name: string) => void;
};

export const myPlayer = (snapshot: Snapshot, me: string) =>
  snapshot.players.find((player) => player.token === me);
