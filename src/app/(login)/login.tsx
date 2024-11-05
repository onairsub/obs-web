import styled from "@emotion/styled";
import { Button, TextField } from "@mui/material";
import { useState } from "react";

export const Login = (props: {authStatus: any, setAuthStatus: any}) => {
  const [port, setPort] = useState(props.authStatus.port);
  const [password, setPassword] = useState(props.authStatus.password);

  const connectOBS = () => {
    props.setAuthStatus({
      port, password
    })
  }

  return (
    <StyledWrapper>
      <h1>OBS Controller</h1>
      <div><TextField value={port} onChange={(e) => setPort(e.target.value)} sx={{width: '400px'}} label="port"/></div>
      <div><TextField value={password} onChange={(e) => setPassword(e.target.value)} sx={{width: '400px'}} label="password"/></div>
      <div><Button onClick={connectOBS} variant='outlined'>CONNECT OBS</Button></div>
      <div></div>
    </StyledWrapper>
  );
};

const StyledWrapper = styled.div`
  display: flex;
  flex-direction: column;
  padding: 64px;
  justify-content: center;
  align-items: center;
  gap: 16px;
  height: 100vh;

  h1 {
    font-size: 48px;
    font-weight: bold;
  }

  > div {
    width: 400px;
  }
  
  > div:last-of-type {
    height: 200px; 
  }

  button {
    width: 400px;
  }
`;
