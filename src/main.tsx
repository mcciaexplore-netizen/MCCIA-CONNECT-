import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App';
import { DataProvider } from './context/DataContext';
import { preloadRoute } from './lib/pages';
import './styles/index.css';

preloadRoute(window.location.pathname); // this address's screen downloads now, alongside finding out who is signed in

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <DataProvider>
        <App />
      </DataProvider>
    </BrowserRouter>
  </StrictMode>,
);
