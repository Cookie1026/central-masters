#!/usr/bin/env python3
"""
選手名表記ゆれ（髙/高・崎/﨑・OCR誤読）のプレイヤーをマージする。
16件確定 / 5件スキップ（別人の可能性）

Usage:
  python scripts/merge_name_variants.py
  python scripts/merge_name_variants.py --apply
"""

import argparse
import os
import sys

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(".env.local")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# (keep_name, keep_id, del_name, del_id, team, reason)
MERGES = [
    # --- Group A: 髙/高 フォント互換文字 ---
    ("髙橋修一",   7544, "高橋修一",  11921, "セ・我孫子",   "髙/高フォント互換"),
    ("山﨑陸真",   8374, "山崎陸真",   8242, "セ・二俣川",   "﨑/崎互換文字"),
    ("髙橋里美",   7522, "高橋里美",  11688, "セ・横浜",     "髙/高フォント互換"),
    ("高梨大樹",  11564, "髙梨大樹",   8344, "セ・成城",     "髙/高フォント互換"),
    ("高島典子",  11866, "髙島典子",   8117, "セ・大森",     "髙/高フォント互換"),
    ("髙橋宙大",   8351, "高橋宙大",  12046, "セ・桶川北本", "髙/高フォント互換"),
    ("三﨑淳二",  13942, "三崎淳二",  16976, "セ・桶川北本", "﨑/崎互換文字"),
    ("嶋﨑昭夫",  11508, "嶋崎昭夫",   8132, "セ・西東京",   "﨑/崎互換文字"),
    # --- Group B: OCR誤読 ---
    ("蛯名とも子", 11834, "蛭名とも子",  7740, "セ・志木",     "蛭→蛯 OCR誤読"),
    ("服部宣孔",  14898, "服部宜孔",  14019, "セ・ときわ台", "宜→宣 OCR誤読"),
    ("弥間政隆",   8331, "彅間政隆",  14801, "セ・葛西",     "彅→弥 OCR誤読"),
    ("蛯名昌彦",  11728, "蛭名昌彦",   7835, "セ・志木",     "蛭→蛯 OCR誤読"),
    ("木澤杲子",  11762, "木澤果子",   8169, "セ・柏",       "果→杲 OCR誤読"),
    ("森川佳余子",  7953, "森川佳奈子", 13653, "クリーンスパ", "奈→余 OCR誤読"),
    ("茂櫛典子",   8383, "茂榊典子",   8354, "セ・成城",     "榊→櫛 OCR誤読"),
    ("後藤明美",   7656, "後藤元美",  15353, "セ・天王洲",   "元→明 OCR誤読"),
]

SKIPPED = [
    ("相澤翔駿", "相澤倖翔", "セ・流山",   "字順が異なる・別人の可能性"),
    ("亀田一暦", "亀田一磨", "セ・東戸塚", "異なる名前・兄弟の可能性"),
    ("亀田一暦", "亀田一鷹", "セ・東戸塚", "異なる名前・兄弟の可能性"),
    ("亀田一磨", "亀田一鷹", "セ・東戸塚", "異なる名前・兄弟の可能性"),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    sb = create_client(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_KEY"],
    )

    # Verify all IDs exist
    all_ids = set()
    for keep_n, keep_id, del_n, del_id, team, reason in MERGES:
        all_ids.add(keep_id)
        all_ids.add(del_id)

    existing = {
        r["id"] for r in
        sb.table("dt_player_person").select("id").in_("id", list(all_ids)).execute().data
    }
    missing = all_ids - existing
    if missing:
        raise SystemExit(f"ID未存在: {sorted(missing)}")

    # Count existing results per player
    pr = sb.table("dt_result_person").select("player_id").execute().data
    rm = sb.table("dt_player_relay").select("player_id").execute().data
    rc = {}
    for r in pr + rm:
        rc[r["player_id"]] = rc.get(r["player_id"], 0) + 1

    print(f"マージ計画: {len(MERGES)}件")
    print(f"{'keep_name':<20} {'keep_id':<8} {'n':>3}  {'del_name':<20} {'del_id':<8} {'n':>3}  team")
    print("-" * 90)
    for keep_n, keep_id, del_n, del_id, team, reason in MERGES:
        ck = rc.get(keep_id, 0)
        cd = rc.get(del_id, 0)
        print(f"{keep_n:<20} {keep_id:<8} {ck:>3}  {del_n:<20} {del_id:<8} {cd:>3}  [{team}]  {reason}")

    print(f"\nスキップ: {len(SKIPPED)}件 (別人の可能性)")
    for a, b, team, r in SKIPPED:
        print(f"  {a} / {b}  [{team}]  {r}")

    if not args.apply:
        print("\nDRY RUN完了。DBは変更していません。")
        return

    for keep_n, keep_id, del_n, del_id, team, reason in MERGES:
        # 1. Reroute any linked results (safety, del_id likely has n=0)
        sb.table("dt_result_person").update({"player_id": keep_id}).eq("player_id", del_id).execute()
        sb.table("dt_player_relay").update({"player_id": keep_id}).eq("player_id", del_id).execute()
        # 2. Add alias
        sb.table("mst_player_alias").insert({
            "alias": del_n,
            "canonical_name": keep_n,
            "status": "confirmed",
            "reason": reason,
        }).execute()
        # 3. Delete obsolete player
        sb.table("dt_player_person").delete().eq("id", del_id).execute()
        print(f"  merged: {del_n}({del_id}) -> {keep_n}({keep_id})  [{team}]")

    print(f"\n{len(MERGES)}件のマージ完了。")


if __name__ == "__main__":
    main()
