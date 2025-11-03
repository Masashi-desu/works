# Masahi Desu Works Static Site

## 長文テキストの改行ポリシー

製品ページなどの長文説明では、HTML の `<br>` ではなく改行コード (`\n`) と `white-space: pre-line;` を組み合わせて改行を表現します。

- 対象の要素には `whitespace-pre-line`（Tailwind）など、改行コードを反映するクラスを付与してください。
- 翻訳/文言テーブルの文字列には必要な位置に `\n` を挿入します。
- この方針により、言語切り替えスクリプトで `textContent` を使ったまま安全に改行を扱えます。

例：`products/TypeFetch/index.html` の `data-i18n="body"`。

## エージェント向けテスト記述ガイド

Playwright などで追加する自動テストスクリプトには、以下を必ずファイル先頭のコメントで記載してください。

- **目的**: どの UI/挙動を検証するテストなのか。
- **期待値**: 判定基準となる色・レイアウト・状態などの具体的な値。
- **検証方法**: ページの開き方やステップ、値の取得方法など。

テスト名も内容が判別できるように命名し、後から見た人が意図を理解しやすいようにします。既存例: `tests/playwright/footer-accent-focus.js`, `tests/playwright/surround1x0-light-theme.js`。
