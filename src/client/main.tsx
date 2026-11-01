import React from 'react';
import { createRoot } from 'react-dom/client';
import { TVApp } from './tv/TVApp.js';
import { RemoteApp } from './remote/RemoteApp.js';
import './styles.css';

function RootRouter() {
  const path = window.location.pathname.toLowerCase();
  const isRemote = path.startsWith('/remote');

  return isRemote ? <RemoteApp /> : <TVApp />;
}

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <React.StrictMode>
      <RootRouter />
    </React.StrictMode>
  );
}
