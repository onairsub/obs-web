export function combinePath(
  fullPath: string,
  fileName: string,
  posixMode: boolean = false
) {
  const separator = posixMode || !fullPath.includes("\\") ? "/" : "\\";
  const cleanFileName = fileName.replace(/^[/\\]+/, "");
  const cleanBase = fullPath.replace(/[/\\]+$/, "");
  if (cleanBase) return `${cleanBase}${separator}${cleanFileName}`;
  return fullPath.startsWith("/") || fullPath.startsWith("\\")
    ? `${separator}${cleanFileName}`
    : cleanFileName;
}
