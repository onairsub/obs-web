"use client";

import {
  BaseballSettings,
  BasketballSettings,
  DEFAULT_BASEBALL_SETTINGS,
  DEFAULT_BASKETBALL_SETTINGS,
  DEFAULT_SOCCER_SETTINGS,
  DEFAULT_VOLLEYBALL_SET_POINTS,
  isSportKey,
  SoccerSettings,
  SPORT_OPTIONS,
  SportKey,
} from "@/components/sports/sportSettings";
import Link from "next/link";
import { ChangeEvent, useRef } from "react";
import { useLocalStorage } from "usehooks-ts";
import styles from "./page.module.css";

const DEFAULT_TITLES = ["친선 경기", "준결승", "결승"];
const DEFAULT_TEAMS = ["HOME", "AWAY"];

function replaceAt<T>(items: T[], index: number, value: T) {
  return items.map((item, itemIndex) => itemIndex === index ? value : item);
}

function positiveNumber(value: string, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, number) : fallback;
}

export default function SettingPage() {
  const [sport, setSport] = useLocalStorage<SportKey>("OBS_SETTINGS_SPORT", "soccer");
  const [titleList, setTitleList] = useLocalStorage("OBS_TITLE_LIST", DEFAULT_TITLES);
  const [teamList, setTeamList] = useLocalStorage("OBS_TEAM_LIST", DEFAULT_TEAMS);
  const [soccer, setSoccer] = useLocalStorage<SoccerSettings>("OBS_SOCCER_CONFIG", DEFAULT_SOCCER_SETTINGS);
  const [basketball, setBasketball] = useLocalStorage<BasketballSettings>("OBS_BASKETBALL_CONFIG", DEFAULT_BASKETBALL_SETTINGS);
  const [baseball, setBaseball] = useLocalStorage<BaseballSettings>("OBS_BASEBALL_CONFIG", DEFAULT_BASEBALL_SETTINGS);
  const [volleyballSetPoints, setVolleyballSetPoints] = useLocalStorage("OBS_SET_LIST", DEFAULT_VOLLEYBALL_SET_POINTS);
  const fileInput = useRef<HTMLInputElement>(null);

  const sportLabel = SPORT_OPTIONS.find((item) => item.key === sport)?.label ?? sport;

  const currentSportSettings = () => {
    if (sport === "soccer") return soccer;
    if (sport === "basketball") return basketball;
    if (sport === "baseball") return baseball;
    return { setPoints: volleyballSetPoints };
  };

  const saveSettings = () => {
    const payload = {
      version: 3,
      sport,
      sportLabel,
      savedAt: new Date().toISOString(),
      titleList,
      teamList,
      settings: currentSportSettings(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `obs-${sport}-settings.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const applyLoadedSettings = (data: Record<string, unknown>) => {
    if (Array.isArray(data.titleList)) setTitleList(data.titleList.filter((item): item is string => typeof item === "string"));
    if (Array.isArray(data.teamList)) setTeamList(data.teamList.filter((item): item is string => typeof item === "string"));

    const loadedSport = isSportKey(data.sport) ? data.sport : Array.isArray(data.setList) ? "volleyball" : sport;
    setSport(loadedSport);
    const settings = data.settings && typeof data.settings === "object" ? data.settings as Record<string, unknown> : data;

    if (loadedSport === "soccer") {
      setSoccer({
        firstHalfMinutes: positiveNumber(String(settings.firstHalfMinutes ?? DEFAULT_SOCCER_SETTINGS.firstHalfMinutes)),
        secondHalfMinutes: positiveNumber(String(settings.secondHalfMinutes ?? DEFAULT_SOCCER_SETTINGS.secondHalfMinutes)),
        extraHalfMinutes: positiveNumber(String(settings.extraHalfMinutes ?? DEFAULT_SOCCER_SETTINGS.extraHalfMinutes)),
      });
    }
    if (loadedSport === "basketball") {
      setBasketball({
        quarterMinutes: positiveNumber(String(settings.quarterMinutes ?? DEFAULT_BASKETBALL_SETTINGS.quarterMinutes)),
        overtimeMinutes: positiveNumber(String(settings.overtimeMinutes ?? DEFAULT_BASKETBALL_SETTINGS.overtimeMinutes)),
        shotClockSeconds: positiveNumber(String(settings.shotClockSeconds ?? DEFAULT_BASKETBALL_SETTINGS.shotClockSeconds)),
        shortShotClockSeconds: positiveNumber(String(settings.shortShotClockSeconds ?? DEFAULT_BASKETBALL_SETTINGS.shortShotClockSeconds)),
      });
    }
    if (loadedSport === "baseball") {
      setBaseball({ regulationInnings: positiveNumber(String(settings.regulationInnings ?? DEFAULT_BASEBALL_SETTINGS.regulationInnings)) });
    }
    if (loadedSport === "volleyball") {
      const points = Array.isArray(settings.setPoints)
        ? settings.setPoints
        : Array.isArray(data.setList)
          ? data.setList
          : DEFAULT_VOLLEYBALL_SET_POINTS;
      setVolleyballSetPoints(points.map((point) => positiveNumber(String(point))));
    }
  };

  const loadSettings = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!data || typeof data !== "object") throw new Error("Invalid settings");
        applyLoadedSettings(data);
      } catch {
        window.alert("올바른 설정 파일이 아닙니다.");
      }
      event.target.value = "";
    };
    reader.readAsText(file);
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/obs/sports" aria-label="스포츠 선택으로 돌아가기">←</Link>
        <div><h1>경기 설정</h1><p>종목별 컨트롤 기본값</p></div>
      </header>

      <section className={styles.sportTabs} aria-label="설정할 종목">
        {SPORT_OPTIONS.map((item) => (
          <button key={item.key} className={sport === item.key ? styles.active : ""} onClick={() => setSport(item.key)}>{item.label}</button>
        ))}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}><div><h2>{sportLabel} 설정</h2><p>컨트롤러의 타이머와 경기 규칙에 바로 반영됩니다.</p></div></div>
        {sport === "soccer" && <div className={styles.fieldGrid}>
          <NumberField label="전반 시간" unit="분" value={soccer.firstHalfMinutes} onChange={(value) => setSoccer((current) => ({ ...current, firstHalfMinutes: value }))} />
          <NumberField label="후반 시간" unit="분" value={soccer.secondHalfMinutes} onChange={(value) => setSoccer((current) => ({ ...current, secondHalfMinutes: value }))} />
          <NumberField label="연장 전·후반" unit="분" value={soccer.extraHalfMinutes} onChange={(value) => setSoccer((current) => ({ ...current, extraHalfMinutes: value }))} />
        </div>}
        {sport === "basketball" && <div className={styles.fieldGrid}>
          <NumberField label="쿼터 시간" unit="분" value={basketball.quarterMinutes} onChange={(value) => setBasketball((current) => ({ ...current, quarterMinutes: value }))} />
          <NumberField label="연장 시간" unit="분" value={basketball.overtimeMinutes} onChange={(value) => setBasketball((current) => ({ ...current, overtimeMinutes: value }))} />
          <NumberField label="기본 샷클락" unit="초" value={basketball.shotClockSeconds} onChange={(value) => setBasketball((current) => ({ ...current, shotClockSeconds: value }))} />
          <NumberField label="공격 리바운드" unit="초" value={basketball.shortShotClockSeconds} onChange={(value) => setBasketball((current) => ({ ...current, shortShotClockSeconds: value }))} />
        </div>}
        {sport === "baseball" && <div className={styles.fieldGrid}>
          <NumberField label="정규 이닝" unit="회" value={baseball.regulationInnings} onChange={(value) => setBaseball({ regulationInnings: value })} />
        </div>}
        {sport === "volleyball" && <div className={styles.listFields}>
          {volleyballSetPoints.map((point, index) => <div className={styles.listRow} key={index}>
            <span>{index + 1}세트</span>
            <input type="number" min={1} value={point} onChange={(event) => setVolleyballSetPoints((current) => replaceAt(current, index, positiveNumber(event.target.value)))} />
            <span>점</span>
            <button aria-label={`${index + 1}세트 삭제`} onClick={() => setVolleyballSetPoints((current) => current.filter((_, itemIndex) => itemIndex !== index))}>삭제</button>
          </div>)}
          <button className={styles.addButton} onClick={() => setVolleyballSetPoints((current) => [...current, 25])}>세트 추가</button>
        </div>}
      </section>

      <StringListSection title="경기 목록" description="제목 선택 메뉴에 표시됩니다." items={titleList} setItems={setTitleList} placeholder="경기 이름" addLabel="경기 추가" />
      <StringListSection title="팀 목록" description="모든 종목의 A팀·B팀 선택 메뉴에 표시됩니다." items={teamList} setItems={setTeamList} placeholder="팀 이름" addLabel="팀 추가" />

      <section className={styles.fileActions}>
        <input ref={fileInput} type="file" accept="application/json,.json" onChange={loadSettings} hidden />
        <button onClick={() => fileInput.current?.click()}>LOAD SETTINGS</button>
        <button className={styles.saveButton} onClick={saveSettings}>SAVE {sport.toUpperCase()} SETTINGS</button>
        <p>저장 파일명과 JSON의 `sport` 필드에 {sportLabel} 종목이 기록됩니다.</p>
      </section>

      <Link href="/obs/help" className={styles.helpLink}>OBS 소스 이름과 설정법 보기 →</Link>
    </main>
  );
}

function NumberField({ label, unit, value, onChange }: { label: string; unit: string; value: number; onChange: (value: number) => void }) {
  return <label className={styles.numberField}><span>{label}</span><div><input type="number" min={1} value={value} onChange={(event) => onChange(positiveNumber(event.target.value, value))} /><b>{unit}</b></div></label>;
}

function StringListSection({ title, description, items, setItems, placeholder, addLabel }: {
  title: string;
  description: string;
  items: string[];
  setItems: (value: string[] | ((current: string[]) => string[])) => void;
  placeholder: string;
  addLabel: string;
}) {
  return <section className={styles.section}>
    <div className={styles.sectionHeader}><div><h2>{title}</h2><p>{description}</p></div></div>
    <div className={styles.listFields}>
      {items.map((item, index) => <div className={styles.textRow} key={index}>
        <input value={item} placeholder={placeholder} onChange={(event) => setItems((current) => replaceAt(current, index, event.target.value))} />
        <button aria-label={`${item || placeholder} 삭제`} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}>삭제</button>
      </div>)}
      <button className={styles.addButton} onClick={() => setItems((current) => [...current, ""])}>{addLabel}</button>
    </div>
  </section>;
}
