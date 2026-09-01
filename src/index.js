import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { installGlobalLogging } from './logger';
import { checkForUpdate } from './updateCheck';
import ErrorBoundary from './ErrorBoundary';

installGlobalLogging();
checkForUpdate(); // 즉시 최신 버전 확인 — 구버전이면 로딩 중에 바로 교체 (사용 중 새로고침 방지)

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
