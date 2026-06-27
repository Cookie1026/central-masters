#!/usr/bin/env python3
"""
mst_team の重複・表記ゆれをマージし、チーム名の半角ASCII→全角変換SQLを生成する。
出力: supabase/migrations/merge_teams.sql
"""
import sys, os, unicodedata
sys.stdout.reconfigure(encoding='utf-8')
from collections import defaultdict

# 各種ダッシュ・ハイフン文字を全角ハイフンマイナス(U+FF0D)に統一
DASH_CHARS = '‐‑‒–—―−‐－'

def normalize_team(s: str) -> str:
    """チーム名を正規化（重複判定・DB格納名生成に使用）"""
    s = unicodedata.normalize('NFKC', s.strip())  # 半角カナ→全角
    s = s.replace('ザパス', 'ザバス')              # OCR誤読修正
    result = []
    for c in s:
        code = ord(c)
        if 0x21 <= code <= 0x7E:               # 半角ASCII → 全角
            result.append(chr(code + 0xFEE0))
        elif c in DASH_CHARS:                   # 各種ダッシュ → 全角ハイフン
            result.append('－')
        else:
            result.append(c)
    return ''.join(result)


def main():
    from dotenv import load_dotenv
    load_dotenv('.env.local')
    from supabase import create_client
    sb = create_client(os.environ['NEXT_PUBLIC_SUPABASE_URL'], os.environ['NEXT_PUBLIC_SUPABASE_ANON_KEY'])

    teams = sb.table('mst_team').select('id, name').order('id').execute().data

    # 空nameチームを分離
    empty_teams = [t for t in teams if not t['name']]
    valid_teams = [t for t in teams if t['name']]

    # 正規化後の名前でグループ化 → 重複検出
    groups: dict[str, list] = defaultdict(list)
    for t in valid_teams:
        key = normalize_team(t['name'])
        groups[key].append(t)

    duplicates = {k: v for k, v in groups.items() if len(v) > 1}
    renames    = [(t['id'], t['name'], normalize_team(t['name']))
                  for t in valid_teams
                  if normalize_team(t['name']) != t['name']]

    # ── レポート ──────────────────────────────────────────────
    print(f'空nameチーム: {len(empty_teams)}件')
    print(f'重複グループ: {len(duplicates)}件')
    for key, ts in sorted(duplicates.items()):
        print(f'  [{key}]')
        for t in ts:
            print(f'    id={t["id"]:3d}  {t["name"]}  →  keep id={min(x["id"] for x in ts)}')
    print(f'\n名前変更が必要: {len(renames)}件')
    for tid, old, new in renames:
        print(f'  id={tid:3d}  {old}  →  {new}')

    # ── SQL 生成 ──────────────────────────────────────────────
    lines = [
        '-- チームマスター整理 (merge_teams.py で自動生成)',
        '-- 1. 空name削除 / 2. 重複マージ / 3. 半角ASCII→全角変換',
        '',
    ]

    # STEP 1: 空nameチーム削除
    lines.append('-- STEP 1: 空nameチーム削除')
    for t in empty_teams:
        lines.append(f"-- 参照がないことを確認済みの場合のみ実行")
        lines.append(f"DELETE FROM mst_team WHERE id = {t['id']};")
    lines.append('')

    # STEP 2: 重複チームマージ（低IDを正規として高IDをマージ）
    lines.append('-- STEP 2: 重複チームマージ')
    for key, ts in sorted(duplicates.items()):
        canonical_id = min(t['id'] for t in ts)
        merge_ids    = [t['id'] for t in ts if t['id'] != canonical_id]
        canonical_name = next(t['name'] for t in ts if t['id'] == canonical_id)
        merge_names    = [t['name'] for t in ts if t['id'] != canonical_id]

        for mid, mname in zip(merge_ids, merge_names):
            lines.append(f"-- マージ: {mname} (id={mid}) → {canonical_name} (id={canonical_id})")
            lines.append(f"UPDATE dt_player_person    SET team_id = {canonical_id} WHERE team_id = {mid};")
            lines.append(f"UPDATE dt_result_relay     SET team_id = {canonical_id} WHERE team_id = {mid};")
            lines.append(f"UPDATE mst_team_alias      SET team_id = {canonical_id} WHERE team_id = {mid};")
            # dt_ranking_team: UNIQUE(event_id, team_id) があるので衝突回避
            lines.append(f"INSERT INTO dt_ranking_team (event_id, team_id, rank, total_points, male_points, female_points, mixed_points)")
            lines.append(f"  SELECT event_id, {canonical_id}, rank, total_points, male_points, female_points, mixed_points")
            lines.append(f"  FROM dt_ranking_team WHERE team_id = {mid}")
            lines.append(f"  ON CONFLICT (event_id, team_id) DO NOTHING;")
            lines.append(f"DELETE FROM dt_ranking_team WHERE team_id = {mid};")
            lines.append(f"DELETE FROM mst_team WHERE id = {mid};")
            lines.append('')

    # STEP 3: 半角ASCII→全角変換（重複マージ後に実施）
    lines.append('-- STEP 3: チーム名の半角ASCII→全角変換')
    # マージ後に残るIDのみ対象（削除されるIDは除外）
    deleted_ids = set()
    for ts in duplicates.values():
        canonical_id = min(t['id'] for t in ts)
        for t in ts:
            if t['id'] != canonical_id:
                deleted_ids.add(t['id'])
    for t in empty_teams:
        deleted_ids.add(t['id'])

    for tid, old, new in sorted(renames, key=lambda x: x[0]):
        if tid in deleted_ids:
            continue
        esc_new = new.replace("'", "''")
        esc_old = old.replace("'", "''")
        lines.append(f"UPDATE mst_team SET name = '{esc_new}' WHERE id = {tid};  -- {old}")

    # mst_team_alias も同様に全角変換
    lines.append('')
    lines.append('-- STEP 4: mst_team_alias の alias/team名も全角変換（必要に応じて実行）')
    aliases = sb.table('mst_team_alias').select('alias').execute().data
    for row in aliases:
        new_alias = normalize_team(row['alias'])
        if new_alias != row['alias']:
            esc_new = new_alias.replace("'", "''")
            esc_old = row['alias'].replace("'", "''")
            lines.append(f"UPDATE mst_team_alias SET alias = '{esc_new}' WHERE alias = '{esc_old}';")

    sql_path = 'supabase/migrations/merge_teams.sql'
    with open(sql_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print(f'\n✅ SQL生成: {sql_path}')


if __name__ == '__main__':
    main()
