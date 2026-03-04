import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [word, setWord] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [displayWord, setDisplayWord] = useState({ first: '', rest: '' });
  const [nowPlaying, setNowPlaying] = useState('대기 중...');
  
  // ⭐️ [해결 1] 브라우저가 켜지자마자 목소리 목록부터 미리 싹 다 불러오기
  const [availableVoices, setAvailableVoices] = useState([]);

  useEffect(() => {
    const fetchVoices = () => {
      setAvailableVoices(window.speechSynthesis.getVoices());
    };
    fetchVoices();
    // 목소리 목록이 로딩 완료되면 바로 업데이트
    window.speechSynthesis.onvoiceschanged = fetchVoices;
  }, []);

  const fetchImage = async (searchWord) => {
    try {
      // ⚠️ 아래 큰따옴표 안에 진영님의 진짜 API 키를 넣어주세요! (띄어쓰기 절대 금지)
      const myApiKey = "54882997-442b00e026bf00d52307ed9ff"; 
      
      // 검색어 앞뒤에 혹시 모를 보이지 않는 공백(스페이스) 제거
      const cleanWord = searchWord.trim();

      // 주소 완벽하게 조립
      const url = `https://pixabay.com/api/?key=${myApiKey}&q=${cleanWord}&image_type=photo&orientation=horizontal`;
      
      // ⭐️ 핵심 디버깅: F12 콘솔창에 모든 정보 출력 ⭐️
      console.log("===== 🔍 이미지 검색 디버깅 시작 =====");
      console.log("1. 입력된 검색어 :", cleanWord);
      console.log("2. 입력된 API 키 :", myApiKey);
      console.log("3. 완성된 요청 URL :", url);
      console.log("======================================");

      const response = await fetch(url);
      
      // 상태 코드 확인 (200이면 정상, 400이면 주소/키 에러)
      if (!response.ok) {
        console.error(`🚨 서버 에러 발생! 상태 코드: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.hits && data.hits.length > 0) {
        setImageUrl(data.hits[0].webformatURL);
        console.log("✅ 이미지 로딩 성공! 사진 주소:", data.hits[0].webformatURL);
      } else {
        console.log("❌ 검색 결과가 없습니다 (사진을 못 찾음).");
      }
    } catch (e) { 
      console.error("🚨 치명적인 에러 발생:", e); 
    }
  };

  const playPhonics = async () => {
    if (!word) return;
    const firstLetter = word[0].toLowerCase();
    setDisplayWord({ first: word[0].toUpperCase(), rest: word.slice(1).toLowerCase() });
    fetchImage(word);

    window.speechSynthesis.cancel();
    
    // 쉬는 시간(인터벌)을 만들어주는 함수
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // 미리 로딩해둔 목소리 중에서 여자 목소리 찾기
    const femaleVoice = availableVoices.find(v => 
      v.name.includes('Google US English') || 
      v.name.includes('Zira') ||              
      v.name.includes('Samantha') ||
      v.name.includes('Female')
    );

    const speak = (text) => new Promise(res => {
      setNowPlaying(`[시스템 음성] "${text}"`);
      const ut = new SpeechSynthesisUtterance(text);
      ut.lang = 'en-US'; 
      ut.rate = 0.7; // 우진이가 듣기 편한 속도
      if (femaleVoice) ut.voice = femaleVoice; // 무조건 여자 목소리 적용
      
      ut.onend = res;
      ut.onerror = res; 
      window.speechSynthesis.speak(ut);
    });

    const playAudio = (letter) => new Promise(res => {
      const fileName = `${letter}_phonics.mp3`;
      setNowPlaying(`[파일 재생] ${fileName}`);
      const audio = new Audio(`${process.env.PUBLIC_URL}/audio/${fileName}`);
      
      audio.onended = res; 
      audio.onerror = () => {
        setNowPlaying(`[에러] ${fileName} 파일 없음!`);
        res(); 
      };
      audio.play().catch(e => res());
    });

    // ⭐️ [해결 2] 재생 루틴과 넉넉한 인터벌 ⭐️
    
    // 1단계: 알파벳 이름 3번 (0.5초 간격)
    for(let i=0; i<3; i++) {
      await speak(firstLetter);
      await sleep(500); 
    }
    
    // 2단계: 파닉스 발음 3번 (⭐️ 1.5초 간격으로 우진이가 따라할 시간 확보 ⭐️)
    for(let i=0; i<3; i++) {
      await playAudio(firstLetter);
      await sleep(1300); 
    }
    
    // 3단계: 전체 단어 3번 (1초 간격)
    for(let i=0; i<3; i++) {
      await speak(word);
      await sleep(900); 
    }

    setNowPlaying('재생 완료! 우진이 최고!');
  };

  return (
    <div className="App">
      <div className="card">
        <h1>🦁 우진이의 파닉스 모험</h1>
        
        <div className="debug-log">
          📡 <strong>상태:</strong> {nowPlaying}
        </div>

        <div className="input-group">
          <input 
            type="text" 
            value={word} 
            onChange={(e) => setWord(e.target.value)} 
            placeholder="단어 입력 (예: Apple)"
            onKeyPress={(e) => e.key === 'Enter' && playPhonics()}
          />
          <button onClick={playPhonics}>소리 듣기!</button>
        </div>

        <div className="word-display">
          <span className="highlight">{displayWord.first}</span>{displayWord.rest}
        </div>

        {imageUrl && <div className="image-container"><img src={imageUrl} alt="word" /></div>}
      </div>
    </div>
  );
}

export default App;