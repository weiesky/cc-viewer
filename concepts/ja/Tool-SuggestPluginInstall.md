# SuggestPluginInstall

`SearchPlugins` の結果からインラインのプラグインインストールカードをレンダリングし、プラグインの提案をユーザーのリクエストに結び付けます。

## 使用タイミング

- プラグイン検索でユーザーがやろうとしていることに一致するプラグインが見つかり、インストール用に提示したい場合。

## パラメータ

- `contextLabel` (string, required): 提案をユーザーのリクエストに結び付ける短いヘッダー (最大 128 文字)。
- `plugins` (array, required): `SearchPlugins` の結果から取得したプラグイン — 1〜16 エントリ。各エントリには以下が含まれます:
  - `pluginId` (string, required)
  - `pluginName` (string, required)
  - `description` (string, required)
  - `skills` (array, optional): プラグインのスキルを説明する最大 32 個の `{name, description?}` エントリ。

## 例

### 例 1: 一致するプラグインを提示

```
SuggestPluginInstall(
  contextLabel="For reviewing pull requests",
  plugins=[{pluginId="pr-toolkit", pluginName="PR Toolkit", description="Review helpers"}]
)
```

カードがユーザー向けにレンダリングされます。プラグインの有効化はこのツールの外部で行われます。フォローアップで `ListPlugins` を呼び出し、実際に何がインストールされたかを確認してください。

## 注意事項

- 検索結果から来たプラグインのみを含めてください — プラグインエントリを発明しないでください。
- HIPAA エンタープライズ構成では無効化されます。
