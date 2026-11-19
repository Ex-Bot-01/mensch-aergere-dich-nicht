import type { EventItem, Snapshot } from '@madn/shared';

/**
 * What the client has not animated yet, oldest first. An empty list means either
 * "nothing new" or "too far behind to be worth replaying" — in both cases the board
 * in this snapshot is the truth, so the screen just draws it.
 */
export function drainEvents(snapshot: Snapshot, seenEventId: number): EventItem[] {
  const carried = snapshot.events;
  if (carried.length === 0) return [];

  const oldest = carried[0]!.id;
  if (seenEventId + 1 < oldest) return [];

  return carried.filter((event) => event.id > seenEventId).sort((a, b) => a.id - b.id);
}

/** Where the next drain should start counting from. */
export function latestEventId(snapshot: Snapshot): number {
  return snapshot.events.reduce((highest, event) => Math.max(highest, event.id), 0);
}
