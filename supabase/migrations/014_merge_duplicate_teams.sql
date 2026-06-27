-- ============================================================
-- チーム重複統合
-- 1. セ・袖ヶ浦(18)  ← セ・袖ケ浦(19)   ヶ/ケ OCR誤読
-- 2. セ・館山(21)    ← セ・馆山(22)      館/馆 OCR誤読
-- 3. ザバス八景(70)  ← 八景(95)          リレー短縮名
-- 4. ザバス川崎(71)  ← 川崎(96)          リレー短縮名
-- 5. ザバス金沢八(73)← 金沢八景(97)      リレー短縮名
-- ============================================================

BEGIN;

-- ============================================================
-- 1. セ・袖ヶ浦(18) ← セ・袖ケ浦(19)
-- ============================================================

-- 重複選手: 成績を keep 側 player_id に付け替えて merge 側を削除
UPDATE dt_result_person SET player_id=14428 WHERE player_id=16847; -- 畠山雅和
UPDATE dt_player_relay  SET player_id=14428 WHERE player_id=16847;
UPDATE dt_result_person SET player_id=14139 WHERE player_id=15029; -- 江頭由美子
UPDATE dt_player_relay  SET player_id=14139 WHERE player_id=15029;
UPDATE dt_result_person SET player_id=17710 WHERE player_id=15067; -- 渡邉茜
UPDATE dt_player_relay  SET player_id=17710 WHERE player_id=15067;
UPDATE dt_result_person SET player_id=17668 WHERE player_id=15280; -- 豊島由里子
UPDATE dt_player_relay  SET player_id=17668 WHERE player_id=15280;
UPDATE dt_result_person SET player_id=14720 WHERE player_id=15332; -- 櫻井理恵子
UPDATE dt_player_relay  SET player_id=14720 WHERE player_id=15332;
UPDATE dt_result_person SET player_id=14393 WHERE player_id=15354; -- 豊島葉子
UPDATE dt_player_relay  SET player_id=14393 WHERE player_id=15354;
UPDATE dt_result_person SET player_id=16021 WHERE player_id=15062; -- 大和久佳江
UPDATE dt_player_relay  SET player_id=16021 WHERE player_id=15062;
UPDATE dt_result_person SET player_id=14571 WHERE player_id=15564; -- 遠藤真理
UPDATE dt_player_relay  SET player_id=14571 WHERE player_id=15564;
UPDATE dt_result_person SET player_id=14423 WHERE player_id=16519; -- 加藤寿起
UPDATE dt_player_relay  SET player_id=14423 WHERE player_id=16519;
UPDATE dt_result_person SET player_id=17469 WHERE player_id=16558; -- 松本光太郎
UPDATE dt_player_relay  SET player_id=17469 WHERE player_id=16558;
DELETE FROM dt_player_person WHERE id IN (16847,15029,15067,15280,15332,15354,15062,15564,16519,16558);

-- merge 側のみの選手: team_id を 18 に移管
UPDATE dt_player_person SET team_id=18 WHERE id IN (16356,16767,16378,16379,16388,16468,15279);

-- リレー成績のチーム付け替え
UPDATE dt_result_relay SET team_id=18 WHERE team_id=19;

-- alias 登録・チーム削除
INSERT INTO mst_team_alias (alias, team_id) VALUES ('セ・袖ケ浦', 18) ON CONFLICT (alias) DO UPDATE SET team_id=EXCLUDED.team_id;
DELETE FROM mst_team WHERE id=19;


-- ============================================================
-- 2. セ・館山(21) ← セ・馆山(22)
-- ============================================================

UPDATE dt_result_person SET player_id=11988 WHERE player_id=11544; -- 柳瀬浩志
UPDATE dt_player_relay  SET player_id=11988 WHERE player_id=11544;
UPDATE dt_result_person SET player_id=8317  WHERE player_id=12114; -- 安藤次郎
UPDATE dt_player_relay  SET player_id=8317  WHERE player_id=12114;
DELETE FROM dt_player_person WHERE id IN (11544,12114);

UPDATE dt_result_relay SET team_id=21 WHERE team_id=22;

INSERT INTO mst_team_alias (alias, team_id) VALUES ('セ・馆山', 21) ON CONFLICT (alias) DO UPDATE SET team_id=EXCLUDED.team_id;
DELETE FROM mst_team WHERE id=22;


-- ============================================================
-- 3. ザバス八景(70) ← 八景(95)
-- ============================================================

UPDATE dt_result_person SET player_id=14731 WHERE player_id=14983; -- 真栄田こずえ
UPDATE dt_player_relay  SET player_id=14731 WHERE player_id=14983;
UPDATE dt_result_person SET player_id=13622 WHERE player_id=14984; -- 座間千鶴子
UPDATE dt_player_relay  SET player_id=13622 WHERE player_id=14984;
UPDATE dt_result_person SET player_id=14347 WHERE player_id=14985; -- 野村洋子
UPDATE dt_player_relay  SET player_id=14347 WHERE player_id=14985;
UPDATE dt_result_person SET player_id=13796 WHERE player_id=14986; -- 鶴岡美佐
UPDATE dt_player_relay  SET player_id=13796 WHERE player_id=14986;
DELETE FROM dt_player_person WHERE id IN (14983,14984,14985,14986);

UPDATE dt_result_relay SET team_id=70 WHERE team_id=95;

INSERT INTO mst_team_alias (alias, team_id) VALUES ('八景', 70) ON CONFLICT (alias) DO UPDATE SET team_id=EXCLUDED.team_id;
DELETE FROM mst_team WHERE id=95;


-- ============================================================
-- 4. ザバス川崎(71) ← 川崎(96)  ※merge側に選手なし
-- ============================================================

UPDATE dt_result_relay SET team_id=71 WHERE team_id=96;

INSERT INTO mst_team_alias (alias, team_id) VALUES ('川崎', 71) ON CONFLICT (alias) DO UPDATE SET team_id=EXCLUDED.team_id;
DELETE FROM mst_team WHERE id=96;


-- ============================================================
-- 5. ザバス金沢八(73) ← 金沢八景(97)
-- ============================================================

UPDATE dt_result_person SET player_id=8355  WHERE player_id=13145; -- 座間千鶴子
UPDATE dt_player_relay  SET player_id=8355  WHERE player_id=13145;
UPDATE dt_result_person SET player_id=8255  WHERE player_id=13146; -- 鶴岡美佐
UPDATE dt_player_relay  SET player_id=8255  WHERE player_id=13146;
UPDATE dt_result_person SET player_id=12899 WHERE player_id=13147; -- 真栄田こずえ
UPDATE dt_player_relay  SET player_id=12899 WHERE player_id=13147;
UPDATE dt_result_person SET player_id=13056 WHERE player_id=13148; -- 野村洋子
UPDATE dt_player_relay  SET player_id=13056 WHERE player_id=13148;
UPDATE dt_result_person SET player_id=11781 WHERE player_id=13149; -- 高梨佳代子
UPDATE dt_player_relay  SET player_id=11781 WHERE player_id=13149;
DELETE FROM dt_player_person WHERE id IN (13145,13146,13147,13148,13149);

UPDATE dt_result_relay SET team_id=73 WHERE team_id=97;

INSERT INTO mst_team_alias (alias, team_id) VALUES ('金沢八景', 73) ON CONFLICT (alias) DO UPDATE SET team_id=EXCLUDED.team_id;
DELETE FROM mst_team WHERE id=97;


COMMIT;
