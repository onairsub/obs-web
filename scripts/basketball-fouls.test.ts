import assert from "node:assert/strict";
import { test } from "node:test";
import { applyBasketballFouls, BasketballFoulWriter, foulsChanged } from "../src/components/obs/basketballFouls";
import { createOBSRpc, type OBSRequest, type OBSRpc } from "../src/components/obs/obsRpc";

function fixture() {
  const calls: OBSRequest[] = [];
  const texts: Record<string, string> = {};
  const visible: Record<number, boolean> = {};
  let scene = "On Air";
  let inputNames = ["fouls_A", "fouls_B"];
  let items = ["fouls_A_1", "fouls_A_2", "fouls_A_3", "fouls_B_1", "fouls_B_2", "unrelated"].map((sourceName, sceneItemId) => ({ sourceName, sceneItemId }));
  let afterBatch = () => {};
  let failBatch = false;
  let cursors = [0];
  const rpc: OBSRpc = {
    async call(requestType, requestData) {
      calls.push({ requestType, requestData });
      if (requestType === "GetCurrentProgramScene") return { currentProgramSceneName: scene };
      if (requestType === "GetInputList") return { inputs: inputNames.map((inputName) => ({ inputName })) };
      if (requestType === "GetSceneItemList") return { sceneItems: items };
      if (requestType === "GetCurrentSceneTransitionCursor") return { transitionCursor: cursors.length > 1 ? cursors.shift() : cursors[0] };
      return {};
    },
    async batch(requests) {
      calls.push({ requestType: "BATCH", requestData: requests });
      if (failBatch) throw new Error("mock write failure");
      for (const request of requests) {
        const d = request.requestData as any;
        if (request.requestType === "SetInputSettings") texts[d.inputName] = d.inputSettings.text;
        if (request.requestType === "SetSceneItemEnabled") visible[d.sceneItemId] = d.sceneItemEnabled;
      }
      afterBatch();
    },
  };
  const abort = new AbortController();
  return { calls, texts, visible, rpc, abort,
    transitions: () => calls.filter((call) => call.requestType === "SetCurrentProgramScene"),
    setInputs: (names: string[]) => { inputNames = names; },
    setItems: (names: string[]) => { items = names.map((sourceName, sceneItemId) => ({ sourceName, sceneItemId })); },
    changeSceneAfterBatch: () => { afterBatch = () => { scene = "Other Live Scene"; }; },
    fail: (value: boolean) => { failBatch = value; },
    setCursors: (values: number[]) => { cursors = values; },
  };
}

test("foul text and all marker writes finish before one transition to the program, never preview", async () => {
  const f = fixture();
  await applyBasketballFouls(f.rpc, [2, 1], true, f.abort.signal);
  assert.deepEqual(f.texts, { fouls_A: "2", fouls_B: "1" });
  assert.deepEqual(f.visible, { 0: true, 1: true, 2: false, 3: true, 4: false });
  assert.deepEqual(f.transitions(), [{ requestType: "SetCurrentProgramScene", requestData: { sceneName: "On Air" } }]);
  assert.ok(f.calls.findIndex((c) => c.requestType === "BATCH") < f.calls.findIndex((c) => c.requestType === "SetCurrentProgramScene"));
  assert.equal(f.calls.some((c) => /Preview|StudioMode/.test(c.requestType)), false);
});

test("initial sync and repeated numeric state do not transition; changed states serialize", async () => {
  const f = fixture();
  const writer = new BasketballFoulWriter(f.rpc, f.abort.signal);
  await writer.update([0, 0], false);
  assert.equal(f.transitions().length, 0);
  await Promise.all([writer.update([1, 0], true), writer.update([1, 0], true), writer.update([2, 1], true), writer.update([0, 0], true)]);
  assert.equal(f.transitions().length, 3);
  assert.deepEqual(Object.values(f.visible), [false, false, false, false, false]);
  assert.equal(foulsChanged([2, 1], [2, 1]), false);
});

test("optional markers without text and text without markers both work", async () => {
  for (const onlyMarkers of [true, false]) {
    const f = fixture();
    if (onlyMarkers) f.setInputs([]); else f.setItems([]);
    await applyBasketballFouls(f.rpc, [1, 2], true, f.abort.signal);
    assert.equal(f.transitions().length, 1);
    assert.equal(Object.keys(f.texts).length, onlyMarkers ? 0 : 2);
    assert.equal(Object.keys(f.visible).length, onlyMarkers ? 5 : 0);
  }
});

test("no foul sources or scene changed during writes: never force a transition", async () => {
  const absent = fixture();
  absent.setInputs([]); absent.setItems([]);
  await applyBasketballFouls(absent.rpc, [1, 0], true, absent.abort.signal);
  assert.equal(absent.transitions().length, 0);
  const moved = fixture(); moved.changeSceneAfterBatch();
  await applyBasketballFouls(moved.rpc, [1, 0], true, moved.abort.signal);
  assert.equal(moved.transitions().length, 0);
});

test("a running transition finishes before the next foul writes", async () => {
  const f = fixture(); f.setCursors([0.5, 1]);
  await applyBasketballFouls(f.rpc, [1, 0], true, f.abort.signal);
  assert.deepEqual(f.calls.slice(0, 3).map((c) => c.requestType), ["GetCurrentSceneTransitionCursor", "GetCurrentSceneTransitionCursor", "GetCurrentProgramScene"]);
});

test("failed batch does not transition or poison future changes; abort cancels queued work", async () => {
  const f = fixture(); const writer = new BasketballFoulWriter(f.rpc, f.abort.signal);
  f.fail(true);
  await assert.rejects(writer.update([1, 0], true), /mock write failure/);
  assert.equal(f.transitions().length, 0);
  f.fail(false);
  await writer.update([2, 0], true);
  assert.equal(f.transitions().length, 1);
  f.abort.abort();
  await writer.update([3, 0], true);
  assert.equal(f.transitions().length, 1);
});

class FakeSocket extends EventTarget {
  readyState = 1;
  sent: any[] = [];
  send(data: string) { this.sent.push(JSON.parse(data)); }
  reply(index: number, data: object = {}, status = true) {
    const request = this.sent[index];
    const result = { requestType: request.d.requestType, requestStatus: { result: status, code: status ? 100 : 600 }, responseData: data };
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ op: request.op + 1, d: { requestId: request.d.requestId, ...(request.op === 6 ? result : { results: request.d.requests.map(() => result) }) } }) }));
  }
}

test("OBS RPC correlates simultaneous out-of-order responses and awaits batch confirmation", async () => {
  const socket = new FakeSocket();
  const rpc = createOBSRpc(socket as unknown as WebSocket, new AbortController().signal);
  const first = rpc.call("GetInputList");
  const second = rpc.call("GetCurrentProgramScene");
  socket.reply(1, { sceneName: "On Air" }); socket.reply(0, { inputs: [] });
  assert.deepEqual(await first, { inputs: [] });
  assert.deepEqual(await second, { sceneName: "On Air" });
  const batch = rpc.batch([{ requestType: "SetSceneItemEnabled", requestData: { sceneItemId: 1 } }]);
  assert.equal(socket.sent[2].d.executionType, 0);
  assert.equal(socket.sent[2].d.haltOnFailure, true);
  socket.reply(2);
  await batch;
});

test("OBS RPC rejects failed writes and closes pending calls on disconnect/abort", async () => {
  const socket = new FakeSocket(); const abort = new AbortController();
  const rpc = createOBSRpc(socket as unknown as WebSocket, abort.signal);
  const bad = rpc.call("BadRequest"); socket.reply(0, {}, false);
  await assert.rejects(bad, /OBS 반영 실패/);
  const batch = rpc.batch([{ requestType: "SetSceneItemEnabled" }]); socket.reply(1, {}, false);
  await assert.rejects(batch, /OBS 반영 실패/);
  const closed = rpc.call("Pending"); socket.dispatchEvent(new Event("close"));
  await assert.rejects(closed, /연결이 종료/);
  const canceled = rpc.call("Pending"); abort.abort();
  await assert.rejects(canceled, /연결이 종료/);
});
