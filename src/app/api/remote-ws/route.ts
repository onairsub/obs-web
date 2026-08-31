import { attachRemoteSocket } from "@/lib/remoteHub";
import { experimental_upgradeWebSocket } from "@vercel/functions";

export const runtime = "nodejs";
export const maxDuration = 300;

export function GET() {
  return experimental_upgradeWebSocket((socket) => {
    attachRemoteSocket(socket);
  });
}
