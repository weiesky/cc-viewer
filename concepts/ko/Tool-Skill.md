# Skill

## 정의

메인 대화 내에서 스킬(skill)을 실행합니다. 스킬은 사용자가 slash command (예: `/commit`, `/review-pr`)로 호출할 수 있는 전용 기능입니다.

## 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `skill` | string | 예 | 스킬 이름 (예: "commit", "review-pr", "pdf") |
| `args` | string | 아니오 | 스킬 인수 |

## 사용 시나리오

**적합한 경우:**
- 사용자가 `/<skill-name>` 형식의 slash command를 입력한 경우
- 사용자의 요청이 등록된 스킬의 기능과 매칭되는 경우

**적합하지 않은 경우:**
- 내장 CLI 명령 (예: `/help`, `/clear`)
- 이미 실행 중인 스킬
- 사용 가능한 스킬 목록에 없는 스킬 이름

## 주의사항

- 스킬이 호출되면 완전한 프롬프트로 확장됨
- 완전 한정 이름 지원 (예: `ms-office-suite:pdf`)
- 사용 가능한 스킬 목록은 system-reminder 메시지에서 제공
- `<command-name>` 태그가 보이면 스킬이 이미 로드된 것이므로, 이 도구를 다시 호출하지 말고 직접 실행해야 함
- 실제로 도구를 호출하지 않고 스킬을 언급하지 말 것

## cc-viewer에서의 의의

Skill 호출은 요청 로그에서 `tool_use` content block으로 나타납니다. 스킬 확장 후의 프롬프트는 후속 요청의 system prompt나 메시지 내용에 영향을 미칩니다.

## 원문

<textarea readonly>Execute a skill within the main conversation

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>" (e.g., "/commit", "/review-pr"), they are referring to a skill. Use this tool to invoke it.

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - `skill: "pdf"` - invoke the pdf skill
  - `skill: "commit", args: "-m 'Fix bug'"` - invoke with arguments
  - `skill: "review-pr", args: "123"` - invoke with arguments
  - `skill: "ms-office-suite:pdf"` - invoke using fully qualified name

Important:
- Available skills are listed in system-reminder messages in the conversation
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)
- If you see a <command-name> tag in the current conversation turn, the skill has ALREADY been loaded - follow the instructions directly instead of calling this tool again
</textarea>
