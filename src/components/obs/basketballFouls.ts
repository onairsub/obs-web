import type { OBSRequest, OBSRpc } from "./obsRpc";

export type TeamFouls = readonly [number, number];
export const foulsChanged = (previous: TeamFouls, next: TeamFouls) => previous[0] !== next[0] || previous[1] !== next[1];

function delay(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new Error("파울 반영이 취소되었습니다.")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 50);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

async function waitForTransition(rpc: OBSRpc, signal: AbortSignal) {
  const deadline = Date.now() + 30000;
  while (!signal.aborted) {
    const { transitionCursor } = await rpc.call("GetCurrentSceneTransitionCursor");
    if (typeof transitionCursor !== "number") throw new Error("OBS 전환 상태를 확인할 수 없습니다.");
    if (transitionCursor <= 0 || transitionCursor >= 1) return;
    if (Date.now() >= deadline) throw new Error("진행 중인 OBS 장면 전환이 끝나지 않았습니다.");
    await delay(signal);
  }
  throw new Error("파울 반영이 취소되었습니다.");
}

/** Only the host calls this; optional text inputs and marker sources coexist. */
export async function applyBasketballFouls(rpc: OBSRpc, fouls: TeamFouls, transition: boolean, signal: AbortSignal) {
  if (signal.aborted) return;
  if (transition) await waitForTransition(rpc, signal);
  const current = await rpc.call("GetCurrentProgramScene");
  const sceneName = current.currentProgramSceneName ?? current.sceneName;
  if (typeof sceneName !== "string" || !sceneName) throw new Error("현재 OBS 프로그램 장면을 확인할 수 없습니다.");
  const [items, inputs] = await Promise.all([
    rpc.call("GetSceneItemList", { sceneName }),
    rpc.call("GetInputList"),
  ]);
  const requests: OBSRequest[] = [];
  const inputNames = new Set((inputs.inputs ?? []).map((input: { inputName: string }) => input.inputName));
  for (const [index, side] of ["A", "B"].entries()) {
    const inputName = `fouls_${side}`;
    if (inputNames.has(inputName)) requests.push({ requestType: "SetInputSettings", requestData: { inputName, inputSettings: { text: String(fouls[index]) }, overlay: true } });
  }
  for (const item of items.sceneItems ?? []) {
    const match = /^fouls_([AB])_([1-9])$/.exec(item.sourceName);
    if (!match) continue;
    requests.push({ requestType: "SetSceneItemEnabled", requestData: { sceneName, sceneItemId: item.sceneItemId, sceneItemEnabled: fouls[match[1] === "A" ? 0 : 1] >= Number(match[2]) } });
  }
  // Serial batch completion guarantees all marker toggles precede the one
  // transition. Missing optional foul sources are simply not included.
  await rpc.batch(requests);
  if (!transition || !requests.length || signal.aborted) return;
  const latest = await rpc.call("GetCurrentProgramScene");
  const latestName = latest.currentProgramSceneName ?? latest.sceneName;
  if (latestName !== sceneName) return; // Never pull an operator back to an old scene.
  // Target the PROGRAM scene, not whatever is queued in Studio Mode preview.
  // In Studio Mode this re-transitions its updated scene copy using OBS's
  // configured transition. Do not toggle Studio Mode or change the effect.
  await rpc.call("SetCurrentProgramScene", { sceneName });
}

/** Serialize distinct changes; repeated state syncs must not retrigger effects. */
export class BasketballFoulWriter {
  private queue = Promise.resolve();
  private previous: TeamFouls | null = null;
  constructor(private rpc: OBSRpc, private signal: AbortSignal) {}

  update(fouls: TeamFouls, transition: boolean) {
    if (this.previous && !foulsChanged(this.previous, fouls)) return this.queue;
    this.previous = [...fouls];
    const values: TeamFouls = [...fouls];
    const operation = this.queue.then(() => applyBasketballFouls(this.rpc, values, transition, this.signal));
    // A failed optional update must not poison subsequent deliberate changes.
    this.queue = operation.catch(() => {});
    return operation;
  }
}
