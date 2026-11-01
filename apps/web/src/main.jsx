import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './styles.css';

// Last line of defence: if the app itself fails to render, say so and offer a reload instead of a blank
// page. Saved journeys stay on the server, so a reload picks them up again.
function AppFailed() {
  return (
    <main className="app-failed" role="alert">
      <p className="chat-title">NAVI 暫時無法顯示</p>
      <p className="chat-text">頁面發生錯誤。已保存的服務旅程不會因此消失，重新載入後可以繼續。</p>
      <button type="button" className="button button-primary" onClick={() => location.reload()}>重新載入</button>
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary name="app" fallback={() => <AppFailed />}><App /></ErrorBoundary>
  </React.StrictMode>,
);
