import React from 'react';
import { createRoot } from 'react-dom/client';
import { DashboardApp } from './sidebar';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DashboardApp />
  </React.StrictMode>
);
