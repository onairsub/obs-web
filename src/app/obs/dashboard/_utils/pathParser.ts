import path from "path";

export function combinePath(
  fullPath: string,
  fileName: string,
  posixMode: boolean = false
) {
  // 경로 문자열을 슬래시나 역슬래시로 분할하여 배열로 변환
  const pathSegments = fullPath.split(/[/\\]+/);

  // 경로와 파일 이름을 합치기
  let combinedPath;
  if (posixMode) {
    combinedPath = path.posix.join(...pathSegments, fileName);
  } else {
    combinedPath = path.join(...pathSegments, fileName);
  }

  return combinedPath;
}
