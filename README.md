# SophiaVerse Control Deck

A local dashboard for inspecting `/game/state` WebSocket snapshots and sending Player movement commands to Unity.

## Start

From this folder:

```bash
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173`, enter Unity Play mode, and select **Connect**.

The current route sends commands directly to Unity. The route selector intentionally reserves an OmegaClaw relay mode for the next integration.

## Capture raw messages

To save the same WebSocket state and action messages as JSON Lines:

```bash
node capture_game_state.mjs
```

Files are written under `logs/`. Use `--output /absolute/path.jsonl` to choose another location.

For UI development without running Unity, start `node mock_server.mjs` and use `ws://127.0.0.1:8766/game/state`.
