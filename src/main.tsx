import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/fonts.css';
import './styles/global.css';
import './styles/ui.css';
import App from './App';
import { initViewport } from './state/viewport';

// 첫 프레임부터 <html data-layout|data-bar|data-short> 가 붙어 있어야 레이아웃이 깜빡이지 않습니다.
initViewport();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
