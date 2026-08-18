# ListSkills

列出使用者已啟用的 claude.ai skills，可選擇性以關鍵字過濾。

## 使用時機

- 你需要目前啟用中之 skills 的權威清單——在呼叫某個 skill 之前，或確認 `SuggestSkills` 卡片新增了什麼。
- 使用者詢問他們有哪些 skills。

## 啟用方式

- 需要外掛登錄檔存取權限。
- 在 HIPAA 環境中停用。
- 在遠端工作階段中一律可用。

## 參數

- `keywords`（string 陣列，選填）：過濾清單——最多 8 個項目，每個 1–64 個字元。省略則列出全部。

## 範例

### 範例 1：列出已啟用的 skills

```
ListSkills()
```

### 範例 2：以關鍵字過濾

```
ListSkills(keywords=["review"])
```

## 注意事項

- 若目錄無法連線（禁止存取），工具會降級為帶警告的空清單，而非失敗。
- 這列出*已啟用*的 skills；使用 `SuggestSkills` 來浮現使用者可新增的 skills。
