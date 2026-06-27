#!/usr/bin/env python3
"""
参照CSVから第80回データを直接DBにインポートする。
OCRパースより精度が高い手入力CSVを正とする。

使い方:
  python scripts/import_from_reference_csv.py [--round 80] [--dry-run]

対象ファイル:
  data/第80回競技結果（個人）.csv  → dt_player_person + dt_result_person
  data/第80回競技結果（チーム）.csv → dt_player_person + dt_result_relay + dt_player_relay
"""
import csv, os, sys, re, unicodedata, argparse
from itertools import groupby
from typing import Optional
sys.stdout.reconfigure(encoding='utf-8')

from dotenv import load_dotenv
load_dotenv('.env.local')
from supabase import create_client


# ── ユーティリティ ────────────────────────────────────────────────

def normalize(s: str) -> str:
    """全角→半角などUnicode正規化"""
    return unicodedata.normalize('NFKC', s.strip())


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

def parse_time(s: str) -> Optional[float]:
    """'3:53.04'→233.04 / '52.61'→52.61 / DNS・記録なし→None"""
    if not s:
        return None
    s = s.strip()
    if s in ('DNS', 'DQ', 'NC', '記録なし', '-', ''):
        return None
    try:
        if ':' in s:
            parts = s.split(':')
            return int(parts[0]) * 60 + float(parts[1])
        return float(s)
    except ValueError:
        return None

def to_float(s: str) -> Optional[float]:
    try:
        return float(s.strip()) if s and s.strip() else None
    except ValueError:
        return None

def to_bool_flag(s: str) -> bool:
    """'大会新' / '○' など値があれば True"""
    return bool(s and s.strip())

def to_int(s: str) -> Optional[int]:
    try:
        v = s.strip()
        return int(v) if v.isdigit() else None
    except (ValueError, AttributeError):
        return None

def read_csv(path: str):
    with open(path, encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))


# ── インポーター ──────────────────────────────────────────────────

class ReferenceImporter:

    def __init__(self, sb, round_no: int, dry_run: bool = False):
        self.sb = sb
        self.round = round_no
        self.dry_run = dry_run
        self._load_masters()

    # ── マスターデータロード ──

    def _load_masters(self):
        # 大会
        res = self.sb.table('mst_event').select('id, round').eq('round', self.round).execute()
        if not res.data:
            raise RuntimeError(f"第{self.round}回のmst_eventが見つかりません")
        self.event_id = res.data[0]['id']
        print(f"第{self.round}回 event_id={self.event_id}")

        # チーム
        teams = self.sb.table('mst_team').select('id, name').execute().data
        self.team_by_name: dict[str, int] = {r['name']: r['id'] for r in teams}

        # エイリアス
        aliases = self.sb.table('mst_team_alias').select('alias, team_id').execute().data
        self.team_aliases: dict[str, int] = {r['alias']: r['team_id'] for r in aliases}

        # 競技種目 (name, gender, pool_type) をキーにする
        # 個人種目は gender=None でDBに保存されている
        cats = self.sb.table('mst_category').select('id, name, gender, type, pool_type').execute().data
        self.cat_by_key: dict[tuple, int] = {(r['name'], r['gender'], r['pool_type']): r['id'] for r in cats}

        # 年齢区分
        ages = self.sb.table('mst_age').select('id, name').execute().data
        self.age_by_name: dict[str, int] = {r['name']: r['id'] for r in ages}

        # 選手（既存キャッシュ）
        players = self.sb.table('dt_player_person').select('id, name, gender, team_id').execute().data
        self.player_by_key: dict[tuple, int] = {
            (r['name'], r['gender'], r['team_id']): r['id'] for r in players
        }

        print(f"  チーム:{len(self.team_by_name)} / 競技:{len(self.cat_by_key)} / "
              f"年齢区分:{len(self.age_by_name)} / 選手:{len(self.player_by_key)}")

    # ── マスター解決 ──

    def resolve_team(self, csv_name: str) -> int:
        name = normalize_team_name(csv_name)

        if name in self.team_by_name:
            return self.team_by_name[name]
        if name in self.team_aliases:
            return self.team_aliases[name]

        # セ・prefix で再検索
        se = 'セ・' + name
        if se in self.team_by_name:
            return self.team_by_name[se]
        if se in self.team_aliases:
            return self.team_aliases[se]

        # 新規登録（全角正規化名で登録）
        print(f"  [NEW TEAM] {name}")
        if not self.dry_run:
            res = self.sb.table('mst_team').insert({'name': name}).execute()
            team_id = res.data[0]['id']
            self.team_by_name[name] = team_id
            return team_id
        return -1

    def resolve_player(self, name: str, gender: str, team_id: int) -> int:
        name = normalize(name)

        # gender が空の場合、既存キャッシュから名前+チームで検索（リレーCSVで性別省略の場合）
        if not gender:
            for (pname, pgender, pteam), pid in self.player_by_key.items():
                if pname == name and pteam == team_id:
                    return pid
            # チーム問わず名前で検索
            for (pname, pgender, pteam), pid in self.player_by_key.items():
                if pname == name:
                    return pid
            print(f"  [SKIP] gender不明・選手未特定: {name} (team_id={team_id})")
            return -1

        key = (name, gender, team_id)
        if key in self.player_by_key:
            return self.player_by_key[key]

        if not self.dry_run:
            res = self.sb.table('dt_player_person').upsert(
                {'name': name, 'gender': gender, 'team_id': team_id},
                on_conflict='name,team_id,gender'
            ).execute()
            player_id = res.data[0]['id']
            self.player_by_key[key] = player_id
            return player_id
        return -1

    def resolve_category(self, name: str, gender: str, type_: str, pool_type: str = '共通') -> int:
        name = normalize(name)
        # Migration 009以降: 個人種目にも gender あり（男子/女子/混合で統一）
        # 混合リレーはDB名が「競技名（混合）」の場合がある
        names_to_try = [name]
        if type_ == 'リレー' and gender == '混合' and not name.endswith('（混合）'):
            names_to_try.append(name + '（混合）')

        for n in names_to_try:
            key = (n, gender, pool_type)
            if key in self.cat_by_key:
                return self.cat_by_key[key]
            key2 = (n, gender, '共通')
            if key2 in self.cat_by_key:
                return self.cat_by_key[key2]

        m = re.match(r'^(\d+)[×x](\d+)m(.+)$', name)
        if not m:
            m = re.match(r'^(\d+)m(.+)$', name)
            dist   = int(m.group(1)) if m else None
            stroke = m.group(2)     if m else None
        else:
            dist   = int(m.group(2))
            stroke = m.group(3)

        insert_key = (name, gender, pool_type)
        print(f"  [NEW CATEGORY] {name} {gender} pool={pool_type}")
        if not self.dry_run:
            res = self.sb.table('mst_category').insert({
                'name': name, 'gender': gender, 'type': type_,
                'distance': dist, 'stroke': stroke, 'pool_type': pool_type
            }).execute()
            cat_id = res.data[0]['id']
            self.cat_by_key[insert_key] = cat_id
            return cat_id
        return -1

    def resolve_age(self, name: str) -> Optional[int]:
        if not name or not name.strip():
            return None
        if name in self.age_by_name:
            return self.age_by_name[name]

        m = re.match(r'^(\d+)～(\d+)歳$', name)
        if m:
            min_a, max_a = int(m.group(1)), int(m.group(2))
        else:
            m2 = re.match(r'^(\d+)歳以上$', name)
            min_a = int(m2.group(1)) if m2 else 0
            max_a = None

        print(f"  [NEW AGE] {name}")
        if not self.dry_run:
            res = self.sb.table('mst_age').insert({'name': name, 'min_age': min_a, 'max_age': max_a}).execute()
            age_id = res.data[0]['id']
            self.age_by_name[name] = age_id
            return age_id
        return -1

    # ── 既存データ削除 ──

    def delete_existing(self):
        if self.dry_run:
            print("[DRY-RUN] 削除スキップ")
            return

        # dt_player_relay → dt_result_relay
        relay_res = self.sb.table('dt_result_relay').select('id').eq('event_id', self.event_id).execute()
        relay_ids = [r['id'] for r in relay_res.data]
        if relay_ids:
            # バッチ削除（IDが多い場合に備えて分割）
            for i in range(0, len(relay_ids), 100):
                chunk = relay_ids[i:i+100]
                self.sb.table('dt_player_relay').delete().in_('relay_result_id', chunk).execute()
            self.sb.table('dt_result_relay').delete().eq('event_id', self.event_id).execute()

        self.sb.table('dt_result_person').delete().eq('event_id', self.event_id).execute()
        self.sb.table('dt_ranking_team').delete().eq('event_id', self.event_id).execute()

        print(f"  削除完了: relay {len(relay_ids)}件 + dt_result_person + dt_ranking_team")

    # ── 個人成績インポート ──

    def import_individual(self, path: str):
        rows = [r for r in read_csv(path) if r.get('タイプ', '').strip() == '個人']
        print(f"個人成績: {len(rows)}行")

        batch = []
        for row in rows:
            team_id   = self.resolve_team(row['チーム名'])
            player_id = self.resolve_player(row['選手名'], row['性別'], team_id)
            cat_id    = self.resolve_category(row['競技名'], row['競技性別'], '個人', row.get('水路', '共通'))
            age_id    = self.resolve_age(row.get('個人年齢区分', ''))

            t   = parse_time(row['個人タイム'])
            mr  = parse_time(row.get('大会記録', ''))
            jr  = parse_time(row.get('日本記録', ''))
            wr  = parse_time(row.get('世界記録', ''))

            batch.append({
                'event_id':            self.event_id,
                'player_id':           player_id,
                'category_id':         cat_id,
                'age_id':              age_id,
                'rank':                to_int(row.get('順位', '')),
                'time_seconds':        t,
                'time_display':        row['個人タイム'].strip() if t else None,
                'dive_time':           parse_time(row.get('飛込タイム', '')),
                'lap_times':           row.get('LAPタイム', '').strip() or None,
                'points':              to_float(row.get('個人得点', '')),
                'team_points':         to_float(row.get('チーム得点', '')),
                'entry_time_seconds':  parse_time(row.get('申請タイム', '')),
                'meet_record_seconds': mr,
                'japan_record_seconds': jr,
                'world_record_seconds': wr,
                'is_meet_record':      to_bool_flag(row.get('大会新', '')),
                'is_japan_record':     bool(t and jr and t < jr),
                'is_world_record':     bool(t and wr and t < wr),
                'is_just_right':       to_bool_flag(row.get('ぴったり賞', '')),
                'race_number':         to_int(row.get('レース番号', '')),
                'lane':                row.get('レーン', '').strip() or None,
            })

        if not self.dry_run:
            for i in range(0, len(batch), 100):
                self.sb.table('dt_result_person').insert(batch[i:i+100]).execute()
            print(f"  → {len(batch)}件インポート完了")
        else:
            print(f"  [DRY-RUN] {len(batch)}件（実行なし）")

    # ── リレー成績インポート ──

    def import_relay(self, path: str):
        rows = [r for r in read_csv(path) if r.get('タイプ', '').strip() == 'チーム']
        print(f"リレー成績: {len(rows)}行")

        # グループ化キー: 同一チームが同年齢区分に複数エントリーする場合があるため順位も含める
        def rkey(r):
            return (r['レース番号'], r['競技名'], r['競技性別'], normalize(r['チーム名']), r['リレー年齢区分'], r['順位'])

        relay_count = 0
        member_count = 0
        for key, group in groupby(sorted(rows, key=rkey), key=rkey):
            members = list(group)
            first = members[0]

            team_id  = self.resolve_team(first['チーム名'])
            cat_id   = self.resolve_category(first['競技名'], first['競技性別'], 'リレー', first.get('水路', '共通'))
            relay_t  = parse_time(first['リレータイム'])
            mr = parse_time(first.get('大会記録', ''))
            jr = parse_time(first.get('日本記録', ''))
            wr = parse_time(first.get('世界記録', ''))

            if not self.dry_run:
                relay_res = self.sb.table('dt_result_relay').insert({
                    'event_id':            self.event_id,
                    'team_id':             team_id,
                    'category_id':         cat_id,
                    'age_group_label':     first['リレー年齢区分'].strip() or None,
                    'age_id':              self.resolve_age(first['リレー年齢区分'].strip()) if first['リレー年齢区分'].strip() else None,
                    'combined_age':        to_int(first.get('リレー実年齢合計', '')),
                    'rank':                to_int(first.get('順位', '')),
                    'time_seconds':        relay_t,
                    'time_display':        first['リレータイム'].strip() if relay_t else None,
                    'team_points':         to_float(first.get('チーム得点', '')),
                    'meet_record_seconds': mr,
                    'japan_record_seconds': jr,
                    'world_record_seconds': wr,
                    'is_meet_record':      to_bool_flag(first.get('大会新', '')),
                    'race_number':         to_int(first.get('レース番号', '')),
                }).execute()
                relay_id = relay_res.data[0]['id']

                seen_orders = set()
                for m in sorted(members, key=lambda x: to_int(x.get('リレー泳順', '')) or 0):
                    swim_order = to_int(m.get('リレー泳順', '')) or 0
                    if swim_order in seen_orders:
                        continue  # 同泳順の補欠選手はスキップ
                    seen_orders.add(swim_order)
                    m_team_id   = self.resolve_team(m['チーム名'])
                    m_player_id = self.resolve_player(m['選手名'], m['性別'], m_team_id)
                    if m_player_id == -1:
                        continue  # gender不明で選手特定できない場合スキップ
                    self.sb.table('dt_player_relay').insert({
                        'relay_result_id': relay_id,
                        'player_id':       m_player_id,
                        'swim_order':      swim_order,
                        'split_seconds':   parse_time(m.get('個人タイム', '')),
                        'is_meet_record':  to_bool_flag(m.get('大会新', '')),
                    }).execute()
                    member_count += 1

            relay_count += 1

        print(f"  → リレー{relay_count}件 / メンバー{member_count}件インポート完了")


# ── メイン ────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='参照CSVからDBにインポート')
    parser.add_argument('--round', type=int, default=80, help='大会回数 (default: 80)')
    parser.add_argument('--dry-run', action='store_true', help='実際には書き込まない')
    args = parser.parse_args()

    sb = create_client(os.getenv('NEXT_PUBLIC_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_KEY'))
    importer = ReferenceImporter(sb, args.round, dry_run=args.dry_run)

    print(f"\n{'[DRY-RUN] ' if args.dry_run else ''}--- 既存データ削除 ---")
    importer.delete_existing()

    print(f"\n--- 個人成績インポート ---")
    importer.import_individual(f'data/第{args.round}回競技結果（個人）.csv')

    print(f"\n--- リレー成績インポート ---")
    importer.import_relay(f'data/第{args.round}回競技結果（チーム）.csv')

    print('\n完了!')


if __name__ == '__main__':
    main()
