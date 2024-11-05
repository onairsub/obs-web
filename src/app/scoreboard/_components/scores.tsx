"use client";

import { useWebSocket } from "@/components/websocket/WebSocketContext";
import styled from "@emotion/styled";
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

  const filterScore = (score: number) => {
    if(score < 0) return 0;
    return score;
  }

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
      setScores((prev) => [filterScore(prev[0] + inc), prev[1]]);
    }
    if (id === SCORE_B_ID) {
      setScores((prev) => [prev[0], filterScore(prev[1] + inc)]);
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
    if(res.requestStatus.code !== 100) return;

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
    <StyledWrapper>
      <div>
        <Button onClick={() => ScoreAdd(SCORE_A_ID, 1)}>A UP</Button>
        <div>{scores[0]}</div>
        <Button onClick={() => ScoreAdd(SCORE_A_ID, -1)}>A DOWN</Button>
      </div>
      <span>:</span>
      <div>
        <Button onClick={() => ScoreAdd(SCORE_B_ID, 1)}>B UP</Button>
        <div>{scores[1]}</div>
        <Button onClick={() => ScoreAdd(SCORE_B_ID, -1)}>B DOWN</Button>
      </div>
    </StyledWrapper>
  );
};

const StyledWrapper = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  height: 100vh;

  font-size: 128px;
  font-weight: bold;

  > div {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  > span {
    text-align: center;
    width: 100px; 
  }

  button {
    font-size: 16px;
  }
`