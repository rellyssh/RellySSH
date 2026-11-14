import React from 'react';
import ReactDOM from 'react-dom/client';
import '@radix-ui/themes/styles.css';
import '@xterm/xterm/css/xterm.css';
import { Theme } from '@radix-ui/themes';
import './services/mobileBridge';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Theme appearance="dark" accentColor="iris" grayColor="slate" radius="medium" scaling="95%">
      <App />
    </Theme>
  </React.StrictMode>
);
