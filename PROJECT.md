# 펀펀영어 (woojin-phonics) 프로젝트 문서

## 1. 프로젝트 개요

한국 어린이를 위한 영어 파닉스 학습 웹앱. React 기반 SPA로, GitHub Pages에 배포되며 Firebase를 백엔드로 사용한다.

- **앱 이름**: 펀펀영어 (헤더에 "[이름]이의 펀펀영어"로 표시)
- **URL**: https://jychoi0858-wj.github.io/woojin-phonics
- **기술 스택**: React 19, Firebase (Auth + Firestore), Azure Cognitive Services (Speech + Vision), Tesseract.js OCR
- **패키지 매니저**: npm
- **빌드 도구**: Create React App (react-scripts 5.0.1)

---

## 2. 프로젝트 구조

```
woojin-phonics/
├── public/                    # 정적 파일
├── build/                     # 빌드 결과물 (gh-pages 배포용)
├── deploy.bat                 # Windows 배포 스크립트
├── package.json               # 의존성 및 스크립트
└── src/
    ├── App.js                 # 메인 컴포넌트 (~2860줄) - 라우팅, 상태관리, 파닉스 학습
    ├── App.css                # 전체 스타일 (~6090줄)
    ├── firebase.js            # Firebase 초기화, Auth, Firestore CRUD
    ├── LoginScreen.js         # 로그인/회원가입/아이디찾기 화면
    ├── SentenceLearning.js    # 문장 학습 화면 (~1515줄)
    ├── SentenceMemorize.js    # 문장 암기 화면 (~600줄)
    ├── BookReading.js         # 원서 읽기 화면 (~1100줄)
    ├── AlphabetMatchGame.js   # 알파벳 짝맞추기 게임
    ├── ttsCache.js            # IndexedDB 기반 TTS 오디오 캐시
    ├── syllableUtils.js       # CMU 발음사전 기반 음절 분리
    ├── FireworksCelebration.js # 불꽃놀이 축하 애니메이션
    ├── LogoIcon.js            # 앱 로고 SVG 아이콘
    ├── QuizIcon.js            # 퀴즈 별 아이콘 SVG
    └── index.js               # React 엔트리포인트
```

---

## 3. 화면 구성 및 기능

### 3.1 로그인/회원가입 (LoginScreen.js)

- **로그인**: 아이디 + 비밀번호 (Firebase Auth, 내부적으로 아이디→가짜이메일 변환)
- **회원가입**: 한글이름(2자) + 아이디 + 비밀번호(4자 이상). 이름 중복 검사
- **아이디 찾기**: 이름으로 아이디 조회
- **아이디/비번 저장**: localStorage에 체크박스로 저장 가능

### 3.2 파닉스 학습 (App.js - screen: 'learning')

메인 학습 화면. 월별로 Lesson을 관리하고, 각 Lesson에 등록된 단어를 학습한다.

**학습 흐름:**
1. 년/월 선택 → Lesson 선택 → "학습 시작"
2. 각 단어마다: Unsplash 이미지 표시 → 알파벳 이름(3회) → 파닉스 소리(3회) → 전체 단어(3회) 순으로 TTS 재생
3. 재생 완료 후 발음 평가 패널 표시 (마이크 버튼)
4. Azure Pronunciation Assessment로 음소 단위 채점 (100점 만점, 60점 이상 통과)
5. 녹음 재생 가능 → "다음" 버튼으로 다음 단어

**하위 기능:**
- 단어 관리 (AdminPage / DayCard): Lesson 추가/삭제, 단어 추가/삭제, 날짜 설정
- 단어 찾기 (FindWordPage): 영어 단어 검색 → Unsplash 이미지 + TTS 재생 (반복횟수/간격 설정)

### 3.3 문장 학습 (SentenceLearning.js - screen: 'sentence')

영어 문장을 단어/음절 단위로 분석하며 학습하는 화면.

**핵심 기능:**
- **음절 분리 학습**: 단어 클릭 시 CMU 발음사전 기반 음절 분리 + IPA 발음 표시. 각 음절 개별 TTS 재생
- **순서대로 듣기**: 음절을 순차적으로 TTS 재생 (인터벌/반복횟수 설정)
- **끊어읽기**: 문장 내 단어 범위를 드래그로 선택하여 부분 재생. 선택읽기(앞에서부터 단어 추가)/구간읽기(범위 선택) 두 모드
- **발음 평가**: Azure Speech SDK로 문장 단위 발음 채점 (단어/음소별 점수 색상 표시). 녹음 재생 가능
- **문장 퀴즈**: 문장의 단어를 빈칸으로 만들어 드래그앤드롭으로 맞추는 퀴즈. Web Audio API 효과음, 불꽃놀이 축하 애니메이션
- **문장 관리 (SentenceDayCard)**: Lesson/문장 추가/삭제/수정, 문장 순서 드래그 변경, OCR로 문장 일괄 입력

### 3.4 문장 암기 (SentenceMemorize.js - screen: 'memorize')

문장을 반복 재생하여 암기하는 화면. 문장 학습과 별도의 데이터 관리.

**핵심 기능:**
- 문장별 TTS 재생 (속도/반복횟수/간격 설정)
- 전체 순서대로 재생 모드
- 한글 뜻 입력 및 표시/숨기기 토글
- 자체 문장 관리 팝업 (Lesson/문장 추가/삭제, 날짜 설정)

### 3.5 원서 읽기 (BookReading.js - screen: 'reading')

그림책을 페이지별로 읽는 ebook 리더.

**핵심 기능:**
- **서재**: 레벨별(1~5) 책 목록 그리드, 레벨별 색상 그라데이션 및 배지
- **리더**: 전체화면 모달, 슬라이드 페이지 넘김 애니메이션, 스와이프 제스처 지원
- **번역 토글**: 페이지별 한국어 번역 표시/숨기기
- **읽기 진행**: 유저별 마지막 읽은 페이지 Firestore 저장
- **TTS**: 페이지 문장 재생
- **업로드**: JSON 텍스트 → 이미지 업로드 → 미리보기 단계별 업로드
- **AI 프롬프트 빌더**: 스토리 JSON 및 이미지 프롬프트 템플릿 (ChatGPT/DALL-E 등 외부 AI 도구용). 커스텀 템플릿 localStorage 저장

### 3.6 알파벳 짝맞추기 게임 (AlphabetMatchGame.js)

@dnd-kit 기반 드래그앤드롭 게임. 대문자 → 소문자 슬롯 매칭. 5개씩 제시, A~Z 전체 완료 시 축하 효과. 일별 진행도 Firestore 저장.

### 3.7 설정 모달 (App.js 내)

- **Azure Speech 설정**: API Key, Region, Voice 선택 (6개 신경망 음성, 아동 음성 AnaNeural 포함)
- **Azure Vision (OCR) 설정**: API Key, Endpoint
- **사용량 대시보드**: TTS 사용량 바 (계정별 월 10만자 제한), Vision 사용량 바 (월 5천 건), TTS 캐시 현황 + 삭제 버튼
- **오디오 모듈 리셋**: AudioContext 재생성
- **계정 삭제**: 비밀번호 확인 후 Firestore 데이터 + Auth 계정 삭제
- **PWA 설치 안내**: "홈 화면에 추가" 가이드

---

## 4. 기술 아키텍처

### 4.1 인증 (Firebase Auth)

아이디 기반 인증. 내부적으로 `username@phonics.app` 형태의 가짜 이메일로 변환. 비밀번호는 `__PH` 패딩 추가 (Firebase 최소 6자 요구 충족). `onAuthStateChanged`로 로그인 상태 감지.

### 4.2 데이터 저장 (Firestore + localStorage)

**이중 저장 전략**: localStorage로 즉시 오프라인 접근, Firestore로 클라우드 동기화.

**Firestore 구조:**
```
users/{uid}/
  ├── data/words        # 파닉스 단어 데이터
  ├── data/sentences    # 문장 학습 데이터
  ├── data/memorize     # 문장 암기 데이터
  ├── data/profile      # 유저 프로필 (이름, 아이디)
  ├── data/reading_progress  # 원서 읽기 진행
  ├── data/alphabet_progress # 알파벳 게임 진행
  └── usage/{YYYY-MM}   # 계정별 월간 TTS 사용량

shared/
  ├── usage-{YYYY-MM}   # 전체 공유 사용량 카운터
  ├── profiles           # 이름→아이디 매핑 (아이디 찾기용)
  └── migration          # 데이터 마이그레이션 플래그

books/{bookId}           # 공유 책 데이터 (모든 유저 공통)
```

**데이터 형식** (words/sentences/memorize 동일 패턴):
```json
{
  "YYYY-MM": [
    {
      "id": 1234567890,
      "name": "Lesson 1",
      "date": "2026-06-22",
      "words": ["apple", "ant"]       // words의 경우
      // "sentences": [{...}]          // sentences/memorize의 경우
    }
  ]
}
```

**실시간 동기화**: `onSnapshot` 리스너로 다른 기기에서의 변경 실시간 반영. `savingRef` 플래그로 에코 루프 방지.

### 4.3 TTS (Azure Speech Service)

- **일반 TTS**: Azure Speech SDK의 `SpeechSynthesizer` 사용. SSML로 음성/속도 지정
- **IPA 음절 TTS**: `<phoneme alphabet="ipa">` 태그로 정확한 음절 발음
- **발음 평가**: `PronunciationAssessmentConfig`로 음소/단어 단위 채점
- **캐시**: IndexedDB LRU 캐시 (최대 1000개, ~50-100MB). 캐시 히트 시 Azure 호출 없이 재생
- **iOS 호환**: AudioContext unlock (무음 버퍼 재생), Audio element 폴백

### 4.4 OCR (Azure Vision + Tesseract.js)

문장 관리에서 이미지로 문장 입력 시 사용. Azure Computer Vision Read API 우선 시도, 실패 시 Tesseract.js(브라우저 내 OCR) 폴백. 이미지는 4MB 이하로 JPEG 압축. 최대 5장 일괄 처리.

### 4.5 음절 분리 (syllableUtils.js)

CMU Pronouncing Dictionary로 음소 기반 정확한 음절 분리. CMU에 없는 단어는 규칙 기반 폴백 (모음 클러스터 분석, onset blend 감지, silent-e 처리). 각 음절에 IPA 발음 매핑.

### 4.6 이미지 (Unsplash API)

단어 학습/검색 시 Unsplash API로 단어에 해당하는 이미지 검색 및 표시.

---

## 5. 보안 참고사항

- **Azure Speech Key**: localStorage에 `woojin-azure-key`, `woojin-azure-region`으로 저장. 코드/Git에 포함하지 않음
- **Azure Vision Key**: localStorage에 `woojin-azure-vision-key`, `woojin-azure-vision-endpoint`로 저장
- **Firebase Config**: 코드에 포함 (클라이언트 사이드 Firebase의 표준 방식, Firestore Security Rules로 보호)
- **Unsplash API Key**: 코드에 포함

---

## 6. 빌드 및 배포

### 6.1 빌드

```bash
# 로컬 개발
npm start

# 프로덕션 빌드 (Cowork/Claude에서 빌드 시)
BUILD_PATH=/tmp/woojin-build npx react-scripts build
cp -rf /tmp/woojin-build/* build/
```

빌드 시 `prebuild` 스크립트가 `.env.local`에 `REACT_APP_BUILD_TIME`을 한국 시간으로 기록. 설정 모달에 빌드 시간 표시됨.

### 6.2 배포

프로젝트 루트에서 `deploy.bat` 실행:
```bat
npm run deploy       # gh-pages -d build → GitHub Pages 배포
git add -A           # 소스 코드 커밋
git commit -m "deploy [날짜] [시간]"
git push origin main # main 브랜치 푸시
```

- **배포 대상**: GitHub Pages (`https://jychoi0858-wj.github.io/woojin-phonics`)
- **package.json의 homepage**: `https://jychoi0858-wj.github.io/woojin-phonics`
- **gh-pages 패키지**: `build/` 폴더를 `gh-pages` 브랜치에 푸시

### 6.3 Cowork 세션에서의 빌드 주의사항

- bash Linux 마운트에서 파일 잘림(truncation) + null 바이트 발생이 빈번함
- 빌드 전 반드시 Python으로 파일 무결성 검사 필요:
  ```python
  # null 바이트 제거
  for f in ['src/App.js', 'src/App.css', 'src/SentenceMemorize.js', 'src/SentenceLearning.js']:
      data = open(f, 'rb').read()
      clean = data.replace(b'\x00', b'')
      if len(clean) != len(data):
          open(f, 'wb').write(clean)
  ```
- 잘림 발생 시 원본 파일의 마지막 정상 위치를 찾아 누락된 부분을 보충해야 함
- `BUILD_PATH=/tmp/woojin-build` 사용 이유: 마운트된 `build/` 폴더에 직접 빌드하면 EPERM 에러 발생

---

## 7. 주요 의존성

| 패키지 | 용도 |
|--------|------|
| react 19 | UI 프레임워크 |
| firebase 12 | Auth, Firestore 데이터베이스 |
| microsoft-cognitiveservices-speech-sdk | Azure TTS 및 발음 평가 |
| tesseract.js 7 | 브라우저 내 OCR (Azure Vision 폴백) |
| @dnd-kit/core | 드래그앤드롭 (퀴즈, 알파벳 게임) |
| cmu-pronouncing-dictionary | 영어 발음 사전 (음절 분리) |
| gh-pages | GitHub Pages 배포 |

---

## 8. 업데이트 내역

### 최초 구축
- React 19 + Create React App으로 프로젝트 생성
- 파닉스 단어 학습 화면 (알파벳→파닉스→단어 3단계 TTS)
- Unsplash 이미지 연동
- 월별 Lesson 관리 (추가/삭제/단어 관리)
- localStorage 데이터 저장

### Azure TTS 통합
- 브라우저 기본 TTS → Azure Speech Service로 교체
- IPA 음소 기반 음절별 TTS 구현
- Azure Key 미설정 시 폴백 처리
- 설정에서 음성 선택 기능 (6개 신경망 음성)

### 단어 찾기 기능
- 영어 단어 검색 + Unsplash 이미지 + TTS 재생
- 재생 반복 횟수 및 간격 설정

### 음절 분리 시스템
- CMU Pronouncing Dictionary 기반 정확한 음절 분리
- IPA 발음 매핑
- 규칙 기반 폴백 (CMU에 없는 단어)

### 문장 학습 시스템
- 문장 데이터 구조 및 관리 페이지
- 단어별 음절 분리 + 개별 TTS
- 끊어읽기 (선택읽기/구간읽기)
- 순서대로 듣기 (인터벌/반복 설정)

### Firebase 통합
- Firestore 데이터 동기화 (단어/문장/암기)
- 실시간 리스너 (`onSnapshot`)
- localStorage + Firestore 이중 저장

### 문장 암기 시스템
- 별도 데이터 관리, 한글 뜻 입력
- 반복 재생 모드 (속도/횟수/간격)

### OCR 기능
- Azure Computer Vision Read API 우선
- Tesseract.js 폴백
- 카메라/앨범 선택 팝업, 여러 장 일괄 OCR

### TTS 캐시
- IndexedDB LRU 캐시 (최대 1000개)
- 캐시 히트 시 Azure 호출 절약
- iOS AudioContext 호환 처리

### 인증 시스템
- Firebase Auth 기반 아이디/비밀번호 인증
- 회원가입 (한글이름 + 아이디)
- 아이디 찾기 (이름으로 조회)
- 아이디/비번 저장 체크박스

### 발음 평가
- Azure Pronunciation Assessment 연동
- 단어 학습: 음소 단위 채점 (60점 이상 통과)
- 문장 학습: 단어/음소별 점수 색상 표시
- 녹음 재생 기능

### 문장 퀴즈
- 드래그앤드롭 빈칸 맞추기
- Web Audio API 효과음 (정답/오답/완료)
- 불꽃놀이 축하 애니메이션

### 원서 읽기
- 서재 (레벨별 책 목록) + ebook 리더
- 슬라이드 페이지 넘김 애니메이션 + 스와이프 제스처
- 한국어 번역 토글
- AI 프롬프트 빌더 (스토리/이미지 생성용)
- 읽기 진행 Firestore 저장

### 알파벳 짝맞추기 게임
- 대문자→소문자 드래그앤드롭 매칭
- 효과음 + 일별 진행도 저장

### 사용량 관리
- 전체 공유 사용량 추적 (TTS/Vision)
- 계정별 TTS 월간 한도 (기본 10만자)
- 사용량 대시보드 UI

### 계정 관리
- 비밀번호 확인 후 계정 삭제 (Firestore 데이터 + Auth 삭제)
- 유저 간 데이터 병합 (`mergeUserData`)
- 기존 데이터 마이그레이션 (v1 → v2)

### 문장 관리 개선
- 문장 순서 드래그 변경 (마우스/터치 기반)
- 인라인 문장 수정
- 삭제 확인 팝업 통일 (커스텀 UI)
- Lesson 날짜 표시/수정 UI

### UI/UX 개선
- Day → Lesson 명칭 통일 (모든 화면)
- Lesson 추가 시 오늘 날짜 자동 입력 (prompt 제거)
- 날짜 UTC → 로컬 시간(한국 UTC+9) 수정
- 단어 찾기 버튼 헤더 → 파닉스 화면으로 이동
- 삭제 팝업 collapsed 상태 버그 수정

### 로그 기능 삭제
- LogPage 컴포넌트 전체 삭제
- 로그 상태/Firebase 구독/저장 코드 삭제
- 로그 관련 CSS 삭제
- 헤더 로그 버튼 삭제
- firebase.js의 로그 함수는 마이그레이션/계정삭제에서 참조하므로 유지
