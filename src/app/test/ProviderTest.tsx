"use client";

import { useWebSocket } from "@/components/websocket/WebSocketContext";
import { Button } from "@mui/material";
import { useEffect, useState } from "react";
import {
  AnimateItem,
  AnimateWithKeyframe,
  TimeFunction,
} from "./_utils/AnimateItem";
import { useLocalStorage } from "usehooks-ts";
import { OBSElementProperties } from "../obs/team-setting/[id]/_constants/constants";

type Scene = {
  sceneName: string;
  sceneUuid: string;
};

type Item = {
  inputKind: string;
  inputName: string;
  inputUuid: string;
};

enum TeamSettingElementType {
  TEXT,
  IMAGE,
  VIDEO,
}

type TeamSettingElement = {
  name: string;
  type: TeamSettingElementType;
  value: string;
};

export default function ProviderTest() {
  const { webSocketManager, connectStatus, recentResponse } = useWebSocket();

  const [teamSetting, setTeamSetting, clearTeamSetting] = useLocalStorage<{
    [key: string]: TeamSettingElement[];
  }>("OBS_TEAM_SETTINGS", {
    서울대: [
      {
        name: "logo",
        type: TeamSettingElementType.IMAGE,
        value: "~/Downloads/images.png",
      },
    ],
  });
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

  const GenerateInputSettings = (
    type: TeamSettingElementType,
    value: string
  ) => {
    return {
      [OBSElementProperties[type]]: value,
    };
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
      <Button
        variant="outlined"
        onClick={() =>
          AnimateItem(
            webSocketManager,
            "장면",
            1,
            0,
            0,
            960,
            540,
            500,
            TimeFunction.EASE_OUT
          )
        }
      >
        {" "}
        ANIMATION{" "}
      </Button>
      <Button
        variant="outlined"
        onClick={() =>
          AnimateWithKeyframe(webSocketManager, "장면", 1, [
            {
              timeCode: 0,
              x: 960,
              y: 1080,
              timeFunction: TimeFunction.EASE_OUT,
            },
            {
              timeCode: 300,
              x: 960,
              y: 240,
              timeFunction: TimeFunction.EASE_IN,
            },
            {
              timeCode: 500,
              x: 960,
              y: 540,
            },
          ])
        }
      >
        {" "}
        ANIMATION2{" "}
      </Button>
      <Button
        variant="outlined"
        onClick={() => {
          webSocketManager?.sendMessage({
            op: 6,
            d: {
              requestId: "1234567",
              requestType: "SetSceneItemEnabled",
              requestData: {
                sceneName: "장면",
                sceneItemId: 2,
                sceneItemEnabled: false,
              },
            },
          });
          setTimeout(
            () =>
              webSocketManager?.sendMessage({
                op: 6,
                d: {
                  requestId: "1234567",
                  requestType: "SetSceneItemEnabled",
                  requestData: {
                    sceneName: "장면",
                    sceneItemId: 2,
                    sceneItemEnabled: true,
                  },
                },
              }),
            50
          );
        }}
      >
        restart
      </Button>
      <Button
        variant="outlined"
        onClick={() => {
          teamSetting["서울대"].forEach((e: TeamSettingElement) => {
            const { name, type, value } = e;
            SetInputSettings(`${name}_A`, GenerateInputSettings(type, value));
          });
        }}
      >
        change
      </Button>
    </div>
  );
}
