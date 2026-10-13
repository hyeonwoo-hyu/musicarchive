# My Music Archive

 음악을 검색하고 곡·발매작에 평점과 감상평을 남기는 개인 아카이브입니다.

- HTML, CSS, Vanilla JavaScript / GitHub Pages. npm, 빌드, 백엔드는 없습니다.
- DE 카탈로그가 기본이고 JP·US를 선택할 수 있습니다. 선택한 국가에서만 검색합니다.
- 아티스트·발매작·곡 검색은 최대 100개를 조회한 뒤 더보기로 나눠 표시합니다. 전체 카탈로그의 무제한 페이지네이션이나 인기순은 제공하지 않습니다.
- 아티스트를 선택하면 발매작, 발매작을 선택하면 디스크·트랙 순서의 수록곡을 봅니다.

## 기록과 인증

평가 모달에서 0.5~10점(0.5점 단위), 선택적 감상평과 표시 제목을 입력합니다. 처음 저장할 때 관리자 연결창에 이 저장소의 **Contents: Read and write** 권한이 있는 GitHub Fine-grained PAT를 입력하면 작성한 평가를 이어서 저장합니다.

PAT는 브라우저 런타임 메모리에만 유지하고 새로고침·연결 해제로 지워집니다. Safari 암호 앱에 hyeonwoo-hyu.github.io의 사용자명과 PAT를 등록해 자동완성을 선택하거나 직접 붙여넣을 수 있습니다. 공개 저장소이므로 평가와 감상평은 공개됩니다.

GitHub Contents API에서 최신 data.json과 SHA를 조회하고 같은 평가의 변경 여부를 확인합니다. 저장 실패와 SHA 충돌 시 작성 내용을 유지합니다. 라이브러리 검색·정렬과 JSON 백업을 지원합니다.

## 데이터와 요청

각 기록은 type(track/album), 숫자 Apple id, title, originalTitle, artist, artistId, collectionId, collectionTitle, artworkUrl, storeUrl, country, year, rating, review, updatedAt를 갖습니다. 

API는 일반 fetch를 먼저 사용합니다. CORS/네트워크 실패 시 테스트 페이지와 같은 allow-scripts 전용 sandbox iframe에서 JSONP를 실행합니다. 외부 스크립트는 관리자 페이지의 DOM·PAT에 접근할 수 없습니다. 물리 요청은 분당 최대 18회로 제한하고 같은 조회는 세션에서 재사용합니다.

Apple 공식 문서: https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/Searching.html

배포는 GitHub Pages → main / (root)입니다. 사이트: https://hyeonwoo-hyu.github.io/musicarchive/
