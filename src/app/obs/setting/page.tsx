"use client";

import styled from "@emotion/styled";
import { Button, IconButton, TextField, Typography } from "@mui/material";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useLocalStorage } from "usehooks-ts";

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
  return (
    <>
      <IconButton onClick={() => router.back()}>
        <Image src="/arrow_back.svg" alt="back" width={36} height={36} />
      </IconButton>
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
