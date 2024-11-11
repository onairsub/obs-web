"use client";

import styled from "@emotion/styled";
import { useRouter } from "next/router";
import React from "react";
import { useLocalStorage } from "usehooks-ts";

enum TeamSettingElementType {
  TEXT,
  IMAGE,
  VIDEO,
}

type TeamSettingElement = {
  name: string;
  type: TeamSettingElementType;
  value: string;
};

const Properties = {
  [TeamSettingElementType.TEXT]: "text",
  [TeamSettingElementType.IMAGE]: "file",
  [TeamSettingElementType.VIDEO]: "local_file",
};

const TeamSettingPage = ({ params }: any) => {
  const unwrapParams = React.use<{ id: string }>(params);
  const teamName = decodeURIComponent(unwrapParams.id);

  const [teamSetting, setTeamSetting, clearTeamSetting] = useLocalStorage<{
    [key: string]: TeamSettingElement[];
  }>("OBS_TEAM_SETTINGS", {
    서울대: [
      {
        name: "logo",
        type: TeamSettingElementType.IMAGE,
        value: "logo.png",
      },
    ],
  });

  const GetInputSettings = (
    name: string,
    type: TeamSettingElementType,
    value: string
  ) => {
    return {
      [Properties[type]]: value,
    };
  };

  return Object.keys(teamSetting).includes(teamName) ? (
    <div>Team Setting page</div>
  ) : (
    <div>Team {teamName} Doesn`t Exist</div>
  );
};

export default TeamSettingPage;

const StyledWrapper = styled.div`
  padding: 32px;
  padding-top: 0px;
  display: flex;
  flex-direction: column;
`;
