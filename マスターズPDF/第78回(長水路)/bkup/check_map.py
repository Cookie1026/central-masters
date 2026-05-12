import json
m = json.load(open('pua_mapping.json', encoding='utf-8'))
with open('map_check.txt', 'w', encoding='utf-8') as f:
    for k, v in m.items():
        if v in ['セ', '間', '熊', '己', 'へ', 'ェ', 'ノ']:
            f.write(f"{k}: {v}\n")
