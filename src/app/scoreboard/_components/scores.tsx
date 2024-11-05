"use client";

import { useWebSocket } from "@/components/websocket/WebSocketContext";
import { Button } from "@mui/material";
import { useEffect, useState } from "react";

const SCORE_A_NAME = "score_A";
const SCORE_A_ID = "score_A";
const SCORE_B_NAME = "score_B";
const SCORE_B_ID = "score_B";

export const Scores = () => {
  const {
    webSocketManager,
    connectStatus,
    recentResponse,
    responseBuffer,
    clearBuffer,
    popBuffer,
  } = useWebSocket();
  const [scores, setScores] = useState([0, 0]);

  const GetInputSettings = (
    inputName: string,
    requestId: string = "123456789"
  ) => {
    webSocketManager?.sendMessage({
      op: 6,
      d: {
        requestId,
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

  const ScoreAdd = (id: string, inc: number) => {
    if (id === SCORE_A_ID) {
      setScores((prev) => [prev[0] + inc, prev[1]]);
    }
    if (id === SCORE_B_ID) {
      setScores((prev) => [prev[0], prev[1] + inc]);
    }
  };

  useEffect(() => {
    GetInputSettings(SCORE_A_NAME, SCORE_A_ID);
    GetInputSettings(SCORE_B_NAME, SCORE_B_ID);
  }, [connectStatus]);

  useEffect(() => {
    SetInputSettings(SCORE_A_NAME, { text: scores[0].toString() });
    SetInputSettings(SCORE_B_NAME, { text: scores[1].toString() });
  }, [scores]);

  useEffect(() => {
    if (popBuffer === null) return;
    const res = popBuffer();
    if (res === null) return;

    console.log("res: ", res);
    if (res?.requestId === SCORE_A_ID)
      setScores((prev) => [
        parseInt(res.responseData.inputSettings.text),
        prev[1],
      ]);
    if (res?.requestId === SCORE_B_ID)
      setScores((prev) => [
        prev[0],
        parseInt(res.responseData.inputSettings.text),
      ]);
  }, [responseBuffer, popBuffer]);

  return (
    <div>
      <Button onClick={() => ScoreAdd(SCORE_A_ID, 1)}>A UP</Button>
      <Button onClick={() => ScoreAdd(SCORE_A_ID, -1)}>A DOWN</Button>
      <Button onClick={() => ScoreAdd(SCORE_B_ID, 1)}>B UP</Button>
      <Button onClick={() => ScoreAdd(SCORE_B_ID, -1)}>B DOWN</Button>
      <div>A score: {scores[0]}</div>
      <div>B score: {scores[1]}</div>
    </div>
  );
};
