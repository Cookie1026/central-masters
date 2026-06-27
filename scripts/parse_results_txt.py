"""
大会結果TXT → CSV変換スクリプト（第80回長水路フォーマット対応）

使い方:
  python scripts/parse_results_txt.py <TXTファイルパス> <大会回数> <水路>
例:
  python scripts/parse_results_txt.py "マスターズPDF/第80回(長水路)/backup/1-第80回PNG画像を文字起こし.txt" 80 長水路

出力CSV（同フォルダに generated/ サブフォルダを作成して出力）:
  team_standings.csv     チーム総合成績
  individual_results.csv 個人競技結果
  relay_results.csv      リレー結果
  relay_members.csv      リレーメンバー
  athletes.csv           選手一覧（重複除去）
  teams.csv              チーム一覧（重複除去）
"""

import sys
import re
import csv
from pathlib import Path
from dataclasses import dataclass
from typing import Optional

# Windows PowerShell でも日本語を正しく出力する
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

CIRCLED_NUM = {'①': 1, '②': 2, '③': 3, '④': 4}


# ============================================================
# ユーティリティ
# ============================================================

def time_to_seconds(time_str: str) -> Optional[float]:
    """'3:53.04' or '53.04' -> 秒数。変換不能は None"""
    if not time_str:
        return None
    s = time_str.strip()
    if s in ('棄権', '失格', 'DNS', 'DNF', 'DQ', '－', '-', ''):
        return None
    m = re.search(r'(\d+:\d+\.\d+|\d+\.\d+)', s)
    if not m:
        return None
    s = m.group(1)
    try:
        if ':' in s:
            mins, secs = s.split(':')
            return int(mins) * 60 + float(secs)
        return float(s)
    except ValueError:
        return None


# ============================================================
# データクラス
# ============================================================

@dataclass
class TeamStanding:
    round: int
    pool_type: str
    rank: int
    team_name: str
    furigana: str
    total_points: float
    male_points: float
    female_points: float
    mixed_points: float


@dataclass
class IndividualResult:
    round: int
    pool_type: str
    race_no: int
    gender: str
    event_name: str
    age_group: str
    world_record: str
    japan_record: str
    meet_record: str
    rank: Optional[int]
    athlete_name: str
    team_name: str
    lane: str
    time_display: str
    time_seconds: Optional[float]
    is_meet_record: bool
    is_japan_record: bool
    is_world_record: bool
    points_w: Optional[float]
    points_n: Optional[float]
    dive_time: Optional[float]
    lap_times: str
    is_dnf: bool = False


@dataclass
class RelayResult:
    round: int
    pool_type: str
    race_no: int
    gender: str
    event_name: str
    age_group_label: str
    world_record: str
    japan_record: str
    meet_record: str
    rank: int
    team_name: str
    combined_age: int
    lane: str
    time_display: str
    time_seconds: Optional[float]
    is_meet_record: bool
    is_japan_record: bool
    is_world_record: bool
    lap_times: str


@dataclass
class RelayMember:
    relay_key: str
    swim_order: int
    athlete_name: str
    dive_time: Optional[float]
    split_display: str
    split_seconds: Optional[float]
    is_record: bool = False


# ============================================================
# 正規表現パターン
# ============================================================

RE_PAGE       = re.compile(r'={30,}\s*Page\s+\d+\s*={30,}')
RE_RACE_HDR   = re.compile(r'^\s*No\.\s*(\d+)\s+(男子|女子|混合)\s+(.+?)(?:\s{3,}.*)?$')
RE_AGE_GROUP  = re.compile(r'[<≪《]\s*(.+?)\s*[>≫》]{1,2}')
RE_WORLD_REC  = re.compile(r'世界記録\s+([\d:\.]+)')
RE_JAPAN_REC  = re.compile(r'日本記録\s+([\d:\.]+)')
RE_MEET_REC   = re.compile(r'大会記録\s+([\d:\.]+)')
RE_LANE       = re.compile(r'(\d+/\s*\d+)')
RE_TIME       = re.compile(r'(\d+:\d+\.\d+|\d+\.\d{2})')
RE_DNF        = re.compile(r'棄権|失格|DNS|DNF|DQ')
RE_TEAM_RANK  = re.compile(
    r'^\s*(\d+)位\s+(.+?)\s{2,}(.+?)\s{2,}([\d\.]+)点\s+([\d\.]+)点\s+([\d\.]+)点\s+([\d\.]+)点'
)
# 第78回 2行形式A: 前行=フリガナ(カタカナ)、当行=順位+チーム名+合計点
RE_TEAM_RANK2 = re.compile(r'^\s+(\d+)位\s+(.+?)\s{2,}([\d\.]+)点\s*$')
# 第79回 2行形式B: 当行=順位+フリガナ、次行=チーム名+合計点
RE_TEAM_RANK3A = re.compile(r'^\s+(\d+)位\s+([^\s].+?)\s*$')         # rank + furigana (no 点)
RE_TEAM_RANK3B = re.compile(r'^\s{6,}(.+?)\s{2,}([\d\.]+)点\s*$')    # name + points
RE_RELAY_TEAM = re.compile(
    r'^\s{0,6}(\d+)\s+(.+?)\s{2,}(\d+)歳\s+(\d+/\s*\d+)\s+([\d:\.]+)\s*(.*)'
)
RE_RELAY_MBR  = re.compile(
    r'^\s{5,}([1-4①②③④])\s+(.+?)(?:\s+(?:\(\s*([+\-]?[\d\.]+|-{3,})\s*\))?\s+([\d:\.]+)\s*(.*))?\s*$'
)
RE_LAP_LINE   = re.compile(r'^\s{20,}([\d:\.]+)(\s+[\d:\.]+)+\s*$')
RE_POINTS     = re.compile(r'(\d+)\s*/\s*(\d+)\s*(?:\(\s*([\d\.]+)\s*\))?')
RE_DIVE_ONLY  = re.compile(r'\(\s*(0\.\d+|1\.\d+)\s*\)')  # FINAポイントなしの飛込タイム (0.xx〜1.xx秒)


# ============================================================
# パーサークラス
# ============================================================

class ResultsParser:
    def __init__(self, round_no: int, pool_type: str):
        self.round_no  = round_no
        self.pool_type = pool_type
        self.team_standings:     list[TeamStanding]     = []
        self.individual_results: list[IndividualResult] = []
        self.relay_results:      list[RelayResult]      = []
        self.relay_members:      list[RelayMember]      = []

    # ----------------------------------------------------------
    def parse_file(self, txt_path: str):
        with open(txt_path, encoding='utf-8') as f:
            raw = f.read()

        parts = RE_PAGE.split(raw)
        pages = [p.splitlines() for p in parts if p.strip()]
        print(f"ページ数: {len(pages)}")

        # 総合成績ページは個別処理、競技ページは全行を連結処理
        # （ページをまたぐリレーチームのメンバー行が正しく取得できるよう）
        all_race_lines: list[str] = []
        for lines in pages:
            content = '\n'.join(lines)
            if '男 女 総 合 成 績' in content:
                self._parse_standings_page(lines)
            else:
                all_race_lines.extend(lines)

        self._parse_race_page(all_race_lines)

    # ----------------------------------------------------------
    def _parse_standings_page(self, lines: list[str]):
        prev_line = ''
        pending_rank: Optional[int] = None   # 第79回形式B用
        pending_furi: str = ''
        for line in lines:
            # 1行形式（第74〜77回）: 順位+チーム名+フリガナ+男女混合点
            m = RE_TEAM_RANK.match(line)
            if m:
                pending_rank = None
                self.team_standings.append(TeamStanding(
                    round=self.round_no, pool_type=self.pool_type,
                    rank=int(m.group(1)),
                    team_name=m.group(2).strip(), furigana=m.group(3).strip(),
                    total_points=float(m.group(4)), male_points=float(m.group(5)),
                    female_points=float(m.group(6)), mixed_points=float(m.group(7)),
                ))
            else:
                # 第79回形式B 行2: チーム名+合計点（直前にpending_rankあり）
                if pending_rank is not None:
                    mb = RE_TEAM_RANK3B.match(line)
                    if mb:
                        self.team_standings.append(TeamStanding(
                            round=self.round_no, pool_type=self.pool_type,
                            rank=pending_rank,
                            team_name=mb.group(1).strip(), furigana=pending_furi,
                            total_points=float(mb.group(2)),
                            male_points=0, female_points=0, mixed_points=0,
                        ))
                        pending_rank = None
                        prev_line = line
                        continue
                    else:
                        pending_rank = None  # マッチしなければリセット

                # 第78回形式A: 前行=フリガナ、当行=順位+チーム名+合計点のみ
                m2 = RE_TEAM_RANK2.match(line)
                if m2:
                    furigana = prev_line.strip()
                    self.team_standings.append(TeamStanding(
                        round=self.round_no, pool_type=self.pool_type,
                        rank=int(m2.group(1)),
                        team_name=m2.group(2).strip(), furigana=furigana,
                        total_points=float(m2.group(3)),
                        male_points=0, female_points=0, mixed_points=0,
                    ))
                else:
                    # 第79回形式B 行1: 順位+フリガナ（点なし）
                    ma = RE_TEAM_RANK3A.match(line)
                    if ma and '点' not in line:
                        pending_rank = int(ma.group(1))
                        pending_furi = ma.group(2).strip()

            prev_line = line

    # ----------------------------------------------------------
    def _parse_race_page(self, lines: list[str]):
        i = 0
        while i < len(lines):
            line = lines[i]
            m = RE_RACE_HDR.match(line)
            if not m:
                i += 1
                continue

            race_no    = int(m.group(1))
            gender     = m.group(2)
            event_name = m.group(3).strip()

            world_rec = ''
            japan_rec = ''
            meet_rec  = ''
            age_group = ''

            wr = RE_WORLD_REC.search(line)
            if wr:
                world_rec = wr.group(1)

            for j in range(i + 1, min(i + 6, len(lines))):
                l = lines[j]
                if not world_rec:
                    t = RE_WORLD_REC.search(l)
                    if t: world_rec = t.group(1)
                if not japan_rec:
                    t = RE_JAPAN_REC.search(l)
                    if t: japan_rec = t.group(1)
                if not meet_rec:
                    t = RE_MEET_REC.search(l)
                    if t: meet_rec = t.group(1)
                if not age_group:
                    t = RE_AGE_GROUP.search(l)
                    if t: age_group = t.group(1).strip()
                if age_group and japan_rec and meet_rec:
                    break

            is_relay = 'リレー' in event_name or 'x' in event_name or 'X' in event_name
            if is_relay:
                i = self._parse_relay_race(
                    lines, i + 1, race_no, gender, event_name,
                    age_group, world_rec, japan_rec, meet_rec
                )
            else:
                i = self._parse_individual_race(
                    lines, i + 1, race_no, gender, event_name,
                    age_group, world_rec, japan_rec, meet_rec
                )
        return i

    # ----------------------------------------------------------
    def _split_rank_name_team(self, text: str):
        """'1 佐藤由利子   セ・用賀' -> (1, '佐藤由利子', 'セ・用賀')"""
        text = text.strip()
        rank = None
        rm = re.match(r'^(\d+)\s+(.*)', text)
        if rm:
            rank = int(rm.group(1))
            text = rm.group(2).strip()
        # チーム名は必ず最後のトークン。rsplit で右から1回分割する
        # （名前内スペースが2〜6個、名前→チーム間が1〜10個と幅があるため
        #   固定スペース数での split は使えない）
        parts = text.rsplit(None, 1)
        if len(parts) == 2:
            name_raw, team = parts
            # 姓名の間のスペースはすべて削除（OCRスペース数揺れによる重複防止）
            name = re.sub(r'\s+', '', name_raw.strip())
        else:
            name = text.strip()
            team = ''
        return rank, name, team

    # ----------------------------------------------------------
    def _parse_individual_race(self, lines, start, race_no, gender,
                                event_name, age_group, world_rec, japan_rec, meet_rec) -> int:
        i = start
        last: Optional[IndividualResult] = None

        while i < len(lines):
            line = lines[i]

            if RE_RACE_HDR.match(line):
                return i

            # 年齢区分の更新（同一種目内に複数年齢区分がある場合）
            age_m = RE_AGE_GROUP.search(line)
            if age_m:
                age_group = age_m.group(1).strip()
                i += 1
                continue

            # LAPタイム行
            if last and RE_LAP_LINE.match(line):
                laps = RE_TIME.findall(line)
                last.lap_times = ','.join(laps)
                i += 1
                continue

            # レーンパターンがある行を結果行候補とする
            lane_m = RE_LANE.search(line)
            if not lane_m:
                i += 1
                continue

            lane   = lane_m.group(1).replace(' ', '')
            before = line[:lane_m.start()].strip()
            after  = line[lane_m.end():].strip()

            rank, name, team = self._split_rank_name_team(before)
            if not name:
                i += 1
                continue

            is_dnf = bool(RE_DNF.search(after)) or bool(RE_DNF.search(line))
            time_raw = ''
            rest = after
            if not is_dnf:
                tm = RE_TIME.search(after)
                if tm:
                    time_raw = tm.group(1)
                    rest = after[tm.end():]

            is_meet_rec  = '大会新' in line
            is_japan_rec = '日本新' in line
            is_world_rec = '世界新' in line

            pts_m = RE_POINTS.search(rest)
            points_w  = float(pts_m.group(1)) if pts_m else None
            points_n  = float(pts_m.group(2)) if pts_m else None
            if pts_m and pts_m.group(3):
                dive_time = float(pts_m.group(3))
            else:
                # FINAポイントなし形式 "(0.95)" のみのフォールバック
                dive_m = RE_DIVE_ONLY.search(rest)
                dive_time = float(dive_m.group(1)) if dive_m else None

            last = IndividualResult(
                round=self.round_no, pool_type=self.pool_type,
                race_no=race_no, gender=gender, event_name=event_name,
                age_group=age_group, world_record=world_rec,
                japan_record=japan_rec, meet_record=meet_rec,
                rank=rank, athlete_name=name, team_name=team, lane=lane,
                time_display=time_raw, time_seconds=time_to_seconds(time_raw),
                is_meet_record=is_meet_rec, is_japan_record=is_japan_rec,
                is_world_record=is_world_rec,
                points_w=points_w, points_n=points_n, dive_time=dive_time,
                lap_times='', is_dnf=is_dnf,
            )
            self.individual_results.append(last)
            i += 1

        return i

    # ----------------------------------------------------------
    def _parse_relay_race(self, lines, start, race_no, gender,
                           event_name, age_group, world_rec, japan_rec, meet_rec) -> int:
        i = start
        current: Optional[RelayResult] = None

        while i < len(lines):
            line = lines[i]

            if RE_RACE_HDR.match(line):
                return i

            # 年齢区分の更新
            age_m = RE_AGE_GROUP.search(line)
            if age_m:
                age_group = age_m.group(1).strip()
                i += 1
                continue

            # LAPタイム行
            if current and RE_LAP_LINE.match(line):
                laps = RE_TIME.findall(line)
                current.lap_times = ','.join(laps)
                i += 1
                continue

            # リレーチーム結果行（メンバー行より先にチェック：5スペース+数字の競合を避ける）
            rm = RE_RELAY_TEAM.match(line)
            if rm:
                current = RelayResult(
                    round=self.round_no, pool_type=self.pool_type,
                    race_no=race_no, gender=gender, event_name=event_name,
                    age_group_label=age_group, world_record=world_rec,
                    japan_record=japan_rec, meet_record=meet_rec,
                    rank=int(rm.group(1)), team_name=rm.group(2).strip(),
                    combined_age=int(rm.group(3)),
                    lane=rm.group(4).replace(' ', ''),
                    time_display=rm.group(5).strip(),
                    time_seconds=time_to_seconds(rm.group(5)),
                    is_meet_record='大会新' in line,
                    is_japan_record='日本新' in line,
                    is_world_record='世界新' in line,
                    lap_times='',
                )
                self.relay_results.append(current)
                i += 1
                continue

            # リレーメンバー行（深いインデント + 泳順番号 1-4 or ①②③④）
            mbr = RE_RELAY_MBR.match(line)
            if mbr and current:
                order_raw = mbr.group(1)
                order = CIRCLED_NUM.get(order_raw, int(order_raw) if order_raw.isdecimal() else 0)
                name     = re.sub(r'\s+', '', mbr.group(2).strip())
                dive_raw  = mbr.group(3)
                split_raw = (mbr.group(4) or '').strip()
                rest_mbr  = mbr.group(5) or ''

                dive_val = None
                if dive_raw and not re.match(r'-{3,}', dive_raw):
                    try:
                        dive_val = float(dive_raw)
                    except ValueError:
                        pass

                relay_key = f"{self.round_no}_{race_no}_{current.age_group_label}_{current.team_name}_{current.rank}"
                self.relay_members.append(RelayMember(
                    relay_key=relay_key, swim_order=order, athlete_name=name,
                    dive_time=dive_val, split_display=split_raw,
                    split_seconds=time_to_seconds(split_raw),
                    is_record='新' in rest_mbr,
                ))
                i += 1
                continue

            i += 1

        return i

    # ----------------------------------------------------------
    def save_csvs(self, out_dir: Path):
        out_dir.mkdir(exist_ok=True)

        self._write_csv(
            out_dir / 'team_standings.csv',
            ['round', 'pool_type', 'rank', 'team_name', 'furigana',
             'total_points', 'male_points', 'female_points', 'mixed_points'],
            [[s.round, s.pool_type, s.rank, s.team_name, s.furigana,
              s.total_points, s.male_points, s.female_points, s.mixed_points]
             for s in self.team_standings]
        )

        self._write_csv(
            out_dir / 'individual_results.csv',
            ['round', 'pool_type', 'race_no', 'gender', 'event_name', 'age_group',
             'world_record', 'japan_record', 'meet_record',
             'rank', 'athlete_name', 'team_name', 'lane',
             'time_display', 'time_seconds',
             'is_meet_record', 'is_japan_record', 'is_world_record',
             'points_w', 'points_n', 'dive_time', 'lap_times', 'is_dnf'],
            [[r.round, r.pool_type, r.race_no, r.gender, r.event_name, r.age_group,
              r.world_record, r.japan_record, r.meet_record,
              r.rank, r.athlete_name, r.team_name, r.lane,
              r.time_display, r.time_seconds,
              r.is_meet_record, r.is_japan_record, r.is_world_record,
              r.points_w, r.points_n, r.dive_time, r.lap_times, r.is_dnf]
             for r in self.individual_results]
        )

        self._write_csv(
            out_dir / 'relay_results.csv',
            ['round', 'pool_type', 'race_no', 'gender', 'event_name', 'age_group_label',
             'world_record', 'japan_record', 'meet_record',
             'rank', 'team_name', 'combined_age', 'lane',
             'time_display', 'time_seconds',
             'is_meet_record', 'is_japan_record', 'is_world_record', 'lap_times'],
            [[r.round, r.pool_type, r.race_no, r.gender, r.event_name, r.age_group_label,
              r.world_record, r.japan_record, r.meet_record,
              r.rank, r.team_name, r.combined_age, r.lane,
              r.time_display, r.time_seconds,
              r.is_meet_record, r.is_japan_record, r.is_world_record, r.lap_times]
             for r in self.relay_results]
        )

        self._write_csv(
            out_dir / 'relay_members.csv',
            ['relay_key', 'swim_order', 'athlete_name',
             'dive_time', 'split_display', 'split_seconds', 'is_record'],
            [[m.relay_key, m.swim_order, m.athlete_name,
              m.dive_time, m.split_display, m.split_seconds, m.is_record]
             for m in self.relay_members]
        )

        athletes: dict[tuple, dict] = {}
        for r in self.individual_results:
            key = (r.athlete_name, r.team_name, r.gender)
            athletes[key] = {'name': r.athlete_name, 'team': r.team_name, 'gender': r.gender}
        self._write_csv(
            out_dir / 'athletes.csv',
            ['name', 'team_name', 'gender'],
            [[a['name'], a['team'], a['gender']] for a in athletes.values()]
        )

        teams: dict[str, str] = {}
        for s in self.team_standings:
            teams[s.team_name] = s.team_name
        self._write_csv(
            out_dir / 'teams.csv',
            ['team_name'],
            [[t] for t in teams.keys()]
        )

        dnf_count = sum(1 for r in self.individual_results if r.is_dnf)
        print(f"\n=== 抽出結果 ===")
        print(f"チーム総合成績: {len(self.team_standings)}チーム")
        print(f"個人競技結果:   {len(self.individual_results)}件  (うち棄権/失格: {dnf_count}件)")
        print(f"リレー結果:     {len(self.relay_results)}チーム")
        print(f"リレーメンバー: {len(self.relay_members)}件")
        print(f"選手:           {len(athletes)}人")
        print(f"チーム:         {len(teams)}チーム")
        print(f"\nCSV出力先: {out_dir}")

    def _write_csv(self, path: Path, headers: list, rows: list):
        with open(path, 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.writer(f)
            w.writerow(headers)
            w.writerows(rows)


# ============================================================
# エントリーポイント
# ============================================================

if __name__ == '__main__':
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)

    txt_path  = sys.argv[1]
    round_no  = int(sys.argv[2])
    pool_type = sys.argv[3]

    txt_file = Path(txt_path)
    if not txt_file.exists():
        print(f"エラー: ファイルが見つかりません: {txt_path}")
        sys.exit(1)

    out_dir = txt_file.parent / 'generated'

    print(f"パース開始: {txt_file.name}")
    print(f"大会: 第{round_no}回 {pool_type}")

    parser = ResultsParser(round_no, pool_type)
    parser.parse_file(txt_path)
    parser.save_csvs(out_dir)
