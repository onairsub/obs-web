import styled from "@emotion/styled";
import { IconButton, MenuItem, Select, TextField } from "@mui/material";
import { useDropzone } from "react-dropzone";
import Image from "next/image";
import {
  TeamSettingElement,
  TeamSettingElementType,
} from "../_constants/constants";

export const TeamSettingComponent = ({
  idx,
  teamName,
  e,
  setTeamSetting,
}: {
  idx: number;
  teamName: string;
  e: any;
  setTeamSetting: any;
}) => {
  const onChange = (value: string) => {
    setTeamSetting((prev: { [key: string]: TeamSettingElement[] }) => ({
      ...prev,
      [teamName]: [
        ...prev[teamName].slice(0, idx),
        { ...prev[teamName][idx], name: value },
        ...prev[teamName].slice(idx + 1),
      ],
    }));
  };

  const onSelect = (value: TeamSettingElementType) => {
    console.log(value);
    setTeamSetting((prev: { [key: string]: TeamSettingElement[] }) => ({
      ...prev,
      [teamName]: [
        ...prev[teamName].slice(0, idx),
        { ...prev[teamName][idx], type: value },
        ...prev[teamName].slice(idx + 1),
      ],
    }));
  };

  const onDrop = (files: any[]) => {
    if (files.length > 0) {
      const path = files[0].name;
      console.log(path);
      setTeamSetting((prev: { [key: string]: TeamSettingElement[] }) => ({
        ...prev,
        [teamName]: [
          ...prev[teamName].slice(0, idx),
          { ...prev[teamName][idx], value: path },
          ...prev[teamName].slice(idx + 1),
        ],
      }));
    }
  };

  const onTextChange = (value: string) => {
    setTeamSetting((prev: { [key: string]: TeamSettingElement[] }) => ({
      ...prev,
      [teamName]: [
        ...prev[teamName].slice(0, idx),
        { ...prev[teamName][idx], value },
        ...prev[teamName].slice(idx + 1),
      ],
    }));
  };

  const onDelete = () => {
    setTeamSetting((prev: { [key: string]: TeamSettingElement[] }) => ({
      ...prev,
      [teamName]: prev[teamName].filter((_, i) => i !== idx),
    }));
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
  });
  return (
    <TeamSettingElementWrapper key={idx}>
      <TextField
        value={e.name}
        onChange={(event) => onChange(event.target.value)}
      />
      <Select value={e.type} onChange={(event) => onSelect(event.target.value)}>
        <MenuItem value={TeamSettingElementType.IMAGE}>Image</MenuItem>
        <MenuItem value={TeamSettingElementType.TEXT}>Text</MenuItem>
        <MenuItem value={TeamSettingElementType.VIDEO}>Video</MenuItem>
      </Select>
      {e.type === TeamSettingElementType.TEXT ? (
        <TextField
          value={e.value}
          onChange={(event) => onTextChange(event.target.value)}
        />
      ) : (
        <div
          {...getRootProps()}
          style={{
            border: "2px dashed #ccc",
            padding: "20px",
            textAlign: "center",
            cursor: "pointer",
          }}
        >
          <input {...getInputProps()} />
          {e.value ? (
            <p>{e.value}</p>
          ) : (
            <div>
              {isDragActive ? (
                <p>Drop the file here...</p>
              ) : (
                <p>Drag and drop a file here, or click to select one</p>
              )}
            </div>
          )}
        </div>
      )}
      <IconButton onClick={onDelete}>
        <Image src="/close.svg" alt="delete" width={50} height={50} />
      </IconButton>
    </TeamSettingElementWrapper>
  );
};

const TeamSettingElementWrapper = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  padding: 10px;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  background: #ffffff;

  > div:first-of-type { flex: 1 1 120px; }
  > div:nth-of-type(2) { flex: 0 0 96px; }
  > div:nth-of-type(3) { flex: 1 1 100%; }
`;
