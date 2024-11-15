"use client";

import styled from "@emotion/styled";
import { Button, Select, TextField } from "@mui/material";
import { useRouter } from "next/router";
import React from "react";
import { useLocalStorage } from "usehooks-ts";
import { useDropzone } from "react-dropzone";
import { TeamSettingComponent } from "../../team-setting/[id]/_components/TeamSettingComponent";
import {
  OBSElementProperties,
  TeamSettingElement,
  TeamSettingElementType,
} from "../../team-setting/[id]/_constants/constants";

const MatchSettingPage = ({ params }: any) => {
  const unwrapParams: { id: string } = React.use<{ id: string }>(params);
  const matchId = decodeURIComponent(unwrapParams.id);

  const [titleList] = useLocalStorage("OBS_TITLE_LIST", [
    "서울대배 8강 경기",
    "서울대배 4강 경기",
    "서울대배 결승전 경기",
  ]);
  const [matchSetting, setMatchSetting, clearMatchSetting] = useLocalStorage<{
    [key: string]: TeamSettingElement[];
  }>("OBS_MATCH_SETTINGS", {});

  const title = titleList[parseInt(matchId)];

  const GetInputSettings = (
    name: string,
    type: TeamSettingElementType,
    value: string
  ) => {
    return {
      [OBSElementProperties[type]]: value,
    };
  };

  const changeSetting = (
    idx: number,
    name: string,
    type: TeamSettingElementType,
    value: string
  ) => {
    setMatchSetting((prev) => ({
      ...prev,
      [matchId]: [
        ...prev[matchId].slice(0, idx),
        { name, type, value },
        ...prev[matchId].slice(idx + 1),
      ],
    }));
  };

  const addSetting = (
    name: string,
    type: TeamSettingElementType,
    value: string
  ) => {
    setMatchSetting((prev) => ({
      ...prev,
      [matchId]: [...prev[matchId], { name, type, value }],
    }));
  };

  return !Object.keys(matchSetting).includes(matchId) ? (
    <div>Match {matchId} Doesn`t Exist</div>
  ) : (
    <div>
      <div>Match {title} Setting page</div>
      {matchSetting[matchId].map((e, idx) => (
        <TeamSettingComponent
          key={idx}
          idx={idx}
          e={e}
          teamName={matchId}
          setTeamSetting={setMatchSetting}
        />
      ))}
      <Button onClick={() => addSetting("", TeamSettingElementType.IMAGE, "")}>
        ADD
      </Button>
    </div>
  );
};
export default MatchSettingPage;
