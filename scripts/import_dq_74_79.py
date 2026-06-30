"""
第74〜79回の失格・棄権データをDBに反映する。

DRY_RUNモード（デフォルト）は変更を加えない確認モード。
実行: python import_dq_74_79.py --execute

処理内容:
  Step 1: event_id=1〜6 の全 null-rank 個人エントリを is_withdrawal=TRUE に設定
  Step 2: 全回の個人失格エントリに disqualification_code を設定
          (is_withdrawal=FALSE に戻す)
  Step 3: リレー失格は既存エントリがないため今回は対象外
          (DBに null-rank リレーエントリがなく INSERT が別途必要)
"""
import os
import sys
import unicodedata
import argparse
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from supabase import create_client

# ---- 個人失格マスター (スキャン結果から) ----
# name はスペース削除後の正規化名、team_hint は部分一致で照合
INDIVIDUAL_DQ = {
    # 第74回 event_id=1
    1: [
        {"name": "臼井希代子", "team_hint": "大宮宮原", "code": "出2"},
        {"name": "加藤直子",   "team_hint": "横浜",     "code": "背4"},
        {"name": "平井節子",   "team_hint": "南千住",   "code": "出2"},
        {"name": "浅野みどり", "team_hint": "天王洲",   "code": "出2"},
        {"name": "増渕毅",     "team_hint": "トレッサ", "code": "出2"},
        {"name": "増渕毅",     "team_hint": "トレッサ", "code": "出2"},  # 2種目失格
        {"name": "生田目則子", "team_hint": "自由が丘", "code": "競1"},
        {"name": "藤岡和男",   "team_hint": "流山",     "code": "競7"},
        {"name": "西村咲喜子", "team_hint": "志木",     "code": "平5"},
        {"name": "西岡祐子",   "team_hint": "用賀",     "code": "出2"},
        {"name": "弥間政隆",   "team_hint": "葛西",     "code": "出2"},  # 弭→弥(DB登録名)
        {"name": "松本海星",   "team_hint": "清瀬",     "code": "出2"},
        {"name": "鈴木篤",     "team_hint": "おおたか", "code": "背7"},
        {"name": "吉村華余",   "team_hint": "長津田",   "code": "バ7"},
    ],
    # 第75回 event_id=2
    2: [
        {"name": "吉澤隆",     "team_hint": "清瀬",     "code": "メ2"},
        {"name": "櫻井直仁",   "team_hint": "清瀬",     "code": "出2"},
        {"name": "加藤直子",   "team_hint": "横浜",     "code": "競1"},
        {"name": "松永タズヨ", "team_hint": "おおたか", "code": "競7"},
        {"name": "宮瀬吉弘",   "team_hint": "おおたか", "code": "背4"},
        {"name": "池田敏子",   "team_hint": "戸塚",     "code": "平13"},
        {"name": "三沢弘美",   "team_hint": "長津田",   "code": "平1"},
        {"name": "大津信弘",   "team_hint": "越谷",     "code": "平13"},
        {"name": "辻真治",     "team_hint": "南青山",   "code": "平14"},
        {"name": "千葉諒太",   "team_hint": "ザバス",   "code": "平14"},
        {"name": "鈴木喜代子", "team_hint": "茂原",     "code": "バ3"},
    ],
    # 第79回 event_id=6
    6: [
        {"name": "三嶋祐子",   "team_hint": "阿佐谷",   "code": "出2"},
        {"name": "神保清美",   "team_hint": "自由が丘", "code": "出2"},
        {"name": "上松高造",   "team_hint": "武蔵小杉", "code": "出2"},
        {"name": "二宮淳",     "team_hint": "トレッサ", "code": "出2"},
        {"name": "浅野みどり", "team_hint": "天王洲",   "code": "出2"},
        {"name": "雨宮裕子",   "team_hint": "大宮宮原", "code": "バ6"},
        {"name": "森川タエ子", "team_hint": "我孫子",   "code": "競1"},
        {"name": "草森理子",   "team_hint": "成城",     "code": "出2"},
        {"name": "西谷愛子",   "team_hint": "芦屋",     "code": "自2"},
        {"name": "舘野美香",   "team_hint": "目黒",     "code": "平14"},
        {"name": "宮林佑妃",   "team_hint": "長津田",   "code": "平14"},
        {"name": "内藤謙一",   "team_hint": "松戸",     "code": "平2"},
        {"name": "伊藤正二",   "team_hint": "大森",     "code": "平2"},
        {"name": "広瀬幸音",   "team_hint": "成城",     "code": "出2"},
        {"name": "飯沼明",     "team_hint": "長津田",   "code": "出2"},
    ],
    # 第76回 event_id=3 (TXTスキャン結果)
    3: [
        {"name": "小池淳子",   "team_hint": "長津田",   "code": "出2"},
        {"name": "眞壁功",     "team_hint": "藤沢",     "code": "メ7"},
        {"name": "高橋修一",   "team_hint": "我孫子",   "code": "メ7"},
        {"name": "君島篤",     "team_hint": "西東京",   "code": "メ6"},
        {"name": "大山伴恵",   "team_hint": "トレッサ", "code": "出2"},
        {"name": "平澤馨",     "team_hint": "府中",     "code": "出2"},
        {"name": "森内裕子",   "team_hint": "天王洲",   "code": "出2"},
        {"name": "谷口治典",   "team_hint": "久喜",     "code": "出2"},
        {"name": "鈴木正基",   "team_hint": "阿佐谷",   "code": "出2"},
        {"name": "田中敏子",   "team_hint": "阿佐谷",   "code": "出2"},
        {"name": "太田重代",   "team_hint": "二俣川",   "code": "平4"},
        {"name": "佐藤美絵子", "team_hint": "清瀬",     "code": "出2"},
        {"name": "若山聖亮",   "team_hint": "SPA",      "code": "出2"},
        {"name": "田中もみぢ", "team_hint": "おおたか", "code": "バ2"},
        {"name": "渡邉登美子", "team_hint": "阿佐谷",   "code": "バ7"},
        {"name": "柳沢智子",   "team_hint": "成城",     "code": "バ2"},
        {"name": "清水佳苗",   "team_hint": "曽谷",     "code": "出2"},
        {"name": "大塚克",     "team_hint": "市川",     "code": "平13"},
        {"name": "小林眞那登", "team_hint": "越谷",     "code": "出2"},
        {"name": "加藤直子",   "team_hint": "横浜",     "code": "競7"},
        {"name": "舛尾妃呂子", "team_hint": "稲毛",     "code": "競5"},
        {"name": "佐々木れい", "team_hint": "志木",     "code": "出2"},
        {"name": "舘野圭子",   "team_hint": "用賀",     "code": "背7"},
        {"name": "山本奈穂美", "team_hint": "大宮宮原", "code": "背8"},
        {"name": "大津信弘",   "team_hint": "越谷",     "code": "背8"},
    ],
    # 第77回 event_id=4 (TXTスキャン結果)
    4: [
        {"name": "木村恵子",   "team_hint": "越谷",     "code": "メ6"},
        {"name": "戸倉陽子",   "team_hint": "慶應",     "code": "出2"},
        {"name": "豊田典子",   "team_hint": "下北沢",   "code": "競1"},
        {"name": "鈴木静江",   "team_hint": "クリーン", "code": "平14"},
        {"name": "山本勝",     "team_hint": "慶應",     "code": "平1"},
        {"name": "東條博",     "team_hint": "阿佐谷",   "code": "平4"},
        {"name": "浅野みどり", "team_hint": "天王洲",   "code": "出2"},
        {"name": "広瀬幸音",   "team_hint": "成城",     "code": "バ8"},
    ],
    # 第78回 event_id=5 (TXTスキャン結果)
    5: [
        {"name": "堂園徹",     "team_hint": "天王洲",   "code": "競1"},
        {"name": "浅野みどり", "team_hint": "天王洲",   "code": "出2"},
        {"name": "増渕博之",   "team_hint": "藤沢",     "code": "出2"},
        {"name": "西村咲喜子", "team_hint": "志木",     "code": "平14"},
        {"name": "山本勝",     "team_hint": "慶應",     "code": "平13"},
        {"name": "祖川久茂",   "team_hint": "長津田",   "code": "平10"},
    ],
}


def normalize(s: str) -> str:
    """全角半角統一 + スペース削除"""
    return unicodedata.normalize("NFKC", s).replace(" ", "").replace("　", "")


def main(dry_run: bool) -> None:
    sb = create_client(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    )
    mode = "DRY_RUN" if dry_run else "EXECUTE"
    print(f"=== import_dq_74_79.py [{mode}] ===\n")

    # ---------------------------------------------------------------
    # Step 1: 全null-rank個人エントリを棄権に設定 (event_id 1〜6)
    # ---------------------------------------------------------------
    print("--- Step 1: 全null-rank個人エントリを棄権に設定 ---")
    total_wd = 0
    for event_id in range(1, 7):
        # まだ is_withdrawal=FALSE かつ disqualification_code が NULL のもののみ
        rows = (
            sb.table("dt_result_person")
            .select("id")
            .eq("event_id", event_id)
            .is_("rank", None)
            .is_("time_seconds", None)
            .is_("disqualification_code", None)
            .eq("is_withdrawal", False)
            .execute()
            .data
        )
        if not rows:
            print(f"  第{73+event_id}回 (event_id={event_id}): 0件 → スキップ")
            continue
        ids = [r["id"] for r in rows]
        print(f"  第{73+event_id}回 (event_id={event_id}): {len(ids)}件 → is_withdrawal=TRUE")
        if not dry_run:
            sb.table("dt_result_person").update({"is_withdrawal": True}).in_("id", ids).execute()
        total_wd += len(ids)
    print(f"  合計 {total_wd} 件の棄権設定\n")

    # ---------------------------------------------------------------
    # Step 2: 個人失格コードを設定 (第74・75・79回)
    # ---------------------------------------------------------------
    print("--- Step 2: 個人失格コードを設定 ---")
    for event_id, dq_list in sorted(INDIVIDUAL_DQ.items()):
        round_no = 73 + event_id
        print(f"\n  第{round_no}回 (event_id={event_id}): {len(dq_list)} エントリ")

        # null-rank個人エントリを全取得（選手情報を JOIN）
        null_rows = (
            sb.table("dt_result_person")
            .select("id, dt_player_person(name, mst_team(name))")
            .eq("event_id", event_id)
            .is_("rank", None)
            .is_("time_seconds", None)
            .execute()
            .data
        )

        # (正規化名, 正規化チーム名) → result_id のマップ（同名同チームが複数あれば複数エントリ）
        from collections import defaultdict
        key_to_ids: dict[tuple, list[int]] = defaultdict(list)
        for row in null_rows:
            p = row.get("dt_player_person") or {}
            if isinstance(p, list):
                p = p[0] if p else {}
            t = p.get("mst_team") or {}
            if isinstance(t, list):
                t = t[0] if t else {}
            pname = normalize(p.get("name", ""))
            tname = normalize(t.get("name", ""))
            key_to_ids[(pname, tname)].append(row["id"])

        matched_ids = set()
        for dq in dq_list:
            target_name = normalize(dq["name"])
            target_hint = normalize(dq["team_hint"])

            # 名前が完全一致 かつ チームヒントが部分一致
            candidates = [
                (key, ids)
                for key, ids in key_to_ids.items()
                if key[0] == target_name and target_hint in key[1]
            ]

            if not candidates:
                print(f"    [MISS] {dq['name']} / {dq['team_hint']} ({dq['code']}) → 一致なし")
                continue

            # 複数候補がある場合は未設定のものを優先
            for key, ids in candidates:
                unset = [i for i in ids if i not in matched_ids]
                if not unset:
                    print(f"    [SKIP] {dq['name']} / {dq['team_hint']} ({dq['code']}) → 既に照合済み")
                    continue
                target_id = unset[0]
                matched_ids.add(target_id)
                print(f"    [OK] id={target_id} {dq['name']} / {key[1]} → {dq['code']}")
                if not dry_run:
                    sb.table("dt_result_person").update({
                        "disqualification_code": dq["code"],
                        "is_withdrawal": False,
                    }).eq("id", target_id).execute()

    print("\n=== 完了 ===")
    if dry_run:
        print("DRY RUNモード: 変更は加えていません。")
        print("実行するには: python import_dq_74_79.py --execute")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true", help="実際にDBを更新する")
    args = parser.parse_args()
    main(dry_run=not args.execute)
