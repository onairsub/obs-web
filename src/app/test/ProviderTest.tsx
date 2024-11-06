"use client";

import { useWebSocket } from "@/components/websocket/WebSocketContext";
import { Button } from "@mui/material";
import { useEffect, useState } from "react";

type Scene = {
  sceneName: string;
  sceneUuid: string;
};

type Item = {
  inputKind: string;
  inputName: string;
  inputUuid: string;
};

export default function ProviderTest() {
  const { webSocketManager, connectStatus, recentResponse } = useWebSocket();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [items, setItems] = useState<Item[]>([]);

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

  const GetSceneItemList = (sceneName: string) => {
    webSocketManager?.sendMessage({
      op: 6,
      d: {
        requestId: "1234567",
        requestType: "GetSceneItemList",
        requestData: {
          sceneName,
        },
      },
    });
  };

  const GetInputList = () => {
    webSocketManager?.sendMessage({
      op: 6,
      d: {
        requestId: "1234567",
        requestType: "GetInputList",
      },
    });
  };

  const GetInputSettings = (inputName: string) => {
    webSocketManager?.sendMessage({
      op: 6,
      d: {
        requestId: "1234567",
        requestType: "GetInputSettings",
        requestData: {
          inputName,
        },
      },
    });
  };

  const SetInputSettings = (inputName: string, inputSettings: object) => {
    webSocketManager?.sendMessage({
      op: 6,
      d: {
        requestId: "1234567",
        requestType: "SetInputSettings",
        requestData: {
          inputName,
          inputSettings,
        },
      },
    });
  };

  useEffect(() => {
    console.log("useEffect");
    if (recentResponse?.requestType === "GetSceneList") {
      setScenes(recentResponse.responseData.scenes);
    } else if (recentResponse?.requestType === "GetInputList") {
      setItems(recentResponse.responseData.inputs);
    }
  }, [recentResponse]);

  return (
    <div>
      status: {connectStatus} <br />
      <Button variant="outlined" onClick={GetSceneList}>
        GetSceneList
      </Button>
      <Button variant="outlined" onClick={GetInputList}>
        GetInputList
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
      {scenes.toReversed().map((scene, idx) => (
        <Button
          key={idx}
          variant="outlined"
          onClick={() => GetSceneItemList(scene.sceneName)}
        >
          GetSceneItemList {"=>"} {scene.sceneName}
        </Button>
      ))}
      {items.map((item, idx) => (
        <Button
          key={idx}
          variant="outlined"
          onClick={() => GetInputSettings(item.inputName)}
        >
          GetInputSettings {"=>"} {item.inputName}
        </Button>
      ))}
      {items.map((item, idx) => (
        <Button
          key={idx}
          variant="outlined"
          onClick={() => SetInputSettings(item.inputName, { text: "2" })}
        >
          SetInputSettings {"=>"} {item.inputName}
        </Button>
      ))}
    </div>
  );
}
