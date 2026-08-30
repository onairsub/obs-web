export type SportKey = "soccer" | "basketball" | "baseball" | "volleyball";

export const SPORT_OPTIONS: { key: SportKey; label: string }[] = [
  { key: "soccer", label: "축구" },
  { key: "basketball", label: "농구" },
  { key: "baseball", label: "야구" },
  { key: "volleyball", label: "배구" },
];

export type SoccerSettings = {
  firstHalfMinutes: number;
  secondHalfMinutes: number;
  extraHalfMinutes: number;
};

export type BasketballSettings = {
  quarterMinutes: number;
  overtimeMinutes: number;
  shotClockSeconds: number;
  shortShotClockSeconds: number;
};

export type BaseballSettings = {
  regulationInnings: number;
};

export const DEFAULT_SOCCER_SETTINGS: SoccerSettings = {
  firstHalfMinutes: 45,
  secondHalfMinutes: 45,
  extraHalfMinutes: 15,
};

export const DEFAULT_BASKETBALL_SETTINGS: BasketballSettings = {
  quarterMinutes: 10,
  overtimeMinutes: 5,
  shotClockSeconds: 24,
  shortShotClockSeconds: 14,
};

export const DEFAULT_BASEBALL_SETTINGS: BaseballSettings = {
  regulationInnings: 9,
};

export const DEFAULT_VOLLEYBALL_SET_POINTS = [25, 25, 15];

export function isSportKey(value: unknown): value is SportKey {
  return SPORT_OPTIONS.some((sport) => sport.key === value);
}
