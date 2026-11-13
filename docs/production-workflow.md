# 제작 지침과 MCP의 역할

## 선택한 디자인

사용자는 개선 전의 반듯한 나무판 시안을 선택했습니다. 비스듬한 초록 책상 개선안과 먹과 돌 시안을 기본 디자인으로 사용하지 않습니다.

따뜻한 나무판, 단단한 흑백 돌, 작은 연필 메모/인장, 낮은 HUD 밀도를 유지합니다. 큰 히어로·기능 카드·대시보드·상시 파티클을 추가하지 않습니다. 선택·조준·충돌·낙하·승패에만 반응을 줍니다.

## 적용한 공개 지침

- [game-ui-frontend](https://github.com/openai/plugins/blob/main/plugins/game-studio/skills/game-ui-frontend/SKILL.md): 판 중심, 게임 소재에 맞는 HUD, PC/모바일 입력 경계.
- [frontend-design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md): 재질·글자·구도에 일관된 방향, 불필요한 장식 제거.
- [game-playtest](https://github.com/openai/plugins/blob/main/plugins/game-studio/skills/game-playtest/SKILL.md): 실제 입력·차례·전환·화면 가림·줄인 모션 검수.

공개 원문을 읽어 제작에 적용한 것입니다. 설치된 플러그인이라고 주장하지 않으며 프로젝트에 외부 스킬 실행 코드를 넣지 않습니다. 브라우저 실기 검수는 환경 제한 때문에 미완료로 기록합니다.

## Suno MCP

공식 연결 주소는 `https://api.suno.com/mcp`입니다. 현재 연결하지 않았고 Suno 생성 음원은 포함하지 않았습니다. 계정·크레딧·인증은 제작자 측에만 있으며 게임 프런트나 저장소에 넣지 않습니다.

연결 후 실제 MCP의 도구 목록에서 Sounds 생성 지원 여부를 확인합니다. 효과음 도구가 노출되지 않으면 Suno Sounds에서 제작한 파일을 가져오는 경로를 사용할 수 있습니다.

우선 제작할 묶음:

| 파일 분류 | 목표 |
| --- | --- |
| `flick` | 손가락이 돌을 튕기는 짧은 시작음 |
| `hitSoft` | 작은 돌 접촉, 건조한 톡 소리 3~5개 |
| `hitHard` | 날카로운 접촉과 나무판의 짧은 울림 3~5개 |
| `fall` | 판 밖으로 떨어진 뒤 바닥에 닿는 짧은 소리 |
| `win` | 다른 샷을 덮지 않는 짧은 마침음 |

효과음은 앞부분 무음을 제거하고 과한 잔향을 줄여 충돌 사건과 맞춥니다. 결과물 파일을 `public/audio/`에 넣고 `manifest.json`에 경로를 기입합니다. 게임은 준비된 파일을 미리 디코딩해 재생합니다. 실제 샷 중에 생성 서비스를 호출하지 않습니다.

공식 설명: [Suno MCP](https://suno.com/mcp), [Suno Sounds](https://help.suno.com/en/articles/10625537).
