#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createServer } from "node:net";

const port = Number(process.argv[2] ?? 8766);
const clients = new Set();
const state = {
  position: [14.22, 2.9, 1.24],
  rotation: [0, 270, 0],
  moving: false,
  controller: "Human",
};
let activeTimer = null;

const moveTo = ["Mailbox", "Top of Stairs", "Power Bank", "Globe", "Jukebox", "Cradle"];
const primitive = ["MoveAhead", "MoveBack", "MoveLeft", "MoveRight", "RotateLeft", "RotateRight", "Cancel"];

function frame(payload) {
  const body = Buffer.from(JSON.stringify(payload));
  if (body.length < 126) return Buffer.concat([Buffer.from([0x81, body.length]), body]);
  const header = Buffer.alloc(4);
  header[0] = 0x81;
  header[1] = 126;
  header.writeUInt16BE(body.length, 2);
  return Buffer.concat([header, body]);
}

function broadcast(payload) {
  const message = frame(payload);
  for (const client of clients) client.write(message);
}

function snapshot() {
  return {
    Type: "game.state.snapshot",
    SchemaVersion: "2.2",
    TimestampUtc: new Date().toISOString(),
    Payload: {
      ControlledEntity: "Player",
      Controller: state.controller,
      UInput: {
        AgentStatus: { Name: "agent_status", Position: [5.66, -2.34, -6.19], CurrentState: "Observe" },
        PlayerStatus: {
          Name: "player_status",
          Position: state.position,
          Rotation: state.rotation,
          Forward: [0, 0, 1],
          IsMoving: state.moving,
        },
        Perception: {
          Observer: "Sophia",
          VisibleEntities: [],
        },
        Perceptions: {
          Player: {
            ObservationMode: "raycast_metadata",
            Observer: "Player",
            ViewOrigin: [14.22, 4.5, 1.24],
            ViewDirection: [0, 0, 1],
            FieldOfViewDegrees: 100,
            MaxDistance: 15,
            VisibleEntities: [{
              EntityId: "Game/Environment/Globe",
              Name: "Globe",
              DisplayName: "The Globe",
              IsRegistered: true,
              Tag: "Untagged",
              Layer: 0,
              LayerName: "Default",
              ColliderType: "SphereCollider",
              IsTrigger: false,
              Kinds: ["destination", "interactable", "scene_object"],
              Position: [13.1, 2.9, 6.3],
              Direction: [-0.21, -0.3, 0.93],
              HitPoint: [13.2, 3.1, 6.1],
              SurfaceNormal: [0, 0.1, -0.99],
              Distance: 4.2,
              AngleDegrees: 21.5,
              AvailableActions: ["MoveTo", "Interact"],
            }, {
              EntityId: "Game/Environment/LabWall",
              Name: "LabWall",
              IsRegistered: false,
              Tag: "Untagged",
              Layer: 0,
              LayerName: "Default",
              ColliderType: "MeshCollider",
              IsTrigger: false,
              Kinds: ["scene_object"],
              Position: [12.3, 3.2, 4.8],
              Direction: [-0.4, 0.05, 0.91],
              HitPoint: [12.4, 3.1, 4.7],
              SurfaceNormal: [0, 0, -1],
              Distance: 3.7,
              AngleDegrees: 24.1,
              AvailableActions: [],
            }],
          },
          Sen: {
            ObservationMode: "metadata",
            Observer: "Sophia",
            VisibleEntities: [],
          },
        },
      },
      AvailableActions: {
        Sen: { MoveTo: [], Interact: [], Primitive: [], WaitForSeconds: [] },
        Player: { MoveTo: moveTo, Interact: [], Primitive: primitive, WaitForSeconds: [] },
      },
    },
  };
}

function result(request, status, message) {
  return {
    Type: "game.action.result",
    ActionId: request.ActionId,
    Actor: request.Actor,
    Action: request.Action,
    Status: status,
    TimestampUtc: new Date().toISOString(),
    Message: message,
  };
}

function applyAction(request) {
  if (request.Action === "Cancel") {
    clearTimeout(activeTimer);
    activeTimer = null;
    state.moving = false;
    state.controller = "Human";
    broadcast(result(request, "completed", "Mock action cancelled."));
    broadcast(snapshot());
    return;
  }
  state.controller = "OmegaClaw";
  state.moving = true;
  broadcast(result(request, "accepted", "Mock Unity accepted the action."));
  broadcast(result(request, "running", "Mock action is in progress."));

  if (request.Action === "MoveAhead") state.position[2] += Number(request.Parameters?.Distance ?? 0.5);
  if (request.Action === "MoveBack") state.position[2] -= Number(request.Parameters?.Distance ?? 0.5);
  if (request.Action === "MoveLeft") state.position[0] -= Number(request.Parameters?.Distance ?? 0.5);
  if (request.Action === "MoveRight") state.position[0] += Number(request.Parameters?.Distance ?? 0.5);
  if (request.Action === "RotateLeft") state.rotation[1] -= Number(request.Parameters?.Degrees ?? 15);
  if (request.Action === "RotateRight") state.rotation[1] += Number(request.Parameters?.Degrees ?? 15);
  if (request.Action === "MoveTo") state.position = [-11.88, -2.34, -2.47];

  activeTimer = setTimeout(() => {
    activeTimer = null;
    state.moving = false;
    state.controller = "Human";
    broadcast(result(request, "completed", "Mock action completed."));
    broadcast(snapshot());
  }, request.Action === "MoveTo" ? 3000 : 350);
}

function readFrame(buffer) {
  if (buffer.length < 6) return null;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    length = buffer.readUInt16BE(offset);
    offset += 2;
  }
  const masked = (buffer[1] & 0x80) !== 0;
  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  offset += masked ? 4 : 0;
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
  return { opcode: buffer[0] & 0x0f, text: payload.toString("utf8") };
}

const server = createServer((socket) => {
  socket.once("data", (requestBuffer) => {
    const request = requestBuffer.toString("utf8");
    const key = request.match(/Sec-WebSocket-Key:\s*(.+)\r\n/i)?.[1]?.trim();
    if (!key || !request.startsWith("GET /game/state ")) {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }
    const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    clients.add(socket);
    socket.write(frame(snapshot()));
    socket.on("data", (buffer) => {
      const incoming = readFrame(buffer);
      if (incoming?.opcode === 1) {
        try { applyAction(JSON.parse(incoming.text)); } catch { /* test server only */ }
      }
    });
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
  });
});

setInterval(() => broadcast(snapshot()), 1000);
server.listen(port, "127.0.0.1", () => console.log(`Mock game state: ws://127.0.0.1:${port}/game/state`));
