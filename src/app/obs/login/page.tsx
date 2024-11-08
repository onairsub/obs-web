"use client";

import { useWebSocket } from "@/components/websocket/WebSocketContext";
import { StatusCode } from "@/constants/statusCode";
import styled from "@emotion/styled";
import { Button, TextField } from "@mui/material";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useLocalStorage } from "usehooks-ts";

const Login = () => {
  const router = useRouter();
  const { connectStatus } = useWebSocket();

  const [authStatus, setAuthStatus, removeAuthStatus] = useLocalStorage(
    "OBS-AUTH",
    { port: 4455, password: "" }
  );

  const [port, setPort] = useState(4455);
  const [password, setPassword] = useState("");

  const connectOBS = () => {
    setAuthStatus({
      port,
      password,
    });
  };

  useEffect(() => {
    setPort(authStatus.port);
    setPassword(authStatus.password);
  }, [authStatus]);

  useEffect(() => {
    if (connectStatus === StatusCode.AUTHENTICATED) {
      console.log("move to dashboard");
      router.push("/obs/dashboard");
    }
  }, [router, connectStatus]);

  return (
    <StyledWrapper>
      <h1>OBS Controller</h1>
      <div>
        <TextField
          value={port}
          inputMode="numeric"
          onChange={(e) => setPort(parseInt(e.target.value))}
          sx={{ width: "400px" }}
          label="port"
        />
      </div>
      <div>
        <TextField
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          sx={{ width: "400px" }}
          label="password"
        />
      </div>
      <div>
        <Button onClick={connectOBS} variant="outlined">
          CONNECT OBS
        </Button>
      </div>
      <div>
        <a href="https://github.com/obsproject/obs-studio/releases/tag/28.1.2">
          INSTALL OBS
        </a>
      </div>
    </StyledWrapper>
  );
};

export default Login;

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

  button {
    width: 400px;
  }

  a {
    display: block;
    width: 100%;
    text-align: center;
    color: #999999;
  }
`;
