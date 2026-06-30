"""
セントラルマスターズ最高記録一覧表 (プログラム p.11-17) → CSV
【v4】 pending方式 + dist確定後フラッシュ
      - age18/25 は dist が確定するまでペンディングに保持
      - スタンドアロンイベント切替時に dist をリセット
      - flush_pending は常に現在の event/dist で上書き
"""
import re
import csv
import argparse
from collections import defaultdict

try:
    import fitz
except ImportError:
    fitz = None

try:
    import pdfplumber
except ImportError:
    pdfplumber = None

DEFAULT_PDF_PATH = r'c:\自分の作業\central_masters\マスターズPDF\第79回(短水路)\第79回セントラルマスターズプログラム.pdf'
DEFAULT_OUT_CSV  = r'c:\自分の作業\central_masters\data\mst_meet_records.csv'
DEFAULT_COURSE   = '短水路'
DEFAULT_PAGE_FROM = 13
DEFAULT_PAGE_TO = 19
DEFAULT_GENDER_PAGES = '13:女,14:女,15:女,16:男,17:男,18:男,19:混合'

INDIVIDUAL_AGES = {18,25,30,35,40,45,50,55,60,65,70,75,80,85,90}
RELAY_AGES      = {119,120,160,200,240,280,320}
ALL_AGES        = INDIVIDUAL_AGES | RELAY_AGES

STANDALONE_EVENTS = {'自由形','背泳ぎ','平泳ぎ','バタフライ','ﾊﾞﾀﾌﾗｲ'}
MULTI_PREFIX      = {'個人','フリー','混合'}
MULTI_SUFFIX      = {'メドレー'}
ALL_EVENT_KW = STANDALONE_EVENTS | MULTI_PREFIX | MULTI_SUFFIX

REC_RE  = re.compile(r'^\d[\d-]+$')
DATE_RE = re.compile(r'^\d{4}/')
COL_SPLIT = 285  # 左右カラム境界x座標

# リレー氏名ペアの検出：'・'を含むトークンが氏名ペア、含まないものがチーム名
# ノイズとして除外するトークンセット（ALL_EVENT_KW でカバーされない "リレー" を追加）
RELAY_NAME_NOISE = {'-', 'リレー'}

def is_record(t):
    return bool(REC_RE.match(t)) and '-' in t

def normalize_record_time(t):
    m = re.match(r'^(\d+)-(\d{2})-(\d{2})$', t)
    if m:
        return f'{m.group(1)}:{m.group(2)}.{m.group(3)}'
    m = re.match(r'^(\d{1,2})-(\d{2})$', t)
    if m:
        return f'{m.group(1)}.{m.group(2)}'
    return t

def is_date(t):
    return bool(DATE_RE.match(t))

def is_age(t):
    try:    return int(t) in ALL_AGES
    except: return False

def is_event_kw(t):
    return t in ALL_EVENT_KW

def is_dist(t):
    # ０-９ = U+FF10-FF19（全角数字すべて）。元の ２-９ では ０,１ が漏れていた
    return bool(re.match(r'^[×Ｘ\d０-９]+ｍ$', t)) or \
           bool(re.match(r'^[4４]×[\d０-９]+[ｍm]$', t))

def split_relay_token(t):
    m = re.match(r'^(リレー)(\d+)$', t)
    if m: return m.group(1), int(m.group(2))
    m = re.match(r'^([4４]×\d+[ｍm])(\d+)$', t)
    if m: return m.group(1), int(m.group(2))
    return None, None

def apply_event_kw(state, kw):
    """
    イベントキーワードでstateのevent_partsとdistを更新。
    スタンドアロン or Multi接頭辞が来たらevent_partsをリセット。
    種目変更の場合はdistもリセット。
    """
    cur_ev = ''.join(state['event_parts'])
    if kw in STANDALONE_EVENTS or kw in MULTI_PREFIX:
        new_parts = [kw]
    elif kw in MULTI_SUFFIX:
        if state['event_parts'] and state['event_parts'][-1] in MULTI_PREFIX:
            new_parts = state['event_parts'] + [kw]
        else:
            new_parts = [kw]
    else:
        new_parts = state['event_parts']

    new_ev = ''.join(new_parts)
    if new_ev != cur_ev:
        # 種目が変わった → dist もリセット
        state['event_parts'] = new_parts
        state['dist'] = ''
    else:
        state['event_parts'] = new_parts

def flush_pending(state, records):
    """ペンディングレコードに現在のevent/distを上書きし、recordsへ移動"""
    ev = ''.join(state['event_parts'])
    dt = state['dist']
    for p in state['pending']:
        if ev: p['event']    = ev
        if dt: p['distance'] = dt
    records.extend(state['pending'])
    state['pending'].clear()

DIST_NORM = {
    '２５ｍ':'25m','５０ｍ':'50m','１００ｍ':'100m','２００ｍ':'200m',
    '４００ｍ':'400m','８００ｍ':'800m','１５００ｍ':'1500m',
    '×２５ｍ':'4×25m','×５０ｍ':'4×50m','×１００ｍ':'4×100m','×２００ｍ':'4×200m',
    '4×25m':'4×25m','4×50m':'4×50m','4×100m':'4×100m','4×200m':'4×200m',
    '４×２５ｍ':'4×25m','４×５０ｍ':'4×50m','４×１００ｍ':'4×100m','４×２００ｍ':'4×200m',
    # split_relay_token で分割後の形（ASCII 4×NNｍ → 全角ｍ）
    '4×25ｍ':'4×25m','4×50ｍ':'4×50m','4×100ｍ':'4×100m','4×200ｍ':'4×200m',
}
EVENT_NORM = {'ﾊﾞﾀﾌﾗｲ':'バタフライ'}

def make_state():
    return {'event_parts': [], 'dist': '', 'pending': [], 'relay_entry': None, 'relay_buffer': []}

def split_individual_name_team(raw: str) -> tuple[str, str]:
    parts = raw.strip().rsplit(' ', 1)
    if len(parts) != 2:
        return raw.replace(' ', '').replace('\u3000', ''), ''
    return parts[0].replace(' ', '').replace('\u3000', ''), parts[1]

def open_pdf_words(path: str):
    if fitz is not None:
        doc = fitz.open(path)
        return lambda page_num: [
            (w[0], w[1], w[4].strip())
            for w in doc[page_num - 1].get_text('words')
        ]
    if pdfplumber is None:
        raise RuntimeError("PyMuPDF(fitz) or pdfplumber is required")
    doc = pdfplumber.open(path)
    return lambda page_num: [
        (w['x0'], w['top'], w['text'].strip())
        for w in doc.pages[page_num - 1].extract_words()
    ]

def parse_gender_pages(text):
    mapping = {}
    for item in text.split(','):
        item = item.strip()
        if not item:
            continue
        page_text, gender = item.split(':', 1)
        mapping[int(page_text.strip())] = gender.strip()
    return mapping

def build_parser():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pdf', default=DEFAULT_PDF_PATH)
    parser.add_argument('--out', default=DEFAULT_OUT_CSV)
    parser.add_argument('--course', default=DEFAULT_COURSE, choices=['短水路', '長水路'])
    parser.add_argument('--page-from', type=int, default=DEFAULT_PAGE_FROM)
    parser.add_argument('--page-to', type=int, default=DEFAULT_PAGE_TO)
    parser.add_argument('--gender-pages', default=DEFAULT_GENDER_PAGES)
    return parser

def main():
    args = build_parser().parse_args()
    gender_by_page = parse_gender_pages(args.gender_pages)
    get_words = open_pdf_words(args.pdf)
    records = []

    for pdf_page_num in range(args.page_from, args.page_to + 1):
        gender = gender_by_page[pdf_page_num]
        words  = get_words(pdf_page_num)

        rows_dict = defaultdict(list)
        for w in words:
            x0, y0, text = w
            if y0 < 55 or y0 > 810: continue
            y_key = round(y0 / 3) * 3
            rows_dict[y_key].append((x0, text.strip()))

        sL = make_state()
        sR = make_state()

        def process_col(col_tokens, s):
        # --------- ラベル処理（event / dist 更新） ---------
            prev_ev   = ''.join(s['event_parts'])
            prev_dist = s['dist']

            relay_age_from_token = None
            for x, t in col_tokens:
                if is_event_kw(t):
                    apply_event_kw(s, t)
                elif is_dist(t):
                    s['dist'] = DIST_NORM.get(t, t)
                else:
                    ev_part, relay_age_v = split_relay_token(t)
                    if ev_part is not None:
                    # combined token からリレー年齢を保存（例: リレー120 → 120）
                        if relay_age_v in RELAY_AGES:
                            relay_age_from_token = relay_age_v
                    # リレー系接尾 ('リレー') をevent_partsへ追加
                        if ev_part == 'リレー' and not any(p == 'リレー' for p in s['event_parts']):
                            s['event_parts'].append('リレー')
                    # 距離部分があれば dist に
                        if re.match(r'^[4４]×', ev_part):
                            s['dist'] = DIST_NORM.get(ev_part, ev_part)

            new_ev   = ''.join(s['event_parts'])
            new_dist = s['dist']

        # 個人種目 pending フラッシュ（dist が確定し変化した場合）
            if s['pending'] and new_dist and (new_ev != prev_ev or new_dist != prev_dist):
                flush_pending(s, records)

        # リレー pending フラッシュ（'×' を含む relay dist が確定した場合）
            if s['relay_buffer'] and new_dist and '×' in new_dist and (new_ev != prev_ev or new_dist != prev_dist):
                for p in s['relay_buffer']:
                    if new_ev: p['event']    = new_ev
                    p['distance'] = new_dist
                records.extend(s['relay_buffer'])
                s['relay_buffer'].clear()

        # --------- データ行処理 ---------
            ages   = [(x, t) for x, t in col_tokens if is_age(t)]
            recs   = [(x, t) for x, t in col_tokens if is_record(t)]
            dates  = [(x, t) for x, t in col_tokens if is_date(t)]

            if not recs or not dates:
            # リレー継続行（氏名のみ）：ノイズ以外の全トークンを追記
            # ※ PDF由来のASCIIスペースで苗字が分割される場合があるため
            #   '・'を含むトークンだけでなく分割された苗字片も含める
                name_only = [t for x, t in col_tokens
                             if not is_age(t) and not is_event_kw(t) and not is_dist(t)
                             and not is_record(t) and not is_date(t)
                             and split_relay_token(t)[0] is None]
                if name_only and s['relay_entry']:
                    valid_tokens = [t for t in name_only
                                    if t not in RELAY_NAME_NOISE
                                    and not t.isdigit()
                                    and t not in ALL_EVENT_KW]
                    if valid_tokens:
                        # 分割された苗字片を結合して pair2 文字列にする（全角スペース除去）
                        pair2 = ''.join(t.replace('　', '') for t in valid_tokens)
                        existing = s['relay_entry']['name_team_raw']
                        s['relay_entry']['name_team_raw'] = (existing + '・' + pair2) if existing else pair2
                return

        # ages リストが空なら combined token から取った relay_age_from_token を使う
            age    = ages[0][1] if ages else (str(relay_age_from_token) if relay_age_from_token else '')
            record = normalize_record_time(recs[0][1])
            date   = dates[0][1]
            age_x  = ages[0][0] if ages else (col_tokens[0][0] if col_tokens else 50)
            rec_x  = recs[0][0]

            # x座標付きでmidトークンを収集（リレーのチーム名判定に使う）
            mid_with_x = [(x, t) for x, t in col_tokens
                          if age_x < x < rec_x
                          and not is_age(t) and not is_event_kw(t) and not is_dist(t)
                          and split_relay_token(t)[0] is None]
            mid = [t for x, t in mid_with_x]

            age_int = int(age) if age.isdigit() else 0
            is_relay_row = age_int in RELAY_AGES

            if is_relay_row:
                # チーム名: x座標が最大（記録列に最も近い）の非ペア・非ノイズトークン
                # ※ PDF由来のASCIIスペースで苗字が分割される場合があるため
                #   '・'の有無だけでなくx座標の右端を使ってチームを特定する
                team_cands = [(x, t) for x, t in mid_with_x
                              if '・' not in t
                              and t not in RELAY_NAME_NOISE
                              and not t.isdigit()
                              and t not in ALL_EVENT_KW]
                if team_cands:
                    team_x, team_t = team_cands[-1]  # 最右端 = チーム名
                    entry_team_name = team_t
                    name_tokens = [t for x, t in mid_with_x
                                   if not (x == team_x and t == team_t)
                                   and t not in RELAY_NAME_NOISE
                                   and not t.isdigit()
                                   and t not in ALL_EVENT_KW]
                else:
                    entry_team_name = ''
                    name_tokens = [t for x, t in mid_with_x
                                   if t not in RELAY_NAME_NOISE
                                   and not t.isdigit()
                                   and t not in ALL_EVENT_KW]
                # 分割された苗字片を結合して pair1 文字列にする（全角スペース除去）
                entry_name_raw = ''.join(t.replace('　', '') for t in name_tokens)
            else:
                entry_name_raw = ' '.join(mid)
                entry_team_name = ''

            entry = {
                'course': args.course,
                'gender': gender,
                'event':  new_ev,
                'distance': new_dist,
                'age_group': age,
                'is_relay': '1' if is_relay_row else '0',
                'name_team_raw': entry_name_raw,
                'team_name': entry_team_name,
                'record': record,
                'established_date': date,
            }

            if is_relay_row:
            # age119/120 はブロック先頭 → 前ブロックの dist を引き継がず常にリセット
            # age160+ は combined token で dist が確定するので引き継ぐ
                if age_int in (119, 120):
                    relay_dist = ''
                else:
                    relay_dist = new_dist if '×' in new_dist else ''
                entry['distance'] = relay_dist
                if s['relay_entry']:
                    old = s['relay_entry']
                # relay_entry にまだ dist がなく、今 relay_dist が確定したなら付与
                    if not old['distance'] and relay_dist:
                        old['distance'] = relay_dist
                        if new_ev: old['event'] = new_ev
                    if old['distance']:
                        records.append(old)
                    else:
                        s['relay_buffer'].append(old)
                s['relay_entry'] = entry
            elif age in ('18', '25') or not new_dist:
                # age18/25 は常に pending（次のブロックへの dist 引き継ぎを防ぐため dist をクリア）
                # not new_dist は個人メドレー等で age30 以降も dist が後出しになる場合に対応
                entry['distance'] = ''
                s['pending'].append(entry)
            else:
                records.append(entry)

        for y_key in sorted(rows_dict.keys()):
            all_tokens = sorted(rows_dict[y_key], key=lambda t: t[0])
            process_col([(x, t) for x, t in all_tokens if x < COL_SPLIT], sL)
            process_col([(x, t) for x, t in all_tokens if x >= COL_SPLIT], sR)

        # ページ末処理
        flush_pending(sL, records)
        flush_pending(sR, records)
        for s in (sL, sR):
            if s['relay_entry']:
                records.append(s['relay_entry']); s['relay_entry'] = None
            if s['relay_buffer']:
                records.extend(s['relay_buffer']); s['relay_buffer'].clear()

    # EVENT正規化 + 氏名/チーム名の確定
    for r in records:
        r['event'] = EVENT_NORM.get(r['event'], r['event'])
        if r['is_relay'] == '0':
            # 個人: name_team_raw（姓名+チーム）を分割し、name_team_rawを姓名のみに更新
            athlete_name, team_name = split_individual_name_team(r['name_team_raw'])
            r['athlete_name'] = athlete_name
            r['team_name'] = team_name
            r['name_team_raw'] = athlete_name  # 名前のみ（スペース除去済み）保存
        else:
            # リレー: name_team_rawはパース時に'・'結合・全角スペース除去済み
            r['athlete_name'] = ''
            if 'team_name' not in r:
                r['team_name'] = ''

    # --- CSV出力 ---
    fields = ['course','gender','event','distance','age_group','is_relay','name_team_raw','record','established_date','athlete_name','team_name']
    with open(args.out, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(records)

    print(f'抽出件数: {len(records)}')
    missing = [r for r in records if r['event']=='' or r['distance']=='']
    print(f'event/distance 未確定: {len(missing)}件')
    for r in missing[:20]:
        print(f"  age={r['age_group']} ev={r['event']!r} dist={r['distance']!r} relay={r['is_relay']} {r['name_team_raw'][:25]}")

if __name__ == "__main__":
    main()
