# SuggestSkills

トピックキーワードに基づいて、ユーザーが追加できるスタンドアロンスキル (まだ有効化されていないスキル) のカードをレンダリングします。

## 使用タイミング

- ユーザーのリクエストが、有効化していないスキルに一致する場合 (ユーザーが求めた場合は `trigger="user_asked"`、求められずに提案する場合は `trigger="proactive"`)。

## パラメータ

- `keywords` (array of strings, required): ユーザーのリクエストからのトピックキーワード。1〜8 項目、各 1〜64 文字。
- `contextLabel` (string, optional): 提案をリクエストに結び付ける短いラベル (最大 128 文字)。
- `trigger` (string, optional): この提案がどのように始まったか — `user_asked` または `proactive`。

## 例

### 例 1: トピックでスキルを提案

```
SuggestSkills(keywords=["data visualization", "charts"], contextLabel="For building the dashboard", trigger="user_asked")
```

すでに有効化されているスキルは結果から除外されます。

## 注意事項

- 提案カードをレンダリングするだけです — スキルの追加はこのツールの外部で行われます。後で `ListSkills` を呼び出して確認してください。
- HIPAA エンタープライズ構成では無効化されます。
