# claude-mods

Claude Code mod 모음. 이 저장소 자체가 마켓플레이스(`.claude-plugin/marketplace.json`)라서 누구나 아래 방법으로 설치할 수 있다.

| Mod | 설명 |
|-----|------|
| [`context-bars`](context-bars) | 컨텍스트 윈도우를 카테고리별 비례 막대 하나로 프롬프트 위에 표시 |
| [`token-weather`](token-weather) | 컨텍스트 윈도우 사용량을 날씨 아이콘·퍼센트·최근 턴 차트로 프롬프트 위에 표시 |
| [`y-change`](y-change) | Claude가 코드를 수정할 때마다 diff와 변경 이유(처음 보는 언어의 문법 설명 포함)를 오른쪽 pane에 표시 (기본은 숨김, `/y-change`로 열기/닫기) |
| [`task-progress`](task-progress) | Claude의 작업 목록(TodoWrite·TaskCreate/TaskUpdate) 진행률을 막대와 `완료/전체`, 진행 중인 항목 이름으로 프롬프트 위(스피너 아래)에 표시 |

## 설치

터미널의 Claude Code 세션 프롬프트에서 입력한다. 마켓플레이스 등록과 설치가 한 번에 된다.

```text
/plugin install context-bars --marketplace nalpari/claude-mods
/plugin install token-weather --marketplace nalpari/claude-mods
/plugin install y-change --marketplace nalpari/claude-mods
/plugin install task-progress --marketplace nalpari/claude-mods
```

처음이면 `Add marketplace?` 에 `y` 로 답하고 scope(user 권장)를 고르면 `Installed <mod>. Plugin is now active.` 가 뜬다. 재시작이나 리로드 없이 바로 적용되고, user scope 는 이후 세션에도 유지된다. 마켓플레이스를 이미 추가했다면 확인 질문은 건너뛴다.

마켓플레이스를 먼저 등록하고 나중에 골라 설치해도 된다.

```text
/plugin marketplace add nalpari/claude-mods
/plugin install context-bars@claude-mods
```

셸에서는 `claude plugin marketplace add nalpari/claude-mods` 와 `claude plugin install context-bars@claude-mods --scope user` 로 같은 일을 한다.

## 업데이트 / 제거

```bash
claude plugin marketplace update claude-mods   # 마켓플레이스 최신화
claude plugin update context-bars@claude-mods  # mod 업데이트
claude plugin list                             # 설치 확인
claude plugin uninstall context-bars           # 제거
```

## 로컬 checkout 에서 시험

```bash
git clone https://github.com/nalpari/claude-mods.git
cd claude-mods

# 이번 세션에서만 시험
claude --plugin-dir ./context-bars

# 로컬 마켓플레이스로 설치
claude plugin marketplace add ./
claude plugin install context-bars@claude-mods --scope user
```

## 참고

- mod 는 Claude Code 2.1.287 이상에서 기본으로 로드된다 (`token-weather/README.md` 기준).
- `/plugin install` 은 터미널 전용이다. 데스크톱 앱 Code 탭에서는 쓸 수 없지만, 터미널에서 user scope 로 설치하면 로컬 세션에서도 로드된다.
