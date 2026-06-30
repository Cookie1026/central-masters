"""
CSV → Supabase インポートスクリプト

事前準備:
  pip install supabase python-dotenv

使い方:
  python scripts/import_to_supabase.py <generatedフォルダパス> <大会日付 YYYY-MM-DD>
例:
  python scripts/import_to_supabase.py "マスターズPDF/第80回(長水路)/backup/generated" 2026-05-02

環境変数 (.env.local から自動読込):
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY
  SUPABASE_SERVICE_KEY  ← 管理者操作用（RLSをバイパス）。.env.local に追加してください。
"""

import sys
import csv
import os
import re
import unicodedata
from pathlib import Path
from typing import Optional
from difflib import get_close_matches


def norm_name(s: str) -> str:
    """スペース除去 + NFKC正規化（全角→半角など）"""
    return unicodedata.normalize('NFKC', re.sub(r'\s+', '', s.strip()))


_DASH_CHARS = '‐‑‒–—―−‐－'

def normalize_team_name(s: str) -> str:
    """チーム名の正規化: 半角カナ→全角 / ザパス→ザバス / 半角ASCII→全角 / ダッシュ統一"""
    s = unicodedata.normalize('NFKC', s.strip())
    s = s.replace('ザパス', 'ザバス')
    result = []
    for c in s:
        code = ord(c)
        if 0x21 <= code <= 0x7E:        # 半角ASCII → 全角
            result.append(chr(code + 0xFEE0))
        elif c in _DASH_CHARS:          # 各種ダッシュ → 全角ハイフン(FF0D)
            result.append('－')
        else:
            result.append(c)
    return ''.join(result)


def time_to_seconds(s: str) -> Optional[float]:
    """'3:53.04' or '53.04' -> float seconds. None if unparseable."""
    if not s or s.strip() in ('', 'None', 'NULL', '－', '-'):
        return None
    m = re.search(r'(\d+:\d+\.\d+|\d+\.\d+)', s.strip())
    if not m:
        return None
    t = m.group(1)
    try:
        if ':' in t:
            mins, secs = t.split(':')
            return int(mins) * 60 + float(secs)
        return float(t)
    except ValueError:
        return None

# dotenv から環境変数を読み込む
try:
    from dotenv import load_dotenv
    load_dotenv('.env.local')
except ImportError:
    pass

try:
    from supabase import create_client, Client
except ImportError:
    print("エラー: supabase パッケージが必要です。")
    print("  pip install supabase python-dotenv")
    sys.exit(1)


# ============================================================
# Supabase クライアント初期化
# ============================================================

def get_client() -> Client:
    url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
    key = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    if not url or not key:
        print("エラー: NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_KEY (または ANON_KEY) が必要です。")
        print(".env.local を確認してください。")
        sys.exit(1)
    return create_client(url, key)


# ============================================================
# CSV 読み込みヘルパー
# ============================================================

def read_csv(path: Path) -> list[dict]:
    with open(path, encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))


def nullable_float(val: str) -> Optional[float]:
    return float(val) if val and val.strip() not in ('', 'None', 'NULL') else None


def nullable_int(val: str) -> Optional[int]:
    try:
        return int(val) if val and val.strip() not in ('', 'None', 'NULL') else None
    except ValueError:
        return None


def to_bool(val: str) -> bool:
    return str(val).strip().lower() in ('true', '1', 'yes')


# ============================================================
# インポーター
# ============================================================

class SupabaseImporter:
    def __init__(self, supabase: Client, generated_dir: Path, meet_date: str):
        self.sb         = supabase
        self.dir        = generated_dir
        self.meet_date  = meet_date

        # IDキャッシュ
        self.event_id:      Optional[int]    = None
        self.team_ids:      dict[str, int]   = {}  # team_name -> id
        self.athlete_ids:   dict[tuple, int] = {}  # (name, team_name, gender) -> id
        self.category_ids:  dict[tuple, int] = {}  # (name, pool_type, gender) -> id
        self.age_ids:       dict[str, int]   = {}  # name -> id
        self.record_bonus:  dict[str, float] = {}  # record_type -> bonus_points
        self.team_aliases:    dict[str, int]   = {}  # alias -> canonical team_id
        self.athlete_aliases: dict[str, str]  = {}  # alias_name -> canonical_name

    # ----------------------------------------------------------
    def run(self):
        print("Supabase インポート開始")
        standings = read_csv(self.dir / 'team_standings.csv')
        ind_res   = read_csv(self.dir / 'individual_results.csv')
        rel_res   = read_csv(self.dir / 'relay_results.csv')
        rel_mbr   = read_csv(self.dir / 'relay_members.csv')

        round_no  = int(standings[0]['round'])
        pool_type = standings[0]['pool_type']

        self._load_age_groups()
        self._load_events()
        self._load_record_bonus()
        self._load_team_aliases()
        self._load_athlete_aliases()
        self._upsert_meet(round_no, pool_type)
        self._upsert_teams(standings, ind_res, rel_res)
        self._upsert_athletes(ind_res, rel_res, rel_mbr)
        self._insert_team_standings(standings)
        self._insert_individual_results(ind_res)
        self._insert_relay_results(rel_res, rel_mbr)
        self._cleanup_orphaned_athletes()
        self._check_similar_names()
        print("\nインポート完了！")

    # ----------------------------------------------------------
    def _load_age_groups(self):
        """age_groups テーブルから全件取得してキャッシュ"""
        res = self.sb.table('mst_age').select('id, name').execute()
        for row in res.data:
            self.age_ids[row['name']] = row['id']
        print(f"年齢区分キャッシュ: {len(self.age_ids)}件")

    def _load_team_aliases(self):
        """team_aliases から alias -> canonical team_id をキャッシュ（NFKC正規化版も登録）"""
        res = self.sb.table('mst_team_alias').select('alias, team_id').execute()
        for row in res.data:
            self.team_aliases[row['alias']] = row['team_id']
            normalized = norm_name(row['alias'])
            if normalized != row['alias']:
                self.team_aliases[normalized] = row['team_id']
        print(f"チームエイリアスキャッシュ: {len(self.team_aliases)}件")

    # ----------------------------------------------------------
    # Central club 正規化: 'セントラルXXXクラブYYY' → 'セ・YYY'
    _CENTRAL_PREFIXES = [
        ('セントラルフィットネスクラブ', 'F'),
        ('セントラルウェルネスクラブ', ''),
        ('セントラルスポーツクラブ', 'S'),
        ('セントラルスイムクラブ', ''),
        ('トーアセントラルフィットネスクラブ', 'F'),
        ('ニッセイセントラルフィットネスクラブ', 'F'),
        ('ラヴィセントラルフィットネスクラブ', 'F'),
    ]
    _CENTRAL_SPECIAL: dict[str, str] = {
        'ゴールデンスパ・ニューオータニ': 'Ｇ－ＳＰＡ',
        'セントラルスポーツクリーンスパイチカワ': 'クリーンスパ',
        'セントラルスポーツクリーンスパ市川': 'クリーンスパ',
        'セントラルスポーツ南行徳': 'ＣＳ南行徳',
        '南行徳': 'ＣＳ南行徳',
        'CS南行徳': 'ＣＳ南行徳',
        'セントラルスポーツフッサ': 'セ・福生',
        'セントラルフィットネスクラブ越谷レイクタウン': 'セ・越谷ＬＴ',
        'ザバススポーツクラブ金沢八景': 'ザバス八景',
        'ザバス金沢八': 'ザバス八景',
        'ザバス金沢八景': 'ザバス八景',
        '曽谷セントラルスイムクラブ': '曽谷・セ',
        '墨田区総合体育館': '墨田区体育館',
        # OCR誤読修正
        'セ・溝ノロ': 'セ・溝ノ口',
        'セ・八千代代': 'セ・八千代台',
        'ザバス金沢ハ': 'ザバス八景',
        'GSPA': 'Ｇ－ＳＰＡ',
    }

    def _normalize_central_team(self, name: str) -> str:
        """フルネームをショートネームに変換。既知の名前ならそのまま返す。"""
        # チームランキングページのOCRゴミを除去
        # "セ・阿佐谷   ﾄｰｱｾﾝﾄﾗﾙ..." → "セ・阿佐谷"
        name = re.sub(r'\s{2,}.*$|\s+[ｦ-ﾟ].*$', '', name.strip())
        # セ・XXX 系のショートネームに余分なゴミがついている場合は最初のスペース以降を除去
        # 例: "セ・千葉みなと セントラルフィットネスクラブ チバミナト" → "セ・千葉みなと"
        if re.match(r'^(セ・|ザバス|CS|ＣＳ|クリーン|G[-－]|曽谷)', name) and ' ' in name:
            name = name[:name.index(' ')]

        # すでに既知の名前 → そのまま
        if name in self.team_ids or name in self.team_aliases:
            return name
        n = norm_name(name)
        if n in self.team_ids or n in self.team_aliases:
            return n

        # 特殊ケース
        if name in self._CENTRAL_SPECIAL:
            return self._CENTRAL_SPECIAL[name]

        # セントラル系プレフィックス変換
        for prefix, type_code in self._CENTRAL_PREFIXES:
            if name.startswith(prefix):
                suffix = name[len(prefix):]
                # 先頭の数字 ('24', '30' など) を除去
                suffix_clean = re.sub(r'^\d+', '', suffix)
                # 末尾の括弧を除去 ('(大倉山)' など)
                suffix_clean = re.sub(r'\s*\(.+\)$', '', suffix_clean).strip()

                candidates_to_try = []
                if type_code:
                    candidates_to_try.append(f'セ・{type_code}{suffix_clean}')
                    candidates_to_try.append(f'セ・{type_code}{suffix}')
                candidates_to_try += [
                    f'セ・{suffix_clean}',
                    f'セ・{suffix}',
                ]
                for c in candidates_to_try:
                    if c in self.team_ids or c in self.team_aliases:
                        return c

                # ファジーフォールバック（既知のセ・XXXチームで最近似）
                known_central = [t for t in list(self.team_ids) + list(self.team_aliases)
                                  if t.startswith('セ・')]
                best_c = f'セ・{suffix_clean}' if suffix_clean else f'セ・{suffix}'
                matches = get_close_matches(best_c, known_central, n=1, cutoff=0.65)
                if matches:
                    return matches[0]
                return best_c

        # ザバス系 (ザバススポーツクラブ=10文字)
        if name.startswith('ザバススポーツクラブ'):
            short = 'ザバス' + name[10:]
            if short in self.team_ids or short in self.team_aliases:
                return short
            # 末尾省略マッチ（金沢八景 → 八景 など）
            known_zabas = [t for t in list(self.team_ids) + list(self.team_aliases)
                           if t.startswith('ザバス')]
            matches = get_close_matches(short, known_zabas, n=1, cutoff=0.6)
            if matches:
                return matches[0]
            return short

        return name

    def _load_athlete_aliases(self):
        """mst_player_alias から alias → canonical_name をキャッシュ"""
        try:
            res = self.sb.table('mst_player_alias').select('alias, canonical_name').execute()
            for row in res.data:
                self.athlete_aliases[row['alias']] = row['canonical_name']
                normalized = norm_name(row['alias'])
                if normalized != row['alias']:
                    self.athlete_aliases[normalized] = row['canonical_name']
            print(f"選手エイリアスキャッシュ: {len(res.data)}件")
        except Exception as e:
            print(f"  選手エイリアス読込スキップ（テーブル未存在?）: {e}")

    def _resolve_athlete_name(self, name: str) -> str:
        """選手名エイリアスを適用して正規名を返す"""
        canonical = self.athlete_aliases.get(name)
        if canonical:
            return canonical
        n = norm_name(name)
        if n != name:
            canonical = self.athlete_aliases.get(n)
            if canonical:
                return canonical
        return name

    def _load_record_bonus(self):
        """mst_record_bonus から記録ボーナスpt をキャッシュ"""
        res = self.sb.table('mst_record_bonus').select('record_type, bonus_points').execute()
        for row in res.data:
            self.record_bonus[row['record_type']] = float(row['bonus_points'])
        print(f"記録ボーナスキャッシュ: {self.record_bonus}")

    def _load_events(self):
        """events テーブルから全件取得してキャッシュ"""
        res = self.sb.table('mst_category').select('id, name, pool_type, gender').execute()
        for row in res.data:
            key = (row['name'], row['pool_type'], row['gender'])
            self.category_ids[key] = row['id']
        print(f"競技キャッシュ: {len(self.category_ids)}件")

    def _find_category_id(self, event_name: str, pool_type: str, gender: str) -> Optional[int]:
        """カテゴリIDを検索。個人競技はgenderがNULL、混合リレーは名前に（混合）が付く"""
        # 個人: gender=None
        key_null   = (event_name, pool_type, None)
        key_gender = (event_name, pool_type, gender)
        found = self.category_ids.get(key_null) or self.category_ids.get(key_gender)
        if found:
            return found
        # 混合リレー: TXTは '4×50mフリーリレー' + gender='混合'
        #             DBは  '4×50mフリーリレー（混合）' + gender='混合'
        if gender == '混合':
            key_mixed = (event_name + '（混合）', pool_type, '混合')
            return self.category_ids.get(key_mixed)
        return None

    def _find_age_id(self, age_group_str: str) -> Optional[int]:
        """年齢区分名からIDを検索。例: '80～84歳' -> 14"""
        # U+301C WAVE DASH (〜) → U+FF5E FULLWIDTH TILDE (～) に統一
        age_group_str = age_group_str.replace('〜', '～')
        # 直接マッチ
        if age_group_str in self.age_ids:
            return self.age_ids[age_group_str]
        # 「歳」補完: '80～84' -> '80～84歳'
        if '歳' not in age_group_str:
            candidate = age_group_str + '歳'
            if candidate in self.age_ids:
                return self.age_ids[candidate]
        # 「以上」補完: '90' -> '90歳以上'
        import re
        m = re.match(r'^(\d+)$', age_group_str.strip())
        if m:
            candidate = m.group(1) + '歳以上'
            if candidate in self.age_ids:
                return self.age_ids[candidate]
        return None

    # ----------------------------------------------------------
    def _upsert_meet(self, round_no: int, pool_type: str):
        res = self.sb.table('mst_event').upsert({
            'round':     round_no,
            'pool_type': pool_type,
            'date':      self.meet_date,
            'name':      f'第{round_no}回セントラルスポーツマスターズフェスティバル（{pool_type}）',
            'venue':     '東京アクアティクスセンター',
        }, on_conflict='round,pool_type').execute()
        self.event_id = res.data[0]['id']
        print(f"大会: 第{round_no}回 {pool_type} → id={self.event_id}")

    # ----------------------------------------------------------
    def _get_team_id(self, name: str) -> Optional[int]:
        """キャッシュ済み team_id を返す。エイリアス・NFKC正規化にもフォールバック。"""
        tid = self.team_ids.get(name) or self.team_aliases.get(name)
        if tid:
            return tid
        n = norm_name(name)
        if n != name:
            return self.team_ids.get(n) or self.team_aliases.get(n)
        return None

    def _resolve_team(self, name: str) -> int:
        """チーム名 → team_id。エイリアスにあればそちらを使い、なければupsert。"""
        # 全角正規化した名前をキャノニカルとして使用
        canonical = normalize_team_name(name)
        if canonical in self.team_ids:
            return self.team_ids[canonical]
        if canonical in self.team_aliases:
            self.team_ids[canonical] = self.team_aliases[canonical]
            return self.team_ids[canonical]
        # 元の名前でも試みる（移行期の後方互換）
        if name != canonical:
            if name in self.team_ids:
                self.team_ids[canonical] = self.team_ids[name]
                return self.team_ids[canonical]
            if name in self.team_aliases:
                self.team_ids[canonical] = self.team_aliases[name]
                return self.team_ids[canonical]
        # 新規 or 既存の正規チームとしてupsert（全角正規化名で登録）
        res = self.sb.table('mst_team').upsert(
            {'name': canonical}, on_conflict='name'
        ).execute()
        self.team_ids[canonical] = res.data[0]['id']
        return self.team_ids[canonical]

    def _upsert_teams(self, standings: list[dict], ind_res: list[dict], rel_res: list[dict]):
        # Step 1: 個人・リレー結果のチーム名を先に登録（これが正規ショートネーム）
        for row in ind_res:
            self._resolve_team(row['team_name'])
        for row in rel_res:
            self._resolve_team(row['team_name'])

        # Step 2: teams.csv のチーム名（フルネームの場合あり）を正規化して登録
        teams_csv = read_csv(self.dir / 'teams.csv')
        for row in teams_csv:
            normalized = self._normalize_central_team(row['team_name'])
            self._resolve_team(normalized)

        # Step 3: チーム成績のチーム名（フルネームの場合あり）を正規化して登録
        for row in standings:
            normalized = self._normalize_central_team(row['team_name'])
            self._resolve_team(normalized)

        print(f"チームupsert: {len(self.team_ids)}件")

    # ----------------------------------------------------------
    def _upsert_athletes(self, ind_res: list[dict], rel_res: list[dict] = None,
                          rel_mbr: list[dict] = None):
        seen: set[tuple] = set()
        to_insert = []

        # 個人結果から選手を収集
        for row in ind_res:
            athlete_name = self._resolve_athlete_name(row['athlete_name'])
            key = (athlete_name, row['team_name'], row['gender'])
            if key in seen:
                continue
            seen.add(key)
            team_id = self._get_team_id(row['team_name'])
            if not team_id:
                continue
            to_insert.append({
                'name':    athlete_name,
                'gender':  row['gender'],
                'team_id': team_id,
            })

        # リレーメンバーからも選手を収集（男子/女子リレーは性別が確定）
        if rel_res and rel_mbr:
            relay_key_to_gender: dict[str, str] = {}
            for rr in rel_res:
                rkey = f"{rr['round']}_{rr['race_no']}_{rr['age_group_label']}_{rr['team_name']}_{rr['rank']}"
                relay_key_to_gender[rkey] = rr['gender']

            for mbr in rel_mbr:
                rkey = mbr['relay_key']
                relay_gender = relay_key_to_gender.get(rkey, '')
                # 混合リレーは性別不確定なので個人結果からの推定に頼る
                if relay_gender not in ('男子', '女子'):
                    continue
                # リレーのチーム名はrelay_keyから取得
                parts = rkey.split('_')
                team_name = parts[3] if len(parts) >= 5 else ''
                athlete_name = self._resolve_athlete_name(mbr['athlete_name'])
                key = (athlete_name, team_name, relay_gender)
                if key in seen:
                    continue
                seen.add(key)
                team_id = self._get_team_id(team_name)
                if not team_id:
                    continue
                to_insert.append({
                    'name':    athlete_name,
                    'gender':  relay_gender,
                    'team_id': team_id,
                })

        batch_size = 100
        for i in range(0, len(to_insert), batch_size):
            batch = to_insert[i:i + batch_size]
            self.sb.table('dt_player_person').upsert(
                batch,
                on_conflict='name,team_id,gender'
            ).execute()

        # IDをキャッシュ（全件取得。PostgRESTデフォルト上限1000を回避するためrange指定）
        # team_id → 全チーム名バリアントのマップ（NFKC重複も含む）
        tid_to_names: dict[int, list[str]] = {}
        for tname, tid in self.team_ids.items():
            tid_to_names.setdefault(tid, []).append(tname)

        offset = 0
        page_size = 1000
        total_cached = 0
        while True:
            res = (
                self.sb.table('dt_player_person')
                .select('id, name, gender, team_id')
                .range(offset, offset + page_size - 1)
                .execute()
            )
            for row in res.data:
                for tname in tid_to_names.get(row['team_id'], ['']):
                    key = (row['name'], tname, row['gender'])
                    self.athlete_ids[key] = row['id']
            total_cached += len(res.data)
            if len(res.data) < page_size:
                break
            offset += page_size
        print(f"選手upsert: {len(to_insert)}件 → キャッシュ {total_cached}件")

    # ----------------------------------------------------------
    def _insert_team_standings(self, standings: list[dict]):
        # 既存の同大会データを削除
        self.sb.table('dt_ranking_team').delete().eq('event_id', self.event_id).execute()

        rows = []
        for row in standings:
            canonical = self._normalize_central_team(row['team_name'])
            team_id = self._get_team_id(canonical)
            if not team_id:
                print(f"  チーム未解決(standings): {row['team_name']}")
                continue
            rows.append({
                'event_id':      self.event_id,
                'team_id':       team_id,
                'rank':          int(row['rank']),
                'total_points':  nullable_float(row['total_points']),
                'male_points':   nullable_float(row['male_points']),
                'female_points': nullable_float(row['female_points']),
                'mixed_points':  nullable_float(row['mixed_points']),
            })

        self.sb.table('dt_ranking_team').insert(rows).execute()
        print(f"チーム成績: {len(rows)}件")

    # ----------------------------------------------------------
    def _insert_individual_results(self, ind_res: list[dict]):
        # 既存データを削除
        self.sb.table('dt_result_person').delete().eq('event_id', self.event_id).execute()

        rows = []
        skipped = 0
        for row in ind_res:
            if to_bool(row['is_dnf']):
                # 棄権・失格はポイントなしで記録
                pass

            category_id = self._find_category_id(
                row['event_name'], row['pool_type'], row['gender']
            )
            age_id = self._find_age_id(row['age_group'])
            resolved_name = self._resolve_athlete_name(row['athlete_name'])
            athlete_key  = (resolved_name, row['team_name'], row['gender'])
            player_id    = self.athlete_ids.get(athlete_key)

            if not all([category_id, age_id, player_id]):
                skipped += 1
                if skipped <= 5:
                    print(f"  スキップ: {row['athlete_name']} event={row['event_name']} "
                          f"age={row['age_group']} category_id={category_id} "
                          f"age_id={age_id} player_id={player_id}")
                continue

            t           = nullable_float(row['time_seconds'])
            meet_rec    = time_to_seconds(row['meet_record'])
            japan_rec   = time_to_seconds(row['japan_record'])
            world_rec   = time_to_seconds(row['world_record'])
            is_meet_rec  = to_bool(row['is_meet_record'])
            is_japan_rec = bool(t and japan_rec and t < japan_rec)
            is_world_rec = bool(t and world_rec and t < world_rec)

            # 順位ベースポイント（1位=10pt … 10位=1pt、11位以下=0pt）
            rank_val = nullable_int(row['rank'])
            base_pts = float(11 - rank_val) if rank_val and 1 <= rank_val <= 10 else 0.0
            bonus = 0.0
            if is_meet_rec:  bonus += self.record_bonus.get('大会新', 0)
            if is_japan_rec: bonus += self.record_bonus.get('日本新', 0)
            if is_world_rec: bonus += self.record_bonus.get('世界新', 0)
            total_pts = (base_pts + bonus) or None

            rows.append({
                'event_id':      self.event_id,
                'player_id':     player_id,
                'category_id':   category_id,
                'age_id':        age_id,
                'rank':          nullable_int(row['rank']),
                'time_seconds':  t,
                'time_display':  row['time_display'] or None,
                'dive_time':     nullable_float(row['dive_time']),
                'lap_times':     row['lap_times'] or None,
                'points':        total_pts,
                'team_points':   total_pts,
                'meet_record_seconds':  meet_rec,
                'japan_record_seconds': japan_rec,
                'world_record_seconds': world_rec,
                'is_meet_record':  is_meet_rec,
                'is_japan_record': is_japan_rec,
                'is_world_record': is_world_rec,
                'race_number':   nullable_int(row['race_no']),
                'lane':          row['lane'] or None,
            })

        batch_size = 200
        for i in range(0, len(rows), batch_size):
            self.sb.table('dt_result_person').insert(rows[i:i + batch_size]).execute()

        print(f"個人結果: {len(rows)}件 (スキップ {skipped}件)")

    # ----------------------------------------------------------
    def _cleanup_orphaned_athletes(self):
        """結果に紐付かない孤立選手レコードを削除（名前修正後の再インポート時に発生）"""
        # 参照されているplayer_idを収集（ページネーション対応）
        used_ids: set[int] = set()
        for table, col in (('dt_result_person', 'player_id'), ('dt_player_relay', 'player_id')):
            offset = 0
            while True:
                res = (
                    self.sb.table(table)
                    .select(col)
                    .range(offset, offset + 999)
                    .execute()
                )
                for r in res.data:
                    used_ids.add(r[col])
                if len(res.data) < 1000:
                    break
                offset += 1000

        # 全選手IDを取得
        all_athletes: list[int] = []
        offset = 0
        while True:
            res = (
                self.sb.table('dt_player_person')
                .select('id')
                .range(offset, offset + 999)
                .execute()
            )
            all_athletes.extend(r['id'] for r in res.data)
            if len(res.data) < 1000:
                break
            offset += 1000

        orphan_ids = [aid for aid in all_athletes if aid not in used_ids]
        if orphan_ids:
            for i in range(0, len(orphan_ids), 100):
                batch = orphan_ids[i:i + 100]
                self.sb.table('dt_player_person').delete().in_('id', batch).execute()
        print(f"孤立選手削除: {len(orphan_ids)}件")

    # ----------------------------------------------------------
    def _check_similar_names(self):
        """同チーム・同性別で名前の先頭3文字が同じ選手ペアを警告（OCR誤認識による重複検出）"""
        from collections import defaultdict
        bucket: dict[tuple, list] = defaultdict(list)
        for (name, team_name, gender) in self.athlete_ids:
            if len(name) >= 3:
                key = (team_name, gender, name[:3])
                bucket[key].append(name)

        warnings = []
        for (team_name, gender, _prefix), names in bucket.items():
            unique_names = sorted(set(names))
            if len(unique_names) >= 2:
                warnings.append((team_name, gender, unique_names))

        if not warnings:
            print("似た名前チェック: 疑わしいペアなし")
            return

        print(f"\n{'='*60}")
        print(f"[要確認] 同チーム内で名前が非常に似ている選手 ({len(warnings)}件)")
        print(f"{'チーム':<20} {'性別':<6} 名前")
        print('-' * 60)
        for team, gender, names in sorted(warnings):
            print(f"{team:<20} {gender:<6} {' / '.join(names)}")
        print("→ PDFを確認し、OCR誤認識ならどちらかを削除してください。")
        print('='*60)

    # ----------------------------------------------------------
    def _insert_relay_results(self, rel_res: list[dict], rel_mbr: list[dict]):
        # 既存データを削除
        self.sb.table('dt_result_relay').delete().eq('event_id', self.event_id).execute()

        # relay_key → relay_result DB id のマッピング用
        relay_key_to_db_id: dict[str, int] = {}
        skipped = 0

        for row in rel_res:
            gender = row['gender']
            category_id = self._find_category_id(row['event_name'], row['pool_type'], gender)
            team_id     = self._get_team_id(row['team_name'])

            if not all([category_id, team_id]):
                skipped += 1
                continue

            relay_rank = nullable_int(row['rank'])
            relay_pts = float(11 - relay_rank) if relay_rank and 1 <= relay_rank <= 10 else None
            is_relay_meet_rec = to_bool(row['is_meet_record'])
            if is_relay_meet_rec and relay_pts is not None:
                relay_pts += self.record_bonus.get('大会新', 0)
            elif is_relay_meet_rec:
                relay_pts = self.record_bonus.get('大会新', 0)

            age_label = row['age_group_label'] or None
            res = self.sb.table('dt_result_relay').insert({
                'event_id':      self.event_id,
                'team_id':       team_id,
                'category_id':   category_id,
                'age_group_label': age_label,
                'age_id':        self._find_age_id(age_label) if age_label else None,
                'combined_age':  nullable_int(row['combined_age']),
                'rank':          relay_rank,
                'time_seconds':  nullable_float(row['time_seconds']),
                'time_display':  row['time_display'] or None,
                'team_points':   relay_pts,
                'meet_record_seconds':  time_to_seconds(row['meet_record']),
                'japan_record_seconds': time_to_seconds(row['japan_record']),
                'world_record_seconds': time_to_seconds(row['world_record']),
                'is_meet_record': is_relay_meet_rec,
                'race_number':   nullable_int(row['race_no']),
            }).execute()

            db_id = res.data[0]['id']
            relay_key = f"{row['round']}_{row['race_no']}_{row['age_group_label']}_{row['team_name']}_{row['rank']}"
            relay_key_to_db_id[relay_key] = db_id

        print(f"リレー結果: {len(relay_key_to_db_id)}件 (スキップ {skipped}件)")

        # リレーメンバーを投入
        mbr_rows = []
        mbr_skip = 0
        for row in rel_mbr:
            rkey = row['relay_key']
            relay_db_id = relay_key_to_db_id.get(rkey)
            if not relay_db_id:
                mbr_skip += 1
                continue

            # 選手IDを検索（性別不明なので名前とチームで推測）
            name = self._resolve_athlete_name(row['athlete_name'])
            # relay_keyからチーム名を推測
            # key format: "80_{race_no}_{age_group}_{team_name}_{rank}"
            # race_no と rank は数字なので、それ以外の部分がチーム名
            # "80_3_320～359歳_セ・用賀_1" -> parts[3] = "セ・用賀" (rank=1はint)
            # 末尾が数字 = rank, 先頭が数字 = round, その次が数字 = race_no
            # 残り: parts[2]=age_group, parts[3...-1]=team_name (team名に_は含まれないはず)
            parts = rkey.split('_')
            team_name = parts[3] if len(parts) >= 5 else ''

            ath_id = None
            for gender in ('女子', '男子'):
                key = (name, team_name, gender)
                if key in self.athlete_ids:
                    ath_id = self.athlete_ids[key]
                    break

            if not ath_id:
                mbr_skip += 1
                continue

            mbr_rows.append({
                'relay_result_id': relay_db_id,
                'player_id':       ath_id,
                'swim_order':      int(row['swim_order']),
                'split_seconds':   nullable_float(row['split_seconds']),
            })

        # (relay_result_id, swim_order) の重複除去（OCRが同じ行を2回出力するケースがある）
        seen_mbr: set[tuple] = set()
        deduped_rows = []
        for r in mbr_rows:
            k = (r['relay_result_id'], r['swim_order'])
            if k not in seen_mbr:
                seen_mbr.add(k)
                deduped_rows.append(r)
        dup_count = len(mbr_rows) - len(deduped_rows)
        if dup_count:
            print(f"  リレーメンバー重複除去: {dup_count}件スキップ")

        batch_size = 200
        for i in range(0, len(deduped_rows), batch_size):
            self.sb.table('dt_player_relay').insert(deduped_rows[i:i + batch_size]).execute()

        print(f"リレーメンバー: {len(deduped_rows)}件 (スキップ {mbr_skip}件)")


# ============================================================
# エントリーポイント
# ============================================================

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    generated_dir = Path(sys.argv[1])
    meet_date     = sys.argv[2]

    if not generated_dir.exists():
        print(f"エラー: フォルダが見つかりません: {generated_dir}")
        sys.exit(1)

    sb = get_client()
    importer = SupabaseImporter(sb, generated_dir, meet_date)
    importer.run()
