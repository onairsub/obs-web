import WebSocketManager from "@/components/websocket/WebSocketManager";

// Linear 함수 (일정한 속도)
function linear(t: number, start: number, end: number) {
  return start + (end - start) * t;
}

// Ease In 함수 (제곱 함수)
function easeIn(t: number, start: number, end: number) {
  return start + (end - start) * (t * t);
}

// Ease Out 함수 (반전된 제곱 함수)
function easeOut(t: number, start: number, end: number) {
  return start + (end - start) * (1 - (1 - t) * (1 - t));
}

// Ease InOut 함수 (두 개의 제곱 함수 결합)
function easeInOut(t: number, start: number, end: number) {
  if (t < 0.5) {
    return start + (end - start) * (2 * t * t);
  } else {
    return start + (end - start) * (1 - Math.pow(-2 * t + 2, 2) / 2);
  }
}

export enum TimeFunction {
  LINEAR = "linear",
  EASE_IN = "easeIn",
  EASE_OUT = "easeOut",
  EASE_IN_OUT = "easeInOut",
}

const funcMap = {
  linear,
  easeIn,
  easeOut,
  easeInOut,
};

export const AnimateItem = async (
  manager: WebSocketManager | null,
  sceneName: string,
  sceneItemId: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  duration: number,
  timeFunction: TimeFunction = TimeFunction.LINEAR
) => {
  const steps = (30 * duration) / 1000; // Number of steps for smoother animation
  const interval = duration / steps;
  const func = funcMap[timeFunction];

  for (let i = 0; i <= steps; i++) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    manager?.sendMessage({
      op: 6,
      d: {
        requestId: "1234567",
        requestType: "SetSceneItemTransform",
        requestData: {
          sceneName,
          sceneItemId,
          sceneItemTransform: {
            positionX: func(i / steps, startX, endX),
            positionY: func(i / steps, startY, endY),
          },
        },
      },
    });
  }
};

type Keyframe = {
  timeCode: number;
  x: number;
  y: number;
  timeFunction?: TimeFunction;
};

export const AnimateWithKeyframe = async (
  manager: WebSocketManager | null,
  sceneName: string,
  sceneItemId: number,
  keyframes: Keyframe[]
) => {
  for (let i = 0; i < keyframes.length - 1; i++) {
    const keyframe = keyframes[i];
    const nextKeyframe = keyframes[i + 1];
    await AnimateItem(
      manager,
      sceneName,
      sceneItemId,
      keyframe.x,
      keyframe.y,
      nextKeyframe.x,
      nextKeyframe.y,
      nextKeyframe.timeCode - keyframe.timeCode,
      keyframe.timeFunction || TimeFunction.LINEAR
    );
  }
};
