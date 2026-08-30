"use client";

import styled from "@emotion/styled";
import { Button } from "@mui/material";
import React from "react";
import { useLocalStorage } from "usehooks-ts";
import { TeamSettingComponent } from "../../team-setting/[id]/_components/TeamSettingComponent";
import {
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
    <StyledWrapper>
      <h1>{title} 경기 자산</h1>
      <p>OBS 입력 이름은 작성한 요소 이름을 그대로 사용합니다.</p>
      {matchSetting[matchId].map((e, idx) => (
        <TeamSettingComponent
          key={idx}
          idx={idx}
          e={e}
          teamName={matchId}
          setTeamSetting={setMatchSetting}
        />
      ))}
      <Button variant="outlined" onClick={() => addSetting("", TeamSettingElementType.IMAGE, "")}>
        ADD
      </Button>
    </StyledWrapper>
  );
};
export default MatchSettingPage;

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
