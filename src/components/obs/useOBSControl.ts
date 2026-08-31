"use client";

import { useWebSocket } from "@/components/websocket/WebSocketContext";
import { useRemoteControl } from "@/components/remote/RemoteControlContext";
import { StatusCode } from "@/constants/statusCode";
import { useCallback, useEffect, useRef, useState } from "react";

export type OBSScene = { sceneName: string; sceneUuid?: string };
type OBSSceneItem = { sourceName: string; sceneItemId: number };

export function useOBSControl() {
  const { webSocketManager, connectStatus, recentResponse } = useWebSocket();
  const { role: remoteRole, status: remoteStatus, sendCommand, obsState } = useRemoteControl();
  const isRemote = remoteRole === "remote";
  const sequence = useRef(0);
  const pendingToggles = useRef(new Map<string, boolean>());
  const [scenes, setScenes] = useState<OBSScene[]>([]);
  const [currentScene, setCurrentScene] = useState("");
  const [sceneItems, setSceneItems] = useState<OBSSceneItem[]>([]);

  const request = useCallback((requestType: string, requestData?: object) => {
    const requestId = `sidecar-${requestType}-${Date.now()}-${sequence.current++}`;
    webSocketManager?.sendMessage({
      op: 6,
      d: { requestType, requestId, ...(requestData ? { requestData } : {}) },
    });
    return requestId;
  }, [webSocketManager]);

  const requestSceneItems = useCallback((sceneName: string) => {
    if (!sceneName) return;
    request("GetSceneItemList", { sceneName });
  }, [request]);

  const refresh = useCallback(() => {
    if (isRemote) {
      sendCommand({ action: "refresh" });
      return;
    }
    request("GetSceneList");
    request("GetCurrentProgramScene");
  }, [isRemote, request, sendCommand]);

  // Remote controllers synchronize their stored match state. The host-side
  // controller applies that state to OBS, avoiding duplicate timer traffic.
  const setText = useCallback((inputName: string, text: string | number) => {
    if (isRemote) return;
    request("SetInputSettings", {
      inputName,
      inputSettings: { text: String(text) },
      overlay: true,
    });
  }, [isRemote, request]);

  const setInputSettings = useCallback((inputName: string, inputSettings: object) => {
    if (isRemote) return;
    request("SetInputSettings", { inputName, inputSettings, overlay: true });
  }, [isRemote, request]);

  const applyToggles = useCallback((items: OBSSceneItem[], sceneName: string) => {
    if (!sceneName || pendingToggles.current.size === 0) return;
    pendingToggles.current.forEach((enabled, sourceName) => {
      items
        .filter((item) => item.sourceName === sourceName)
        .forEach((item) => request("SetSceneItemEnabled", {
          sceneName,
          sceneItemId: item.sceneItemId,
          sceneItemEnabled: enabled,
        }));
      pendingToggles.current.delete(sourceName);
    });
  }, [request]);

  const setVisible = useCallback((sourceName: string, enabled: boolean) => {
    if (isRemote) return;
    const matchingItems = sceneItems.filter((item) => item.sourceName === sourceName);
    if (currentScene && matchingItems.length > 0) {
      matchingItems.forEach((item) => request("SetSceneItemEnabled", {
        sceneName: currentScene,
        sceneItemId: item.sceneItemId,
        sceneItemEnabled: enabled,
      }));
      return;
    }
    pendingToggles.current.set(sourceName, enabled);
    request("GetCurrentProgramScene");
  }, [currentScene, isRemote, request, sceneItems]);

  const switchScene = useCallback((sceneName: string) => {
    if (isRemote) {
      sendCommand({ action: "switchScene", sceneName });
      return;
    }
    setCurrentScene(sceneName);
    setSceneItems([]);
    request("SetCurrentProgramScene", { sceneName });
    requestSceneItems(sceneName);
  }, [isRemote, request, requestSceneItems, sendCommand]);

  useEffect(() => {
    if (!isRemote && connectStatus === StatusCode.AUTHENTICATED) refresh();
  }, [connectStatus, isRemote, refresh]);

  useEffect(() => {
    if (!recentResponse || recentResponse.requestStatus?.code !== 100) return;
    const { requestType, responseData } = recentResponse;
    if (requestType === "GetSceneList") setScenes(responseData?.scenes ?? []);
    if (requestType === "GetCurrentProgramScene") {
      const sceneName = responseData?.currentProgramSceneName ?? responseData?.sceneName ?? "";
      setCurrentScene(sceneName);
      requestSceneItems(sceneName);
    }
    if (requestType === "GetSceneItemList") {
      const items = responseData?.sceneItems ?? [];
      setSceneItems(items);
      applyToggles(items, currentScene);
    }
  }, [applyToggles, currentScene, recentResponse, requestSceneItems]);

  return {
    connected: isRemote ? remoteStatus === "active" : connectStatus === StatusCode.AUTHENTICATED,
    scenes: isRemote ? obsState.scenes : scenes,
    currentScene: isRemote ? obsState.currentScene : currentScene,
    setText,
    setInputSettings,
    setVisible,
    switchScene,
    refresh,
  };
}
