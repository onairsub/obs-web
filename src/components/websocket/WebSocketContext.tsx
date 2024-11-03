import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

// WebSocketManager 클래스 가져오기
import WebSocketManager from "./WebSocketManager";

const WebSocketContext = createContext<{
  webSocketManager: WebSocketManager | null;
  connectStatus: number;
}>({
  webSocketManager: null,
  connectStatus: 0,
});

export const WebSocketProvider = ({ children }: { children: any }) => {
  const [connectStatus, setConnectStatus] = useState(0);
  const webSocketManager = useRef(
    new WebSocketManager("ws://localhost:4455")
  ).current;

  useEffect(() => {
    // WebSocket 연결 설정
    webSocketManager.connect({
      onOpen: () => {
        setConnectStatus(200);
        console.log("Connected!");
      },
      onMessage: (message: any) => {
        if (message.op === 2 && message.d.authentication) {
          setConnectStatus(201);
          console.log("Authentication success!");
        }
      },
      onError: (error: any) => {
        console.error("WebSocket 에러:", error);
      },
      onClose: () => {
        console.log("WebSocket 연결이 닫혔습니다.");
      },
    });

    // 컴포넌트 언마운트 시 연결 해제
    return () => {
      webSocketManager.disconnect();
    };
  }, [webSocketManager]);

  return (
    <WebSocketContext.Provider value={{ webSocketManager, connectStatus }}>
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = () => {
  return useContext(WebSocketContext);
};
