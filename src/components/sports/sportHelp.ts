import { SportKey } from "./sportSettings";

export type OBSSource = {
  names: string[];
  type: "텍스트 입력" | "씬 아이템" | "텍스트 + 씬 아이템";
  description: string;
};

export type SportHelp = {
  label: string;
  summary: string;
  sources: OBSSource[];
  notes: string[];
};

export const COMMON_OBS_SOURCES: OBSSource[] = [
  { names: ["title"], type: "텍스트 입력", description: "선택한 경기 제목" },
  { names: ["team_A", "team_B"], type: "텍스트 입력", description: "A팀·B팀 이름" },
  { names: ["score_A", "score_B"], type: "텍스트 입력", description: "A팀·B팀 점수" },
];

export const SPORT_HELP: Record<SportKey, SportHelp> = {
  soccer: {
    label: "축구",
    summary: "득점, 경기 시계, 전·후반과 연장, 추가시간, 퇴장, 승부차기를 제어합니다.",
    sources: [
      { names: ["game_clock"], type: "텍스트 입력", description: "MM:SS 형식의 경기 시계" },
      { names: ["period"], type: "텍스트 입력", description: "전반 · HT · 후반 · 연장1 · 연장2 · PK · FT" },
      { names: ["added_time"], type: "텍스트 + 씬 아이템", description: "+N 형식의 추가시간. 0이면 숨김" },
      { names: ["red_cards_A", "red_cards_B"], type: "텍스트 입력", description: "A팀·B팀 퇴장 수" },
      { names: ["penalties_A", "penalties_B"], type: "텍스트 입력", description: "A팀·B팀 승부차기 득점" },
    ],
    notes: [
      "설정에서 전반·후반·연장 시간을 지정하면 컨트롤러의 시작 프리셋에 반영됩니다.",
      "added_time은 같은 이름의 텍스트 입력을 현재 씬에 올려 두어야 표시와 숨김이 함께 동작합니다.",
    ],
  },
  basketball: {
    label: "농구",
    summary: "게임클락과 샷클락을 독립적으로 운용하고 득점, 쿼터, 파울, 타임아웃, 공격권을 제어합니다.",
    sources: [
      { names: ["game_clock"], type: "텍스트 입력", description: "쿼터·연장 게임클락" },
      { names: ["shot_clock"], type: "텍스트 입력", description: "24/14초 샷클락. 5초 미만은 4.9 형식" },
      { names: ["period"], type: "텍스트 입력", description: "Q1 · Q2 · Q3 · Q4 · OT · FT" },
      { names: ["fouls_A", "fouls_B"], type: "텍스트 입력", description: "A팀·B팀 팀 파울" },
      { names: ["fouls_A_1 … fouls_A_9", "fouls_B_1 … fouls_B_9"], type: "씬 아이템", description: "팀 파울 수만큼 순서대로 표시되는 선택형 마커" },
      { names: ["timeouts_A", "timeouts_B"], type: "텍스트 입력", description: "A팀·B팀 타임아웃 숫자" },
      { names: ["possession_A", "possession_B"], type: "씬 아이템", description: "현재 공격권 팀의 표시 아이템" },
    ],
    notes: [
      "게임클락과 샷클락은 각각 시작·정지할 수 있고 둘 다 시작/정지 버튼도 제공합니다.",
      "실행 중인 게임클락과 샷클락은 리셋이나 ±1초 보정 후에도 계속 실행됩니다.",
      "샷클락은 0초가 되어도 RUN 상태를 유지하므로 24초·14초 재설정이나 직접 입력 후 바로 흘러갑니다. 일시정지 또는 둘 다 정지를 누른 경우에는 값을 바꿔도 정지 상태를 유지합니다.",
      "게임클락·샷클락 숫자를 더블클릭(모바일은 두 번 탭)하면 그 자리에서 입력할 수 있습니다. 게임클락은 분:초 또는 초, 샷클락은 초를 입력하세요. Enter나 바깥 클릭으로 적용, Esc로 취소합니다. 0.1초 단위로 보정하며 실행·정지 상태는 유지됩니다. 게임클락의 0초는 정지하고, 샷클락의 0초는 실행 상태를 유지합니다. 원격에서도 사용할 수 있습니다.",
      "원격 타이머는 호스트가 확정한 시간에 맞춰 표시됩니다. 동기화 중에는 조작이 잠시 비활성화됩니다.",
      "설정에서 쿼터·연장 시간과 기본·공격 리바운드 샷클락을 변경할 수 있습니다.",
      "다른 쿼터로 변경하면 양 팀 파울·타임아웃을 0으로 초기화합니다. 같은 쿼터를 다시 누르면 유지되며, 점수와 타이머는 바꾸지 않습니다.",
      "파울 마커는 필요한 개수만큼 fouls_A_N, fouls_B_N 씬 아이템을 준비하세요. 파울 수 이하의 마커만 표시됩니다.",
      "파울이 변경되면 텍스트·마커 반영 후 현재 프로그램 장면에 OBS에 설정된 전환을 한 번 적용합니다. 다른 미리보기 장면으로 전환하지 않으며, 최초 연결이나 같은 값의 재동기화에는 전환하지 않습니다.",
    ],
  },
  baseball: {
    label: "야구",
    summary: "득점, 이닝과 초·말, B/S/O, 주자, 안타, 실책을 제어합니다.",
    sources: [
      { names: ["inning"], type: "텍스트 입력", description: "현재 이닝 숫자" },
      { names: ["inning_half"], type: "텍스트 입력", description: "TOP 또는 BOTTOM" },
      { names: ["balls", "strikes", "outs"], type: "텍스트 입력", description: "볼 · 스트라이크 · 아웃 카운트" },
      { names: ["hits_A", "hits_B"], type: "텍스트 입력", description: "A팀·B팀 안타" },
      { names: ["errors_A", "errors_B"], type: "텍스트 입력", description: "A팀·B팀 실책" },
      { names: ["base_1", "base_2", "base_3"], type: "씬 아이템", description: "1·2·3루 주자 표시" },
    ],
    notes: [
      "네 번째 볼과 세 번째 스트라이크는 타석 카운트를 자동으로 초기화합니다.",
      "세 번째 아웃은 주자를 비우고 공수를 교대하며, 설정에서 정규 이닝 수를 변경할 수 있습니다.",
    ],
  },
  volleyball: {
    label: "배구",
    summary: "득점, 세트 승수, 서브권, 타임아웃, 세트포인트와 매치포인트를 제어합니다.",
    sources: [
      { names: ["set"], type: "텍스트 입력", description: "1 SET 형식의 현재 세트" },
      { names: ["sets_A", "sets_B"], type: "텍스트 입력", description: "A팀·B팀 세트 승수" },
      { names: ["timeouts_A", "timeouts_B"], type: "텍스트 입력", description: "A팀·B팀 타임아웃 사용 수" },
      { names: ["serve_A", "serve_B"], type: "씬 아이템", description: "현재 서브권 팀의 표시 아이템" },
      { names: ["time_out"], type: "씬 아이템", description: "타임아웃 배너" },
      { names: ["timeout_team"], type: "텍스트 입력", description: "타임아웃 팀 이름" },
      { names: ["set_point", "match_point"], type: "씬 아이템", description: "세트·매치포인트 배너" },
      { names: ["point_team"], type: "텍스트 입력", description: "세트·매치포인트 팀 이름" },
      { names: ["set_A_1", "set_A_2", "set_A_3"], type: "씬 아이템", description: "A팀 세트 승 표시" },
      { names: ["set_B_1", "set_B_2", "set_B_3"], type: "씬 아이템", description: "B팀 세트 승 표시" },
    ],
    notes: [
      "설정에서 세트 수와 세트별 목표 점수를 변경할 수 있으며 항상 2점 차 승리를 적용합니다.",
      "사용할 세트 승 표시 개수만큼 set_A_N, set_B_N 씬 아이템을 준비하세요.",
    ],
  },
};
