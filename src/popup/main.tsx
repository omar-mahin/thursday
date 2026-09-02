import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PRODUCT_NAME } from '../shared/constants/product';
import '../shared/ui/base.css';
import './popup.css';
import { Popup } from './Popup';

document.title = PRODUCT_NAME;
const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <Popup />
    </StrictMode>,
  );
}
