import React, { useState, useEffect, useRef, useCallback } from 'react';
import { saveBookToFirestore, deleteBookFromFirestore, onBooksChange, saveReadingProgressToFirestore, loadReadingProgressFromFirestore, addSpeechUsageFirestore, loadAppConfig } from './firebase';
import { getCachedAudio, setCachedAudio, playCachedAudio, makeCacheKey, stopCachedAudio } from './ttsCache';
import * as speechsdk from 'microsoft-cognitiveservices-speech-sdk';
import { showNotice, VOICE_MSG } from './notice';

// ─── 이미지 압축 (최대 200px, JPEG 0.4 — Firestore 저장용) ───
function compressImage(file, maxWidth = 800, quality = 0.85) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = URL.createObjectURL(file);
  });
}

// ─── GitHub 이미지 저장 설정 ───
// 이미지는 main 브랜치 book-images/ 에 커밋하고 raw URL로 로드한다.
// (gh-pages 브랜치는 배포 시 force-push로 덮어써지므로 사용하지 않음)
const GH_OWNER = 'jychoi0858-wj';
const GH_REPO = 'woojin-phonics';
const GH_BRANCH = 'main';

async function uploadImageToGitHub(token, path, dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const apiUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`;
  const res = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `book image: ${path}`,
      content: base64,
      branch: GH_BRANCH,
    }),
  });
  if (!res.ok) {
    let msg = '' + res.status;
    try { const j = await res.json(); if (j.message) msg = `${res.status} - ${j.message}`; } catch (e) { /* ignore */ }
    throw new Error('GitHub 업로드 실패: ' + msg);
  }
  // jsDelivr CDN으로 서빙 (전세계 캐시 → raw보다 훨씬 빠름)
  return `https://cdn.jsdelivr.net/gh/${GH_OWNER}/${GH_REPO}@${GH_BRANCH}/${path}`;
}

// ─── 레벨별 색상 ───
const LEVEL_COLORS = [
  ['#a8e6cf', '#88d4ab'], // Lv.1 green
  ['#ffd3b6', '#ffaaa5'], // Lv.2 peach
  ['#c3bef7', '#a29bfe'], // Lv.3 purple
  ['#ffeaa7', '#fdcb6e'], // Lv.4 yellow
  ['#74b9ff', '#0984e3'], // Lv.5 blue
];

function getLevelGradient(level) {
  const idx = Math.min((level || 1) - 1, LEVEL_COLORS.length - 1);
  const [a, b] = LEVEL_COLORS[idx];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

// ─── 레벨 뱃지 색상 ───
function getLevelBadgeClass(level) {
  if (level <= 1) return 'br-level-green';
  if (level <= 2) return 'br-level-amber';
  if (level <= 3) return 'br-level-purple';
  return 'br-level-blue';
}

// ======================================================
// BookReading 메인 컴포넌트
// ======================================================
export default function BookReading({ azureKey, azureRegion, azureVerified, azureVoice, currentUser, ttsLimitReached = false }) {
  // ─── 화면 상태 ───
  const [view, setView] = useState('shelf'); // 'shelf' | 'reader' | 'upload'
  const [books, setBooks] = useState([]);
  const [booksLoading, setBooksLoading] = useState(true);
  const [selectedBook, setSelectedBook] = useState(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [showKorean, setShowKorean] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [filterLevel, setFilterLevel] = useState(0); // 0 = 전체
  const [readingProgress, setReadingProgress] = useState({});

  // ─── 업로드 상태 ───
  const [uploadJson, setUploadJson] = useState('');
  const [parsedPages, setParsedPages] = useState([]);
  const [uploadImages, setUploadImages] = useState([]); // [{file, preview, matched}]
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadTitleKo, setUploadTitleKo] = useState('');
  const [uploadLevel, setUploadLevel] = useState(1);
  const [uploadDesc, setUploadDesc] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [githubToken, setGithubToken] = useState(localStorage.getItem('woojin-github-token') || '');
  const [parseError, setParseError] = useState('');
  const [uploadStep, setUploadStep] = useState(1); // 1=텍스트, 2=이미지, 3=미리보기

  // ─── AI 프롬프트 빌더 상태 ───
  const [showPromptBuilder, setShowPromptBuilder] = useState(false);
  const [promptTab, setPromptTab] = useState('story'); // 'story' | 'image'
  const [promptCopied, setPromptCopied] = useState('');
  // 스토리 프롬프트 입력
  const [storyTopic, setStoryTopic] = useState('');
  const [storyLevel, setStoryLevel] = useState(1);
  const [storyPages, setStoryPages] = useState(10);
  const [storyExtra, setStoryExtra] = useState('');
  // 이미지 프롬프트 입력
  const [imgStyle, setImgStyle] = useState('부드러운 수채화풍');
  const [imgSubject, setImgSubject] = useState('');
  const [imgExtra, setImgExtra] = useState('');
  const [imgStoryJson, setImgStoryJson] = useState(''); // 스토리 JSON 붙여넣기용
  // 골격 템플릿 관리
  const [showTemplateEdit, setShowTemplateEdit] = useState(false);
  const [storyTemplate, setStoryTemplate] = useState(() =>
    localStorage.getItem('woojin-prompt-story-template') ||
    `한국 5~8세 아이를 위한 영어 그림책을 써줘.

주제: {topic}

조건:
- 레벨 {level}: 쉽고 나이에 맞는 단어만 사용
- 총 {pages}페이지, 페이지당 영어 문장 1개
- 각 문장마다 한글 번역 포함
- 레벨 1-2는 8단어 이내, 레벨 3 이상은 12단어 이내
- 반복 패턴과 파닉스에 좋은 단어 사용
- 시작, 중간, 끝이 있는 이야기 구성
{extra}
아래 JSON 형식으로 출력해줘:
{{
  "title": "영어 제목",
  "titleKo": "한글 제목",
  "level": {level},
  "pages": [
    {{ "page": 1, "text": "English sentence.", "textKo": "한글 번역." }}
  ]
}}`
  );
  const [imageTemplate, setImageTemplate] = useState(() =>
    localStorage.getItem('woojin-prompt-image-template') ||
    `어린이 그림책 삽화를 그려줘.

그림체: {style}
장면: {subject}

조건:
- 이미지 안에 글자나 텍스트 넣지 마
- 따뜻하고 밝은 색감, 5~8세 아이에게 적합하게
- 심플한 구도, 명확한 포인트
- 캐릭터 디자인은 책 전체에서 일관되게
- 가로형 와이드 비율 (16:9 또는 3:2)
{extra}`
  );

  // ─── 페이지 넘김 애니메이션 상태 ───
  const [pageAnimating, setPageAnimating] = useState(false);
  const [textHidden, setTextHidden] = useState(false);
  const pageContainerRef = useRef(null);
  const touchStartX = useRef(0);

  const fileInputRef = useRef(null);
  const _speakCancelled = useRef(false);
  const _activeSynthesizer = useRef(null);

  // ─── 책 목록 로드 (실시간) ───
  useEffect(() => {
    const unsub = onBooksChange((newBooks) => {
      setBooks(newBooks);
      setBooksLoading(false);
    });
    return unsub;
  }, []);

  // ─── 읽기 진행 로드 ───
  useEffect(() => {
    if (!currentUser) return;
    loadReadingProgressFromFirestore(currentUser.uid).then(p => {
      if (p) setReadingProgress(p);
    });
  }, [currentUser]);

  // ─── GitHub 토큰 Firestore에서 로드 (모든 기기 공통) ───
  useEffect(() => {
    loadAppConfig().then(cfg => { if (cfg && cfg.githubToken) setGithubToken(cfg.githubToken); });
  }, [currentUser]);

  // ─── 인접 페이지 이미지 미리 불러오기 (넘김 즉시 표시) ───
  useEffect(() => {
    if (!selectedBook) return;
    const pages = selectedBook.pages || [];
    [currentPage + 1, currentPage + 2, currentPage - 1].forEach(i => {
      const p = pages[i];
      if (p && p.imageData) { const im = new Image(); im.src = p.imageData; }
    });
  }, [selectedBook, currentPage]);

  // ─── 읽기 진행 저장 ───
  const saveProgress = useCallback((bookId, pageIdx) => {
    if (!currentUser) return;
    setReadingProgress(prev => {
      const updated = { ...prev, [bookId]: { page: pageIdx, lastRead: new Date().toISOString() } };
      saveReadingProgressToFirestore(currentUser.uid, updated);
      return updated;
    });
  }, [currentUser]);

  // ─── 책 열기 (모달로 표시) ───
  const openBook = (book) => {
    setSelectedBook(book);
    setCurrentPage(0); // 항상 첫 페이지부터 시작 (마지막 페이지 기억 안 함)
    setShowKorean(false);
  };

  // ─── 모달 닫기 ───
  const backToShelf = () => {
    stopTTS();
    setSelectedBook(null);
    setCurrentPage(0);
    setPageAnimating(false);
  };

  // ─── 페이지 이동 (책등 축 입체 플립 애니메이션) ───
  const goPage = (dir) => {
    if (!selectedBook || pageAnimating || isPlaying) return;
    const pages = selectedBook.pages || [];
    const nextIdx = currentPage + dir;
    if (nextIdx < 0 || nextIdx >= pages.length) return;
    stopTTS();

    const container = pageContainerRef.current;
    if (!container) { setCurrentPage(nextIdx); saveProgress(selectedBook.id, nextIdx); return; }

    const reactPage = container.querySelector('.br-ebook-page');
    if (!reactPage) { setCurrentPage(nextIdx); saveProgress(selectedBook.id, nextIdx); return; }

    setPageAnimating(true);
    setTextHidden(true);
    const isForward = dir === 1;
    const DUR = 1000; // ms

    // 플립은 이미지만 넘긴다 (텍스트/컨트롤은 고정 레이어)
    const makePageHTML = (p, idx) => p.imageData
      ? `<img src="${p.imageData}" alt="Page ${idx+1}" class="br-ebook-img"/>`
      : '<div class="br-ebook-no-img"><span>📖</span></div>';

    // 앞/뒤 넘김에 따른 각 면의 페이지 결정
    let underPg, frontPg, backPg;
    if (isForward) {
      underPg = pages[nextIdx];        // 아래에서 드러나는 다음 페이지
      frontPg = pages[currentPage];    // 일어서는 페이지의 앞면(현재)
      backPg = pages[nextIdx];         // 넘어가는 종이의 뒷면
    } else {
      underPg = pages[nextIdx];        // 아래에서 드러나는 이전 페이지
      frontPg = pages[currentPage];    // 처음부터 꽉 찬 현재 페이지(앞면) → 오른쪽으로 넘어감
      backPg = pages[nextIdx];         // 넘어가는 종이의 뒷면
    }

    // 플립 오버레이 구성 (React 페이지는 숨기지 않고 오버레이로 덮는다 → 깜빡임 방지)
    const overlay = document.createElement('div');
    overlay.className = 'br-flip-overlay';

    const under = document.createElement('div');
    under.className = 'br-ebook-page';
    under.innerHTML = makePageHTML(underPg, nextIdx);

    const gutter = document.createElement('div');
    gutter.className = 'br-flip-gutter';

    const lift = document.createElement('div');
    lift.className = 'br-flip-lift';

    const leaf = document.createElement('div');
    leaf.className = 'br-flip-leaf';

    const frontFace = document.createElement('div');
    frontFace.className = 'br-flip-face br-ebook-page front';
    frontFace.innerHTML = makePageHTML(frontPg, currentPage);

    const backFace = document.createElement('div');
    backFace.className = 'br-flip-face br-ebook-page back';
    backFace.innerHTML = makePageHTML(backPg, nextIdx);

    const sheen = document.createElement('div');
    sheen.className = 'br-flip-sheen';

    leaf.appendChild(frontFace);
    leaf.appendChild(backFace);
    leaf.appendChild(sheen);
    lift.appendChild(leaf);
    overlay.appendChild(under);
    overlay.appendChild(gutter);
    overlay.appendChild(lift);
    container.appendChild(overlay);

    // 되넘김(이전 페이지)은 앞넘김의 좌우 반대(미러) 모션:
    // 현재 페이지가 처음부터 꽉 찬 상태에서 오른쪽 책등을 축으로 일어서 넘어가고,
    // 그 아래 이전 페이지가 드러난다. (앞넘김과 동일하게 딜레이 없음)
    if (!isForward) {
      leaf.style.transformOrigin = 'right center';
      sheen.style.transform = 'scaleX(-1)';                 // 광택도 좌우 반전
      gutter.style.left = 'auto';
      gutter.style.right = '0';
      gutter.style.background = 'linear-gradient(to left, rgba(0,0,0,0.5), rgba(0,0,0,0))';
    }

    let revealed = false;
    const revealNewText = () => {
      if (revealed) return;
      revealed = true;
      // 새 페이지로 갱신 + 텍스트 다시 표시 (넘김이 끝나기 직전에 미리 떠오르게)
      setCurrentPage(nextIdx);
      saveProgress(selectedBook.id, nextIdx);
      setTextHidden(false);
    };

    let finalized = false;
    const finalize = () => {
      if (finalized) return;
      finalized = true;
      revealNewText();
      setPageAnimating(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (overlay.parentNode) overlay.remove();
        });
      });
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const flipEase = `${DUR}ms cubic-bezier(.5,.02,.5,.98) forwards`;
        leaf.style.animation = `${isForward ? 'brFlipFwd' : 'brFlipBack'} ${flipEase}`;
        lift.style.animation = `brLiftZ ${DUR}ms ease-in-out forwards`;
        sheen.style.animation = `brSheen ${DUR}ms ease forwards`;
        gutter.style.animation = `brGutter ${DUR}ms ease forwards`;

        // 넘김이 끝나기 직전에 새 문장을 미리 페이드인
        setTimeout(revealNewText, DUR - 260);
        leaf.addEventListener('animationend', finalize, { once: true });
        // 안전장치
        setTimeout(finalize, DUR + 250);
      });
    });
  };

  // ─── TTS 재생 ───
  const speakText = async (text) => {
    if (!text || isPlaying) return;
    _speakCancelled.current = false;
    setIsPlaying(true);

    try {
      if (azureVerified && azureKey && azureRegion) {
        const cacheKey = makeCacheKey(text, azureVoice, '-10%');
        const cached = await getCachedAudio(cacheKey);
        if (cached) {
          if (!_speakCancelled.current) await playCachedAudio(cached);
          setIsPlaying(false);
          return;
        }

        // TTS 제한 체크
        if (ttsLimitReached) {
          console.warn('TTS 제한 초과');
          showNotice(VOICE_MSG.limit); // 조용히 무음이 되지 않게 안내
          setIsPlaying(false);
          return;
        }
        addSpeechUsageFirestore(text.length);
        await new Promise((resolve) => {
          const sc = speechsdk.SpeechConfig.fromSubscription(azureKey, azureRegion);
          const synthesizer = new speechsdk.SpeechSynthesizer(sc, null);
          _activeSynthesizer.current = synthesizer;

          const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
            <voice name="${azureVoice}">
              <prosody rate="-15%" pitch="+0%">${text}</prosody>
            </voice>
          </speak>`;

          synthesizer.speakSsmlAsync(ssml, (result) => {
            synthesizer.close();
            _activeSynthesizer.current = null;
            if (result.audioData && result.audioData.byteLength > 0 && !_speakCancelled.current) {
              const arr = new Uint8Array(result.audioData);
              setCachedAudio(cacheKey, arr);
              playCachedAudio(arr).then(resolve);
            } else { resolve(); }
          }, () => { synthesizer.close(); _activeSynthesizer.current = null; resolve(); });
        });
      } else {
        // Web Speech API 폴백
        await new Promise((resolve) => {
          const synth = window.speechSynthesis;
          synth.cancel();
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = 'en-US';
          utterance.rate = 0.8;
          const timeout = setTimeout(resolve, 8000);
          utterance.onend = () => { clearTimeout(timeout); resolve(); };
          utterance.onerror = () => { clearTimeout(timeout); resolve(); };
          synth.speak(utterance);
        });
      }
    } catch (e) {
      console.error('TTS 에러:', e);
    }
    setIsPlaying(false);
  };

  const stopTTS = () => {
    _speakCancelled.current = true;
    stopCachedAudio();
    if (_activeSynthesizer.current) {
      try { _activeSynthesizer.current.close(); } catch (e) { /* ignore */ }
      _activeSynthesizer.current = null;
    }
    window.speechSynthesis.cancel();
    setIsPlaying(false);
  };

  // ─── JSON 파싱 ───
  const parseJsonInput = () => {
    setParseError('');
    const text = uploadJson.trim();
    if (!text) { setParseError('텍스트를 입력해주세요.'); return; }

    try {
      // JSON 블록 추출 (```json ... ``` 형태도 지원)
      let jsonStr = text;
      const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

      const parsed = JSON.parse(jsonStr);

      if (parsed.title) setUploadTitle(parsed.title);
      if (parsed.titleKo) setUploadTitleKo(parsed.titleKo);
      if (parsed.level) setUploadLevel(parsed.level);
      if (parsed.description) setUploadDesc(parsed.description);

      if (parsed.pages && Array.isArray(parsed.pages)) {
        setParsedPages(parsed.pages.map((p, i) => ({
          page: p.page || i + 1,
          text: p.text || '',
          textKo: p.textKo || '',
          imagePrompt: p.imagePrompt || '',
          imageData: null,
        })));
        setUploadStep(2);
      } else {
        setParseError('JSON에 pages 배열이 없습니다.');
      }
    } catch (e) {
      // JSON 파싱 실패 → 줄바꿈/구분자로 나누기
      const lines = text.split(/\n{2,}|---/).map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length >= 2) {
        setParsedPages(lines.map((l, i) => ({
          page: i + 1,
          text: l,
          textKo: '',
          imagePrompt: '',
          imageData: null,
        })));
        setUploadStep(2);
      } else {
        setParseError('JSON 파싱 실패. 올바른 JSON 형식이거나 빈 줄로 구분된 텍스트를 입력해주세요.');
      }
    }
  };

  // ─── 이미지 업로드 처리 ───
  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // 파일명 순서로 정렬
    const sorted = files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    const images = [];
    for (const file of sorted) {
      const preview = URL.createObjectURL(file);
      images.push({ file, preview });
    }
    setUploadImages(images);

    // 파싱된 페이지에 이미지 매칭
    setParsedPages(prev => prev.map((p, i) => ({
      ...p,
      imageData: images[i] ? images[i].preview : null,
      _imageFile: images[i] ? images[i].file : null,
    })));
  };

  // ─── 책 저장 ───
  const handleSaveBook = async () => {
    if (!uploadTitle.trim()) { alert('책 제목을 입력해주세요.'); return; }
    if (parsedPages.length === 0) { alert('페이지가 없습니다.'); return; }

    const token = (githubToken || '').trim();
    if (!token) {
      alert('GitHub 토큰을 먼저 입력해주세요.\n이미지는 GitHub(main 브랜치 book-images/)에 저장됩니다.');
      return;
    }

    setIsUploading(true);
    try {
      // 이미지를 GitHub에 업로드하고, Firestore에는 URL만 저장 (용량 절감)
      const bookId = 'book-' + Date.now();
      const total = parsedPages.length;
      const pagesWithImages = [];
      let n = 0;
      for (const page of parsedPages) {
        n++;
        let imageData = null;
        let dataUrl = null;
        if (page._imageFile) {
          // 가로 최대 2048px, 품질 95% (고해상도 균형 — 화면 표시엔 충분, 용량/속도 최적화)
          dataUrl = await compressImage(page._imageFile, 2048, 0.95);
        } else if (page.imageData && page.imageData.startsWith('data:')) {
          dataUrl = page.imageData;
        } else if (page.imageData) {
          imageData = page.imageData; // 이미 URL인 경우 그대로
        }
        if (dataUrl) {
          setUploadStatus(`이미지 업로드 중... (${n}/${total})`);
          const path = `book-images/${bookId}/p${page.page}.jpg`;
          imageData = await uploadImageToGitHub(token, path, dataUrl);
        }
        pagesWithImages.push({
          page: page.page,
          text: page.text,
          textKo: page.textKo || '',
          imageData: imageData,
        });
      }

      setUploadStatus('책 정보 저장 중...');
      const book = {
        id: bookId,
        title: uploadTitle.trim(),
        titleKo: uploadTitleKo.trim(),
        level: uploadLevel,
        description: uploadDesc.trim(),
        pages: pagesWithImages,
        createdAt: new Date().toISOString(),
      };

      await saveBookToFirestore(book);

      // 정리
      uploadImages.forEach(img => URL.revokeObjectURL(img.preview));
      setUploadJson('');
      setParsedPages([]);
      setUploadImages([]);
      setUploadTitle('');
      setUploadTitleKo('');
      setUploadLevel(1);
      setUploadDesc('');
      setUploadStep(1);
      setView('shelf');
      alert('책이 등록되었습니다!');
    } catch (e) {
      console.error('책 저장 실패:', e);
      alert('저장 실패: ' + e.message);
    }
    setUploadStatus('');
    setIsUploading(false);
  };

  // ─── 책 삭제 ───
  const handleDeleteBook = async (bookId, e) => {
    e.stopPropagation();
    if (!window.confirm('이 책을 삭제할까요?')) return;
    await deleteBookFromFirestore(bookId);
  };

  // ─── 업로드 초기화 ───
  const resetUpload = () => {
    uploadImages.forEach(img => URL.revokeObjectURL(img.preview));
    setUploadJson('');
    setParsedPages([]);
    setUploadImages([]);
    setUploadTitle('');
    setUploadTitleKo('');
    setUploadLevel(1);
    setUploadDesc('');
    setParseError('');
    setUploadStep(1);
    setView('shelf');
  };

  // ─── AI 프롬프트 생성 ───
  const generateStoryPrompt = () => {
    return storyTemplate
      .replace(/\{topic\}/g, storyTopic || '(주제를 입력하세요)')
      .replace(/\{level\}/g, String(storyLevel))
      .replace(/\{pages\}/g, String(storyPages))
      .replace(/\{extra\}/g, storyExtra ? `- Additional: ${storyExtra}` : '');
  };

  const generateImagePrompt = () => {
    // 스토리 JSON이 있으면 페이지별 이미지 프롬프트 자동 생성
    if (imgStoryJson.trim()) {
      try {
        const data = JSON.parse(imgStoryJson.trim());
        const pages = data.pages || [];
        const title = data.title || 'Untitled';
        let prompt = `어린이 그림책 "${title}"의 삽화를 페이지별로 1장씩 그려줘.\n\n`;
        prompt += `그림체: ${imgStyle || '부드러운 수채화풍'}\n`;
        if (imgExtra) prompt += `추가 요청: ${imgExtra}\n`;
        prompt += `\n조건:\n- 이미지 안에 글자나 텍스트 넣지 마\n- 따뜻하고 밝은 색감, 5~8세 아이에게 적합하게\n- 캐릭터 디자인은 책 전체에서 일관되게 유지\n- 가로형 와이드 비율 (16:9 또는 3:2)\n- 페이지당 이미지 1장씩 총 ${pages.length}장 생성\n\n`;
        prompt += `페이지별 장면:\n`;
        pages.forEach((p, i) => {
          prompt += `${i + 1}. "${p.text}"${p.textKo ? ` (${p.textKo})` : ''}\n`;
        });
        return prompt;
      } catch (e) {
        return '⚠️ JSON 형식이 올바르지 않습니다. 스토리 생성 결과를 그대로 붙여넣어주세요.';
      }
    }
    // 기본 템플릿 (수동 입력)
    return imageTemplate
      .replace(/\{style\}/g, imgStyle || '(그림체를 입력하세요)')
      .replace(/\{subject\}/g, imgSubject || '(장면을 입력하세요)')
      .replace(/\{extra\}/g, imgExtra ? `- Additional: ${imgExtra}` : '');
  };

  const handleCopyPrompt = async (type) => {
    const text = type === 'story' ? generateStoryPrompt() : generateImagePrompt();
    try {
      await navigator.clipboard.writeText(text);
      setPromptCopied(type);
      setTimeout(() => setPromptCopied(''), 2000);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setPromptCopied(type);
      setTimeout(() => setPromptCopied(''), 2000);
    }
  };

  const handleSaveTemplates = () => {
    localStorage.setItem('woojin-prompt-story-template', storyTemplate);
    localStorage.setItem('woojin-prompt-image-template', imageTemplate);
    setShowTemplateEdit(false);
  };

  // ─── 필터링된 책 목록 ───
  const filteredBooks = filterLevel === 0 ? books : books.filter(b => b.level === filterLevel);

  // ======================================================
  // 렌더: 이북 리더 모달 (서재 위에 오버레이)
  // ======================================================
  const renderEbookModal = () => {
    if (!selectedBook) return null;
    const pages = selectedBook.pages || [];
    const page = pages[currentPage];
    const totalPages = pages.length;

    const handleSwipeStart = (e) => { touchStartX.current = e.touches[0].clientX; };
    const handleSwipeEnd = (e) => {
      const dx = e.changedTouches[0].clientX - touchStartX.current;
      if (Math.abs(dx) > 50) { dx < 0 ? goPage(1) : goPage(-1); }
    };

    return (
      <div className="br-ebook-overlay">
        <div className="br-ebook-modal">
          {/* 이북 본문 (페이지 넘김 컨테이너) */}
          <div
            className="br-ebook-body"
            ref={pageContainerRef}
            onTouchStart={handleSwipeStart}
            onTouchEnd={handleSwipeEnd}
          >
            {/* 넘어가는 페이지 = 이미지만 (텍스트/컨트롤은 아래 고정 레이어) */}
            {page ? (
              <div className="br-ebook-page" key={currentPage}>
                {page.imageData ? (
                  <img src={page.imageData} alt={`Page ${currentPage + 1}`} className="br-ebook-img" />
                ) : (
                  <div className="br-ebook-no-img"><span>📖</span></div>
                )}
              </div>
            ) : (
              <div className="br-empty">페이지를 찾을 수 없습니다.</div>
            )}

            {/* 고정 레이어: 하단 텍스트 + 컨트롤 (플립 위에 항상 표시) */}
            {page && (
              <>
                <div className="br-ebook-bottom-overlay">
                  <div className={`br-ebook-text-overlay ${textHidden ? 'br-text-hidden' : ''}`}>
                    <div className="br-ebook-sentence">
                      {page.text.split(' ').map((word, i) => (
                        <span
                          key={i}
                          className="br-ebook-word"
                          onClick={() => speakText(word.replace(/[.,!?;:'"]/g, ''))}
                        >
                          {word}{' '}
                        </span>
                      ))}
                    </div>

                    {showKorean && page.textKo && (
                      <div className="br-ebook-korean-text">{page.textKo}</div>
                    )}
                  </div>

                  <div className="br-ebook-controls">
                    <button
                      className="br-ebook-ctrl-circle"
                      onClick={() => goPage(-1)}
                      disabled={currentPage === 0 || pageAnimating || isPlaying}
                    >
                      ◀
                    </button>

                    <button
                      className={`br-ebook-listen ${isPlaying ? 'playing' : ''}`}
                      onClick={() => page && (isPlaying ? stopTTS() : speakText(page.text))}
                    >
                      {isPlaying ? '⏹' : '▶'}
                    </button>

                    <span className="br-ebook-header-pg">{currentPage + 1} / {totalPages}</span>

                    <button
                      className={`br-ebook-korean-toggle ${showKorean ? 'active' : ''}`}
                      onClick={() => setShowKorean(!showKorean)}
                    >
                      한글
                    </button>

                    <button
                      className="br-ebook-ctrl-circle br-ebook-ctrl-next"
                      onClick={() => goPage(1)}
                      disabled={currentPage === totalPages - 1 || pageAnimating || isPlaying}
                    >
                      ▶
                    </button>
                  </div>
                </div>

                <button className="br-ebook-close" onClick={backToShelf}>✕</button>
              </>
            )}
          </div>

          {/* 진행 바 */}
          <div className="br-ebook-progress">
            <div className="br-ebook-progress-fill" style={{ width: `${((currentPage + 1) / totalPages) * 100}%` }}></div>
          </div>
        </div>
      </div>
    );
  };

  // ======================================================
  // 렌더: 서재 화면
  // ======================================================
  // 렌더: AI 프롬프트 빌더 모달 (서재/업로드 공용)
  // ======================================================
  const renderPromptBuilder = () => {
    if (!showPromptBuilder) return null;
    return (
      <div className="modal-overlay" onClick={() => setShowPromptBuilder(false)}>
        <div className="br-prompt-modal" onClick={(e) => e.stopPropagation()}>
          <div className="br-prompt-header">
            <h3>🤖 AI 프롬프트 빌더</h3>
            <button className="br-prompt-close" onClick={() => setShowPromptBuilder(false)}>✕</button>
          </div>

          {/* 탭 전환 */}
          <div className="br-prompt-tabs">
            <button className={`br-prompt-tab ${promptTab === 'story' ? 'active' : ''}`} onClick={() => setPromptTab('story')}>📖 스토리 생성</button>
            <button className={`br-prompt-tab ${promptTab === 'image' ? 'active' : ''}`} onClick={() => setPromptTab('image')}>🎨 이미지 생성</button>
          </div>

          {/* 스토리 프롬프트 탭 */}
          {promptTab === 'story' && (
            <div className="br-prompt-body">
              <div className="br-prompt-inputs">
                <div className="br-prompt-field">
                  <label>📌 주제 / 소재</label>
                  <input type="text" value={storyTopic} onChange={(e) => setStoryTopic(e.target.value)} placeholder="예: 용감한 작은 토끼, 학교 가는 이야기" />
                </div>
                <div className="br-prompt-row">
                  <div className="br-prompt-field">
                    <label>📊 레벨</label>
                    <select value={storyLevel} onChange={(e) => setStoryLevel(Number(e.target.value))}>
                      {[1, 2, 3, 4, 5].map(lv => <option key={lv} value={lv}>Level {lv}</option>)}
                    </select>
                  </div>
                  <div className="br-prompt-field">
                    <label>📄 페이지 수</label>
                    <select value={storyPages} onChange={(e) => setStoryPages(Number(e.target.value))}>
                      {[6, 8, 10, 12, 15, 20].map(n => <option key={n} value={n}>{n}페이지</option>)}
                    </select>
                  </div>
                </div>
                <div className="br-prompt-field">
                  <label>✏️ 추가 요청 (선택)</label>
                  <input type="text" value={storyExtra} onChange={(e) => setStoryExtra(e.target.value)} placeholder="예: 라임 단어 사용, 동물 포함" />
                </div>
              </div>

              <div className="br-prompt-result">
                <div className="br-prompt-result-header">
                  <span>생성된 프롬프트 <span className="br-prompt-guide">(프롬프트를 복사하여 AI에 입력하세요)</span></span>
                  <button className="br-prompt-template-toggle" onClick={() => setShowTemplateEdit(!showTemplateEdit)}>
                    ⚙️ 골격 편집
                  </button>
                </div>
                {showTemplateEdit && (
                  <div className="br-prompt-template-edit">
                    <textarea
                      value={storyTemplate}
                      onChange={(e) => setStoryTemplate(e.target.value)}
                      rows={10}
                      className="br-prompt-template-textarea"
                    />
                    <div className="br-prompt-template-hint">
                      변수: <code>{'{topic}'}</code> <code>{'{level}'}</code> <code>{'{pages}'}</code> <code>{'{extra}'}</code>
                    </div>
                    <div className="br-prompt-template-actions">
                      <button onClick={handleSaveTemplates}>💾 골격 저장</button>
                      <button onClick={() => {
                        setStoryTemplate(`한국 5~8세 아이를 위한 영어 그림책을 써줘.\n\n주제: {topic}\n\n조건:\n- 레벨 {level}: 쉽고 나이에 맞는 단어만 사용\n- 총 {pages}페이지, 페이지당 영어 문장 1개\n- 각 문장마다 한글 번역 포함\n- 레벨 1-2는 8단어 이내, 레벨 3 이상은 12단어 이내\n- 반복 패턴과 파닉스에 좋은 단어 사용\n- 시작, 중간, 끝이 있는 이야기 구성\n{extra}\n아래 JSON 형식으로 출력해줘:\n{{\n  "title": "영어 제목",\n  "titleKo": "한글 제목",\n  "level": {level},\n  "pages": [\n    {{ "page": 1, "text": "English sentence.", "textKo": "한글 번역." }}\n  ]\n}}`);
                      }}>🔄 기본값 복원</button>
                    </div>
                  </div>
                )}
                <pre className="br-prompt-preview">{generateStoryPrompt()}</pre>
                <button className={`br-prompt-copy-btn ${promptCopied === 'story' ? 'copied' : ''}`} onClick={() => handleCopyPrompt('story')}>
                  {promptCopied === 'story' ? '✅ 복사됨!' : '📋 프롬프트 복사하기'}
                </button>
              </div>
            </div>
          )}

          {/* 이미지 프롬프트 탭 */}
          {promptTab === 'image' && (
            <div className="br-prompt-body">
              <div className="br-prompt-inputs">
                <div className="br-prompt-field">
                  <label>📋 스토리 JSON 붙여넣기</label>
                  <textarea
                    value={imgStoryJson}
                    onChange={(e) => setImgStoryJson(e.target.value)}
                    placeholder='1단계에서 생성한 스토리 JSON을 여기에 붙여넣으세요.&#10;&#10;{"title":"...", "pages":[{"page":1, "text":"...", "textKo":"..."}]}'
                    rows={4}
                    style={{ width: '100%', fontSize: '0.85rem', borderRadius: 8, border: '1px solid #ddd', padding: 10, resize: 'vertical' }}
                  />
                </div>
                <div className="br-prompt-field">
                  <label>🎨 그림체 / 스타일</label>
                  <input type="text" value={imgStyle} onChange={(e) => setImgStyle(e.target.value)} placeholder="예: 부드러운 수채화, 귀여운 만화, 플랫 일러스트" />
                </div>
                <div className="br-prompt-field">
                  <label>✏️ 추가 요청 (선택)</label>
                  <input type="text" value={imgExtra} onChange={(e) => setImgExtra(e.target.value)} placeholder="예: 파스텔 색감, 배경은 꽃밭" />
                </div>
              </div>

              <div className="br-prompt-result">
                <div className="br-prompt-result-header">
                  <span>생성된 프롬프트 <span className="br-prompt-guide">(프롬프트를 복사하여 AI에 입력하세요)</span></span>
                  <button className="br-prompt-template-toggle" onClick={() => setShowTemplateEdit(!showTemplateEdit)}>
                    ⚙️ 골격 편집
                  </button>
                </div>
                {showTemplateEdit && (
                  <div className="br-prompt-template-edit">
                    <textarea
                      value={imageTemplate}
                      onChange={(e) => setImageTemplate(e.target.value)}
                      rows={8}
                      className="br-prompt-template-textarea"
                    />
                    <div className="br-prompt-template-hint">
                      변수: <code>{'{style}'}</code> <code>{'{subject}'}</code> <code>{'{extra}'}</code>
                    </div>
                    <div className="br-prompt-template-actions">
                      <button onClick={handleSaveTemplates}>💾 골격 저장</button>
                      <button onClick={() => {
                        setImageTemplate(`어린이 그림책 삽화를 그려줘.\n\n그림체: {style}\n장면: {subject}\n\n조건:\n- 이미지 안에 글자나 텍스트 넣지 마\n- 따뜻하고 밝은 색감, 5~8세 아이에게 적합하게\n- 심플한 구도, 명확한 포인트\n- 캐릭터 디자인은 책 전체에서 일관되게\n- 가로형 와이드 비율 (16:9 또는 3:2)\n{extra}`);
                      }}>🔄 기본값 복원</button>
                    </div>
                  </div>
                )}
                <pre className="br-prompt-preview">{generateImagePrompt()}</pre>
                <button className={`br-prompt-copy-btn ${promptCopied === 'image' ? 'copied' : ''}`} onClick={() => handleCopyPrompt('image')}>
                  {promptCopied === 'image' ? '✅ 복사됨!' : '📋 프롬프트 복사하기'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ======================================================
  if (view === 'shelf') {
    return (
      <div className="br-container">
        <div className="br-shelf-header">
          <h2 className="br-shelf-title">My Library</h2>
          <div className="br-shelf-btns">
            <button className="br-add-btn" onClick={() => setView('upload')}>
              + 책 등록
            </button>
          </div>
        </div>

        {/* 레벨 필터 */}
        <div className="br-level-filter">
          <button className={`br-filter-btn ${filterLevel === 0 ? 'active' : ''}`} onClick={() => setFilterLevel(0)}>전체</button>
          {[1, 2, 3, 4, 5].map(lv => (
            <button key={lv} className={`br-filter-btn ${filterLevel === lv ? 'active' : ''}`} onClick={() => setFilterLevel(lv)}>Lv.{lv}</button>
          ))}
        </div>

        {/* 책 그리드 */}
        {booksLoading ? (
          <div className="br-loading">책 목록을 불러오는 중...</div>
        ) : filteredBooks.length === 0 ? (
          <div className="br-empty">
            <span className="br-empty-icon">📚</span>
            <p>등록된 책이 없습니다.</p>
            <p className="br-empty-sub">"+ 책 등록" 버튼으로 첫 번째 책을 추가해보세요!</p>
          </div>
        ) : (
          <div className="br-book-grid">
            {filteredBooks.map(book => {
              const progress = readingProgress[book.id];
              const totalPages = (book.pages || []).length;
              const readPage = progress ? progress.page + 1 : 0;
              const isFinished = readPage >= totalPages;
              const coverImage = book.pages?.[0]?.imageData;
              return (
                <div className="br-book-card" key={book.id} onClick={() => openBook(book)}>
                  <div className="br-book-cover" style={{ background: coverImage ? 'none' : getLevelGradient(book.level) }}>
                    {coverImage ? (
                      <img src={coverImage} alt="" className="br-cover-img" />
                    ) : (
                      <span className="br-cover-emoji">📖</span>
                    )}
                    {isFinished && <span className="br-finished-badge">완독</span>}
                  </div>
                  <div className="br-book-info">
                    <div className="br-book-title">{book.title}</div>
                    {book.titleKo && <div className="br-book-title-ko">{book.titleKo}</div>}
                    <div className="br-book-meta">
                      <span className={`br-level-badge ${getLevelBadgeClass(book.level)}`}>Lv.{book.level}</span>
                      <span className="br-page-count">{totalPages}p</span>
                    </div>
                    {readPage > 0 && !isFinished && (
                      <div className="br-reading-bar">
                        <div className="br-reading-fill" style={{ width: `${(readPage / totalPages) * 100}%` }}></div>
                      </div>
                    )}
                  </div>
                  <button className="br-book-delete" onClick={(e) => handleDeleteBook(book.id, e)} title="삭제">✕</button>
                </div>
              );
            })}
          </div>
        )}

        {/* ===== AI 프롬프트 빌더 모달 ===== */}
        {renderPromptBuilder()}

        {/* 이북 리더 모달 */}
        {renderEbookModal()}
      </div>
    );
  }

  // ======================================================
  // 렌더: 업로드 화면
  // ======================================================
  return (
    <div className="br-container">
      <div className="br-upload-header">
        <button className="br-back-btn" onClick={resetUpload}>← 서재</button>
        <h2 className="br-upload-title">책 등록</h2>
        <div className="br-upload-steps">
          <span className={`br-step ${uploadStep >= 1 ? 'active' : ''}`}>1.텍스트</span>
          <span className="br-step-arrow">→</span>
          <span className={`br-step ${uploadStep >= 2 ? 'active' : ''}`}>2.이미지</span>
          <span className="br-step-arrow">→</span>
          <span className={`br-step ${uploadStep >= 3 ? 'active' : ''}`}>3.미리보기</span>
        </div>
        <button className="br-prompt-btn" onClick={() => setShowPromptBuilder(true)}>
          🤖 AI 프롬프트
        </button>
      </div>

      {/* Step 1: 텍스트 입력 */}
      {uploadStep === 1 && (
        <div className="br-upload-step">
          <div className="br-upload-desc">
            GPT에서 생성한 JSON을 그대로 붙여넣으세요. <code>{`{"title":"...", "pages":[...]}`}</code> 형식이면 됩니다.
          </div>
          <textarea
            className="br-upload-textarea"
            value={uploadJson}
            onChange={(e) => setUploadJson(e.target.value)}
            placeholder={`GPT 결과 JSON을 여기에 붙여넣기...\n\n예시:\n{\n  "title": "The Little Fox",\n  "titleKo": "작은 여우",\n  "level": 1,\n  "pages": [\n    { "page": 1, "text": "A little fox lived in the forest.", "textKo": "작은 여우가 숲에 살았어요." }\n  ]\n}`}
            rows={15}
          />
          {parseError && <div className="br-parse-error">{parseError}</div>}
          <button className="br-next-btn" onClick={parseJsonInput} disabled={!uploadJson.trim()}>
            다음: 텍스트 확인 →
          </button>
        </div>
      )}

      {/* Step 2: 이미지 업로드 */}
      {uploadStep === 2 && (
        <div className="br-upload-step">
          {/* 책 정보 편집 */}
          <div className="br-book-info-form">
            <div className="br-form-row">
              <label>제목 (영어)</label>
              <input type="text" value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} placeholder="The Little Fox" />
            </div>
            <div className="br-form-row">
              <label>제목 (한글)</label>
              <input type="text" value={uploadTitleKo} onChange={(e) => setUploadTitleKo(e.target.value)} placeholder="작은 여우" />
            </div>
            <div className="br-form-row">
              <label>레벨</label>
              <select value={uploadLevel} onChange={(e) => setUploadLevel(Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map(lv => <option key={lv} value={lv}>Level {lv}</option>)}
              </select>
            </div>
            <div className="br-form-row">
              <label>설명</label>
              <input type="text" value={uploadDesc} onChange={(e) => setUploadDesc(e.target.value)} placeholder="책 소개 한 줄" />
            </div>
          </div>

          {/* 페이지 텍스트 확인 */}
          <div className="br-pages-preview-list">
            <div className="br-pages-header">
              <span>페이지 텍스트 ({parsedPages.length}페이지)</span>
            </div>
            {parsedPages.map((p, i) => (
              <div className="br-page-preview-item" key={i}>
                <span className="br-page-num">P{p.page}</span>
                <span className="br-page-text-preview">{p.text}</span>
                {p.imageData && <img src={p.imageData} alt="" className="br-page-thumb" />}
              </div>
            ))}
          </div>

          {/* 이미지 업로드 */}
          <div className="br-image-upload-area">
            {!githubToken && (
              <div className="br-upload-desc" style={{ fontSize: '0.75rem', marginBottom: 10, color: '#c2691a' }}>
                ⚠️ GitHub 토큰이 없어요. 설정(⚙️)에서 먼저 입력해 주세요.
              </div>
            )}
            <div className="br-upload-desc">
              DALL-E로 생성한 삽화 이미지를 한번에 선택하세요. 파일명 순서대로 페이지에 매칭됩니다.
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
              style={{ display: 'none' }}
            />
            <button className="br-image-upload-btn" onClick={() => fileInputRef.current?.click()}>
              🖼️ 이미지 선택 ({uploadImages.length > 0 ? `${uploadImages.length}개 선택됨` : '선택 안 됨'})
            </button>
          </div>

          <div className="br-step-btns">
            <button className="br-back-step-btn" onClick={() => setUploadStep(1)}>← 이전</button>
            <button className="br-next-btn" onClick={() => setUploadStep(3)}>미리보기 →</button>
          </div>
        </div>
      )}

      {/* Step 3: 미리보기 */}
      {uploadStep === 3 && (
        <div className="br-upload-step">
          <div className="br-preview-book">
            <div className="br-preview-header">
              <h3>{uploadTitle || '(제목 없음)'}</h3>
              {uploadTitleKo && <span className="br-preview-ko">{uploadTitleKo}</span>}
              <span className={`br-level-badge ${getLevelBadgeClass(uploadLevel)}`}>Lv.{uploadLevel}</span>
            </div>

            <div className="br-preview-pages">
              {parsedPages.map((p, i) => (
                <div className="br-preview-page" key={i}>
                  <div className="br-preview-page-num">Page {p.page}</div>
                  <div className="br-preview-page-content">
                    {p.imageData ? (
                      <img src={p.imageData} alt="" className="br-preview-page-img" />
                    ) : (
                      <div className="br-preview-no-img">이미지 없음</div>
                    )}
                    <div className="br-preview-page-text">
                      <div className="br-preview-en">{p.text}</div>
                      {p.textKo && <div className="br-preview-kr">{p.textKo}</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="br-step-btns">
            <button className="br-back-step-btn" onClick={() => setUploadStep(2)}>← 수정</button>
            <button className="br-save-btn" onClick={handleSaveBook} disabled={isUploading}>
              {isUploading ? (uploadStatus || '저장 중...') : '📚 책 저장하기'}
            </button>
          </div>
        </div>
      )}

      {/* AI 프롬프트 빌더 모달 */}
      {renderPromptBuilder()}
    </div>
  );
}
