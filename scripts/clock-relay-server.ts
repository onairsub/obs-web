import { WebSocketServer } from "ws";

// Isolated test process: never pick up application/production credentials.
process.env.REDIS_URL = process.env.CLOCK_TEST_REDIS_URL ?? "";
async function main() {
  const { attachRemoteSocket } = await import("../src/lib/remoteHub");
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  server.on("connection", attachRemoteSocket);
  server.on("listening", () => {
    const address = server.address();
    if (typeof address === "object" && address) process.send?.({ port: address.port });
  });
}
void main();
