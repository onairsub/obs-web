import styled from "@emotion/styled";
import { Button, TextField } from "@mui/material";

export const Login = () => {
  return (
    <StyledWrapper>
      <h1>OBS Controller</h1>
      <TextField />
      <TextField />
      <Button></Button>
    </StyledWrapper>
  );
};

const StyledWrapper = styled.div`
  width: 100px;
  height: 100px;
  background-color: white;
`;
