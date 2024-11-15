"use client";

import { useWebSocket } from "@/components/websocket/WebSocketContext";
import { StatusCode } from "@/constants/statusCode";
import styled from "@emotion/styled";
import {
  Box,
  Button,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useLocalStorage } from "usehooks-ts";

import { combinePath } from "./_utils/pathParser";
import {
  OBSElementProperties,
  TeamSettingElement,
  TeamSettingElementType,
} from "../team-setting/[id]/_constants/constants";

const TITLE_NAME = "title";
const SET_NAME = "set";
const TEAM_A_NAME = "team_A";
const SCORE_A_NAME = "score_A";
const SET_A_NAME = "set_A";
const SCORE_A_ID = "score_A";
const TEAM_B_NAME = "team_B";
const SCORE_B_NAME = "score_B";
const SET_B_NAME = "set_B";
const SCORE_B_ID = "score_B";

const TIMEOUT_NAME = "time_out";
const MATCH_POINT_NAME = "match_point";
const SET_POINT_NAME = "set_point";

type Scene = {
  sceneName: string;
  sceneUuid: string;
};

type SceneItem = {
  sourceName: string;
  sourceUuid: string;
  sceneItemId: number;
};

enum RoundType {
  NORMAL,
  SET_POINT,
  MATCH_POINT,
}

const Scores = () => {
  const router = useRouter();

  const {
    webSocketManager,
    connectStatus,
    recentResponse,
    responseBuffer,
    clearBuffer,
    popBuffer,
  } = useWebSocket();
  const [titleList] = useLocalStorage("OBS_TITLE_LIST", [
    "서울대배 8강 경기",
    "서울대배 4강 경기",
    "서울대배 결승전 경기",
  ]);
  const [teamList] = useLocalStorage("OBS_TEAM_LIST", [
    "서울대",
    "연세대",
    "고려대",
  ]);
  const [setList] = useLocalStorage("OBS_SET_LIST", [10, 7, 5]);

  const [title, setTitle] = useLocalStorage("OBS_TITLE", "서울대배 8강 경기");
  const [teamA, setTeamA] = useLocalStorage("OBS_TEAM_A", "서울대");
  const [teamB, setTeamB] = useLocalStorage("OBS_TEAM_B", "연세대");
  const [localPath] = useLocalStorage("OBS_LOCAL_PATH", "C:/Users");

  const [matchSetting] = useLocalStorage<{
    [key: string]: TeamSettingElement[];
  }>("OBS_MATCH_SETTINGS", {});
  const [teamSetting] = useLocalStorage<{
    [key: string]: TeamSettingElement[];
  }>("OBS_TEAM_SETTINGS", {});

  const [scores, setScores] = useLocalStorage("OBS_SCORE", [0, 0]);
  const [sets, setSets] = useLocalStorage("OBS_SETS", [0, 0]);
  const [currentSet, setCurrentSet] = useLocalStorage("OBS_CURRENT_SET", 1);

  const [tmpTitle, setTmpTitle] = useState("");
  const [ready, setReady] = useState([false, false]);
  const [cache, setCache] = useState<
    Map<string, { sceneItemId: number; sceneName: string }>
  >(new Map());
  const [sceneItems, setSceneItems] = useState<{ [key: string]: any }>({});
  const [timeOut, setTimeOut] = useState(false);

  const [roundType, setRoundType] = useState<RoundType>(RoundType.NORMAL);

  const filterScore = (score: number) => {
    if (score < 0) return 0;
    return score;
  };

  const GetCurrentProgramScene = (requestId: string = "123456789") => {
    webSocketManager?.sendMessage({
      op: 6,
      d: {
        requestId,
        requestType: "GetCurrentProgramScene",
      },
    });
  };

  const SetCurrentProgramScene = (sceneName: string) => {
    webSocketManager?.sendMessage({
      op: 6,
      d: {
        requestId: "123456789",
        requestType: "SetCurrentProgramScene",
        requestData: {
          sceneName,
        },
      },
    });
  };

  const GetSceneList = (requestId: string = "1234567") => {
    webSocketManager?.sendMessage({
      op: 6,
      d: {
        requestId,
        requestType: "GetSceneList",
      },
    });
  };

  const GetSceneItemList = (
    requestId: string = "1234567",
    sceneName: string
  ) => {
    webSocketManager?.sendMessage({
      op: 6,
      d: {
        requestId,
        requestType: "GetSceneItemList",
        requestData: {
          sceneName,
        },
      },
    });
  };

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

  const SetSceneItemEnabled = (
    sceneName: string,
    sceneItemId: number,
    sceneItemEnabled: boolean
  ) => {
    webSocketManager?.sendMessage({
      op: 6,
      d: {
        requestId: "1234567",
        requestType: "SetSceneItemEnabled",
        requestData: {
          sceneName,
          sceneItemId,
          sceneItemEnabled,
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

  const ApplyScene = () => {
    GetCurrentProgramScene("APPLYSCENE");
  };

  const ScoreAdd = (id: string, inc: number) => {
    if (id === SCORE_A_ID) {
      setScores((prev) => [filterScore(prev[0] + inc), prev[1]]);
    }
    if (id === SCORE_B_ID) {
      setScores((prev) => [prev[0], filterScore(prev[1] + inc)]);
    }
  };

  const FinishSet = () => {
    setCurrentSet((prev) => prev + 1);
    if (scores[0] > scores[1]) setSets([sets[0] + 1, sets[1]]);
    if (scores[0] < scores[1]) setSets([sets[0], sets[1] + 1]);
    ResetScore();
  };

  const ResetScore = () => {
    setScores([0, 0]);
  };

  const ResetAll = () => {
    setScores([0, 0]);
    setSets([0, 0]);
    setCurrentSet(1);
  };

  const FindSceneItem = (inputName: string) => {
    const result = {
      sceneName: "",
      sceneItemId: 0,
    };
    if (cache.has(inputName)) return cache.get(inputName);
    else {
      Object.keys(sceneItems).forEach((key) => {
        sceneItems[key].forEach((e: SceneItem) => {
          if (e.sourceName === inputName) {
            setCache((prev) => {
              const newMap = new Map(prev);
              newMap.set(inputName, {
                sceneName: key,
                sceneItemId: e.sceneItemId,
              });
              return newMap;
            });
            result.sceneName = key;
            result.sceneItemId = e.sceneItemId;
          }
        });
      });
    }
    console.log("found : ", result);
    return result.sceneItemId === 0 ? null : result;
  };

  const SwitchTeams = () => {
    setSets((prev) => prev.toReversed());
    setScores((prev) => prev.toReversed());
    setTeamA(teamB);
    setTeamB(teamA);
  };

  const CheckRoundType = () => {
    if (
      scores[0] !== scores[1] &&
      (scores[0] >= setList[currentSet - 1] - 1 ||
        scores[1] >= setList[currentSet - 1] - 1)
    ) {
      if (scores[0] > scores[1]) {
        if (sets[0] + 1 > setList.length / 2) {
          return RoundType.MATCH_POINT;
        } else {
          return RoundType.SET_POINT;
        }
      } else {
        if (sets[1] + 1 > setList.length / 2) {
          return RoundType.MATCH_POINT;
        } else {
          return RoundType.SET_POINT;
        }
      }
    } else return RoundType.NORMAL;
  };

  useEffect(() => {
    // GetInputSettings(SCORE_A_NAME, SCORE_A_ID);
    // GetInputSettings(SCORE_B_NAME, SCORE_B_ID);
    if (connectStatus === StatusCode.AUTHENTICATED)
      GetSceneList("GETSCENEDATA");
  }, [connectStatus]);

  useEffect(() => {
    if (connectStatus === StatusCode.AUTHENTICATED) {
      SetInputSettings(TEAM_A_NAME, { text: teamA });

      teamSetting[teamList.indexOf(teamA).toString()]?.forEach(
        (e: TeamSettingElement) => {
          const { name, type, value } = e;
          SetInputSettings(
            `${name}_A`,
            GenerateInputSettings(
              type,
              type === TeamSettingElementType.TEXT
                ? value
                : combinePath(localPath, value)
            )
          );
        }
      );
    }
  }, [teamA, connectStatus, localPath, teamSetting, teamList]);

  useEffect(() => {
    if (connectStatus === StatusCode.AUTHENTICATED) {
      SetInputSettings(TEAM_B_NAME, { text: teamB });

      teamSetting[teamList.indexOf(teamB).toString()]?.forEach(
        (e: TeamSettingElement) => {
          const { name, type, value } = e;
          SetInputSettings(
            `${name}_B`,
            GenerateInputSettings(
              type,
              type === TeamSettingElementType.TEXT
                ? value
                : combinePath(localPath, value)
            )
          );
        }
      );
    }
  }, [teamB, connectStatus, localPath, teamSetting, teamList]);

  useEffect(() => {
    if (connectStatus === StatusCode.AUTHENTICATED) {
      SetInputSettings(TITLE_NAME, { text: title });
      setTmpTitle(title);

      matchSetting[titleList.indexOf(title).toString()]?.forEach(
        (e: TeamSettingElement) => {
          const { name, type, value } = e;
          SetInputSettings(
            name,
            GenerateInputSettings(
              type,
              type === TeamSettingElementType.TEXT
                ? value
                : combinePath(localPath, value)
            )
          );
        }
      );
    }
  }, [title, connectStatus, localPath, matchSetting, titleList]);

  useEffect(() => {
    if (connectStatus === StatusCode.AUTHENTICATED) {
      SetInputSettings(SCORE_A_NAME, { text: scores[0].toString() });
      SetInputSettings(SCORE_B_NAME, { text: scores[1].toString() });

      setRoundType(CheckRoundType());
    }
  }, [scores, connectStatus]);

  useEffect(() => {
    const matchPoint = FindSceneItem(MATCH_POINT_NAME);
    const setPoint = FindSceneItem(SET_POINT_NAME);

    switch (roundType) {
      case RoundType.NORMAL:
        SetSceneItemEnabled(
          matchPoint?.sceneName || "unknown",
          matchPoint?.sceneItemId || 0,
          false
        );
        SetSceneItemEnabled(
          setPoint?.sceneName || "unknown",
          setPoint?.sceneItemId || 0,
          false
        );
        break;
      case RoundType.MATCH_POINT:
        SetSceneItemEnabled(
          matchPoint?.sceneName || "unknown",
          matchPoint?.sceneItemId || 0,
          true
        );
        SetSceneItemEnabled(
          setPoint?.sceneName || "unknown",
          setPoint?.sceneItemId || 0,
          false
        );
        break;
      case RoundType.SET_POINT:
        SetSceneItemEnabled(
          matchPoint?.sceneName || "unknown",
          matchPoint?.sceneItemId || 0,
          false
        );
        SetSceneItemEnabled(
          setPoint?.sceneName || "unknown",
          setPoint?.sceneItemId || 0,
          true
        );
        break;
    }
    ApplyScene();
  }, [roundType, connectStatus]);

  useEffect(() => {
    if (connectStatus === StatusCode.AUTHENTICATED) {
      SetInputSettings(SET_NAME, { text: `${currentSet} SET` });
    }
  }, [currentSet, connectStatus]);

  useEffect(() => {
    if (connectStatus === StatusCode.AUTHENTICATED) {
      const result = FindSceneItem(TIMEOUT_NAME);
      if (result === null || result === undefined) return;
      const { sceneName, sceneItemId } = result;
      SetSceneItemEnabled(sceneName, sceneItemId, timeOut);
      ApplyScene();
    }
  }, [timeOut, connectStatus]);

  useEffect(() => {
    if (connectStatus === StatusCode.AUTHENTICATED) {
      for (let i = 0; i < 3; i++) {
        const result = FindSceneItem(`${SET_A_NAME}_${i + 1}`);
        console.log("found A: ", result);
        if (result === null || result === undefined) break;
        const { sceneName, sceneItemId } = result;
        SetSceneItemEnabled(sceneName, sceneItemId, sets[0] > i);
      }
      for (let i = 0; i < 3; i++) {
        const result = FindSceneItem(`${SET_B_NAME}_${i + 1}`);
        console.log("found B: ", result);
        if (result === null || result === undefined) break;
        const { sceneName, sceneItemId } = result;
        SetSceneItemEnabled(sceneName, sceneItemId, sets[1] > i);
      }
      ApplyScene();
    }
  }, [sets, cache, connectStatus]);

  // response handle
  useEffect(() => {
    if (popBuffer === null) return;
    const res = popBuffer();
    if (res === null) return;
    if (res.requestStatus.code !== 100) return;

    console.log("res: ", res);
    if (res.requestId === SCORE_A_ID) {
      setScores((prev) => [
        parseInt(res.responseData.inputSettings.text),
        prev[1],
      ]);
      setReady((prev) => [true, prev[1]]);
    }
    if (res.requestId === SCORE_B_ID) {
      setScores((prev) => [
        prev[0],
        parseInt(res.responseData.inputSettings.text),
      ]);
      setReady((prev) => [prev[0], true]);
    }
    if (res.requestId === "GETSCENEDATA") {
      res.responseData.scenes.forEach((e: Scene) => {
        GetSceneItemList(e.sceneName, e.sceneName);
      });
    }
    if (res.requestType === "GetSceneItemList") {
      setSceneItems((prev) => ({
        ...prev,
        [res.requestId]: res.responseData.sceneItems,
      }));
    }
    if (res.requestId === "APPLYSCENE") {
      SetCurrentProgramScene(res.responseData.sceneName);
    }
  }, [responseBuffer, popBuffer]);

  return (
    <PageWrapper>
      <SidebarWrapper>
        <Typography
          sx={{
            textAlign: "center",
            marginBottom: "8px",
            fontWeight: "bold",
          }}
        >
          Scenes
        </Typography>
        {Object.keys(sceneItems).map((sceneName) => (
          <Button
            key={sceneName}
            onClick={() => SetCurrentProgramScene(sceneName)}
          >
            {sceneName}
          </Button>
        ))}
        <Divider variant="middle" />
        <Button
          onClick={() => router.push("/obs/setting")}
          sx={{
            textAlign: "center",
            marginTop: "32px",
            fontWeight: "bold",
            color: "#444444",
          }}
        >
          Settings
        </Button>
      </SidebarWrapper>
      <StyledWrapper>
        <FormControl>
          <InputLabel>경기 제목</InputLabel>
          <Select
            value={title}
            label="경기 제목"
            placeholder="경기 제목을 입력하세요"
            onChange={(e) => setTitle(e.target.value)}
            sx={{
              maxWidth: "50vw",
              textOverflow: "ellipsis",
              overflow: "hidden",
              unicodeBidi: "embed",
              direction: "rtl",
            }}
          >
            {titleList.map((e, idx) => (
              <MenuItem key={idx} value={e}>
                {e}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TeamSelectWrapper>
          <FormControl>
            <InputLabel>A팀</InputLabel>
            <Select
              value={teamA}
              label="A팀"
              onChange={(e) => setTeamA(e.target.value)}
            >
              {teamList.map((e, idx) => (
                <MenuItem key={idx} value={e}>
                  {e}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Image
            onClick={SwitchTeams}
            src="/autorenew.svg"
            alt="switch"
            width={32}
            height={32}
          />
          <FormControl>
            <InputLabel>B팀</InputLabel>
            <Select
              value={teamB}
              label="B팀"
              onChange={(e) => setTeamB(e.target.value)}
            >
              {teamList.map((e, idx) => (
                <MenuItem key={idx} value={e}>
                  {e}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </TeamSelectWrapper>
        <ScoreboardWrapper>
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
        </ScoreboardWrapper>
        <div>set score</div>
        <div>{`${sets[0]} : ${sets[1]}`}</div>
        <Box sx={{ marginBottom: "16px" }} />
        <Button
          sx={{ width: "200px", marginBottom: "8px" }}
          variant="contained"
          onClick={FinishSet}
        >
          finish set
        </Button>
        <Button
          sx={{ width: "200px", marginBottom: "8px" }}
          color="error"
          variant={timeOut ? "contained" : "outlined"}
          onClick={() => setTimeOut((prev) => !prev)}
        >
          timeout
        </Button>
        <Button
          sx={{ width: "200px", marginBottom: "8px" }}
          variant="outlined"
          onClick={ResetScore}
        >
          reset score
        </Button>
        <Button sx={{ width: "200px" }} variant="outlined" onClick={ResetAll}>
          reset all
        </Button>
      </StyledWrapper>
    </PageWrapper>
  );
};

export default Scores;

const PageWrapper = styled.div`
  display: flex;
`;

const SidebarWrapper = styled.div`
  display: flex;
  flex-direction: column;
  width: 200px;
  background-color: #efefef;
  justify-content: center;
  button: {
    width: 100%;
  }
`;

const TeamSelectWrapper = styled.div`
  margin: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
`;

const StyledWrapper = styled.div`
  height: 100vh;
  min-height: 500px;
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
`;

const ScoreboardWrapper = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;

  font-size: 32px;
  font-weight: bold;

  > div {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  > span {
    text-align: center;
  }

  button {
    font-size: 16px;
    width: 150px;
    height: 80px;
  }
`;
