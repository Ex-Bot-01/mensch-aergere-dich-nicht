import { describe, expect, it } from 'vitest';

import type { EventItem, Snapshot } from '@madn/shared';

import { drainEvents, latestEventId } from '../src/events.js';

const events = (ids: number[]): EventItem[] =>
  ids.map((id) => ({ id, kind: 'rolled', payload: { value: (id % 6) + 1 } }));

function snapshotWith(ids: number[]): Snapshot {
  return {
    rev: 7,
    phase: 'playing',
    code: 'K7M2QP',
    hostToken: 't1',
    paused: false,
    waitingFor: null,
    players: [],
    spectators: [],
    game: {
      turnColor: 'red',
      stage: 'awaitRoll',
      die: null,
      legalMoves: [],
      pieces: [],
      standings: null,
    },
    events: events(ids),
    notice: null,
  };
}

describe('catching the screen up', () => {
  it('hands over only what the client has not seen, oldest first', () => {
    const snapshot = snapshotWith([3, 4, 5]);

    expect(drainEvents(snapshot, 2).map((event) => event.id)).toEqual([3, 4, 5]);
    expect(drainEvents(snapshot, 4).map((event) => event.id)).toEqual([5]);
  });

  it('says nothing when the client is already up to date', () => {
    expect(drainEvents(snapshotWith([3, 4, 5]), 5)).toEqual([]);
  });

  it('jumps to the board instead of replaying a stale capture', () => {
    // A browser that wakes from a long sleep is behind more than 12 events.
    const snapshot = snapshotWith([13, 14, 15, 16]);

    expect(drainEvents(snapshot, 2)).toEqual([]);
  });

  it('knows the newest event so the next poll starts there', () => {
    expect(latestEventId(snapshotWith([3, 4, 5]))).toBe(5);
    expect(latestEventId(snapshotWith([]))).toBe(0);
  });
});
