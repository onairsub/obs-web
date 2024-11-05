import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import crypto from "crypto-js";

// WebSocketManager 클래스 가져오기
import WebSocketManager from "./WebSocketManager";

type Authentication = null | {
  challenge: string;
  salt: string;
};

type RecentResponse = null | {
  requestId: string;
  requestStatus: { code: number; result: boolean };
  requestType: string;
  responseData: any;
};

function generateAuthHash(password: string, salt: string, challenge: string) {
  // Step 1: password + salt를 해싱
  const passwordSaltHash = crypto
    .SHA256(password + salt)
    .toString(crypto.enc.Base64);

  // Step 2: 해시된 값 + challenge를 다시 해싱
  const authHash = crypto
    .SHA256(passwordSaltHash + challenge)
    .toString(crypto.enc.Base64);

  return authHash;
}

const WebSocketContext = createContext<{
  webSocketManager: WebSocketManager | null;
  authentication: Authentication;
  connectStatus: number;
  recentResponse: RecentResponse;
  responseBuffer: RecentResponse[];
  clearBuffer: () => void;
  popBuffer: null | (() => RecentResponse);
}>({
  webSocketManager: null,
  authentication: null,
  connectStatus: 0,
  recentResponse: null,
  responseBuffer: [],
  clearBuffer: () => {},
  popBuffer: null,
});

export const WebSocketProvider = ({
  password = null,
  port = 4455,
  children,
}: {
  password?: string | null;
  port?: number;
  children: any;
}) => {
  const [connectStatus, setConnectStatus] = useState(0);
  const [authentication, setAuthentication] = useState<Authentication>(null);
  const [recentResponse, setRecentResponse] = useState<RecentResponse>(null);
  const [responseBuffer, setResponseBuffer] = useState<RecentResponse[]>([]);
  const webSocketManager = useRef(
    new WebSocketManager(`ws://localhost:${port}`)
  ).current;

  const clearBuffer = () => {
    if (responseBuffer.length === 0) return null;
    setResponseBuffer([]);
  };

  const popBuffer = () => {
    if (responseBuffer.length === 0) return null;
    const res = responseBuffer[0];
    setResponseBuffer((prev) => prev.slice(1));
    return res;
  };

  useEffect(() => {
    // WebSocket 연결 설정
    webSocketManager.url = `ws://localhost:${port}`;
    webSocketManager.connect({
      onOpen: () => {
        setConnectStatus(200);
      },
      onMessage: (message: any) => {
        if (message.op === 0 && message.d.authentication) {
          setAuthentication(message.d.authentication);
          if (!password) {
            console.log("Authentication required, but password field is null");
            return;
          }
          webSocketManager.sendMessage({
            op: 1,
            d: {
              rpcVersion: 1,
              authentication: generateAuthHash(
                password,
                message.d.authentication.salt,
                message.d.authentication.challenge
              ),
            },
          });
        } else if (message.op === 0) {
          webSocketManager.sendMessage({
            op: 1,
            d: {
              rpcVersion: 1,
            },
          });
        }
        if (message.op === 2) {
          setConnectStatus(201);
          console.log("Authentication success!");
        }
        if (message.op === 7) {
          console.log("response");
          setRecentResponse(message.d);
          setResponseBuffer((prev) => [...prev, message.d]);
        }
      },
      onError: (error: any) => {},
      onClose: () => {},
    });

    return () => {
      webSocketManager.disconnect();
    };
  }, [webSocketManager, password, port]);

  return (
    <WebSocketContext.Provider
      value={{
        webSocketManager,
        authentication,
        connectStatus,
        recentResponse,
        responseBuffer,
        clearBuffer,
        popBuffer,
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = () => {
  return useContext(WebSocketContext);
};
