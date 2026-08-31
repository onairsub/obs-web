import { createServer } from "node:http";
import next from "next";
import { WebSocketServer } from "ws";
import { attachRemoteSocket } from "./src/lib/remoteHub";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const hostname = "0.0.0.0";
async function main() {
  const app = next({ dev, hostname, port });
  await app.prepare();

  // Next's custom server registers its own catch-all upgrade listener on the
  // first HTTP request. Mark that setup as complete on a no-op target so this
  // server can route remote-control and HMR upgrades exactly once below.
  const customServer = app as typeof app & {
    setupWebSocketHandler(server: { on: () => void }): void;
  };
  customServer.setupWebSocketHandler({ on: () => undefined });

  const handle = app.getRequestHandler();
  const handleUpgrade = app.getUpgradeHandler();

  const httpServer = createServer((request, response) => void handle(request, response));
  const websocketServer = new WebSocketServer({ noServer: true });
  websocketServer.on("connection", (websocket) => attachRemoteSocket(websocket));

  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname;
    if (pathname === "/api/remote-ws") {
      websocketServer.handleUpgrade(request, socket, head, (websocket) => websocketServer.emit("connection", websocket, request));
      return;
    }
    void handleUpgrade(request, socket, head);
  });

  httpServer.listen(port, hostname, () => {
    console.log(`> OBS Controller ready on http://localhost:${port}`);
  });
}

void main();
