"use client";

import styled from "@emotion/styled";
import { Button } from "@mui/material";
import React from "react";
import { useLocalStorage } from "usehooks-ts";
import { TeamSettingComponent } from "./_components/TeamSettingComponent";
import {
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
    <StyledWrapper>
      <h1>{teamName} 팀 자산</h1>
      <p>OBS 입력 이름은 요소 이름 뒤에 _A, _B가 붙습니다.</p>
      {teamSetting[teamId].map((e, idx) => (
        <TeamSettingComponent
          key={idx}
          idx={idx}
          e={e}
          teamName={teamId}
          setTeamSetting={setTeamSetting}
        />
      ))}
      <Button variant="outlined" onClick={() => addSetting("", TeamSettingElementType.IMAGE, "")}>
        ADD
      </Button>
    </StyledWrapper>
  );
};
export default TeamSettingPage;

const StyledWrapper = styled.div`
  width: min(100%, 420px);
  min-height: 100dvh;
  margin: 0 auto;
  padding: 24px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;

  h1 { margin: 0; font-size: 24px; }
  > p { margin: 0 0 10px; color: #8d94a3; font-size: 11px; }
`;
