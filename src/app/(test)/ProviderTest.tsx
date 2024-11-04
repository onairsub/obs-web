"use client";

import { useWebSocket } from "@/components/websocket/WebSocketContext";
import { Button } from "@mui/material";

export default function ProviderTest() {
  const { webSocketManager, connectStatus } = useWebSocket();

  const GetSceneList = () => {
    webSocketManager?.sendMessage({
      op: 6,
      d: {
        requestId: "1234567",
        requestType: "GetSceneList",
      },
    });
  };

  const SetCurrentProgramScene = (sceneName: string) => {
    webSocketManager?.sendMessage({
      op: 6,
      d: {
        requestId: "1234567",
        requestType: "SetCurrentProgramScene",
        requestData: {
          sceneName,
        },
      },
    });
  };

  return (
    <div>
      status: {connectStatus} <br />
      <Button variant="outlined" onClick={GetSceneList}>
        GetSceneList
      </Button>
      <Button variant="outlined" onClick={() => SetCurrentProgramScene("장면")}>
        SetCurrentProgramScene {"=>"} 장면
      </Button>
      <Button
        variant="outlined"
        onClick={() => SetCurrentProgramScene("장면 2")}
      >
        SetCurrentProgramScene {"=>"} 장면 2
      </Button>
    </div>
  );
}
