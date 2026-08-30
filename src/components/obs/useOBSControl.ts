"use client";

import { useWebSocket } from "@/components/websocket/WebSocketContext";
import { StatusCode } from "@/constants/statusCode";
import { useCallback, useEffect, useRef, useState } from "react";

export type OBSScene = { sceneName: string; sceneUuid?: string };
type OBSSceneItem = { sourceName: string; sceneItemId: number };

export function useOBSControl() {
  const { webSocketManager, connectStatus, recentResponse } = useWebSocket();
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
    request("GetSceneList");
    request("GetCurrentProgramScene");
  }, [request]);

  const setText = useCallback((inputName: string, text: string | number) => {
    request("SetInputSettings", {
      inputName,
      inputSettings: { text: String(text) },
      overlay: true,
    });
  }, [request]);

  const setInputSettings = useCallback((inputName: string, inputSettings: object) => {
    request("SetInputSettings", { inputName, inputSettings, overlay: true });
  }, [request]);

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
  }, [currentScene, request, sceneItems]);

  const switchScene = useCallback((sceneName: string) => {
    setCurrentScene(sceneName);
    setSceneItems([]);
    request("SetCurrentProgramScene", { sceneName });
    requestSceneItems(sceneName);
  }, [request, requestSceneItems]);

  useEffect(() => {
    if (connectStatus === StatusCode.AUTHENTICATED) refresh();
  }, [connectStatus, refresh]);

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
    connected: connectStatus === StatusCode.AUTHENTICATED,
    scenes,
    currentScene,
    setText,
    setInputSettings,
    setVisible,
    switchScene,
    refresh,
  };
}
