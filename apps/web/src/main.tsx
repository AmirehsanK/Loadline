import './strict.ts';
import '@fontsource/b612/latin-400.css';
import '@fontsource/b612/latin-700.css';
import '@fontsource/b612-mono/latin-400.css';
import '@fontsource/b612-mono/latin-700.css';
import '@fontsource-variable/big-shoulders-stencil/wght.css';
import '@fontsource-variable/estedad/wght.css';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
