"use client";

import { useOBSControl } from "@/components/obs/useOBSControl";
import { useEffect } from "react";
import { useRemoteControl } from "./RemoteControlContext";

export default function RemoteOBSBridge() {
  const remote = useRemoteControl();
  const obs = useOBSControl();
  const { role, status, subscribeCommand, publishOBSState } = remote;
  const { currentScene, scenes, refresh, setInputSettings, setText, setVisible, switchScene } = obs;

  useEffect(() => {
    if (role !== "host") return;
    return subscribeCommand((command) => {
      if (command.action === "setText") setText(command.inputName, command.text);
      if (command.action === "setInputSettings") setInputSettings(command.inputName, command.inputSettings);
      if (command.action === "setVisible") setVisible(command.sourceName, command.enabled);
      if (command.action === "switchScene") switchScene(command.sceneName);
      if (command.action === "refresh") refresh();
    });
  }, [refresh, role, setInputSettings, setText, setVisible, subscribeCommand, switchScene]);

  useEffect(() => {
    if (role !== "host" || status !== "active") return;
    publishOBSState({ scenes, currentScene });
  }, [currentScene, publishOBSState, role, scenes, status]);

  return null;
}
