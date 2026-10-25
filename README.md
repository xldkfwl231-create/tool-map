# tool-map: 스킬·MCP 지도

Claude Code 세션 옆에 설치된 스킬과 MCP를 주제별(디자인·UI, 점검·리뷰, 문서·기획·발표, 리서치·데이터 등)로 묶어 보여주는 모드입니다.

- 작업 중 쓰인 스킬과 MCP를 색으로 표시합니다. 노란색은 실행 중, 초록색은 사용함, 흐린 글씨는 아직 안 씀입니다.
- 묶음은 접혀서 시작합니다. 묶음 제목을 누르면 펼쳐지고, 항목을 누르면 한 줄 설명이 나옵니다.
- 입력창 바로 위에 한 줄 요약 띠가 붙습니다. 패널을 닫아도 띠는 보이고, [지도 열기] 버튼으로 패널을 다시 열 수 있습니다.
- `/tool-map` 명령으로도 패널을 열 수 있습니다.

목록은 만든 컴퓨터에 설치된 스킬을 기준으로 고정되어 있습니다. 다른 컴퓨터에 없는 스킬은 "안 씀"으로 남습니다.

## 설치

터미널의 Claude Code 입력창에서:

```
/plugin install tool-map --marketplace xldkfwl231-create/tool-map
```

셸에서:

```
claude plugin install tool-map --marketplace xldkfwl231-create/tool-map
```

Claude 데스크톱 앱에서: 입력창 옆 **+** → **Plugins** → **Add marketplace**에 `xldkfwl231-create/tool-map`을 넣고, **Add plugin**을 누릅니다.
