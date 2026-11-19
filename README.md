# Mensch ärgere dich nicht

A playable browser version of *Mensch ärgere dich nicht* you can share with a link
and a code. One person hosts, everyone else joins the lobby with that code, picks a
color that is still free, and plays when the host starts the game. A 3D dice gets
tossed, pieces get moved, someone gets ärgert.

## How it plays

1. Open the page. Create a game (you become host/admin) or enter a code to join one.
2. In the lobby, pick a color that nobody else has taken.
3. The host starts the match.
4. Roll the 3D dice, move a piece, land on an opponent and send them home.

Classic rules: four pieces each, a six to leave the corner, another roll for every
six, capture sends a piece back to its corner, and the first color with all four in
the home column wins. Nobody needs an account.

Connections are expected to be bad sometimes. A tab that loses its signal says so,
redials by itself and gets its seat back — no refresh, no lost turn. If a friend's
connection dies for real the table waits for them, and any player can end their game so
the rest can carry on. Anyone who joins after the start watches.

## Running it

Needs Node 20 or newer.

```bash
npm install
npm run build      # the web client into apps/web/dist
npm start          # http://localhost:3000
```

Then open four tabs — or four devices, or a phone on the same network — and play. The
server keeps rooms in memory, so restarting it empties the lobby. `PORT=8080 npm start`
picks another port; `npm run dev` restarts the server when its code changes.

While writing the client it is quicker to let vite reload it:

```bash
npm start                # one terminal: the game server on :3000
npm run dev -w @madn/web # another: vite on :5173, proxying /api and /ws to :3000
```

Each browser tab is one seat, remembered in that tab's `sessionStorage`, so a refresh
comes back to the same player and four tabs on one laptop make a full game.

## Checking it

```bash
npm test        # 167 tests: rules engine, rooms, lifecycle, wire protocol, screens
npm run typecheck
npm run build && npm start &      # then
npm run accept                    # five real browsers play a whole game
```

`npm run accept` drives Chromium with Playwright (`npx playwright install chromium`
once). It seats four players and a spectator, plays to a winner, refreshes a tab
mid-choice, cuts one player's connection and watches it come back on its own, drops a
player for good, forces continue, and measures the tap targets on a phone-sized screen —
23 checks, printing PASS or FAIL for each, with screenshots to
`.superpowers/sdd/2026-11-18-phase-1-functionality/shots/`.

## Layout

| Path | What lives there |
| --- | --- |
| `packages/shared` | The wire contract: snapshots, intents, notices. |
| `packages/engine` | Rules only. No DOM, no sockets, no timers — seeded dice, legal moves, captures, standings, invariant checks, a bot that plays whole games. |
| `apps/server` | Rooms, seats, turn custody, heartbeats, HTTP + WebSocket transport. Authoritative: clients send intents, never state. |
| `apps/web` | Screens, the SVG board, the three.js dice. |
| `scripts/acceptance.mjs` | The phase 1 acceptance run, in real browsers. |

## Plan

Two phases, in this order:

1. **Functionality** — every game mechanic works end to end over multiple browsers:
   sessions, lobby, color picking, turn order, dice, movement rules, capture, home
   run, winning. Correct and robust before it is beautiful.
2. **Visuals** — the board, the pieces, the 3D dice toss, animations and polish that
   make it look astonishing.

## Repo state

Phase 1 is done: `phase-1-functionality` plays a full game across browsers, passes
152 tests and the acceptance run above. Phase 2 (visuals) has not started — the board
is a readable ring of fields rather than the wooden cross, and the dice toss is one
animation rather than a flourish.

- Design: `docs/superpowers/specs/2026-11-18-mensch-aergere-dich-nicht-design.md`
- Phase 1 plan, with acceptance results: `docs/superpowers/plans/2026-11-18-phase-1-functionality.md`
