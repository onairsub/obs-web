"use client";

import styled from "@emotion/styled";
import { Button, IconButton, TextField, Typography } from "@mui/material";
import Image from "next/image";
import { useRouter } from "next/navigation";
import React, { ChangeEventHandler, useEffect, useRef } from "react";
import { useLocalStorage } from "usehooks-ts";
import { projectHmrEvents } from "next/dist/build/swc/generated-native";
import { TeamSettingElement } from "../team-setting/[id]/_constants/constants";

function updateListAtIndex(list: any[], index: number, newValue: any) {
  if (index < 0 || index >= list.length) {
    throw new Error("Index out of bounds");
  }
  return list.map((item, i) => (i === index ? newValue : item));
}

const SettingPage = () => {
  const router = useRouter();

  const [titleList, setTitleList, clearTitleList] = useLocalStorage(
    "OBS_TITLE_LIST",
    ["서울대배 8강 경기", "서울대배 4강 경기", "서울대배 결승전 경기"]
  );
  const [teamList, setTeamList, clearTeamList] = useLocalStorage(
    "OBS_TEAM_LIST",
    ["서울대", "연세대", "고려대"]
  );
  const [setList, setSetList, clearSetList] = useLocalStorage(
    "OBS_SET_LIST",
    [10, 7, 5]
  );
  const [teamSetting, setTeamSetting, clearTeamSetting] = useLocalStorage<{
    [key: string]: TeamSettingElement[];
  }>("OBS_TEAM_SETTINGS", {});
  const [matchSetting, setMatchSetting, clearMatchSetting] = useLocalStorage<{
    [key: string]: TeamSettingElement[];
  }>("OBS_MATCH_SETTINGS", {});

  const [localPath, setLocalPath] = useLocalStorage(
    "OBS_LOCAL_PATH",
    "C:/Users"
  );

  const SaveSettings = () => {
    const dataStr = JSON.stringify(GetSettings(), null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "settings.json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const LoadSettings = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files === null) return;
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        if (!e.target?.result) return;
        const importedSettings = JSON.parse(e.target.result as string);
        SetSettings(importedSettings);
      } catch (err) {
        console.error("Error parsing JSON file:", err);
        alert("Invalid JSON file");
      }
    };
    reader.readAsText(file);
  };

  const GetSettings = () => {
    return {
      titleList,
      matchSetting,
      teamList,
      setList,
      teamSetting,
    };
  };

  const SetSettings = (settingData: {
    titleList: string[];
    matchSetting: {
      [key: string]: TeamSettingElement[];
    };
    teamList: string[];
    setList: number[];
    teamSetting: {
      [key: string]: TeamSettingElement[];
    };
  }) => {
    const {
      titleList: _titleList,
      matchSetting: _matchSetting,
      teamList: _teamList,
      setList: _setList,
      teamSetting: _teamSetting,
    } = settingData;
    setTitleList(_titleList);
    setMatchSetting(_matchSetting);
    setTeamList(_teamList);
    setSetList(_setList);
    setTeamSetting(_teamSetting);
  };

  useEffect(() => {
    teamList.forEach((e, idx) => {
      if (!Object.keys(teamSetting).includes(idx.toString()))
        setTeamSetting((prev) => ({ ...prev, [idx.toString()]: [] }));
    });
  }, [teamList, teamSetting, setTeamSetting]);

  useEffect(() => {
    titleList.forEach((e, idx) => {
      if (!Object.keys(matchSetting).includes(idx.toString()))
        setMatchSetting((prev) => ({ ...prev, [idx.toString()]: [] }));
    });
  }, [titleList, matchSetting, setMatchSetting]);

  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <IconButton onClick={() => router.back()}>
        <Image src="/arrow_back.svg" alt="back" width={36} height={36} />
      </IconButton>
      <HeaderButtonWrapper>
        <TextField
          label="local asset path"
          value={localPath}
          onChange={(e) => setLocalPath(e.target.value)}
        />
        <input
          type="file"
          accept=".json"
          onChange={LoadSettings}
          ref={inputRef}
          style={{
            display: "none",
            position: "absolute",
            left: 0,
            top: 0,
            width: "100%",
            height: "100%",
            cursor: "pointer",
          }}
        />
        <Button onClick={SaveSettings}>SAVE SETTINGS</Button>
        <Button
          onClick={() => {
            inputRef.current?.click();
          }}
        >
          Load SETTINGS
        </Button>
      </HeaderButtonWrapper>
      <StyledWrapper>
        <TitleWrapper>
          <h1>경기 제목</h1>
          <h4 onClick={() => setTitleList([])}>전체 삭제</h4>
        </TitleWrapper>
        <ContentWrapper>
          {titleList.map((e, idx) => (
            <ItemWrapper key={idx}>
              <TextField
                value={e}
                onChange={(event) =>
                  setTitleList((prev) =>
                    updateListAtIndex(prev, idx, event.target.value)
                  )
                }
              />
              <Image
                onClick={() => router.push(`/obs/match-setting/${idx}`)}
                src="/edit.svg"
                alt="match setting"
                width={36}
                height={36}
              />
              <Image
                onClick={() =>
                  setTitleList((prev) => prev.filter((e, i) => i !== idx))
                }
                src="/close.svg"
                alt="delete"
                width={36}
                height={36}
              />
            </ItemWrapper>
          ))}
          <Button
            onClick={() => setTitleList((prev) => [...prev, ""])}
            variant="outlined"
          >
            <Image src="/add.svg" alt="add item" width={24} height={24} />
          </Button>
        </ContentWrapper>

        <TitleWrapper>
          <h1>팀 목록</h1>
          <h4 onClick={() => setTitleList([])}>전체 삭제</h4>
        </TitleWrapper>
        <ContentWrapper>
          {teamList.map((e, idx) => (
            <ItemWrapper key={idx}>
              <TextField
                value={e}
                onChange={(event) =>
                  setTeamList((prev) =>
                    updateListAtIndex(prev, idx, event.target.value)
                  )
                }
              />
              <Image
                onClick={() => router.push(`/obs/team-setting/${idx}`)}
                src="/edit.svg"
                alt="team setting"
                width={36}
                height={36}
              />
              <Image
                onClick={() =>
                  setTeamList((prev) => prev.filter((e, i) => i !== idx))
                }
                src="/close.svg"
                alt="delete"
                width={36}
                height={36}
              />
            </ItemWrapper>
          ))}
          <Button
            onClick={() => setTeamList((prev) => [...prev, ""])}
            variant="outlined"
          >
            <Image src="/add.svg" alt="add item" width={24} height={24} />
          </Button>
        </ContentWrapper>

        <TitleWrapper>
          <h1>세트별 점수</h1>
          <h4 onClick={() => setSetList([10])}>전체 삭제</h4>
        </TitleWrapper>
        <ContentWrapper>
          {setList.map((e, idx) => (
            <ItemWrapper key={idx}>
              <Typography
                sx={{
                  fontWeight: "bold",
                  fontSize: "32px",
                  display: "flex",
                  alignItems: "center",
                  marginRight: "8px",
                }}
              >
                {idx + 1}
              </Typography>
              <TextField
                type="number"
                value={e}
                onChange={(event) =>
                  setSetList((prev) =>
                    updateListAtIndex(prev, idx, parseInt(event.target.value))
                  )
                }
              />
              <Image
                onClick={() =>
                  setSetList((prev) => prev.filter((e, i) => i !== idx))
                }
                src="/close.svg"
                alt="delete"
                width={36}
                height={36}
              />
            </ItemWrapper>
          ))}
          <Button
            onClick={() => setSetList((prev) => [...prev, 0])}
            variant="outlined"
          >
            <Image src="/add.svg" alt="add item" width={24} height={24} />
          </Button>
        </ContentWrapper>
      </StyledWrapper>
    </>
  );
};

export default SettingPage;

const HeaderButtonWrapper = styled.div`
  display: flex;
  justify-content: space-between;
`;

const StyledWrapper = styled.div`
  padding: 64px;
  padding-top: 0px;
  display: flex;
  flex-direction: column;
`;

const TitleWrapper = styled.div`
  display: flex;

  justify-content: space-between;
  align-items: center;

  margin-top: 32px;
  margin-bottom: 16px;

  h1 {
    font-size: 32px;
    font-weight: bold;
  }

  h4 {
    font-size: 16px;
    color: #666666;
  }
`;

const ContentWrapper = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  gap: 12px;
`;

const ItemWrapper = styled.div`
  display: flex;
  width: 100%;
  div:first-of-type {
    flex: 1;
  }
  gap: 12px;
`;
