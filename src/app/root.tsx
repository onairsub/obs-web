import { useWebSocket } from "@/components/websocket/WebSocketContext";
import { Scores } from "./scoreboard/_components/scores";
import { Login } from "./(login)/login";

export const Root = (props: {authStatus: any, setAuthStatus: any}) => {
  const { connectStatus } = useWebSocket();

  return <div>{connectStatus === 201 ? <Scores /> : <Login {...props}/>}</div>;
};
