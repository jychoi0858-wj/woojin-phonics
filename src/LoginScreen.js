import React, { useState } from 'react';
import { loginUser, signupUser, saveUserProfile, isNameTaken, findUsernameByName } from './firebase';
import LogoIcon from './LogoIcon';

const SAVE_KEY = 'woojin-save-credentials';
const SAVED_USER = 'woojin-saved-username';
const SAVED_PASS = 'woojin-saved-password';

export default function LoginScreen() {
  const [username, setUsername] = useState(() => localStorage.getItem(SAVED_USER) || '');
  const [password, setPassword] = useState(() => localStorage.getItem(SAVED_PASS) || '');
  const [name, setName] = useState('');
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'findId'
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [saveCredentials, setSaveCredentials] = useState(() => localStorage.getItem(SAVE_KEY) === 'true');

  const switchMode = (newMode) => {
    setMode(newMode);
    setError('');
    setInfo('');
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    if (!username.trim()) { setError('아이디를 입력해주세요'); return; }
    if (password.length < 4) { setError('비밀번호는 4자 이상이어야 해요'); return; }

    setLoading(true);
    try {
      await loginUser(username, password);
      // 로그인 성공 → 저장 옵션에 따라 처리
      if (saveCredentials) {
        localStorage.setItem(SAVE_KEY, 'true');
        localStorage.setItem(SAVED_USER, username.trim());
        localStorage.setItem(SAVED_PASS, password);
      } else {
        localStorage.removeItem(SAVE_KEY);
        localStorage.removeItem(SAVED_USER);
        localStorage.removeItem(SAVED_PASS);
      }
    } catch (err) {
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
        setError('아이디 또는 비밀번호가 틀려요');
      } else {
        setError('오류: ' + err.message);
      }
    }
    setLoading(false);
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setError('');
    if (name.trim().length !== 2) { setError('이름은 2글자로 입력해주세요'); return; }
    if (!username.trim()) { setError('아이디를 입력해주세요'); return; }
    if (password.length < 4) { setError('비밀번호는 4자 이상이어야 해요'); return; }

    setLoading(true);
    try {
      // 이름 중복 확인
      const taken = await isNameTaken(name);
      if (taken) {
        setError('이미 사용 중인 이름이에요');
        setLoading(false);
        return;
      }

      const user = await signupUser(username, password);
      // 프로필 저장 (이름 → 아이디 매핑)
      await saveUserProfile(user.uid, username.toLowerCase().trim(), name.trim());
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        setError('이미 사용 중인 아이디예요');
      } else if (err.code === 'auth/weak-password') {
        setError('비밀번호가 너무 짧아요 (4자 이상)');
      } else {
        setError('오류: ' + err.message);
      }
    }
    setLoading(false);
  };

  const handleFindId = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    if (name.trim().length !== 2) { setError('이름은 2글자로 입력해주세요'); return; }

    setLoading(true);
    try {
      const foundUsername = await findUsernameByName(name);
      if (foundUsername) {
        setInfo(`아이디: ${foundUsername}`);
      } else {
        setError('해당 이름으로 등록된 아이디가 없어요');
      }
    } catch (err) {
      console.error('Find ID error:', err);
      if (err.code === 'permission-denied') {
        setError('Firestore 권한 오류 — 규칙을 업데이트해주세요');
      } else {
        setError('오류: ' + err.message);
      }
    }
    setLoading(false);
  };

  return (
    <div className={`login-container ${mode === 'signup' ? 'signup-mode' : mode === 'findId' ? 'find-mode' : 'login-mode'}`}>
      <div className="login-card">
        <div className="login-emoji"><LogoIcon size={100} /></div>
        <h1 className="login-title">펀펀영어</h1>
        <p className="login-subtitle">
          {mode === 'login' ? '로그인' : mode === 'signup' ? '회원가입' : '아이디 찾기'}
        </p>

        {/* ─── 로그인 ─── */}
        {mode === 'login' && (
          <form onSubmit={handleLogin} className="login-form">
            <div className="login-field">
              <label className="login-label">아이디</label>
              <input type="text" className="login-input" value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="아이디 입력" autoComplete="username" autoFocus />
            </div>
            <div className="login-field">
              <label className="login-label">비밀번호</label>
              <input type="password" className="login-input" value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호 입력" autoComplete="current-password" />
            </div>
            <label className="login-save-check">
              <input type="checkbox" checked={saveCredentials}
                onChange={(e) => setSaveCredentials(e.target.checked)} />
              <span>아이디 / 비밀번호 저장</span>
            </label>
            {error && <div className="login-error">{error}</div>}
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? '처리 중...' : '로그인'}
            </button>
          </form>
        )}

        {/* ─── 회원가입 ─── */}
        {mode === 'signup' && (
          <form onSubmit={handleSignup} className="login-form">
            <div className="login-field">
              <label className="login-label">이름</label>
              <input type="text" className="login-input" value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="이름 2글자 (아이디 찾기에 사용)" maxLength={2} autoFocus />
            </div>
            <div className="login-field">
              <label className="login-label">아이디</label>
              <input type="text" className="login-input" value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="아이디 입력" autoComplete="username" />
            </div>
            <div className="login-field">
              <label className="login-label">비밀번호</label>
              <input type="password" className="login-input" value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호 입력 (4자 이상)" autoComplete="new-password" />
            </div>
            {error && <div className="login-error">{error}</div>}
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? '처리 중...' : '회원가입'}
            </button>
          </form>
        )}

        {/* ─── 아이디 찾기 ─── */}
        {mode === 'findId' && (
          <form onSubmit={handleFindId} className="login-form">
            <div className="login-field">
              <label className="login-label">이름</label>
              <input type="text" className="login-input" value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="회원가입 시 입력한 이름" autoFocus />
            </div>
            {error && <div className="login-error">{error}</div>}
            {info && <div className="login-info">{info}</div>}
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? '찾는 중...' : '아이디 찾기'}
            </button>
          </form>
        )}

        {/* ─── 모드 전환 버튼 ─── */}
        <div className="login-links">
          {mode === 'login' && (
            <>
              <button className="login-toggle" onClick={() => switchMode('signup')}>
                계정이 없어요 → 회원가입
              </button>
              <button className="login-toggle" onClick={() => switchMode('findId')}>
                아이디를 잊었어요
              </button>
            </>
          )}
          {mode === 'signup' && (
            <button className="login-toggle" onClick={() => switchMode('login')}>
              이미 계정이 있어요 → 로그인
            </button>
          )}
          {mode === 'findId' && (
            <button className="login-toggle" onClick={() => switchMode('login')}>
              ← 로그인으로 돌아가기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
