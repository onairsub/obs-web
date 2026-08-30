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
    onOpen: () => void | null;
    onMessage: (message: object) => void | null;
    onError: (error: Event) => void | null;
    onClose: () => void | null;
  }) {
    this.socket = new WebSocket(this.url);

    this.socket.onopen = () => {
      this.isConnected = true;
      if (onOpen) onOpen();
    };

    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (onMessage) onMessage(message);
    };

    this.socket.onerror = (error) => {
      console.error("WebSocket 에러:", error);
      if (onError) onError(error);
    };

    this.socket.onclose = () => {
      this.isConnected = false;
      if (onClose) onClose();
    };
  }

  sendMessage(message: object) {
    if (this.isConnected && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.isConnected = false;
    }
  }
}
