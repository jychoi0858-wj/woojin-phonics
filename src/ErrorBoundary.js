import React from 'react';

// ============================================================
// 렌더 중 에러가 나도 흰 화면이 되지 않게 막아주는 안전망
// - 아이가 혼자 쓰다 멈춰도 [다시 시작하기] 한 번으로 복구
// - 에러 내용은 접어두고, 어른이 필요할 때만 펼쳐 확인
// ============================================================
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null, showDetail: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    try {
      console.error('[크래시]', error, info);
      // 진단용 로그 (logger.js가 localStorage에 보관)
      const prev = JSON.parse(localStorage.getItem('woojin-crash-logs') || '[]');
      prev.push({
        at: new Date().toISOString(),
        message: String(error && error.message),
        stack: String((error && error.stack) || '').slice(0, 1200),
        component: String((info && info.componentStack) || '').slice(0, 1200),
      });
      localStorage.setItem('woojin-crash-logs', JSON.stringify(prev.slice(-10)));
    } catch (e) { /* ignore */ }
  }

  render() {
    if (!this.state.error) return this.props.children;

    const { error, info, showDetail } = this.state;
    return (
      <div className="eb-wrap">
        <div className="eb-card">
          <div className="eb-emoji">🐣</div>
          <div className="eb-title">앗, 잠깐 문제가 생겼어요</div>
          <div className="eb-desc">아래 버튼을 누르면 다시 시작할 수 있어요.<br />공부한 내용은 저장되어 있으니 걱정하지 마세요!</div>

          <div className="eb-btns">
            <button className="eb-btn primary" onClick={() => window.location.reload()}>
              🔄 다시 시작하기
            </button>
            <button className="eb-btn ghost" onClick={() => this.setState({ showDetail: !showDetail })}>
              {showDetail ? '자세히 숨기기' : '어른용 자세히 보기'}
            </button>
          </div>

          {showDetail && (
            <pre className="eb-detail">
{String(error && error.message)}
{'\n'}
{String((error && error.stack) || '').slice(0, 900)}
{'\n'}
{String((info && info.componentStack) || '').slice(0, 900)}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
