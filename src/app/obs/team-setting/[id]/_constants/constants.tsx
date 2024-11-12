export enum TeamSettingElementType {
  TEXT,
  IMAGE,
  VIDEO,
}

export type TeamSettingElement = {
  name: string;
  type: TeamSettingElementType;
  value: string;
};

export const OBSElementProperties: Record<TeamSettingElementType, string> = {
  [TeamSettingElementType.TEXT]: "text",
  [TeamSettingElementType.IMAGE]: "file",
  [TeamSettingElementType.VIDEO]: "local_file",
};
