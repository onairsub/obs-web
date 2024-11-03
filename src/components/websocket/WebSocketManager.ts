// WebSocketManager.js
export default class WebSocketManager {
  url: string;
  socket: WebSocket | null;
  isConnected: boolean;

  constructor(url: string) {
    this.url = url;
    this.socket = null;
    this.isConnected = false;
  }

  connect({
    onOpen,
    onMessage,
    onError,
    onClose,
  }: {
    onOpen: Function | null;
    onMessage: Function | null;
    onError: Function | null;
    onClose: Function | null;
  }) {
    this.socket = new WebSocket(this.url);

    this.socket.onopen = () => {
      this.isConnected = true;
      console.log("WebSocket 연결 성공!");
      if (onOpen) onOpen();
    };

    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      console.log("메시지 수신:", message);
      if (onMessage) onMessage(message);
    };

    this.socket.onerror = (error) => {
      console.error("WebSocket 에러:", error);
      if (onError) onError(error);
    };

    this.socket.onclose = () => {
      this.isConnected = false;
      console.log("WebSocket 연결이 닫혔습니다.");
      if (onClose) onClose();
    };
  }

  sendMessage(message: object) {
    if (this.isConnected && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      console.log("메시지를 보냈습니다:", message);
    } else {
      console.log("WebSocket이 아직 연결되지 않았습니다.");
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.isConnected = false;
    }
  }
}
