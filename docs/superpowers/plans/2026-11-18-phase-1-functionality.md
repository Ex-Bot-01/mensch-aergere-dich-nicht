# Mensch ärgere dich nicht — phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser game of *Mensch ärgere dich nicht* that four friends on three continents can finish together from a room code, with every rule server-enforced and no beauty required yet.

**Architecture:** One Node process holds rooms in memory and is the only referee; clients send intents and receive full state snapshots tagged with a `rev`. The rules live in a pure, DOM-free engine module that also runs headless bot games, so phase 2 can replace every pixel of the view without touching a rule.

**Tech Stack:** TypeScript (strict, ESM) everywhere; npm workspaces; Node 22 + `ws`; Vite for the browser app; Three.js for the dice only; SVG for the board; Vitest for tests (`happy-dom` for the few DOM assertions).

**Spec:** `docs/superpowers/specs/2026-11-18-mensch-aergere-dich-nicht-design.md`

## Global Constraints

- Node 22, TypeScript strict mode, ESM modules only.
- No database: rooms live in memory. Keeping them across a server restart is optional and
  left open (the spec leaves it to the builder); nothing may assume it works.
- `packages/engine` imports nothing from the DOM, from `ws`, or from Three.js — it must run under plain Node.
- Colors are exactly `red | blue | green | yellow`; four pieces each; 2–4 players per game.
- Room codes: 6 characters from an alphabet with no O/0/I/1, unique among live rooms, shown as text.
- UI labels in English; the game name stays *Mensch ärgere dich nicht*. Touch targets ≥ 44 px; no hover-only affordances.
- Rules: a 6 always grants another roll and there is no three-6 penalty; bring-out on 6 is mandatory when the start field is empty; no forced capture, no split rolls, no pass button; a full circuit must be completed before entering the 4-field home column; no overshooting past the last home field; no jumping over your own pieces inside the home column.
- The server never waits on a client animation; a turn passes in state the moment the move is applied.

## Review Focus

- A mobile socket that dies without closing: within ~30 s the table says "waiting for Green…" rather than hanging on a ghost seat nobody believes is gone. *(Tasks 8 and 9)*
- Refresh while the player has rolled and owes a piece choice: the browser comes back showing that exact pending choice, not a fresh die and not a passed turn. *(Task 9)*
- Two tabs on one laptop joining with the same remembered name: both get seats, and neither silently steals a color another tab is holding in the lobby. *(Task 7)*
- A spectator who taps where only players can act: nothing changes in state and no error toast storm follows. *(Tasks 7 and 10)*
- Force continue pressed by a non-host while the host is the one who dropped: accepted, and a two-player game ends at once instead of leaving one player playing alone. *(Tasks 5 and 8)*

---

### Task 1: Workspace scaffold and board geometry

**Files:**
- Create: `package.json` (workspaces: `packages/*`, `apps/*`), `tsconfig.base.json`, `vitest.workspace.ts`
- Create: `packages/shared/src/types.ts`, `packages/shared/src/index.ts`
- Create: `packages/engine/package.json`, `packages/engine/src/board.ts`, `packages/engine/test/board.test.ts`

**Interfaces:**
- Produces: `COLORS: readonly Color[]`, `type Color`, `CIRCUIT_LEN = 40`, `HOME_LEN = 4`, `ROUTE_LEN = 44`, `ENTRY: Record<Color, number>` (`red:0, blue:10, green:20, yellow:30`), `type FieldId = string`, `fieldId(color: Color, step: number): FieldId`, `isHomeField(f: FieldId): boolean`, `ownerOf(f: FieldId): Color | null`.
- Field id format, used everywhere from here on: `'c17'` shared circuit field 17, `'h:red:3'` red's third home field, `'k:blue:2'` blue's second corner slot.

- [x] **Step 1: Write the failing test** in `packages/engine/test/board.test.ts`: a route is 44 fields long; the four entry points are exactly 10 apart on a 40-field circuit; every color's circuit half visits all 40 circuit fields exactly once and no field twice; two colors' home fields never share an id; `fieldId('red', 39) === 'c9'` (wrapping) and `fieldId('red', 40) === 'h:red:1'`.
- [x] **Step 2: Run it** — `npx vitest run packages/engine` → FAIL on missing module.
- [x] **Step 3: Scaffold** the workspaces, base tsconfig (`strict: true`, `module: NodeNext`, `target: ES2022`), Vitest workspace config, and implement `board.ts` with the constants above plus `fieldId`. `packages/shared/src/types.ts` gets the wire types from the spec verbatim: `Snapshot {rev, phase, code, hostColor, paused, waitingFor, players: PlayerView[], spectators: string[], game: GameView | null, events: EventItem[], notice: Notice | null}` (`paused: boolean`, `waitingFor: Color | null`), `PlayerView {token, name, color: Color | null, connected: boolean, out: boolean, isHost: boolean}`, `GameView {turnColor, stage: 'awaitRoll' | 'awaitMove', die: number | null, legalMoves: MoveView[], pieces: PieceView[], standings: Standing[] | null}`, `PieceView {id, color, loc: FieldId}`, `EventItem {id: number, kind: 'rolled'|'moved'|'captured'|'passed'|'started'|'finished'|'markedOut', payload: Record<string, unknown>}`.
- [x] **Step 4: Run it** → PASS. Then `npx tsc -b` typechecks clean across workspaces.
- [x] **Step 5: Commit** — `git add -A && git commit -m "feat: workspace scaffold and board geometry"`

### Task 2: Game state, setup and seeded dice

**Files:**
- Create: `packages/engine/src/state.ts`, `packages/engine/src/rng.ts`
- Test: `packages/engine/test/state.test.ts`

**Interfaces:**
- Consumes: Task 1 board constants.
- Produces: `type GameState` (players in seat order, pieces, `phase: 'playing' | 'finished'`, `turn: {color, stage, die}`, `events`, `standings`, `out: Color[]`, `seed`), `type Rng = () => number`, `makeRng(seed: number): Rng`, `createGame(opts: {colors: Color[], hostColor: Color, seed: number}): GameState`, `rollDie(state: GameState, rng: Rng, byColor: Color): GameState | EngineError`.

- [x] **Step 1: Write the failing test** — `createGame` puts all four pieces of every player in that color's corner (`k:red:0..3`); the starting color is derived from the seed alone (same seed + same colors ⇒ same start color, and across 200 seeds all four colors get to start at least once); `rollDie` by a non-active color returns `{code: 'notYourTurn'}`; a roll while `stage === 'awaitMove'` returns `{code: 'alreadyRolled'}`; a roll of 6 sets `turn.die === 6` and appends one `rolled` event.
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement** `rng.ts` (mulberry32 seeded generator) and `state.ts`. `rollDie` draws the value as `1 + Math.floor(rng() * 6)`, stores it in `turn.die`, flips `stage` to `'awaitMove'`, and emits `{kind:'rolled', payload:{color, value}}`. `EngineError = {code: string}` — codes are strings from a named union you define here: `notYourTurn | alreadyRolled | illegalMove | notStarted | finished | wrongPhase | notAPlayer | colorTaken | tooFewPlayers | notHost | unknownCode`.
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** — `"feat: engine state, seeded dice, roll"`

### Task 3: Legal move computation

**Files:**
- Create: `packages/engine/src/moves.ts`
- Test: `packages/engine/test/moves.test.ts`

**Interfaces:**
- Consumes: `GameState`, board constants.
- Produces: `type Move = {pieceId: string; from: FieldId; to: FieldId; capture?: Color}`, `legalMoves(state: GameState): Move[]`.

- [x] **Step 1: Write the failing test** covering each rule as its own case, all asserting on the returned `Move[]`: nothing is legal before a roll (`state.turn.die === null` ⇒ `[]`); with an empty start field and pieces in the corner, a 6 yields exactly one move — that piece onto `ENTRY`'s circuit field (mandatory bring-out beats every other option); a destination held by your own piece is absent; a destination held by an opponent's piece is present **and** carries `capture: <their color>`; a roll that would pass field 43 is absent (overshoot); a piece at step 37 with a 6 may enter home, so the move exists; a piece may not jump over your own piece standing further up the same home column — the rear piece has no legal move while the front one blocks it; a roll of 6 with the start field already occupied yields ordinary moves for every movable piece.
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement** `legalMoves`. Two helpers keep it readable and are yours to name: one that resolves a step index to a `FieldId` plus occupancy, one that decides whether the home column blocks the path between two steps (`step < CIRCUIT_LEN` pieces never block; only same-color pieces inside the home column do).
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** — `"feat: legal move computation"`

### Task 4: Apply a move — capture, turn order, winning

**Files:**
- Create: `packages/engine/src/apply.ts`
- Modify: `packages/engine/src/state.ts` (export any shared helpers you need)
- Test: `packages/engine/test/apply.test.ts`

**Interfaces:**
- Consumes: `legalMoves`, `GameState`.
- Produces: `applyMove(state: GameState, move: Move, byColor: Color): GameState | EngineError`, `advanceTurn(state: GameState): GameState`, `passTurn(state: GameState): GameState`.

- [x] **Step 1: Write the failing test** — a move not in `legalMoves(state)` returns `{code:'illegalMove'}` and leaves state deep-equal to before; moving onto an opponent's piece puts that piece back on its own corner slot and appends a `captured` event after the `moved` one; after any move `turn.die === null`; when the rolled value was 6 the same color keeps the turn with `stage:'awaitRoll'`, otherwise the next player in **seat order** gets it; a move that finishes the fourth piece for a color sets `phase:'finished'` and fills `standings` with that color first, remaining colors ordered by pieces finished then by furthest advanced; `passTurn` (used when nothing is legal) appends `passed` then `moved`-less turn change and never touches pieces.
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement** `apply.ts`. Piece identity is stable (`pieceId` = `${color}:${slot}`), capture targets the single opponent piece on that field, and a finished piece keeps `loc === 'h:<color>:4'` so it is counted but never movable again.
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** — `"feat: move application, capture, turn order, win"`

### Task 5: Invariants and force continue

**Files:**
- Create: `packages/engine/src/invariants.ts`
- Modify: `packages/engine/src/apply.ts` (add `markOut`)
- Test: `packages/engine/test/invariants.test.ts`

**Interfaces:**
- Produces: `assertInvariants(state: GameState): void` (throws with a message naming the color and count), `markOut(state: GameState, color: Color): GameState | EngineError`, `activePlayers(state: GameState): Color[]`.

- [x] **Step 1: Write the failing test** — for every state produced by a legal sequence, `assertInvariants` holds: each active player owns exactly four pieces, each piece sits in exactly one of the five places (corner slot, start field, circuit, home column, finished), and no two pieces share a `FieldId`. Then `markOut`: removes that color's pieces from the board entirely, appends `markedOut`, ranks that color last in `standings` when the game later finishes, returns `{code:'notAPlayer'}` for a color not in the game, and in a two-player game sets `phase:'finished'` with the remaining player first. Marking out one of four leaves three players still taking turns.
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement.** `assertInvariants` is called by tests, not by the hot path — it must stay cheap enough to run every turn in Task 6's simulator but never run in production code.
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** — `"feat: engine invariants and markOut"`

### Task 6: Bot simulation — thousands of complete games

**Files:**
- Create: `packages/engine/src/simulate.ts`
- Test: `packages/engine/test/simulate.test.ts`

**Interfaces:**
- Produces: `playRandomGame(opts: {colors: Color[], seed: number, pick?: (moves: Move[], state: GameState) => Move}): {state: GameState; turns: number; rolls: number}`, `randomPick: (moves: Move[], state: GameState) => Move`.

- [x] **Step 1: Write the failing test** — for seeds 0..499 and for each of 2, 3 and 4 players: `playRandomGame` terminates with `phase === 'finished'`, a non-empty `standings`, and `assertInvariants` true after *every* turn (call it inside the loop, not just at the end); no seed exceeds 50 000 turns; games where every piece is stuck in the corner still advance turns (the pass path runs); a fixed-seed game replays to an identical final state.
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement** `simulate.ts` as the loop the server will mirror: roll → if `legalMoves` is empty, `passTurn`, else `pick` then `applyMove`. Keep the injected `pick` so a later phase can play smarter bots; default `randomPick` chooses uniformly.
- [x] **Step 4: Run** → PASS. Expect ~1 500 games in under a few seconds; if it is slower, cut the seed range to 0..199 and note it in the test name rather than dropping the invariant check.
- [x] **Step 5: Commit** — `"test: bot-played games with per-turn invariants"`

### Task 7: Room model and intent handling

**Files:**
- Create: `packages/server/src/rooms.ts`, `packages/server/src/codes.ts`
- Test: `packages/server/test/rooms.test.ts`

**Interfaces:**
- Consumes: engine (`createGame`, `rollDie`, `legalMoves`, `applyMove`, `markOut`).
- Produces: `type Room`, `CODE_ALPHABET`, `newCode(rand: () => number): string`, `createRoom(nameOf: (token: string) => string, rand): Room`, `joinByCode(store, code, {name, token}): {room, notice?}`, `handleIntent(store, code, token, intent: Intent): {snapshot?: Snapshot; notice?: Notice}`, `makeSnapshot(room: Room, forToken?: string): Snapshot`, `type Intent = {type:'pickColor'|'unpick'|'start'|'roll'|'move'|'forceContinue'|'returnToLobby'|'rename', ...}`.

- [x] **Step 1: Write the failing test** — a fresh room is phase `lobby` with four free colors and its creator as host; two different tokens cannot hold the same color (second gets `{notice:{code:'colorTaken'}}`) and each keeps its own seat when both join from the same browser name; `start` by a non-host returns `notHost`, `start` with one seated player returns `tooFewPlayers`, and `start` with two sets phase `playing`, seats the starting color, and appends `started`; a token that joins after `start` becomes a spectator (no color, listed in `snapshot.spectators`) and its intents are refused with `notAPlayer`; a player who left can rejoin by code into their own color; `roll` then `move` from the active color advances the engine and produces a snapshot whose `game.legalMoves` is empty for everyone but the active player's view; an intent from a spectator or the wrong color leaves `rev` unchanged; and two live rooms are independent — an intent in one never bumps the other's `rev` or pieces, which is the spec's "several rooms on one server" claim.
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement** `rooms.ts` + `codes.ts`. `newCode` draws 6 chars from an alphabet with no O/0/I/1 and retries on collision with live rooms. The room holds `players: Map<token, Player>`, `spectators: Set<token>`, `game: GameState | null`, `rev: number`, `events: EventItem[]` (keep the last 12 in the snapshot), and `notice` per recipient — so `makeSnapshot(room, forToken)` takes a token argument and only fills `legalMoves` for that player's seat.
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** — `"feat: room model and intent handling"`

### Task 8: Identity, disconnect pause, and room lifecycle

**Files:**
- Modify: `packages/server/src/rooms.ts`
- Create: `packages/server/src/lifecycle.ts`
- Test: `packages/server/test/lifecycle.test.ts`

**Interfaces:**
- Consumes: Task 7 room model.
- Produces: `markDisconnected(store, code, token, now: number)`, `markConnected(store, code, token, now: number)`, `forceContinue(store, code, byToken, targetColor): {snapshot?, notice?}`, `tick(store, now: number): ClosedRoom[]`, `HEARTBEAT_MS = 15_000`, `GONE_AFTER_MS = 30_000`, `EMPTY_ROOM_TTL_MS = 15 * 60_000`, `IDLE_ROOM_TTL_MS = 30 * 60_000`.

- [x] **Step 1: Write the failing test** with an injected clock — a player whose heartbeat goes quiet for 29 s is still connected, at 31 s the room sets `paused: true` and every snapshot carries `waitingFor: <color>`; reconnecting clears both and nobody's turn was skipped (same `turn.color` as before); `forceContinue` by any connected human — host or not — marks the target out via the engine and resumes play, and returns `notAPlayer` for a color that is already out; when the host disconnects the role does **not** move, but when the host *leaves* it passes to the next remaining human in seat order; a room with no attached human closes after 15 minutes of `tick`, one with idle humans after 30, and a game in progress is not closed while at least one human is attached.
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement.** While `paused`, gameplay intents (`roll`, `move`) are refused with `{code:'paused'}` — add that code to the engine's error union; `forceContinue` and lobby intents stay allowed, which is exactly why a non-host can rescue a stalled table.
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** — `"feat: disconnect pause and room lifecycle"`

### Task 9: HTTP + WebSocket server

**Files:**
- Create: `apps/server/src/main.ts`, `apps/server/src/http.ts`, `apps/server/src/ws.ts`
- Test: `apps/server/test/e2e.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 7–8; `ws`.
- Produces: `POST /api/create {name} → {code, token}`, `POST /api/join {code, name, token?} → {code, token, notice?}`, `GET /api/snapshot/:code → Snapshot`, a WS endpoint speaking `{type:'intent', intent}` in and `{type:'snapshot', snapshot}` / `{type:'notice', notice}` out, static serving of the built web app from `apps/web/dist`, and `startServer({port, webRoot}): {close(): Promise<void>}`.

- [x] **Step 1: Write the failing test** — two real `ws` clients against an in-process server: create → join → both seated → host `start` → the active client receives a snapshot with `stage:'awaitRoll'`; sending `roll` then a legal `move` reaches the other client as a new `rev`; an illegal intent (wrong color rolling) returns a `notice` and **no** new snapshot; a client that closes its socket and reconnects mid-game, while the game sat in `stage:'awaitMove'`, gets a snapshot with `stage:'awaitMove'`, the same `die` value it had before, and its own `legalMoves` filled — this is the Review Focus case for a refresh mid-choice; a third client joining after `start` lands as a spectator.
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement** with `ws`'s `server` attached to the Node http server, one heartbeat ping per connection every 15 s driving `markDisconnected`, and JSON messages only. The HTTP layer is small enough for plain `node:http` routing — no framework.
- [x] **Step 4: Run** → PASS. Then `npm run build && npm start` and confirm the served page loads from `http://localhost:<port>/`.
- [x] **Step 5: Commit** — `"feat: http and websocket server"`

### Task 10: Web client plumbing and the three screens

**Files:**
- Create: `apps/web/src/main.ts`, `apps/web/src/api.ts`, `apps/web/src/render/home.ts`, `apps/web/src/render/lobby.ts`, `apps/web/src/render/table.ts`, `apps/web/styles.css`
- Test: `apps/web/test/render.test.ts`

**Interfaces:**
- Consumes: `Snapshot`, intents, HTTP + WS endpoints.
- Produces: `connect(code, token, onMessage): {send(intent: Intent): void; close(): void}`, `renderHome(root: HTMLElement, api)`, `renderLobby(root, snapshot, actions)`, `renderTable(root, snapshot, actions)` where `actions = {roll(), move(pieceId), pickColor(c), start(), forceContinue(c)}` — each action is a no-op when the snapshot says the local player may not do it.

- [x] **Step 1: Write the failing test** (Vitest + happy-dom) — the tab's token comes from `sessionStorage`, so two tabs of the same origin hold different tokens while the name stays remembered per code in `localStorage`; `renderTable` marks legal pieces with `.legal` only when the local player is the active color, and a spectator gets no `.legal` and no `[data-act=roll]` button; `waitingFor` renders the "waiting for Green…" banner and disables actions for everyone; an unknown code shows the reason text from the notice rather than a blank screen; standings appear only when `phase === 'finished'`.
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement.** One plain render function per screen, re-run on every snapshot — no framework, no virtual DOM; the board placeholder is a `<div id="board">` that Task 11 fills. Input locking is local only: buttons are disabled when it is not your turn or the game is paused.
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** — `"feat: web client screens"`

### Task 11: SVG board and pieces

**Files:**
- Create: `apps/web/src/render/board.ts`, `apps/web/src/board-geometry.ts`
- Test: `apps/web/test/board.test.ts`

**Interfaces:**
- Consumes: `FieldId`, `PieceView`, `EventItem`.
- Produces: `fieldPoint(field: FieldId): {x: number; y: number}`, `renderBoard(root: HTMLElement, snapshot: Snapshot, onPick(pieceId: string)): void`, `BOARD_VIEWBOX = '0 0 100 100'`.

- [x] **Step 1: Write the failing test** — every one of the 40 circuit fields maps to a distinct point inside the viewBox; the four entry fields sit 90° apart around the centre (compare angles from the centre within 1°); each color's four home fields lie on the line from its entry toward the centre and get progressively closer to it; corner slots stay inside their own quadrant; `renderBoard` draws exactly 16 pieces for a fresh game and adds `.legal` only to pieces in `game.legalMoves`; a `captured` event in the snapshot's events marks that piece's color with `.flash` once.
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement.** Circuit field *i* sits at angle `(i / 40) * 2π` on a ring of radius 42 in viewBox units, home fields interpolate from the entry point toward the centre, corner slots are a fixed 2×2 grid per quadrant. Pieces are `<circle>` with `r=2.6`; legal-piece hit areas get a transparent `r=5` sibling so touch targets clear 44 px on a phone.
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** — `"feat: svg board and pieces"`

### Task 12: The 3D dice

**Files:**
- Create: `apps/web/src/dice.ts`
- Test: `apps/web/test/dice.test.ts`

**Interfaces:**
- Consumes: the rolled value from a `rolled` event.
- Produces: `faceQuaternion(value: 1|2|3|4|5|6): [number, number, number, number]`, `createDice(host: HTMLElement, opts?: {forceFallback?: boolean}): {show(value: number): void; dispose(): void}`, and a fallback path that renders the numeral in text when WebGL is unavailable.

- [x] **Step 1: Write the failing test** — `faceQuaternion` returns six distinct rotations whose resulting up-axis differs by more than 20° pairwise (so no two faces can land alike); `createDice(host, {forceFallback: true})` renders an element whose text is the value passed to `show(4)` and does not throw when WebGL is missing; a real WebGL context path is exercised once so a broken shader fails loudly rather than silently.
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement** with Three.js: one box geometry, six canvas-generated pip textures (no external asset to download), a short tumble animation (~700 ms) that ends on `faceQuaternion(value)`. Every client animates the same value; only the local player's pending choice locks input.
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** — `"feat: three.js dice with text fallback"`

### Task 13: Standings, play again, and event-driven animation

**Files:**
- Modify: `apps/server/src/rooms.ts` (add `returnToLobby`), `apps/web/src/render/table.ts`, `apps/web/src/main.ts`
- Test: `packages/server/test/playagain.test.ts`, `apps/web/test/events.test.ts`

**Interfaces:**
- Consumes: Task 7 room model, Task 11 board, Task 12 dice.
- Produces: `returnToLobby(store, code, byToken): {snapshot?, notice?}` — same seats, colors and host, fresh game with a new seed, phase back to `lobby`, spectators kept; `drainEvents(snapshot, seenEventId): EventItem[]` on the client.

- [x] **Step 1: Write the failing test** — server side: `returnToLobby` by the host keeps every player's color and host flag, clears pieces to corners, drops `out`, and refuses a non-host with `notHost`; a room whose game finished stays alive (no expiry while a human is attached) and shows standings until someone returns. Client side: `drainEvents` returns only events newer than the id the client last saw, oldest first, and an empty list for a reconnecting client that is further behind than the 12 events the snapshot carries — so it jumps to the current board instead of replaying a stale capture.
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement.** The client keeps `lastSeenEventId` in memory and animates the drained list in order, one animation per event, dice first; nothing on the server waits for that to finish.
- [x] **Step 4: Run** → PASS. Then run the whole suite: `npm test`.
- [x] **Step 5: Commit** — `"feat: play again and event-driven animation"`

### Task 14: Manual acceptance run against the spec

No new behavior; this task proves the phase-1 done list and fixes whatever it finds.

**Files:**
- Modify: `README.md` (replace "Repo state" with how to run it), `docs/superpowers/plans/2026-11-18-phase-1-functionality.md` (tick the acceptance boxes)
- Test: none new — the checklist below is the test.

- [x] **Step 1: Start it** — `npm run build && npm start`, then open four browser tabs on one machine, seat four players with four colors, and start the game.
- [x] **Step 2: Play one full game to a winner**, rolling from each tab in turn order and confirming every capture sends a piece home visibly. If any rule looks wrong, stop and fix the engine — that is what phase 1 exists for.
- [x] **Step 3: Refresh one tab mid-choice** (after its roll, before its move) and confirm it returns to the same pending choice with the same die value.
- [x] **Step 4: Kill one tab's socket for ~40 s** (close the tab's network in devtools or restart the server) and confirm the table shows "waiting for…", pauses, then resumes without a skipped turn; then press force continue from a non-host tab and confirm the game continues with three players.
- [x] **Step 5: Join a fifth tab after the start** and confirm it watches as a spectator and cannot affect state; open one instance on a phone or narrow viewport and confirm the board scales and legal pieces are tappable.
- [x] **Step 6: Commit** — `"docs: phase 1 acceptance results"`

**Results (2026-11-18).** Steps 1–5 ran in `scripts/acceptance.mjs`: five real Chromium
contexts (four players, one phone-sized spectator) against `npm start`. A whole game was
played to a winner — 193 turns, 218 rolls, 180 moves, no failed taps, ~56 s — and 23 of
23 checks passed: code format, a stranger arriving with a link being asked their name,
four seats claimed by name, host-only start, spectator with no roll button, a real mouse
tap on a highlighted piece (45 px target), a tab that loses its connection saying so and
rejoining by itself in the same seat, the table waiting for a player who vanished with
"Waiting for Blue…" while nobody else can play, force continue from a non-host tab taking
that color off the board and playing on, a refresh between roll and move returning the
same pending choice and die value, a capture flashing on the board, the dice drawn by
three.js, standings at the end, play again restoring the same four seats, and a 340 px
square board on a 360 px screen. Screenshots:
`.superpowers/sdd/2026-11-18-phase-1-functionality/shots/`.

Three things the run changed in the code, all found by it rather than by unit tests:

- `apps/server/test/e2e.test.ts` dropped any snapshot that arrived while no read was
  pending, so a passing test failed one run in six. The harness now queues them.
- A link with a code in it no longer joins as `guest` for someone the browser has never
  seen; it asks their name first, and only rejoins silently when this tab already knows
  who it is.
- **The browser never reconnected.** The server survived a dropped socket and the design
  promises short network drops are survivable, but a tab whose websocket closed sat on a
  stale board — every phone changing masts would have had to be refreshed by hand.
  `apps/web/src/connection.ts` now redials with the same token (500 ms, doubling to 4 s),
  says "Connection lost — trying again" while it is out, disables everything that needs
  the wire instead of swallowing taps, and stops when the room is gone for good. Making
  the run simulate this took some doing: Playwright's `setOffline` only blocks *new*
  sockets and this Chromium has no `Network.closeWebSocket`, so the script patches
  `window.WebSocket` to record the app's own socket and hangs that up while the network
  stays down.
