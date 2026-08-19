# Projects

ユーザーの Claude プロジェクトナレッジベース内のプロジェクトドキュメントを管理します: ドキュメントの読み取り、検索、書き込み、削除、またはプロジェクト情報の取得。

## 使用タイミング

- ドキュメント (成果物、メモ、参考資料) をユーザーのプロジェクトに永続化し、セッションを超えて残す。
- 既存のプロジェクトドキュメントを読み取りまたは検索し、現在のタスクを過去のコンテキストに根拠付ける。
- 内容をコンテキストに読み込まずに、ローカルファイルをプロジェクトにアップロードする。
- 古くなったプロジェクトドキュメントを削除する。

## パラメータ

- `method` (string, required): `project_info`、`project_read`、`project_search`、`project_write`、`project_delete` のいずれか。
- `path` (string, optional): `project_read`/`project_write`/`project_delete` の場合: ドキュメントのパス。`project_write` の場合: 既存のパスはその場で置き換えられ、新しいベアファイル名 ("/" なし) は `claude/<name>` に名前空間化されます。
- `content` (string, optional): `project_write` の場合: インラインのドキュメントテキスト。`local_path` と相互排他的です。
- `local_path` (string, optional): `project_write` の場合: 作業ディレクトリ内のアップロードするファイル — 内容がコンテキストに入ることはありません。`content` と相互排他的です。
- `present_to_user` (boolean, optional): `project_write` の場合: このドキュメントをユーザーが見る必要のある成果物としてマークします。デフォルトは false。通常の保存や一括書き込みでは設定しないでください。
- `query` (string, optional): `project_search` の場合: ナレッジベースのクエリ。
- `n` (number, optional): `project_search` の場合: ヒット数 (デフォルト 5)。

## 例

### 例 1: 成果物をプロジェクトに書き込む

```
Projects(
  method="project_write",
  path="claude/migration-plan.md",
  local_path="./migration-plan.md",
  present_to_user=true
)
```

ローカルファイルをコンテキストに読み込まずにアップロードし、ユーザーの成果物としてフラグを立てます。

### 例 2: ナレッジベースを検索

```
Projects(method="project_search", query="authentication refresh tokens", n=5)
```

## 注意事項

- `content` はインラインで構成するテキスト用、`local_path` はすでにディスク上にあるもの用です — この 2 つを混ぜないでください。
- `present_to_user=true` は控えめに使用してください: ユーザーが求めた、または対応が必要な 1 つのドキュメントにのみ使います。
