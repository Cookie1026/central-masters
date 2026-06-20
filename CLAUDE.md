# セントラルマスターズ記録検索サイト

## プロジェクト概要
中央マスターズ水泳大会の記録をWeb上で検索・閲覧できるサイト。
選手・種目・タイムなどで絞り込める検索機能が中心。

## 技術スタック
- **フロントエンド**: Next.js 15 (App Router) + TypeScript
- **スタイリング**: Tailwind CSS
- **データベース**: Supabase (PostgreSQL)
- **ファイルストレージ**: AWS S3（PDFファイル管理）
- **ホスティング**: Vercel
- **バージョン管理**: GitHub

## ディレクトリ構成
```
central_masters/
├── src/
│   ├── app/          # ページ（App Router）
│   ├── components/   # 再利用UIコンポーネント
│   ├── lib/          # DB接続・ユーティリティ
│   └── types/        # TypeScript型定義
├── data/             # CSVデータファイル（生データ・マスター）
├── マスターズPDF/      # 大会結果PDF
└── public/           # 静的アセット（画像など）
```

## 開発コマンド
```bash
npm run dev      # 開発サーバー起動 (http://localhost:3000)
npm run build    # 本番ビルド
npm run lint     # ESLintチェック
```

## コーディング規約
- TypeScriptの型は必ず定義する（`any`は原則禁止）
- コンポーネントファイル名はPascalCase（例：`SearchForm.tsx`）
- 関数・変数はcamelCase
- Server ComponentとClient Componentを意識して使い分ける

## 環境変数（`.env.local`に記載、絶対にコミットしない）
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_S3_BUCKET_NAME`

## データについて
- `data/`フォルダのCSVがマスターデータ
- Supabaseへのインポート後もCSVは保持する（バックアップ兼ねる）
- 大会ごとにCSVが追加される運用

## Claude Codeスラッシュコマンド
- `/1-png2txt` — PDFをPNG変換後に文字起こし
- `/2-txt2total` — 文字起こしTXTから総合成績CSVを生成
