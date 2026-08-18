# SendUserFile

하나 이상의 파일을 사용자에게 전송합니다 — 생성된 산출물, 스크린샷, 리포트 — 클라이언트가 이를 표시하는 방식을 제어할 수 있습니다.

## 사용 시점

- 사용자가 필요로 하는 파일(리포트, 이미지, HTML 페이지)을 만들었고 경로만 언급하지 않고 이를 내보내고 싶습니다.
- 첨부 파일로 답장(`status="normal"`), 또는 사용자가 요청하지 않았지만 지금 봐야 하는 것을 선제적으로 표시(`status="proactive"`).

## 매개변수

- `files` (array of strings, 필수): 사용자에게 전송할 파일 경로(절대 경로 또는 cwd 기준). 단일 파일이라도 항상 배열을 전달하십시오.
- `caption` (string, 선택): 파일에 대한 짧은 캡션.
- `status` (string, 필수): 사용자가 요청하지 않았지만 지금 봐야 하는 파일 — 생성된 산출물, 완료된 리포트 — 을 표시할 때는 `proactive`; 사용자가 방금 말한 것에 답장할 때는 `normal`.
- `display` (string, 선택): `render`는 파일을 측면 패널에 인라인으로 엽니다(HTML, SVG, Mermaid, 이미지, PDF). `attach`는 다운로드 카드만 표시합니다(사용자가 저장하고 다른 곳에서 열 산출물). 생략하면 클라이언트가 파일 유형에 따라 결정합니다.

## 예시

### 예시 1: 생성된 리포트 전달

```
SendUserFile(
  files=["./out/weekly-report.html"],
  caption="Weekly usage report",
  status="proactive",
  display="render"
)
```

## 참고사항

- 세션에서 파일 전송이 허용되어야 합니다(설정/기능 게이트된 기능). brief 모드에서는 제공되지 않습니다.
- 사용자가 저장해서 다른 앱에서 여는 파일에는 `display="attach"`를, 즉시 봐야 하는 것에는 `render`를 선택하십시오.
