import { isClockCommand, isClockSnapshot, type ClockCommand, type ClockSnapshot } from "../obs/clockSync";

export const REMOTE_PROTOCOL_VERSION = 3;

export const REMOTE_SYNC_KEYS = [
  "OBS_ACTIVE_SPORT",
  "OBS_SETTINGS_SPORT",
  "OBS_TITLE_LIST",
  "OBS_TEAM_LIST",
  "OBS_TITLE",
  "OBS_TEAM_A",
  "OBS_TEAM_B",
  "OBS_SOCCER_CONFIG",
  "OBS_SOCCER_SCORE",
  "OBS_SOCCER_PERIOD",
  "OBS_SOCCER_ADDED_TIME",
  "OBS_SOCCER_RED_CARDS",
  "OBS_SOCCER_PENALTIES",
  "OBS_BASKETBALL_CONFIG",
  "OBS_BASKETBALL_SCORE",
  "OBS_BASKETBALL_PERIOD",
  "OBS_BASKETBALL_FOULS",
  "OBS_BASKETBALL_TIMEOUTS",
  "OBS_BASKETBALL_POSSESSION",
  "OBS_BASEBALL_CONFIG",
  "OBS_BASEBALL_SCORE",
  "OBS_BASEBALL_HITS",
  "OBS_BASEBALL_ERRORS",
  "OBS_BASEBALL_INNING",
  "OBS_BASEBALL_HALF",
  "OBS_BASEBALL_COUNT",
  "OBS_BASEBALL_BASES",
  "OBS_SET_LIST",
  "OBS_VOLLEYBALL_SCORE",
  "OBS_VOLLEYBALL_SETS",
  "OBS_VOLLEYBALL_CURRENT_SET",
  "OBS_VOLLEYBALL_TIMEOUTS",
  "OBS_VOLLEYBALL_TIMEOUT_SIDE",
  "OBS_VOLLEYBALL_SERVE",
] as const;

export const REMOTE_SYNC_KEY_SET = new Set<string>(REMOTE_SYNC_KEYS);

export type RemoteCommand =
  | { action: "setText"; inputName: string; text: string }
  | { action: "setInputSettings"; inputName: string; inputSettings: object }
  | { action: "setVisible"; sourceName: string; enabled: boolean }
  | { action: "switchScene"; sceneName: string }
  | { action: "refresh" };

export type RemoteOBSState = {
  scenes: { sceneName: string; sceneUuid?: string }[];
  currentScene: string;
};

export type RemoteClientMessage =
  | { type: "join"; sessionId: string; clientId: string; role: "host" | "remote"; hostSecret?: string; protocolVersion?: number; resume?: boolean }
  | { type: "clock-sync"; requestId: string }
  | { type: "clock-command"; command: ClockCommand }
  | { type: "clock-state"; snapshot: ClockSnapshot; replyTo?: string }
  | { type: "storage"; key: string; value: string | null }
  | { type: "snapshot"; state: Record<string, string | null> }
  | { type: "command"; command: RemoteCommand }
  | { type: "obs-state"; state: RemoteOBSState }
  | { type: "close-session" }
  | { type: "ping"; requestId?: string };

export type RemoteServerMessage = (
  | { type: "ready"; role: "host" | "remote"; uploadState?: boolean }
  | { type: "clock-sync"; requestId: string }
  | { type: "clock-command"; command: ClockCommand }
  | { type: "clock-state"; snapshot: ClockSnapshot; replyTo?: string }
  | { type: "storage"; key: string; value: string | null }
  | { type: "snapshot"; state: Record<string, string | null> }
  | { type: "command"; command: RemoteCommand }
  | { type: "obs-state"; state: RemoteOBSState }
  | { type: "client-count"; count: number }
  | { type: "closed"; reason: string }
  | { type: "error"; code: string; message: string }
  | { type: "pong"; requestId?: string }
) & { relayId?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isRemoteCommand(value: unknown): value is RemoteCommand {
  if (!isRecord(value) || typeof value.action !== "string") return false;
  if (value.action === "refresh") return true;
  if (value.action === "setText") return typeof value.inputName === "string" && value.inputName.length <= 100 && String(value.text ?? "").length <= 2_000;
  if (value.action === "setInputSettings") return typeof value.inputName === "string" && value.inputName.length <= 100 && isRecord(value.inputSettings);
  if (value.action === "setVisible") return typeof value.sourceName === "string" && value.sourceName.length <= 100 && typeof value.enabled === "boolean";
  if (value.action === "switchScene") return typeof value.sceneName === "string" && value.sceneName.length <= 200;
  return false;
}

export function parseRemoteClientMessage(raw: unknown): RemoteClientMessage | null {
  let value: unknown = raw;
  try {
    if (typeof raw === "string") value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value.type !== "string") return null;

  if (value.type === "join") {
    const validSession = typeof value.sessionId === "string" && /^[a-f0-9]{32}$/.test(value.sessionId);
    const validClient = typeof value.clientId === "string" && value.clientId.length >= 8 && value.clientId.length <= 64;
    const validRole = value.role === "host" || value.role === "remote";
    const validSecret = value.role !== "host" || (typeof value.hostSecret === "string" && /^[a-f0-9]{48}$/.test(value.hostSecret));
    const validResume = value.resume === undefined || typeof value.resume === "boolean";
    return validSession && validClient && validRole && validSecret && validResume ? value as RemoteClientMessage : null;
  }
  if (value.type === "storage") {
    const validValue = value.value === null || (typeof value.value === "string" && value.value.length <= 20_000);
    return typeof value.key === "string" && REMOTE_SYNC_KEY_SET.has(value.key) && validValue ? value as RemoteClientMessage : null;
  }
  if (value.type === "clock-sync") return typeof value.requestId === "string" && value.requestId.length >= 8 && value.requestId.length <= 64 ? value as RemoteClientMessage : null;
  if (value.type === "clock-command") return isClockCommand(value.command) ? value as RemoteClientMessage : null;
  if (value.type === "clock-state") return isClockSnapshot(value.snapshot) && (value.replyTo === undefined || (typeof value.replyTo === "string" && value.replyTo.length <= 64)) ? value as RemoteClientMessage : null;
  if (value.type === "snapshot") return isRecord(value.state) ? value as RemoteClientMessage : null;
  if (value.type === "command") return isRemoteCommand(value.command) ? value as RemoteClientMessage : null;
  if (value.type === "obs-state") return isRecord(value.state) && Array.isArray(value.state.scenes) && typeof value.state.currentScene === "string" ? value as RemoteClientMessage : null;
  if (value.type === "ping") return value.requestId === undefined || (typeof value.requestId === "string" && value.requestId.length <= 64) ? value as RemoteClientMessage : null;
  if (value.type === "close-session") return value as RemoteClientMessage;
  return null;
}

export function filterRemoteSnapshot(state: Record<string, unknown>) {
  const filtered: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(state)) {
    if (!REMOTE_SYNC_KEY_SET.has(key)) continue;
    if (value === null || (typeof value === "string" && value.length <= 20_000)) filtered[key] = value;
  }
  return filtered;
}
