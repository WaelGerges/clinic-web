import React, { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from './i18n';
import { App } from './App';
import './styles.css';
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="fatal">
        <h1>Clinic</h1>
        <p>The workspace could not be displayed. Reload to reconnect.</p>
        <p lang="ar" dir="rtl">
          تعذر عرض مساحة العمل. أعد تحميل الصفحة للاتصال.
        </p>
        <button onClick={() => location.reload()}>Reload / إعادة التحميل</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Boundary>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </Boundary>
  </React.StrictMode>,
);
