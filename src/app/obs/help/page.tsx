"use client";

import { COMMON_OBS_SOURCES, OBSSource, SPORT_HELP } from "@/components/sports/sportHelp";
import { SPORT_OPTIONS, SportKey } from "@/components/sports/sportSettings";
import { ShortcutGuide } from "@/components/sports/ControllerShortcuts";
import Link from "next/link";
import { useLocalStorage } from "usehooks-ts";
import styles from "./page.module.css";

const SETUP_STEPS = [
  "OBS의 도구 → WebSocket 서버 설정에서 서버를 활성화합니다.",
  "아래 이름으로 텍스트 입력과 씬 아이템을 현재 프로그램 씬에 만듭니다.",
  "로그인 화면에 OBS와 같은 포트·비밀번호를 입력해 연결합니다.",
  "컨트롤러에서 장면을 선택하고 새로고침한 뒤 각 버튼을 시험합니다.",
];

export default function HelpPage() {
  const [sport, setSport] = useLocalStorage<SportKey>("OBS_SETTINGS_SPORT", "soccer");
  const help = SPORT_HELP[sport];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/obs/sports" aria-label="스포츠 선택으로 돌아가기">←</Link>
        <div><h1>OBS 소스 도움말</h1><p>종목별 소스 이름과 준비 방법</p></div>
      </header>

      <section className={styles.sportTabs} aria-label="도움말 종목">
        {SPORT_OPTIONS.map((item) => (
          <button key={item.key} className={sport === item.key ? styles.active : ""} onClick={() => setSport(item.key)}>{item.label}</button>
        ))}
      </section>

      <section className={styles.intro}>
        <span>{help.label}</span>
        <p>{help.summary}</p>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}><h2>처음 설정하기</h2><span>4 STEPS</span></div>
        <ol className={styles.steps}>
          {SETUP_STEPS.map((step, index) => <li key={step}><b>{index + 1}</b><span>{step}</span></li>)}
        </ol>
      </section>

      <SourceSection title="공통 소스" description="모든 종목에서 사용합니다." sources={COMMON_OBS_SOURCES} />
      <SourceSection title={`${help.label} 전용 소스`} description="사용할 기능에 해당하는 소스만 만들어도 됩니다." sources={help.sources} />

      <section className={styles.section}>
        <div className={styles.sectionHeader}><h2>키보드 단축키</h2></div>
        <p className={styles.notes}>컨트롤러의 키보드 단축키 메뉴에서 켜고 끌 수 있습니다. 조합키 없이, 같은 메뉴는 서로 붙어 있는 키로 조작합니다.</p>
        <ShortcutGuide sport={sport} />
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}><h2>운영 참고</h2></div>
        <ul className={styles.notes}>
          {help.notes.map((note) => <li key={note}>{note}</li>)}
          <li>이름은 대소문자와 언더스코어까지 정확히 일치해야 합니다.</li>
          <li>표시/숨김은 현재 프로그램 씬 안의 같은 이름 아이템에 적용됩니다.</li>
        </ul>
      </section>

      <div className={styles.actions}>
        <Link href={`/obs/${sport}`}>컨트롤러 열기</Link>
        <Link href="/obs/setting" className={styles.primary}>설정 열기</Link>
      </div>
    </main>
  );
}

function SourceSection({ title, description, sources }: { title: string; description: string; sources: OBSSource[] }) {
  return <section className={styles.section}>
    <div className={styles.sectionHeader}><div><h2>{title}</h2><p>{description}</p></div></div>
    <div className={styles.sources}>
      {sources.map((source) => <article className={styles.source} key={source.names.join("-")}>
        <div className={styles.sourceNames}>{source.names.map((name) => <code key={name}>{name}</code>)}</div>
        <span className={styles.sourceType}>{source.type}</span>
        <p>{source.description}</p>
      </article>)}
    </div>
  </section>;
}
