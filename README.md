# OBS Controller (Next.js)

OBS Studio(28.1.2+ 내장 WebSocket v5)를 로컬에서 실시간으로 제어하는 웹 앱입니다. 점수판 텍스트(score_A/score_B/set), 팀/경기별 자산(이미지/비디오/텍스트), 씬 아이템(time_out, match_point, set_point, set_A_1..3, set_B_1..3) 표시/숨김 및 씬 전환을 지원합니다.

이 문서는 다음을 안내합니다.

- OBS(WebSocket v5) 설정 방법과 인증 절차
- 실시간으로 바꾸고자 하는 요소의 소스/입력(입력=Input) 이름 규칙
- 앱 사용법(로그인 → 대시보드 → 세팅/팀/매치 편집)
- 로컬 자산 경로 설정 및 파일 매칭 방식
- 점수판/세트/세트포인트/매치포인트 표시 로직
- 제약 사항과 트러블슈팅

## 요구 사항

- OBS Studio 28.1.2 이상 (내장 OBS WebSocket v5 프로토콜 사용)
- 동일 PC에서 앱과 OBS를 함께 실행(현재 원격 호스트 미지원, localhost 전용)
- 기본 WebSocket 포트: 4455 (OBS와 앱에서 동일 값 사용)
- 비밀번호 사용 시 앱 로그인 페이지에 동일 비밀번호 입력

## 빠른 시작

1. 의존성 설치 및 개발 서버 실행

```bash
npm install
npm run dev
# 또는
yarn
yarn dev
# 또는
pnpm install
pnpm dev
# 또는
bun install
bun dev
```

2. 브라우저에서 http://localhost:3000/obs 접속

3. OBS(WebSocket) 설정 후 앱 로그인 화면에서 포트/비밀번호 입력 → CONNECT OBS

## OBS 설정하기 (WebSocket v5)

1. OBS 실행 → Settings(설정) → WebSocket Server 메뉴로 이동
2. Enable(활성화) 체크
3. Server Port: 4455(기본값 권장, 변경 시 앱 로그인 포트도 동일하게 입력)
4. Authentication(비밀번호) 사용 여부 선택
   - 비밀번호 사용: 앱 로그인 화면에 동일 비밀번호 입력 필요
   - 비밀번호 미사용: 앱에서 비밀번호 입력 칸은 비워둠
5. OBS에서 필요한 입력과 씬 아이템을 아래 ‘명명 규칙’대로 생성

인증 플로우 참고(내부 동작):

- Hello(op=0) 수신 → Identify(op=1) 전송 → Authenticated(op=2) 수신 시 연결 완료
- 비밀번호 사용 시 SHA256(password+salt)→base64 → SHA256(prev+challenge)→base64 로 인증 해시 생성

## OBS 소스/입력/씬 아이템 명명 규칙 (중요)

앱은 OBS의 이름(sourceName/inputName)을 정확히 키로 사용합니다. 이름 불일치 시 제어가 되지 않습니다.

필수 텍스트 입력(Input)

- title
- team_A
- team_B
- score_A
- score_B
- set
  권장 입력 종류: Text(GDI+) (SetInputSettings로 { text: "..." } 적용)
  표시/숨김 토글 대상 씬 아이템(Scene Item) 이름(소스명)
- time_out
- match_point
- set_point
- set_A_1, set_A_2, set_A_3
- set_B_1, set_B_2, set_B_3
- extra_time (추가시간 오버레이)
- timer_end (선택, 카운트다운 종료 시 1~2초 표시)
  설명: sceneItemId를 찾아 SetSceneItemEnabled로 표시/숨김 처리합니다. 현재 세트 승 표시 토글은 A/B 각각 3개까지 지원합니다.

타이머 관련 입력(Input)

- timer (Text(GDI+), 1초 주기로 "mm:ss" 텍스트 업데이트)

팀(Team) 세팅으로 추가되는 입력명 규칙

## 로컬 자산(Local Asset) 경로와 파일명 매칭

- 세팅 화면의 드롭존에서 선택한 파일은 “파일명만” 저장됩니다.
- OBS에 실제로 전달되는 경로는 Settings의 “local asset path”(베이스 경로)와 파일명을 결합하여 생성됩니다.
- 결합 규칙: combinePath(basePath, fileName)로 OS에 맞는 구분자를 사용해 안전하게 join

예시

- Windows: base=C:\Assets, file=teamA.png → C:\Assets\teamA.png
- macOS/Linux: base=/Users/john/Assets, file=teamA.png → /Users/john/Assets/teamA.png

사용 팁

- 먼저 베이스 경로 폴더를 정하고(예: C:\Assets), 그 폴더 안에 사용할 이미지/영상 파일을 복사해 둔 뒤, 세팅 화면에서 해당 파일을 선택하세요.

## 앱 사용법

1. 로그인(/obs/login)

- 포트(기본 4455)와 비밀번호(사용 시)를 입력 후 “CONNECT OBS”
- 인증 성공 시 자동으로 대시보드(/obs/dashboard)로 이동

2. 대시보드(/obs/dashboard)

- 좌측: OBS 씬 목록 → 클릭 시 SetCurrentProgramScene으로 즉시 전환
- 중앙: 경기 제목(title) 선택, 팀 A/B 선택, 점수 조작, 세트 종료/리셋/타임아웃 토글 등의 컨트롤
- 점수(score_A/score_B) 변경: 해당 텍스트 입력을 즉시 업데이트
- 현재 세트(set) 텍스트: “{n} SET” 형식으로 갱신
- 세트 종료(Finish set): sets 배열 갱신 후 점수 리셋
- 라운드 타입 판단에 따라 match_point 또는 set_point 씬 아이템을 표시/숨김
- set_A_1..3 / set_B_1..3: 현재 세트 승수를 기준으로 표시/숨김(최대 3개)
- 타이머 패널: 모드(Count Up/Down) 선택, Down 시작값(초) 입력, Start/Pause/Reset, +10s/-10s, Extra Time 토글 제공 <!-- 118.1 -->

3. 설정(/obs/setting)

- 경기 제목(titleList), 팀 목록(teamList), 세트 점수 배열(setList) 관리
- 팀/경기 세팅 페이지 이동 링크 제공
- Local Asset Path 설정(자산 경로 베이스)
- 설정 저장/로드(settings.json import/export) 지원

4. 팀 세팅(/obs/team-setting/[id])

- 팀별로 동적 요소를 정의
- name(예: logo), type(TEXT/IMAGE/VIDEO), value(텍스트 또는 파일명) 입력
- IMAGE/VIDEO는 드래그앤드롭으로 파일명 선택
- 실제 OBS 입력명은 {name}\_A와 {name}\_B 형태로 만들어야 앱이 제어합니다.

5. 매치 세팅(/obs/match-setting/[id])

- 경기별로 동적 요소를 정의(name 그대로 입력명 사용)
- type에 따라 TEXT/IMAGE/VIDEO를 선택하고 value 입력(텍스트 또는 파일명)

## 라운드 타입/표시 로직

- SET_POINT: 현재 세트 목표 점수에 한 점 모자란 상태에서 리드 중일 때
- MATCH_POINT: 다음 세트를 따면 승리 확정인 팀이 리드 중일 때
- NORMAL: 위 두 조건이 아닌 경우
- 결과에 따라 match_point 또는 set_point 씬 아이템을 표시/숨김합니다.

## 제약/주의사항

- 원격 호스트 미지원: ws://localhost:{port}만 연결 (동일 PC에서 OBS 실행 필수)
- OBS WebSocket v5 전용: v4와는 호환되지 않습니다.
- 세트 승 표시 아이템은 A/B 각각 최대 3개(set_A_1..3, set_B_1..3)까지만 지원
- 입력/씬 아이템 이름 불일치 시 제어 실패(대소문자/언더스코어 포함 정확히 일치 필요)
- 비밀번호 사용 시 앱에 동일 비밀번호를 입력해야 인증됩니다.
- 자산 교체(IMAGE/VIDEO)는 파일명을 저장하고, Settings의 Local Asset Path와 결합된 경로가 OBS에 적용됩니다.

- 타이머가 갱신되지 않음 <!-- 153.1 -->
  - OBS에 timer(Text(GDI+)) 입력이 존재하는지, 이름이 정확한지 확인 <!-- 153.2 -->
  - 1초 주기이며 동일 텍스트는 중복 전송을 생략합니다(lastTimerText 최적화). <!-- 153.3 -->
- Extra Time이 표시되지 않음 <!-- 153.4 -->
  - extra_time 씬 아이템이 현재 프로그램 씬에 존재하고 이름이 정확한지 확인 <!-- 153.5 -->
  - extra_time 씬 아이템이 현재 프로그램 씬에 존재하고 이름이 정확한지 확인 <!-- 153.5 -->

## 트러블슈팅

- AUTHENTICATED로 전환되지 않음
  - OBS Settings → WebSocket Server에서 Enable 활성화 여부 확인
  - 포트가 OBS와 앱에서 동일한지 확인(기본 4455)
  - 비밀번호 사용 시 앱 로그인에 동일 비밀번호를 입력했는지 확인
  - 비밀번호 미사용인데 앱에 값이 들어가 있거나 반대 상황인지 확인
- 점수/텍스트가 갱신되지 않음
  - 해당 입력(Input)이 Text(GDI+)인지 확인 및 입력명(title, team_A, team_B, score_A, score_B, set) 정확히 매칭
- 이미지/영상이 바뀌지 않음
  - IMAGE/VIDEO 입력 종류가 맞는지(Image Source/Media Source)
  - Settings의 Local Asset Path와 파일명이 올바르게 결합되는지 확인(실제 파일 위치 포함)
- set_A_x / set_B_x 토글이 반응하지 않음
  - 해당 소스가 현재 프로그램 씬에 존재하는지, 이름이 정확한지 확인

## 보안/데이터 보관

- 포트/비밀번호 등 접속 정보는 브라우저 LocalStorage(키: OBS-AUTH)에 저장됩니다. 공개 PC에서는 사용 후 삭제를 권장합니다.
- 세팅(titleList, teamList, setList, team/match settings, local asset path)은 LocalStorage에 저장되며 settings.json으로 export/import 가능합니다.

## 개발자 참고 (선택)

- 연결 상태 코드: CONNECTED(200), AUTHENTICATED(220), UNAUTHORIZED(401)
- 인증 해시 생성 및 Identify/Hello/Authenticated 핸들링, 요청/응답 버퍼링 등은 src/components/websocket 하위에서 처리됩니다.
- 주요 파일
  - src/components/websocket/WebSocketContext.tsx, WebSocketManager.ts
  - src/app/obs/dashboard/page.tsx, src/app/obs/dashboard/\_utils/pathParser.ts
  - src/app/obs/setting/page.tsx
  - src/app/obs/team-setting/[id]/\*\*, src/app/obs/match-setting/[id]/page.tsx

## 참고 링크

- OBS WebSocket API Document: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md#Requests
- OBS Studio 28.1.2 릴리스: https://github.com/obsproject/obs-studio/releases/tag/28.1.2

## 다른 종목 활용 가이드 (Multi-sport)

이 앱은 배구 중계를 위해 설계되었지만, 필드의 의미를 재해석하거나 일부 요소를 생략/대체함으로써 다양한 종목(농구, 축구, 야구, 라켓 종목, 이스포츠 등)에 활용 가능합니다. 아래 가이드를 참고해 필요한 입력/씬 아이템만 구성하고, 쓰지 않는 항목은 생성하지 않는 것을 권장합니다.

1. 필드 공용화 개념

- 실시간 업데이트(고정) 필드
  - 텍스트 입력: title, team_A, team_B, score_A, score_B, set("{n} SET" 형식)
  - 씬 아이템 토글: time_out(수동), match_point/set_point(자동 로직), set_A_1..3 / set_B_1..3(자동)
- 세팅 시 일괄 반영(동적 자산)
  - TeamSetting: {name}\_A, {name}\_B → TEXT/IMAGE/VIDEO
  - MatchSetting: {name} → TEXT/IMAGE/VIDEO
- 미사용 처리 원칙
  - OBS에 해당 이름의 입력/씬 아이템을 생성하지 않으면 앱의 제어가 화면에 영향을 주지 않습니다(로그만 남을 수 있음).
  - 자동 토글을 끄고 싶으면 setList를 [999, 999, ...]처럼 큰 값으로 설정하여 사실상 발생하지 않도록 할 수 있습니다.

2. 필드 재해석/활용 가이드

- score_A/B: 대부분 종목에서 득점/골/라운드 스코어로 직접 사용.
- set: 세트/피리어드/쿼터/전반·후반/맵 번호 등으로 재해석 가능. 단, 텍스트가 "{n} SET"로 고정이므로 다음 중 택1:
  - set 입력을 만들지 않아 미사용 처리
  - 그래픽에서 " SET" 문구 영역을 마스킹/크롭하여 숨김
  - "SET" 라벨이 어색하지 않게 디자인
- time_out: 임의의 이진 오버레이로 재활용 가능(VAR, INJURY, POWER PLAY 등). 소스명은 time_out 유지.
- match_point / set_point: 세트 기반 자동 토글 로직에 의존하므로 타 종목은 미사용 권장. 필요 시 목표치 근접 경고 등에 응용 가능.
- set_A_1..3 / set_B_1..3: 시리즈/세트 승수 라이트(최대 3개). Bo3에 적합, Bo5/Bo7에는 한계.
- Team/Match Setting: 로고, 컬러, 배너, 스폰서 등 경기 시작 전 고정 자산에 적합.

3. 종목별 적용 레시피
   A) 농구

- 사용: title, team_A/B, score_A/B, time_out(팀 타임아웃 오버레이 등)
- 선택: set → 피리어드(쿼터)로 재해석("1 SET" 허용 시), 하프타임은 씬 전환으로 연출
- 미사용: match*point, set_point, set_A/B*\*
- 세팅 팁: setList=[999,999,999,999]로 자동 토글 억제, 쿼터 라벨은 set 미사용 또는 " SET" 가리기

B) 축구(Football/Soccer)

- 사용: title, team_A/B, score_A/B
- 선택: time_out → VAR/INJURY/ET 등 이진 오버레이로 재활용
- 미사용: set, match*point, set_point, set_A/B*\*
- 세팅 팁: setList=[999,999] 권장, 전반/후반 표시는 별도 그래픽 또는 씬 전환 활용

C) 야구(Baseball)

- 사용: title, team_A/B, score_A/B(득점)
- 선택: time_out → 리뷰/교체 오버레이 등
- 미사용: set, match*point, set_point, set_A/B*\*
- 세팅 팁: setList=[999,999,999] 권장, 이닝/볼카운트는 현재 UI로 실시간 제어 불가(OBS 텍스트 수동 운영 또는 Match/TeamSetting에 텍스트 미리 반영)

D) 라켓 종목(테니스/배드민턴/탁구 등)

- 사용 권장: title, team_A/B, score_A/B(포인트/게임 수), set, set_A/B_1..3, time_out
- setList 예: 배드민턴/탁구 11 or 21 포인트 기준([11,11,11] 또는 [21,21,21]), 테니스 간이 운용 시 [6,6,6](2게임 차/타이브레이크 세부 규칙은 미지원)
- 자동 토글: set_point/match_point는 근사 로직으로 활용 가능(정확한 종목별 세부 룰 전부 반영 아님)

E) 이스포츠(LoL, Valorant 등)

- 사용: title, team_A/B, score_A/B(라운드/킬/목표 지표 등), set(맵 번호), set_A/B_1..3(맵 승수 라이트)
- setList 예: Bo3 기준 Valorant는 [13,13,13]
- 선택: time_out → 전술 타임아웃/텍 포즈 오버레이
- 주의: Bo5/Bo7은 set 라이트 3개 한계 → 확장 필요 시 코드 수정 필요

F) 핸드볼/하키/럭비 등 기타

- 사용: title, team_A/B, score_A/B
- 선택: time_out → 제재/파워플레이 오버레이
- 미사용: set, match*point, set_point, set_A/B*\*
- 세팅 팁: setList=[999,999]

4. 운영 팁(OBS/앱)

- 필요한 입력/씬 아이템만 만들기: 쓰지 않는 것은 생성하지 않기(오류 무시되며 화면 영향 없음)
- 자동 토글 억제: setList를 큰 값으로 설정해 set_point/match_point가 나오지 않게 함
- set 텍스트 보정: set 입력 미생성 또는 " SET" 영역 마스킹/크롭
- time_out 재활용: 소스명은 time_out 유지, 그래픽만 교체하면 간편
- Team/MatchSetting: 경기 시작 전 로고/배너/스폰서/컬러를 일괄 반영(실시간 수치 제어는 현재 미지원)
- 씬 전환: 전반/하프타임/세트 종료 연출은 대시보드의 씬 전환 버튼으로 처리

5. 현재 한계 및 주의(제약/주의사항도 함께 참고)

- 실시간 제어 필드 제한: score_A/B, set("{n} SET"), time_out 토글, set 라이트, match_point/set_point 자동 로직
- set 표기 고정: "{n} SET" 포맷 커스텀 불가
- 세트 승수 라이트: 팀별 최대 3개 고정
- 다중 카운터/타이머/볼카운트 등 커스텀 숫자 필드는 제공되지 않음
- Team/MatchSetting 값은 일괄 적용 성격(변경 즉시 실시간 반영 트리거 미제공)

6. 향후 개선 제안(옵션)

- set 라이트 가변 개수(Bo5/Bo7), 사용자 정의 토글 슬롯, 사용자 정의 숫자 카운터 추가
- set 텍스트 포맷 템플릿(예: "Q{n}", "H{n}", "MAP {n}")
- 원격 호스트 입력(로컬호스트 외 호스트/토큰)
- Team/MatchSetting의 변경 즉시 반영 옵션(SetInputSettings 트리거)

## 배포

- Next.js 표준 배포를 따릅니다. https://nextjs.org/docs/app/building-your-application/deploying
