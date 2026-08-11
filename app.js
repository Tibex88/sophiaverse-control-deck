const elements = {
  socketUrl: document.querySelector("#socketUrl"),
  commandRoute: document.querySelector("#commandRoute"),
  connectButton: document.querySelector("#connectButton"),
  connectionDot: document.querySelector("#connectionDot"),
  connectionLabel: document.querySelector("#connectionLabel"),
  connectionDetail: document.querySelector("#connectionDetail"),
  controlledEntity: document.querySelector("#controlledEntity"),
  controller: document.querySelector("#controller"),
  playerPosition: document.querySelector("#playerPosition"),
  playerMotion: document.querySelector("#playerMotion"),
  playerHeading: document.querySelector("#playerHeading"),
  playerForward: document.querySelector("#playerForward"),
  senState: document.querySelector("#senState"),
  senPosition: document.querySelector("#senPosition"),
  distance: document.querySelector("#distance"),
  distanceValue: document.querySelector("#distanceValue"),
  degrees: document.querySelector("#degrees"),
  degreesValue: document.querySelector("#degreesValue"),
  cancelButton: document.querySelector("#cancelButton"),
  primitiveCount: document.querySelector("#primitiveCount"),
  destination: document.querySelector("#destination"),
  destinationCount: document.querySelector("#destinationCount"),
  moveToButton: document.querySelector("#moveToButton"),
  observer: document.querySelector("#observer"),
  visibleEntities: document.querySelector("#visibleEntities"),
  messageCount: document.querySelector("#messageCount"),
  clearLog: document.querySelector("#clearLog"),
  activityLog: document.querySelector("#activityLog"),
  rawState: document.querySelector("#rawState"),
  toast: document.querySelector("#toast"),
};

let socket = null;
let latestSnapshot = null;
let availablePrimitives = new Set();
let activityCount = 0;
let toastTimer = null;
let actionInProgress = false;

function setConnection(status, detail) {
  const connected = status === "Connected";
  elements.connectionLabel.textContent = status;
  elements.connectionDetail.textContent = detail;
  elements.connectionDot.className = `status-dot ${connected ? "connected" : status === "Connecting" ? "connecting" : ""}`;
  elements.connectButton.textContent = connected ? "Disconnect" : "Connect";
  elements.connectButton.classList.toggle("disconnect", connected);
  updateControlAvailability();
}

function connect() {
  const url = elements.socketUrl.value.trim();
  if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
    showToast("Use a ws:// or wss:// endpoint.", true);
    return;
  }

  if (socket?.readyState === WebSocket.OPEN) {
    socket.close(1000, "dashboard disconnect");
    return;
  }

  setConnection("Connecting", url);
  socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    setConnection("Connected", url);
    addActivity("system", "Connected", url);
  });

  socket.addEventListener("message", async (event) => {
    const text = typeof event.data === "string" ? event.data : await event.data.text();
    let message;
    try {
      message = JSON.parse(text);
    } catch (error) {
      addActivity("error", "Invalid incoming JSON", error.message);
      return;
    }

    if (message.Type === "game.state.snapshot") {
      latestSnapshot = message;
      renderSnapshot(message);
      addActivity("snapshot", "State snapshot", summarizeSnapshot(message));
    } else if (message.Type === "game.action.result") {
      if (message.Action !== "Cancel") {
        if (["accepted", "running"].includes(message.Status)) actionInProgress = true;
        if (["completed", "failed", "rejected", "cancelled"].includes(message.Status)) actionInProgress = false;
      }
      updateControlAvailability();
      addActivity("result", `${message.Action ?? "Action"} · ${message.Status ?? "unknown"}`, message.Message ?? "", message.Status);
      if (["failed", "rejected"].includes(message.Status)) showToast(message.Message ?? "Action failed.", true);
    } else {
      addActivity("incoming", message.Type ?? "Incoming message", text.slice(0, 220));
    }
  });

  socket.addEventListener("error", () => {
    showToast("WebSocket connection failed. Check Unity Play mode and the endpoint.", true);
  });

  socket.addEventListener("close", (event) => {
    setConnection("Disconnected", event.reason || `Socket closed (${event.code})`);
    addActivity("system", "Disconnected", event.reason || `Code ${event.code}`);
    socket = null;
  });
}

function renderSnapshot(message) {
  const payload = message.Payload ?? {};
  const input = payload.UInput ?? {};
  const player = input.PlayerStatus ?? {};
  const sen = input.AgentStatus ?? {};
  const perception = input.Perception ?? {};
  const playerActions = payload.AvailableActions?.Player ?? {};

  actionInProgress = payload.Controller === "OmegaClaw";

  elements.controlledEntity.textContent = payload.ControlledEntity ?? "—";
  elements.controller.textContent = `Controller: ${payload.Controller ?? "—"}`;
  elements.playerPosition.textContent = formatVector(player.Position);
  elements.playerMotion.textContent = player.IsMoving ? "Moving" : "Stationary";
  elements.playerHeading.textContent = `${Math.round(player.Rotation?.[1] ?? 0)}°`;
  elements.playerForward.textContent = `Forward: ${formatVector(player.Forward)}`;
  elements.senState.textContent = sen.CurrentState ?? "—";
  elements.senPosition.textContent = `Position: ${formatVector(sen.Position)}`;
  elements.observer.textContent = `Observer: ${perception.Observer ?? "—"}`;
  elements.rawState.textContent = JSON.stringify(message, null, 2);

  availablePrimitives = new Set(playerActions.Primitive ?? []);
  elements.primitiveCount.textContent = `${availablePrimitives.size} available`;
  updateDestinations(playerActions.MoveTo ?? []);
  updateVisibleEntities(perception.VisibleEntities ?? []);
  updateControlAvailability();
}

function updateDestinations(destinations) {
  const previous = elements.destination.value;
  elements.destination.replaceChildren();
  for (const name of destinations) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    elements.destination.append(option);
  }
  if (destinations.includes(previous)) elements.destination.value = previous;
  elements.destinationCount.textContent = `${destinations.length} destinations`;
}

function updateVisibleEntities(entities) {
  elements.visibleEntities.replaceChildren();
  if (!entities.length) {
    elements.visibleEntities.className = "entity-list empty-state";
    elements.visibleEntities.textContent = "No entities are currently visible to Sen.";
    return;
  }

  elements.visibleEntities.className = "entity-list";
  for (const entity of entities) {
    const card = document.createElement("div");
    card.className = "entity";
    const name = document.createElement("strong");
    name.textContent = entity.DisplayName || entity.Name || "Unknown entity";
    const distance = document.createElement("small");
    distance.textContent = `${Number(entity.Distance ?? 0).toFixed(1)} m · ${(entity.AvailableActions ?? []).join(", ") || "observe"}`;
    card.append(name, distance);
    elements.visibleEntities.append(card);
  }
}

function updateControlAvailability() {
  const connected = socket?.readyState === WebSocket.OPEN;
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.disabled = !connected || !availablePrimitives.has(button.dataset.action);
  });
  elements.moveToButton.disabled = !connected || !elements.destination.value;
  elements.cancelButton.disabled = !connected || !actionInProgress;
}

function sendPrimitive(action) {
  const parameters = action.startsWith("Rotate")
    ? { Degrees: Number(elements.degrees.value) }
    : { Distance: Number(elements.distance.value) };
  sendAction(action, parameters);
}

function sendAction(action, parameters) {
  if (elements.commandRoute.value !== "unity") {
    showToast("The OmegaClaw relay has not been configured yet.", true);
    return;
  }
  if (socket?.readyState !== WebSocket.OPEN) {
    showToast("Connect to Unity first.", true);
    return;
  }

  const request = {
    Type: "game.action.request",
    ActionId: `dashboard-${Date.now()}`,
    Actor: "Player",
    Action: action,
    Parameters: parameters,
  };
  socket.send(JSON.stringify(request));
  addActivity("outgoing", action, JSON.stringify(parameters));
}

function addActivity(kind, title, detail, status = "") {
  if (elements.activityLog.querySelector(".empty-state")) elements.activityLog.replaceChildren();
  activityCount += 1;
  elements.messageCount.textContent = `${activityCount} messages`;

  const entry = document.createElement("div");
  const direction = kind === "outgoing" ? "out" : kind === "snapshot" || kind === "incoming" || kind === "result" ? "in" : "•";
  entry.className = `log-entry ${kind === "outgoing" ? "out" : ""} ${kind === "result" ? `result ${status}` : ""}`;
  entry.innerHTML = `
    <div class="log-meta"><span class="direction ${direction === "in" ? "in" : ""}">${direction.toUpperCase()}</span><br>${new Date().toLocaleTimeString([], { hour12: false })}</div>
    <div class="log-body"><strong></strong><small></small></div>`;
  entry.querySelector("strong").textContent = title;
  entry.querySelector("small").textContent = detail;
  elements.activityLog.append(entry);

  while (elements.activityLog.children.length > 160) elements.activityLog.firstElementChild.remove();
  elements.activityLog.scrollTop = elements.activityLog.scrollHeight;
}

function summarizeSnapshot(message) {
  const player = message.Payload?.UInput?.PlayerStatus ?? {};
  return `${formatVector(player.Position)} · ${player.IsMoving ? "moving" : "stationary"} · ${message.Payload?.Controller ?? "unknown controller"}`;
}

function formatVector(vector) {
  if (!Array.isArray(vector)) return "—";
  return vector.map((value) => Number(value).toFixed(2)).join(", ");
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast show ${isError ? "error" : ""}`;
  toastTimer = setTimeout(() => { elements.toast.className = "toast"; }, 3200);
}

elements.connectButton.addEventListener("click", connect);
elements.distance.addEventListener("input", () => { elements.distanceValue.textContent = `${elements.distance.value} m`; });
elements.degrees.addEventListener("input", () => { elements.degreesValue.textContent = `${elements.degrees.value}°`; });
elements.destination.addEventListener("change", updateControlAvailability);
elements.moveToButton.addEventListener("click", () => sendAction("MoveTo", { Target: elements.destination.value }));
elements.cancelButton.addEventListener("click", () => sendAction("Cancel", {}));
document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => sendPrimitive(button.dataset.action)));
elements.clearLog.addEventListener("click", () => {
  activityCount = 0;
  elements.messageCount.textContent = "0 messages";
  elements.activityLog.innerHTML = '<div class="empty-state">Activity cleared.</div>';
});

setConnection("Disconnected", "No live state");
