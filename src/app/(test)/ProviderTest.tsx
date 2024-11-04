"use client";

import { useWebSocket } from "@/components/websocket/WebSocketContext";
import { Button } from "@mui/material";
import { useEffect, useState } from "react";

type Scene = {
  sceneName: string;
  sceneUuid: string;
};

export default function ProviderTest() {
  const { webSocketManager, connectStatus, recentResponse } = useWebSocket();
  const [scenes, setScenes] = useState<Scene[]>([]);

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

  useEffect(() => {
    console.log("useEffect");
    if (recentResponse?.requestType === "GetSceneList") {
      console.log("getscenelist!");
      console.log(recentResponse.responseData.scenes);
      setScenes(recentResponse.responseData.scenes);
    }
  }, [recentResponse]);

  return (
    <div>
      status: {connectStatus} <br />
      <Button variant="outlined" onClick={GetSceneList}>
        GetSceneList
      </Button>
      {scenes.toReversed().map((scene, idx) => (
        <Button
          key={idx}
          variant="outlined"
          onClick={() => SetCurrentProgramScene(scene.sceneName)}
        >
          SetCurrentProgramScene {"=>"} {scene.sceneName}
        </Button>
      ))}
    </div>
  );
}
