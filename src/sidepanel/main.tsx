import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PRODUCT_NAME } from '../shared/constants/product';
import '../shared/ui/base.css';
import './sidepanel.css';
import { App } from './App';

document.title = `${PRODUCT_NAME} audit`;
const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
