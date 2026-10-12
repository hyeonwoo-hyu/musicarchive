# My Music Archive

MusicBrainz에서 곡을 검색하고 개인 평점·감상평을 저장하는 GitHub Pages 웹사이트입니다.

## 구성

- HTML, CSS, JavaScript만 사용합니다. npm·빌드·서버 설치가 필요 없습니다.
- MusicBrainz: 곡명, 아티스트, 발매 정보 검색
- Cover Art Archive: 커버 이미지 제공(등록되지 않은 커버는 기본 이미지)
- GitHub Contents API: `main` 브랜치의 `data.json`에 평점·감상평 저장

## 배포

GitHub 저장소의 **Settings → Pages**에서 `Deploy from a branch` / `main` / `/(root)`를 선택하세요.

예상 주소: https://hyeonwoo-hyu.github.io/musicarchive/

## 기록 방법

1. **곡 검색 · 추가**에서 곡을 찾습니다.
2. 검색 결과를 누르고 평점과 감상평을 적습니다.
3. 첫 저장 시 **관리자 연결**에서 해당 저장소에 `Contents: Read and write` 권한이 있는 Fine-grained PAT를 입력합니다.
4. 평가 창으로 돌아와 다시 저장을 누릅니다. GitHub에서 `data.json`에 커밋됩니다.
5. 이후 기록은 **내 라이브러리**에서 검색·정렬하고 JSON으로 백업할 수 있습니다.

## 유의사항

- 공개 저장소이므로 **평가와 감상평은 누구나 열람할 수 있습니다**.
- **토큰을 소스코드·저장소·채팅에 올리지 마세요.** 토큰은 이 페이지의 브라우저 메모리에만 보관되며 새로고침하면 삭제됩니다. 이 방식도 XSS나 악성 브라우저 확장 등으로 인한 토큰 탈취 위험이 있으니 믿을 수 있는 본인 기기에서만 사용하세요.
- GitHub에 데이터를 저장한 후 GitHub Pages의 배포가 조금 늦을 수 있습니다. 사이트는 GitHub API에서 최신 데이터를 먼저 불러오고 실패하면 배포된 `data.json`을 읽습니다.
- MusicBrainz 웹 API는 초당 1회 이하로 요청해야 하며 식별 가능한 User-Agent 정책이 있습니다. 브라우저에서 User-Agent를 임의로 지정할 수 없으므로 환경·정책에 따라 API 직접 호출이 제한될 수 있습니다.
- JSON 파일을 수정할 때는 GitHub의 최신 SHA를 확인하고, 같은 곡이 동시에 변경됐다면 저장을 중단해 덮어쓰기를 방지합니다.
