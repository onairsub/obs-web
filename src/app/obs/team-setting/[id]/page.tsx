"use client";

import styled from "@emotion/styled";
import { Button, Select, TextField } from "@mui/material";
import { useRouter } from "next/router";
import React from "react";
import { useLocalStorage } from "usehooks-ts";
import { useDropzone } from "react-dropzone";
import { TeamSettingComponent } from "./_components/TeamSettingComponent";
import {
  OBSElementProperties,
  TeamSettingElement,
  TeamSettingElementType,
} from "./_constants/constants";

const TeamSettingPage = ({ params }: any) => {
  const unwrapParams: { id: string } = React.use<{ id: string }>(params);
  const teamId = decodeURIComponent(unwrapParams.id);

  const [teamList] = useLocalStorage("OBS_TEAM_LIST", [
    "서울대",
    "연세대",
    "고려대",
  ]);
  const [teamSetting, setTeamSetting, clearTeamSetting] = useLocalStorage<{
    [key: string]: TeamSettingElement[];
  }>("OBS_TEAM_SETTINGS", {});

  const teamName = teamList[parseInt(teamId)];

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
    setTeamSetting((prev) => ({
      ...prev,
      [teamId]: [
        ...prev[teamId].slice(0, idx),
        { name, type, value },
        ...prev[teamId].slice(idx + 1),
      ],
    }));
  };

  const addSetting = (
    name: string,
    type: TeamSettingElementType,
    value: string
  ) => {
    setTeamSetting((prev) => ({
      ...prev,
      [teamId]: [...prev[teamId], { name, type, value }],
    }));
  };

  return !Object.keys(teamSetting).includes(teamId) ? (
    <div>Team {teamId} Doesn`t Exist</div>
  ) : (
    <div>
      <div>Team {teamName} Setting page</div>
      {teamSetting[teamId].map((e, idx) => (
        <TeamSettingComponent
          key={idx}
          idx={idx}
          e={e}
          teamName={teamId}
          setTeamSetting={setTeamSetting}
        />
      ))}
      <Button onClick={() => addSetting("", TeamSettingElementType.IMAGE, "")}>
        ADD
      </Button>
    </div>
  );
};
export default TeamSettingPage;

const StyledWrapper = styled.div`
  padding: 32px;
  padding-top: 0px;
  display: flex;
  flex-direction: column;
`;
