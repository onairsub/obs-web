export type OBSRequest = { requestType: string; requestData?: object };
type OBSResult = { requestType: string; requestStatus: { result: boolean; code: number; comment?: string }; responseData?: Record<string, any> };

export interface OBSRpc {
  call(requestType: string, requestData?: object): Promise<Record<string, any>>;
  batch(requests: OBSRequest[]): Promise<void>;
}

/** Correlate replies on the socket itself, not React's last-response state. */
export function createOBSRpc(socket: WebSocket, signal: AbortSignal): OBSRpc {
  function exchange(op: 6 | 8, data: object): Promise<any> {
    return new Promise((resolve, reject) => {
      if (signal.aborted || socket.readyState !== 1) {
        reject(new Error("OBS 연결이 종료되었습니다."));
        return;
      }
      const requestId = `foul-${crypto.randomUUID()}`;
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("close", onClose);
        socket.removeEventListener("error", onClose);
        signal.removeEventListener("abort", onClose);
      };
      const fail = (error: Error) => { cleanup(); reject(error); };
      const onClose = () => fail(new Error("OBS 연결이 종료되었습니다."));
      const onMessage = (event: MessageEvent) => {
        let message;
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (message?.op !== op + 1 || message.d?.requestId !== requestId) return;
        cleanup();
        resolve(message.d);
      };
      const timer = setTimeout(() => fail(new Error("OBS 응답 시간이 초과되었습니다.")), 5000);
      socket.addEventListener("message", onMessage);
      socket.addEventListener("close", onClose);
      socket.addEventListener("error", onClose);
      signal.addEventListener("abort", onClose, { once: true });
      try { socket.send(JSON.stringify({ op, d: { ...data, requestId } })); }
      catch (error) { fail(error instanceof Error ? error : new Error("OBS 요청에 실패했습니다.")); }
    });
  }
  function check(result: OBSResult) {
    if (!result.requestStatus?.result) throw new Error(`${result.requestType}: ${result.requestStatus?.comment ?? "OBS 반영 실패"}`);
  }
  return {
    async call(requestType, requestData) {
      const result: OBSResult = await exchange(6, { requestType, ...(requestData ? { requestData } : {}) });
      check(result);
      return result.responseData ?? {};
    },
    async batch(requests) {
      if (!requests.length) return;
      const result = await exchange(8, { executionType: 0, haltOnFailure: true, requests });
      if (!Array.isArray(result.results)) throw new Error("OBS 일괄 응답이 올바르지 않습니다.");
      result.results.forEach(check);
      if (result.results.length !== requests.length) throw new Error("OBS 파울 반영이 완료되지 않았습니다.");
    },
  };
}
