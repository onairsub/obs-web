import { randomBytes, randomUUID } from "node:crypto";
import WebSocket from "ws";

const endpoint = process.env.REMOTE_TEST_URL ?? "ws://127.0.0.1:3000/api/remote-ws";
const hostEndpoint = process.env.REMOTE_TEST_HOST_URL ?? endpoint;
const remoteEndpoint = process.env.REMOTE_TEST_REMOTE_URL ?? endpoint;
const host = new WebSocket(hostEndpoint);
const remote = new WebSocket(remoteEndpoint);
const sessionId = randomBytes(16).toString("hex");
const hostSecret = randomBytes(24).toString("hex");

function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function waitFor(socket, label, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", listener);
      reject(new Error(`Timed out waiting for ${label}`));
    }, 5_000);
    const listener = (raw) => {
      const message = JSON.parse(raw.toString());
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off("message", listener);
      resolve(message);
    };
    socket.on("message", listener);
  });
}

function send(socket, message) {
  socket.send(JSON.stringify(message));
}

try {
  await Promise.all([waitForOpen(host), waitForOpen(remote)]);

  const hostReady = waitFor(host, "host ready", (message) => message.type === "ready");
  send(host, { type: "join", sessionId, hostSecret, clientId: randomUUID(), role: "host" });
  const ready = await hostReady;
  if (!ready.uploadState) throw new Error("New host session was not created");

  send(host, { type: "snapshot", state: { OBS_SOCCER_SCORE: "[1,2]", OBS_TEAM_A: null, "OBS-AUTH": "must-not-relay" } });

  const remoteReady = waitFor(remote, "remote ready", (message) => message.type === "ready");
  const remoteSnapshot = waitFor(remote, "remote snapshot", (message) => message.type === "snapshot");
  const hostClientCount = waitFor(host, "remote presence", (message) => message.type === "client-count" && message.count === 1);
  send(remote, { type: "join", sessionId, clientId: randomUUID(), role: "remote" });
  await remoteReady;
  await hostClientCount;
  const state = (await remoteSnapshot).state;
  if (state.OBS_SOCCER_SCORE !== "[1,2]" || (state.OBS_TEAM_A !== undefined && state.OBS_TEAM_A !== null) || state["OBS-AUTH"]) throw new Error("Snapshot filtering failed");

  const hostStorage = waitFor(host, "remote-to-host storage", (message) => message.type === "storage");
  send(remote, { type: "storage", key: "OBS_SOCCER_SCORE", value: "[2,2]" });
  if ((await hostStorage).value !== "[2,2]") throw new Error("Remote-to-host state relay failed");

  const remoteStorage = waitFor(remote, "host-to-remote storage", (message) => message.type === "storage");
  send(host, { type: "storage", key: "OBS_SOCCER_PERIOD", value: '"후반"' });
  if ((await remoteStorage).value !== '"후반"') throw new Error("Host-to-remote state relay failed");

  const remoteOBSState = waitFor(remote, "OBS state", (message) => message.type === "obs-state");
  send(host, { type: "obs-state", state: { scenes: [{ sceneName: "LIVE" }], currentScene: "LIVE" } });
  if ((await remoteOBSState).state.currentScene !== "LIVE") throw new Error("OBS state relay failed");

  const hostCommand = waitFor(host, "remote command", (message) => message.type === "command");
  send(remote, { type: "command", command: { action: "setText", inputName: "score_A", text: "2" } });
  if ((await hostCommand).command.inputName !== "score_A") throw new Error("Command relay failed");

  const remoteClosed = waitFor(remote, "session close", (message) => message.type === "closed");
  send(host, { type: "close-session" });
  await remoteClosed;
  console.log(`Vercel WebSocket relay smoke test passed: ${sessionId}`);
} finally {
  host.close();
  remote.close();
}
