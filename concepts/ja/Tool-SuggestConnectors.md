# SuggestConnectors

`SearchMcpRegistry` が返す `directoryUuid` 値の完全なコネクタペイロードを解決し、有効化できる具体的なコネクタをユーザーに提示できるようにします。

## 使用タイミング

- `SearchMcpRegistry` が候補コネクタを返した後、提示用に完全な詳細を取得するため。

## 有効化

- ファーストパーティ API 上のリモート (claude.ai) セッションでのみ利用可能です。

## パラメータ

- `uuids` (array of strings, required): 解決する `directoryUuid` または `server_id` の値。1〜32 項目、各 1〜64 文字。

## 例

### 例 1: 2 つのレジストリヒットを解決

```
SuggestConnectors(uuids=["d290f1ee-6c54-4b01-90e6-d701748f0851", "a1b2c3d4-0000-4000-8000-abcdefabcdef"])
```

## 注意事項

- UUID を推測しないでください — `SearchMcpRegistry` から返ってきた識別子のみを解決してください。
- このツール自体は何も接続しません。コネクタの有効化はこのツールの外部で行われます。
