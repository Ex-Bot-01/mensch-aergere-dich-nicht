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

## Plan

Two phases, in this order:

1. **Functionality** — every game mechanic works end to end over multiple browsers:
   sessions, lobby, color picking, turn order, dice, movement rules, capture, home
   run, winning. Correct and robust before it is beautiful.
2. **Visuals** — the board, the pieces, the 3D dice toss, animations and polish that
   make it look astonishing.

## Repo state

Empty skeleton. Rules details and stack choices are being settled in the design doc
under `docs/`.
