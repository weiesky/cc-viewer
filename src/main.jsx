import './tokenInterceptor';
import React from 'react';
import ReactDOM from 'react-dom/client';
import './global.css';
import { isMobile } from './env';

const root = ReactDOM.createRoot(document.getElementById('root'));

const onLoadError = (err) => {
  console.error('Failed to load app module:', err);
  document.getElementById('root').textContent = 'Loading failed. Please refresh the page.';
};

if (isMobile) {
  import('./Mobile').then(({ default: Mobile }) => {
    root.render(<Mobile />);
  }).catch(onLoadError);
} else {
  import('./App').then(({ default: App }) => {
    root.render(<App />);
  }).catch(onLoadError);
}
