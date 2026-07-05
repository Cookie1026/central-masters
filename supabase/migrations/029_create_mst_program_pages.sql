-- プログラムPNGとOCRテキストのページマッピングテーブル
CREATE TABLE IF NOT EXISTS mst_program_pages (
  id        SERIAL PRIMARY KEY,
  round     SMALLINT NOT NULL,
  page_no   SMALLINT NOT NULL,
  text_content TEXT NOT NULL,
  UNIQUE (round, page_no)
);

-- 選手名検索用のGINインデックス（日本語全文検索）
CREATE INDEX IF NOT EXISTS idx_program_pages_text ON mst_program_pages USING gin(to_tsvector('simple', text_content));

-- anon ロールに SELECT を付与
GRANT SELECT ON mst_program_pages TO anon;
GRANT SELECT ON mst_program_pages TO authenticated;
