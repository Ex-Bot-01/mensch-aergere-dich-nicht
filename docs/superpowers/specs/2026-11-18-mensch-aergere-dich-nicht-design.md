# Mensch ärgere dich nicht — browser game, design

Date: 2026-11-18 · Status: approved · Phase in focus: **1 (functionality)**

## Intent

A version of *Mensch ärgere dich nicht* you can play with friends who live all over
the world. Someone opens the page, creates a game and gets a code; everyone else
opens the same page, types the code and lands in the lobby, picks a color that is
still free, and plays when the host starts it. No accounts, no install, no download.

**Why:** it is a way to play *this* game with *these* people over a distance. Success
looks like four people on three continents finishing an evening game where nobody has
to explain the rules, nobody loses a piece to a dropped connection, and the dice feels
like throwing a real one.

## Goals (phase 1)

- Create or join a room by code from one URL; no accounts.
- Lobby where you take a color nobody else has taken, and the host starts the game.
- Every mechanic works, server-enforced: turn order, dice, bringing pieces into play,
  movement, capture, sending a piece home, the home column, winning.
- A dice value that every browser agrees on, tossed by the player whose turn it is.
- Survive refreshes and short network drops mid-game without losing your seat or state.
- Playable with a finger on a phone and with a mouse on a desktop.
- Several independent rooms on one server at the same time.
- A late friend can open the code and watch the game running, read-only, as a spectator.

## Non-goals (phase 1)

Chat and reactions, sound, avatars, turn timers,
computer opponents, persistent statistics, i18n beyond English labels with the German
game terms kept as-is, anything that looks astonishing. Astonishing is phase 2.

## Anti-goals

- A game that looks beautiful and has a wrong rule.
- A room that dies because someone refreshed.
- Ping deciding who wins: this is turn-based, so latency may delay, never disadvantage.
- Screens of options to configure before you are allowed to play.
- "Multiplayer" that is really one browser plus bots.
- A UI you can only use if you already know the rules.

## Constraints

- Needs an always-on server holding game state and pushing changes: free static-only
  hosting is out. Node 22 is available locally; `ws` over HTTPS/WSS in production.
- Players are on mobile data with real latency and brief disconnects, and their browser
  clocks do not agree — so the server is the only clock and the only referee.
- The two-phase plan means phase 1 work must not lock in a look: the rules engine has to
  be renderer-agnostic so phase 2 can replace the whole view without touching a rule.

## Approaches considered

**1. Boring server, 3D dice only (chosen).** Node + `ws`, rooms in memory, full JSON
state snapshots pushed on every change. Client is TypeScript with the board as
HTML/SVG; Three.js used for one thing — the dice. Rules live in a pure module with no
rendering in it, so phase 1 is testable headless. Trades: the board looks plain until
phase 2; in-memory rooms need a reload path when the server restarts.

**2. All-in 3D.** Three.js scene with board, pieces and camera from day one — the
camera swings after the dice and the moving piece. Astonishing sooner, but camera work
and picking pieces in 3D spend phase 1 hours that belong to the rules.

**3. Managed realtime backend** (Colyseus, Supabase Realtime). Least plumbing to get a
room broadcasting, but you inherit their room-and-state model and still need an
always-on host, so the saving is smaller than it looks.

Chosen: **1**, because it gets every mechanic provably right first, spends the 3D budget
on the dice where the "astonishing" moment actually is, and leaves phase 2 free to swap a
plain SVG board for something gorgeous without touching a single rule.

## Decisions that are theirs

- **Phase order:** functionality first, visuals second. Nothing about phase 1's design
  depends on how it will eventually look.
- **Architecture:** approach 1 above.
- **Rules: variant A (classic), with the folk opening.** Roll a 6 to bring a piece out
  of the start corner — not the official opening where one piece already stands on the
  start field. The official opening comes later as a room toggle, which costs nothing
  once the engine exists.
- **No "three 6s forfeits" penalty:** a 6 always earns another roll. (That penalty is
  not in the official *Grundregeln*; it belongs to variant families.)
- **Connection model:** server-authoritative with resync, because friends worldwide on
  mobile data must never disagree about the board.
- **Phones matter**, so touch targets and a one-hand layout are phase 1 requirements,
  not polish.

## The design

### Shape of the app

Three screens, no settings screen:

```
[ Home ]        "Mensch ärgere dich nicht"
                Name: [____]        (remembered from last time)
                [ Create game ]     or  join: code [____]  [ Join ]

[ Lobby ]       Code: K7M2QP   (tap to copy)      you are host
                Red    — host, "Anna"            [ take ]
                Blue   — "Ben"                   [ leave ]
                Green  — free                    [ take ]
                Yellow — free                    [ take ]
                Start requires 2+ players.       [ Start game ]   (host only)

[ Table ]       whose turn it is, and what they must do:
                "Blue to roll"      [ Roll dice ]  → die tumbles, shows 6
                "Blue, choose a piece" → legal pieces highlighted, tap one
                opponent's piece sent home → that corner flashes
                standings strip; if disconnected: "waiting for Green…"
```

### State and protocol

- The server holds the only real state. Rooms live in memory, keyed by code.
- Client sends **intents** only: `join`, `leave`, `pickColor`, `unpick`, `start`, `roll`,
  `move`, `forceContinue`, `rename`. The server validates each against the rules and the
  sender's seat, mutates, then broadcasts.
- Server sends one thing back: a **full snapshot** plus a monotonically increasing `rev`.
  Snapshots, not diffs: self-healing by construction. A client that missed three updates
  is fixed by the next one, and it ignores any snapshot with a `rev` it has already seen.
- A turn can contain several happenings — bring a piece out, roll again, move, capture —
  so the snapshot carries an **event list**, not a single event: appended events each get
  an id after `rev`, the snapshot keeps the last handful (my call: 12), and clients animate
  only the ones they have not seen yet. A client that was away through more than that just
  jumps to the current board.
- Refusals travel on their own **notice** channel, because a rejected intent changes no
  state and therefore produces no new snapshot: the client gets `{reason}` and shows it.
- The snapshot carries the **legal moves for the active player**, computed by the server.
  The view only paints them; it does not re-derive rules. That keeps phase 2's new board
  from needing a copy of the rulebook, and it means a refreshed browser can restore "which
  pieces may I tap" straight from the snapshot.
- **The server never waits on an animation.** A turn passes in state the moment the move is
  applied; each client drains its event queue locally and locks input only while *its own*
  player still owes a choice. No server timer depends on how long a tumble takes, so phase
  2 can change every duration without touching the protocol.
- The server rolls the dice when `roll` arrives and puts the value in the snapshot, so all
  browsers show the same number. Each game gets its own random seed, recorded next to the
  code, so any finished game can be replayed deterministically in a test.
- Only the player whose turn it is may roll or move; a wrong intent returns a notice and
  changes nothing.

### Rules engine (phase 1, complete)

Pure module: `apply(state, action) → state | error`. No DOM, no timers, no randomness
except an injected seeded RNG.

- **Board:** 2–4 players; colors red, blue, green, yellow; four pieces each. Geometry is
  one named constant per color: a route of shared circuit fields (entered at that color's
  start field) followed by that color's four private home fields. Start slots and home
  fields are color-private, so only shared-circuit fields can hold pieces of two colors.
  The circuit length is pinned to the real board in phase 2; nothing in the rules depends
  on the number, only on the fact that a piece must complete one full circuit before it
  may turn into its home column.
- **Opening (folk version):** all four pieces start in the player's corner. A roll of 6
  with an empty start field and at least one piece still in the corner is *mandatory*:
  place a piece on the color's start field, then roll again.
- **Rolling 6 otherwise:** move as usual, then roll again — no limit, no penalty.
- **Movement:** forward only, exactly the rolled value, and a roll may not be split
  across pieces. The player chooses which piece among the legal ones; there is no forced
  capture and no forced move. *No forced* means free choice of **which** piece, not a
  choice to decline: if a legal move exists you must take one, so there is no *pass*
  button on the table.
- **Invariant:** every *active* player owns exactly four pieces, in one of five places —
  corner, start field, shared circuit, home column, finished. A player marked out by the
  host stops being active and their pieces leave the board; the invariant is then checked
  over the active players only.
- **Capture:** landing on a field held by an opponent sends that opponent's piece back to
  its own corner. Landing on your own piece is not a move at all: illegal, no re-roll.
- **No legal move** after a roll (all blocked or all overshooting) simply ends the turn;
  the server passes it automatically after the animation window.
- **Home column:** entered only after a full circuit. A move may not carry a piece past
  the last home field, and a piece may not jump over another piece of its own color
  inside the home column. A piece on the last home field is finished and stays put.
- **Winning:** the game ends the moment one player has all four pieces in home. Standings:
  winner first, then remaining players by pieces finished, then by how far ahead they are.

### Session and room lifecycle

- Codes are 6 characters from an alphabet with no ambiguous glyphs (no O/0, I/1), unique
  among live rooms, shown as text so they can be read out over the phone.
- **One seat per tab, not one per browser.** A tab's player token lives in
  `sessionStorage`, so a reload keeps your seat and four tabs on one laptop are four
  players — which is what makes the phase 1 acceptance test runnable alone at a desk.
  The name you typed is remembered per room code in `localStorage`, so the next evening
  the page offers "join again as Anna" instead of asking who you are, and an abandoned
  seat can be reclaimed rather than blocked forever.
- The lobby is open until the host starts; while playing, a player who left may rejoin by
  code into their own color as long as the game runs.
- **Disconnect** is detected by an application-level heartbeat (my call: ping every 15s,
  two missed answers means gone) and instantly on socket close. Heartbeat matters because
  a half-open mobile-data socket can look connected for minutes while the table waits on a
  ghost. The game pauses when a player drops, with or without the turn — banner "waiting
  for Green…", no countdown, nobody's turn is silently skipped.
- **Force continue** is the escape hatch for a phone that died at 2 a.m. It marks that
  player out: their pieces leave the board, they rank last in the standings, and their
  color stays taken for the rest of that game rather than being handed to someone new.
  If only one active player is left, that player wins immediately — nobody plays a game
  alone. Any connected human may press it, not just the host, because the decision is
  social and the host might be the missing one; the button says plainly what it does.
- **Host leaves:** the host role passes to the next remaining human in seat order.
- **Room death:** a room closes when no human has been attached for 15 minutes, or after
  30 idle minutes with humans present, so an evening table left open on a phone tab does
  not live forever. When a game ends the room survives it: the standings screen keeps the
  code alive and the host can send everyone back to the lobby to play again.

### The dice

Phase 1 needs the value to be right and the toss to exist: a Three.js die on its own
canvas that tumbles briefly and settles showing the server's value, started by the active
player pressing *Roll dice*. Phase 2 is where it gets physical — real tumbling with sound,
and possibly a board camera that follows it.

### Reconnect model

On socket open the client sends code + token; the server reattaches the seat and sends the
current snapshot. Missed animations are not replayed beyond the handful of events the
snapshot still carries. If the game was mid-choice (rolled, waiting for a piece), the
client shows exactly that: whose turn, which pieces are legal.

### Done means (phase 1)

- Engine suite plays thousands of complete games with random-but-legal bot moves and
  asserts invariants every turn: each player always owns exactly four pieces; no piece is
  ever on two fields; no illegal move was ever accepted; captures always land in the
  corner; every game terminates with a winner.
- Live end-to-end by hand: four browser tabs on one machine play a full game to a winner,
  with one tab refreshed mid-game and one disconnected for about half a minute and
  returning — the per-tab token exists so this test needs no second device.
- Force continue is exercised, not just implemented: a three-player game marked down to
  two still finishes, and a two-player game ends at once when its loser is marked out.
- The same game is playable from a phone browser.
- Two rooms running at once on one server process do not see each other.

### Phase 2 (after this works)

Board art and pieces that read as objects, dice physics and sound, move and capture
animations, lobby polish, whatever else the look demands — all of it allowed to replace
the phase 1 view, none of it allowed to change a rule.

## Joining late: spectators

Someone with a valid code does **not** become a player once the host has started — no new
color is dropped into a race that is already uneven. They come in as a **spectator**: the
same table, read-only, live.

- A spectator needs no seat and picks no color. Their browser subscribes to snapshots and
  sends nothing but join and leave, so they cannot affect state at all.
- They do not appear in the standings, and their disconnecting never pauses the game —
  only players do that.
- In a lobby where all four colors are already taken, a joiner watches rather than being
  told the room is full.
- A player who is marked out by force continue becomes a spectator on the spot: they stop
  losing and keep watching, and their color is waiting for them when the room returns to
  the lobby.
- Spectators are deliberately plain in phase 1 — a board you can follow, no chat, no
  follow-the-piece camera. Making watching pleasant is phase 2 work.

## Smaller calls, made by me

- Colors red/blue/green/yellow rather than the board's traditional black, because black
  reads as shadow on a screen.
- English UI labels with the German game name kept as-is.
- Starting color chosen randomly by the server at game start; turn order then fixed.
- No accounts; `localStorage` token only. Clearing it costs you your seat, not the game.
- Rooms in memory with a snapshot reload path on server restart; no database in phase 1.
- Seats are restored when the host takes the room back to the lobby: same colors, same
  host, so "again" is two taps and not everyone re-picking.
- Everyone's browser animates the dice tumble, not just the roller — it is the moment
  everyone came for. If WebGL is unavailable, a plain box showing the number takes its
  place, so an old phone never blocks a game.
- Turn order is a fixed cycle through the seats, starting from a color the server picks at
  random when the host starts; it does not depend on who rolls highest, which is fairer and
  needs no special case for everyone rolling a 6.
- The four colors enter the shared circuit at evenly spaced points. That is a property of
  the board, not a tuning knob: uneven spacing would quietly favour one seat and skew the
  thousands of simulated games that prove the engine.

## Left to the builder

- Client framework and build tool (plain TypeScript + Vite is the fallback assumption),
  and how the board is drawn in HTML/SVG terms.
- CSS approach; how the board scales between a phone and a wide desktop.
- Hosting target and deploy mechanics for an always-on WebSocket server, and whether a
  restart keeps rooms by snapshotting to disk.
- The dice asset: procedural box with pip textures or a small glTF model.
- Repo layout (`server/` + `web/` in one repo is the fallback assumption) and test runner.
- Pinning the shared-circuit field count against a physical board when phase 2 draws it.
