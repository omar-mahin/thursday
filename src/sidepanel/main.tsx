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

  /*
   * Tells the frame around us that we are alive.
   *
   * The panel is framed inside a page, and if that frame fails to load the
   * user gets one of Chrome's grey error screens inside Thursday's own window
   * with no explanation and no way out -- which is exactly what happened when
   * the resource was declared with a dynamic URL. The frame waits for this and
   * says something useful if it never arrives.
   *
   * postMessage rather than anything richer: the frame is cross-origin to its
   * parent, so this is the only channel, and it carries no data -- just the
   * fact of having rendered.
   */
  window.parent?.postMessage({ thursday: 'panel-ready' }, '*');
}
