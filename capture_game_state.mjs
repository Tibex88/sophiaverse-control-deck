#!/usr/bin/env node

import { mkdirSync, createWriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const argumentsList = process.argv.slice(2);
const valueAfter = (name) => {
  const index = argumentsList.indexOf(name);
  return index >= 0 ? argumentsList[index + 1] : undefined;
};

const dashboardRoot = dirname(fileURLToPath(import.meta.url));
const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const socketUrl = valueAfter("--url") ?? "ws://127.0.0.1:8765/game/state";
const outputPath = resolve(
  valueAfter("--output") ??
    resolve(dashboardRoot, "logs", `game-state-${timestamp}.jsonl`),
);

mkdirSync(dirname(outputPath), { recursive: true });
const output = createWriteStream(outputPath, { flags: "a" });

let socket;
let reconnectTimer;
let shuttingDown = false;
let messageCount = 0;

console.log(`Saving game state to ${outputPath}`);

function connect() {
  if (shuttingDown) return;

  console.log(`Connecting to ${socketUrl} ...`);
  socket = new WebSocket(socketUrl);

  socket.addEventListener("open", () => {
    console.log("Connected. Play SophiaVerse to begin capturing snapshots.");
  });

  socket.addEventListener("message", async (event) => {
    try {
      const text = typeof event.data === "string" ? event.data : await event.data.text();
      const message = JSON.parse(text);
      output.write(`${JSON.stringify(message)}\n`);
      messageCount += 1;

      if (message.Type === "game.action.result") {
        console.log(
          `[${messageCount}] action=${message.Action ?? "unknown"} actor=${message.Actor ?? "unknown"} ` +
            `status=${message.Status ?? "unknown"} id=${message.ActionId ?? "unknown"} ` +
            `message=${message.Message ?? ""}`,
        );
        return;
      }

      const visibleEntities = message.Payload?.UInput?.Perception?.VisibleEntities ?? [];
      const visibleNames = visibleEntities.map((entity) => entity.Name).join(", ") || "none";
      const sophia = message.Payload?.UInput?.AgentStatus ?? {};
      const player = message.Payload?.UInput?.PlayerStatus ?? {};
      const controlledEntity = message.Payload?.ControlledEntity ?? "unknown";
      const controller = message.Payload?.Controller ?? "unknown";
      const formatPosition = (position) =>
        Array.isArray(position)
        ? `(${position.map((coordinate) => Number(coordinate).toFixed(2)).join(", ")})`
        : "unknown";
      console.log(
        `[${messageCount}] ${message.TimestampUtc ?? new Date().toISOString()} ` +
          `controlled=${controlledEntity} controller=${controller} ` +
          `player=${formatPosition(player.Position)} playerMoving=${player.IsMoving ?? "unknown"} ` +
          `sophia=${formatPosition(sophia.Position)} sophiaState=${sophia.CurrentState ?? "unknown"} ` +
          `observer=${message.Payload?.UInput?.Perception?.Observer ?? "unknown"} ` +
          `visible=${visibleNames}`,
      );
    } catch (error) {
      console.error(`Ignored an invalid WebSocket message: ${error.message}`);
    }
  });

  socket.addEventListener("error", () => {
    // The close event below handles reconnection with a useful, non-repeating message.
  });

  socket.addEventListener("close", () => {
    if (shuttingDown) return;
    console.log("WebSocket unavailable; retrying in 2 seconds ...");
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 2000);
  });
}

function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(reconnectTimer);
  if (socket?.readyState === WebSocket.OPEN) socket.close(1000, "capture stopped");
  output.end(() => {
    console.log(`Saved ${messageCount} messages to ${outputPath}`);
    process.exit(0);
  });
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

connect();
