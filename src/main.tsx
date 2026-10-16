import './android/runtime-compatibility';
import './android/dom-compatibility';
import React from 'react';
import './android/frontend';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
