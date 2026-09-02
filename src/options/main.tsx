import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PRODUCT_NAME } from '../shared/constants/product';
import '../shared/ui/base.css';
import './options.css';
import { Options } from './Options';

document.title = `${PRODUCT_NAME} settings`;
const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <Options />
    </StrictMode>,
  );
}
