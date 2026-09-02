(function(){function e(e,t){throw Error(`${t}: unhandled variant ${JSON.stringify(e)}`)}var t=e=>{if(typeof e!=`object`||!e)return!1;let t=e;if(t.from!==`sidepanel`&&t.from!==`content`)return!1;let n=t.message;return typeof n==`object`&&!!n&&typeof n.type==`string`},n=200,r=new Set([`title`,`placeholder`]),i=new Set([`input`,`select`,`textarea`]),a=new Set([`a`,`button`,`summary`,`h1`,`h2`,`h3`,`h4`,`h5`,`h6`,`label`,`legend`,`caption`,`td`,`th`,`option`,`li`]),o=new Set([`button`,`link`,`heading`,`menuitem`,`option`,`tab`,`treeitem`,`cell`,`columnheader`,`rowheader`,`listitem`]),s=e=>e.replace(/\s+/g,` `).trim(),c=e=>e.length>n?`${e.slice(0,n).trimEnd()}…`:e,l=e=>{if(e.getAttribute(`aria-hidden`)===`true`||e.hasAttribute(`hidden`))return!0;let t=e.getAttribute(`style`);return t!==null&&/display\s*:\s*none|visibility\s*:\s*hidden/i.test(t)};function u(e,t=0){if(t>12)return``;let n=``;for(let r of e.childNodes){if(r.nodeType===3){n+=r.nodeValue??``;continue}if(r.nodeType!==1)continue;let e=r;if(l(e))continue;let a=e.tagName.toLowerCase();if(i.has(a))continue;if(a===`img`){n+=` ${e.getAttribute(`alt`)??``} `;continue}let o=e.getAttribute(`aria-label`);if(o){n+=` ${o} `;continue}n+=` ${u(e,t+1)} `}return s(n)}function d(e){let t=e.getAttribute(`aria-labelledby`);if(!t)return null;let n=e.getRootNode(),r=[];for(let e of t.trim().split(/\s+/)){let t=n.getElementById?.(e)??null;if(!t)continue;let i=t.getAttribute(`aria-label`);r.push(i?s(i):u(t))}let i=s(r.join(` `));return i.length>0?i:null}function f(e){let t=e.getAttribute(`id`);if(t){let n=e.getRootNode(),r=typeof CSS<`u`&&CSS.escape?CSS.escape(t):t.replace(/"/g,`\\"`),i=n.querySelector?.(`label[for="${r}"]`);if(i){let e=u(i);if(e)return{name:e,source:`label-for`}}}let n=e.closest?.(`label`);if(n){let e=u(n);if(e)return{name:e,source:`label-wrapped`}}return null}var p=()=>({name:``,source:`none`,weak:!1}),m=(e,t)=>({name:c(s(e)),source:t,weak:r.has(t)});function h(e){let t=e.tagName.toLowerCase(),n=e.getAttribute(`role`)??void 0;if(e.getAttribute(`aria-hidden`)===`true`)return p();let r=d(e);if(r)return m(r,`aria-labelledby`);let c=e.getAttribute(`aria-label`);if(c&&s(c))return m(c,`aria-label`);if(t===`img`||t===`area`){let t=e.getAttribute(`alt`);if(t!==null)return t===``?p():m(t,`alt`)}if(t===`input`){let t=(e.getAttribute(`type`)??`text`).toLowerCase();if(t===`submit`||t===`reset`||t===`button`){let n=e.getAttribute(`value`);if(n&&s(n))return m(n,`value`);if(t===`submit`)return m(`Submit`,`value`);if(t===`reset`)return m(`Reset`,`value`)}if(t===`image`){let t=e.getAttribute(`alt`);if(t&&s(t))return m(t,`alt`)}}if(i.has(t)||n===`textbox`||n===`combobox`){let t=f(e);if(t)return m(t.name,t.source)}if(t===`fieldset`){let t=e.querySelector(`:scope > legend`);if(t){let e=u(t);if(e)return m(e,`legend`)}}if(t===`table`){let t=e.querySelector(`:scope > caption`);if(t){let e=u(t);if(e)return m(e,`caption`)}}if(a.has(t)||n!==void 0&&o.has(n)){let t=u(e);if(t)return m(t,`text`)}let l=e.getAttribute(`title`);if(l&&s(l))return m(l,`title`);let h=e.getAttribute(`placeholder`);return h&&s(h)?m(h,`placeholder`):p()}var g={a:`link`,article:`article`,aside:`complementary`,button:`button`,dialog:`dialog`,fieldset:`group`,figure:`figure`,footer:`contentinfo`,form:`form`,h1:`heading`,h2:`heading`,h3:`heading`,h4:`heading`,h5:`heading`,h6:`heading`,header:`banner`,hr:`separator`,img:`img`,input:`textbox`,li:`listitem`,main:`main`,nav:`navigation`,ol:`list`,option:`option`,output:`status`,progress:`progressbar`,section:`region`,select:`combobox`,summary:`button`,table:`table`,tbody:`rowgroup`,td:`cell`,textarea:`textbox`,th:`columnheader`,tr:`row`,ul:`list`},_={button:`button`,checkbox:`checkbox`,color:`textbox`,date:`textbox`,"datetime-local":`textbox`,email:`textbox`,file:`button`,image:`button`,month:`textbox`,number:`spinbutton`,password:`textbox`,radio:`radio`,range:`slider`,reset:`button`,search:`searchbox`,submit:`button`,tel:`textbox`,text:`textbox`,time:`textbox`,url:`textbox`,week:`textbox`},v=new Set([`article`,`aside`,`main`,`nav`,`section`]),y=new Set([`header`,`nav`,`main`,`aside`,`footer`,`section`,`form`]),b=new Set([`h1`,`h2`,`h3`,`h4`,`h5`,`h6`]);function x(e){let t=e.tagName.toLowerCase();if(t===`a`||t===`area`)return e.hasAttribute(`href`)?`link`:void 0;if(t===`img`)return e.getAttribute(`alt`)===``?`presentation`:`img`;if(t===`input`){let t=(e.getAttribute(`type`)??`text`).toLowerCase();return t===`hidden`?void 0:_[t]??`textbox`}if(t===`header`||t===`footer`){let n=e.parentElement;for(;n;){if(v.has(n.tagName.toLowerCase()))return`generic`;n=n.parentElement}return g[t]}return t===`section`?e.hasAttribute(`aria-label`)||e.hasAttribute(`aria-labelledby`)?`region`:void 0:g[t]}function S(e){let t=e.getAttribute(`role`)?.trim().split(/\s+/)[0],n=x(e),r={};return t?r.role=t:n&&(r.role=n),n&&(r.implicit=n),r}function C(e){let t=e.tagName.toLowerCase();if(b.has(t))return Number(t.slice(1));if(e.getAttribute(`role`)===`heading`){let t=Number(e.getAttribute(`aria-level`));return Number.isFinite(t)&&t>0?t:void 0}}var w=[`data-testid`,`data-test`,`data-qa`,`data-test-id`],T=[/^:r/i,/^ember\d/i,/^(mui|radix|headlessui|reach|chakra|mantine)-/i,/^__/,/\d{4,}/,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i],ee=6,E=80,D=.15,O=e=>e.length>0&&e.length<60&&!T.some(t=>t.test(e)),te=e=>e.replace(/(["\\])/g,`\\$1`);function ne(e){for(let t of w){let n=e.getAttribute(t);if(n&&n.length<100)return{name:t,value:n}}let t=e.getAttribute(`id`);if(t&&O(t))return{name:`id`,value:t}}var re=e=>{let t=1,n=e.previousElementSibling;for(;n;)n.tagName===e.tagName&&(t+=1),n=n.previousElementSibling;return t};function ie(e){let t=[],n=e,r=0;for(;n&&r<ee;){let e=n.tagName.toLowerCase();if(e===`body`||e===`html`||(t.unshift(`${e}:nth-of-type(${re(n)})`),y.has(e)))break;n=n.parentElement,r+=1}return t.join(` > `)}function ae(e){let t=[],n=e.parentElement;for(;n&&t.length<8;){let e=n.tagName.toLowerCase();if(e===`html`)break;let r=n.getAttribute(`id`);t.unshift(r&&O(r)?`${e}#${r}`:e),n=n.parentElement}return t}function k(e){let t=s(e.textContent??``);if(t)return t.length>E?t.slice(0,E):t}function oe(e,t){let{role:n}=S(e),r=h(e),i=ne(e),a=k(e),o={tagName:e.tagName.toLowerCase(),structuralPath:ie(e),ancestry:ae(e),rect:t,centroid:{x:Math.round(t.x+t.width/2),y:Math.round(t.y+t.height/2)}};return n&&(o.role=n),r.name&&(o.accessibleName=r.name),a&&(o.textSnippet=a),i&&(o.stableAttribute=i),o}var A=e=>e.length===1?e[0]??null:null,j=(e,t)=>{let n=Math.max(e.width,1),r=Math.max(e.height,1);return Math.abs(e.width-t.width)/n<=D&&Math.abs(e.height-t.height)/r<=D};function se(e,t,n){return e.textSnippet&&k(t)===e.textSnippet||e.accessibleName&&h(t).name===e.accessibleName?!0:j(e.rect,n(t))}function ce(e,t,n){let r=e.tagName;if(e.stableAttribute?.name===`id`){let n=t.getElementById(e.stableAttribute.value);if(n&&n.tagName.toLowerCase()===r)return{element:n,level:1}}if(e.stableAttribute&&e.stableAttribute.name!==`id`){let{name:n,value:r}=e.stableAttribute,i=A([...t.querySelectorAll(`[${n}="${te(r)}"]`)]);if(i)return{element:i,level:2}}if(e.role&&e.accessibleName){let n=A([...t.querySelectorAll(`*`)].filter(t=>S(t).role===e.role&&h(t).name===e.accessibleName));if(n)return{element:n,level:3}}if(e.textSnippet){let n=A([...t.querySelectorAll(r)].filter(t=>k(t)===e.textSnippet));if(n)return{element:n,level:4}}if(e.structuralPath)try{let i=[...t.querySelectorAll(e.structuralPath)].filter(e=>e.tagName.toLowerCase()===r)[0]??null;if(i&&se(e,i,n))return{element:i,level:5}}catch{}let i=t.elementFromPoint?.(e.centroid.x,e.centroid.y)??null;return i&&i.tagName.toLowerCase()===r&&j(e.rect,n(i))?{element:i,level:6}:{element:null,level:null}}var M=`Thursday`,N=`thursday`,P=`${N}-root`;`${N}`,`${N}`;var le=`${N}:`,F={toolbarPosition:null,theme:`system`,minTouchTarget:44},I=e=>`${le}${e}`;async function ue(e){try{let t=(await chrome.storage.local.get(I(e)))[I(e)];return t===void 0?F[e]:t}catch{return F[e]}}async function de(e,t){try{await chrome.storage.local.set({[I(e)]:t})}catch{}}var fe=`
.layer {
  all: initial;
  position: fixed;
  inset: 0;
  pointer-events: none;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.4;
  color-scheme: light dark;

  --thu-bg: #17181d;
  --thu-bg-hover: #23252c;
  --thu-fg: #f2f3f5;
  --thu-fg-dim: #a2a7b3;
  --thu-line: #32353d;
  --thu-accent: #7aa2f7;
  --thu-shadow: 0 6px 20px rgba(0, 0, 0, 0.32), 0 1px 2px rgba(0, 0, 0, 0.4);
}

@media (prefers-color-scheme: light) {
  .layer {
    --thu-bg: #ffffff;
    --thu-bg-hover: #f1f2f5;
    --thu-fg: #16181d;
    --thu-fg-dim: #5c6270;
    --thu-line: #e2e4ea;
    --thu-accent: #2f5fd0;
    --thu-shadow: 0 6px 20px rgba(15, 20, 40, 0.16), 0 1px 2px rgba(15, 20, 40, 0.12);
  }
}

.toolbar {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 5px 6px;
  border: 1px solid var(--thu-line);
  border-radius: 10px;
  background: var(--thu-bg);
  color: var(--thu-fg);
  box-shadow: var(--thu-shadow);
  pointer-events: auto;
  user-select: none;
  touch-action: none;
  will-change: transform;
}

.toolbar[data-dragging="true"] { cursor: grabbing; }

.grip {
  display: grid;
  grid-template-columns: repeat(2, 2px);
  gap: 2px 3px;
  padding: 4px 5px;
  cursor: grab;
  border-radius: 6px;
}
.grip span {
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: var(--thu-fg-dim);
}
.grip:hover { background: var(--thu-bg-hover); }

.brand {
  padding: 0 6px 0 2px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--thu-fg-dim);
  white-space: nowrap;
}

.sep {
  width: 1px;
  align-self: stretch;
  margin: 2px 4px;
  background: var(--thu-line);
}

button {
  font: inherit;
  appearance: none;
  border: 0;
  margin: 0;
  padding: 6px 9px;
  border-radius: 6px;
  background: transparent;
  color: var(--thu-fg);
  cursor: pointer;
  white-space: nowrap;
}
button:hover:not(:disabled) { background: var(--thu-bg-hover); }
button:disabled { color: var(--thu-fg-dim); cursor: default; }
button[aria-pressed="true"] {
  background: var(--thu-accent);
  color: #fff;
}
button:focus-visible {
  outline: 2px solid var(--thu-accent);
  outline-offset: 2px;
}

.icon-btn {
  padding: 6px 7px;
  color: var(--thu-fg-dim);
  font-size: 14px;
  line-height: 1;
}
.icon-btn:hover:not(:disabled) { color: var(--thu-fg); }

/* Screen-reader-only live region for state announcements. */
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
`,pe=`
.hl-box {
  position: absolute;
  top: 0;
  left: 0;
  display: none;
  pointer-events: none;
  box-sizing: border-box;
  border: 1px solid var(--thu-accent);
  background: color-mix(in srgb, var(--thu-accent) 12%, transparent);
  border-radius: 2px;
  will-change: transform, width, height;
}
.hl-box[data-tone="selected"] {
  border-width: 2px;
  border-style: solid;
}
.hl-box[data-flash="true"] {
  animation: thu-flash 1.4s ease-out;
}
@keyframes thu-flash {
  0%, 40% { background: color-mix(in srgb, var(--thu-accent) 34%, transparent); }
  100% { background: color-mix(in srgb, var(--thu-accent) 6%, transparent); }
}

.hl-label {
  position: absolute;
  top: 0;
  left: 0;
  display: none;
  align-items: center;
  gap: 8px;
  max-width: 240px;
  height: 22px;
  padding: 0 7px;
  border-radius: 5px;
  background: var(--thu-accent);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
  will-change: transform;
}
.hl-identity {
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.hl-size { opacity: 0.8; font-variant-numeric: tabular-nums; }
`,me=20,he=[`pointerdown`,`pointerup`,`mousedown`,`mouseup`,`click`,`dblclick`,`auxclick`,`contextmenu`,`keydown`,`keyup`,`keypress`];function ge(){for(let e of document.querySelectorAll(P))e.remove();let e=document.createElement(P);e.setAttribute(`data-thursday-version`,`1`);for(let[t,n]of[[`position`,`fixed`],[`top`,`0`],[`left`,`0`],[`width`,`0`],[`height`,`0`],[`margin`,`0`],[`padding`,`0`],[`border`,`0`],[`z-index`,`2147483647`],[`pointer-events`,`none`],[`contain`,`layout style`],[`color-scheme`,`light dark`]])e.style.setProperty(t,n,`important`);let t=e.attachShadow({mode:`open`}),n=new CSSStyleSheet;n.replaceSync(fe+pe),t.adoptedStyleSheets=[n];let r=document.createElement(`div`);r.className=`layer`,t.append(r);let i=new AbortController;for(let t of he)e.addEventListener(t,e=>e.stopPropagation(),{signal:i.signal});document.documentElement.append(e);let a=0,o=new MutationObserver(()=>{e.isConnected||a>=me||(a+=1,document.documentElement.append(e))});return o.observe(document.documentElement,{childList:!0}),{host:e,root:t,layer:r,destroy(){o.disconnect(),i.abort(),e.remove()}}}var L=22,R=4;function _e(e){let t=document.createElement(`div`);t.className=`hl-box`,t.setAttribute(`aria-hidden`,`true`);let n=document.createElement(`div`);n.className=`hl-label`,n.setAttribute(`aria-hidden`,`true`);let r=document.createElement(`span`);r.className=`hl-identity`;let i=document.createElement(`span`);i.className=`hl-size`,n.append(r,i),e.append(t,n);let a=0,o=(e,a,o)=>{t.dataset.tone=o,t.style.transform=`translate3d(${e.x}px, ${e.y}px, 0)`,t.style.width=`${e.width}px`,t.style.height=`${e.height}px`,t.style.display=`block`,r.textContent=a.role?`${a.selector} · ${a.role}`:a.selector,i.textContent=`${Math.round(e.width)} × ${Math.round(e.height)}`;let s=e.y-L-R,c=s>=0?s:Math.min(e.y+R,window.innerHeight-L-R),l=Math.max(0,Math.min(e.x,window.innerWidth-240));n.style.transform=`translate3d(${l}px, ${c}px, 0)`,n.style.display=`flex`};return{show(e,t,n=`hover`){a&&=(clearTimeout(a),0),o(e,t,n)},flash(e,r){o(e,r,`selected`),t.dataset.flash=`true`,a&&clearTimeout(a),a=window.setTimeout(()=>{delete t.dataset.flash,t.style.display=`none`,n.style.display=`none`,a=0},1400)},hide(){a||(t.style.display=`none`,n.style.display=`none`)},destroy(){a&&clearTimeout(a),t.remove(),n.remove()}}}function z(e){let t=e.tagName.toLowerCase(),n=e.getAttribute(`id`);if(n)return{selector:`${t}#${n}`};let r=e.classList.item(0);return{selector:r?`${t}.${r}`:t}}var B=e=>Math.round(e*10)/10,V=e=>({x:B(e.x),y:B(e.y),width:B(e.width),height:B(e.height)});function H(e){let t=Array(e.length);for(let n=0;n<e.length;n+=1)t[n]=V(e[n].getBoundingClientRect());let n=Array(e.length);for(let r=0;r<e.length;r+=1){let i=e[r];n[r]={element:i,rect:t[r],style:getComputedStyle(i)}}return n}var U=e=>{let t=Number.parseFloat(e);return Number.isFinite(t)?B(t):0},W=e=>e!==``&&e!==`none`&&e!==`normal`;function ve(e){return{display:e.display,position:e.position,visibility:e.visibility,overflowX:e.overflowX,overflowY:e.overflowY,zIndex:e.zIndex,cursor:e.cursor,opacity:Number.parseFloat(e.opacity)||0,color:e.color,backgroundColor:e.backgroundColor,hasBackgroundImage:W(e.backgroundImage),hasBackdropFilter:W(e.backdropFilter),mixBlendMode:e.mixBlendMode,borderColor:e.borderTopColor,borderRadius:e.borderRadius,borderWidths:[U(e.borderTopWidth),U(e.borderRightWidth),U(e.borderBottomWidth),U(e.borderLeftWidth)],hasBoxShadow:W(e.boxShadow),fontFamily:e.fontFamily,fontSize:U(e.fontSize),fontWeight:Number.parseInt(e.fontWeight,10)||400,lineHeight:e.lineHeight,letterSpacing:e.letterSpacing,textTransform:e.textTransform,textAlign:e.textAlign,textDecorationLine:e.textDecorationLine,margin:[U(e.marginTop),U(e.marginRight),U(e.marginBottom),U(e.marginLeft)],padding:[U(e.paddingTop),U(e.paddingRight),U(e.paddingBottom),U(e.paddingLeft)],boxSizing:e.boxSizing}}var ye=[`pointerdown`,`pointerup`,`mousedown`,`mouseup`,`click`,`dblclick`,`auxclick`,`contextmenu`],be=new Set([`html`,`body`,P]),xe=600,Se=[`pointerup`,`mouseup`,`click`,`dblclick`,`auxclick`,`contextmenu`];function Ce(e,t){let n=null,r=null,i=null,a=0,o=null,s=null,c=0,l=e=>e.tagName.toLowerCase()===P||e.closest(P)!==null,u=e=>e.composedPath().some(e=>e instanceof Element&&e.tagName.toLowerCase()===P),d=()=>{c&&=(clearTimeout(c),0),s?.abort(),s=null},f=()=>{d(),s=new AbortController;let e=e=>{u(e)||(e.preventDefault(),e.stopImmediatePropagation(),e.type===`click`&&d())};for(let t of Se)window.addEventListener(t,e,{capture:!0,signal:s.signal});c=window.setTimeout(d,xe)},p=e=>{let t=V(e.getBoundingClientRect()),{role:n}=S(e),r=h(e),i=e.textContent?.replace(/\s+/g,` `).trim().slice(0,60),a={tagName:e.tagName.toLowerCase(),classNames:[...e.classList].slice(0,6),rect:t},o=e.getAttribute(`id`);return o&&(a.id=o),n&&(a.role=n),r.name&&(a.accessibleName=r.name),i&&(a.textSnippet=i),a},m=()=>{if(a=0,!r||!n)return;let o=document.elementFromPoint(r.x,r.y);if(!o||l(o)||be.has(o.tagName.toLowerCase())){i=null,e.hide(),t.onHover(null);return}if(o===i)return;i=o;let s=p(o);e.show(s.rect,z(o),`hover`),t.onHover(s)},g=()=>{a||=requestAnimationFrame(m)},_=e=>{r={x:e.clientX,y:e.clientY},g()},v=e=>{if(u(e))return;let t=e,n=e.type===`contextmenu`||t.button>0;if(e.preventDefault(),e.stopImmediatePropagation(),e.type!==`pointerdown`&&e.type!==`contextmenu`)return;if(n){w();return}let r=i;r&&x(r)},y=e=>{e.key===`Escape`&&(e.preventDefault(),e.stopImmediatePropagation(),w())},b=()=>{i=null,g()};function x(n){let r=V(n.getBoundingClientRect());e.show(r,z(n),`selected`),f(),C(),t.onPick(n)}function C(){n&&(n.abort(),n=null,i=null,r=null,a&&=(cancelAnimationFrame(a),0),o===null||o===``?document.documentElement.style.removeProperty(`cursor`):document.documentElement.style.setProperty(`cursor`,o),o=null,t.onStateChange(!1))}function w(){e.hide(),f(),C()}return{start(){if(n)return;n=new AbortController;let e={capture:!0,signal:n.signal};o=document.documentElement.style.getPropertyValue(`cursor`),document.documentElement.style.setProperty(`cursor`,`crosshair`,`important`),window.addEventListener(`pointermove`,_,{...e,passive:!0});for(let t of ye)window.addEventListener(t,v,e);window.addEventListener(`keydown`,y,e),window.addEventListener(`scroll`,b,{...e,passive:!0}),window.addEventListener(`resize`,b,{...e,passive:!0}),t.onStateChange(!0)},cancel:w,isActive:()=>n!==null,destroy(){d(),C()}}}var we=new Set([`password`,`hidden`]),Te=/^(cc-|new-password|current-password|one-time-code)/i,Ee=/pass|pwd|cvv|cvc|csc|card|ssn|social.?security|token|secret|otp|passcode|security.?code|routing|iban|account.?number/i,De=/password|card number|cvv|cvc|security code|social security|passcode|one.?time code/i,Oe=/[\w.+-]+@[\w-]+\.[\w.]{2,}/g,ke=/(?:\+\d[\d\s().-]{6,}\d)|(?:\(?\d{2,}[\s().-][\d\s().-]{4,}\d)/g,Ae=9,je=/\b\d{5,}\b/g,Me=12e3;function Ne(e){let t=e.tagName.toLowerCase();if(t!==`input`&&t!==`textarea`&&t!==`select`)return!1;let n=(e.getAttribute(`type`)??`text`).toLowerCase();if(we.has(n))return!0;let r=e.getAttribute(`autocomplete`);if(r&&Te.test(r.trim()))return!0;for(let t of[`name`,`id`]){let n=e.getAttribute(t);if(n&&Ee.test(n))return!0}for(let t of[`aria-label`,`placeholder`]){let n=e.getAttribute(t);if(n&&De.test(n))return!0}return!1}function Pe(e){return e.replace(Oe,`[email]`).replace(ke,e=>e.replace(/\D/g,``).length>=Ae?`[phone]`:e).replace(je,`[number]`)}function Fe(e){let t=e.replace(/\s+/g,` `).trim();return t.length>200?`${t.slice(0,200).trimEnd()}…`:t}var G=e=>Pe(Fe(e));function Ie(e,t){if(e)try{let n=new URL(e,t);return n.protocol!==`http:`&&n.protocol!==`https:`?n.protocol:`${n.origin}${n.pathname}`}catch{return}}function K(e,t){let n=e.tagName.toLowerCase(),r={type:n===`input`?(e.getAttribute(`type`)??`text`).toLowerCase():n,required:e.hasAttribute(`required`)||e.getAttribute(`aria-required`)===`true`,labelledBy:t},i=e.getAttribute(`autocomplete`);return i&&(r.autocomplete=i),r}var Le=e=>e.display===`none`||e.visibility===`hidden`||e.visibility===`collapse`||e.opacity===0||e.contentVisibility===`hidden`,Re=e=>e.width<1||e.height<1,ze=(e,t,n)=>{let r=t*3;return e.y>r||e.y+e.height<-r||e.x>n*2||e.x+e.width<-n},Be=(e,t,n)=>e.y<n&&e.y+e.height>0&&e.x<t&&e.x+e.width>0,q=new Set([`button`,`select`,`textarea`,`summary`,`details`]),Ve=new Set([`button`,`link`,`checkbox`,`radio`,`switch`,`slider`,`spinbutton`,`tab`,`menuitem`,`menuitemcheckbox`,`menuitemradio`,`option`,`combobox`,`textbox`,`searchbox`]);function He(e){return q.has(e.tagName)?!0:e.tagName===`a`||e.tagName===`area`?e.hasHref:e.tagName===`input`?e.inputType!==`hidden`:e.tagName===`label`||e.role&&Ve.has(e.role)||e.hasClickAttribute?!0:e.tabIndex>=0}function Ue(e){return e.disabled?!1:e.tabIndex>=0?!0:e.tagName===`a`||e.tagName===`area`?e.hasHref:e.tagName===`input`?e.inputType!==`hidden`:q.has(e.tagName)}function We(e){let t={};for(let n of e.getAttributeNames())n.startsWith(`aria-`)&&n!==`aria-label`&&n!==`aria-labelledby`&&(t[n]=(e.getAttribute(n)??``).slice(0,120));return t}function Ge(e){switch(e.source){case`label-for`:return`label-for`;case`label-wrapped`:return`label-wrapped`;case`aria-label`:case`aria-labelledby`:return`aria`;case`placeholder`:return`placeholder`;default:return`none`}}function Ke(e){let t=``;for(let n of e.childNodes)n.nodeType===3&&(t+=n.nodeValue??``);return t}function J(e,t){let{element:n,rect:r,style:i}=e,a=n.tagName.toLowerCase(),{role:o,implicit:s}=S(n),c=C(n),l=Ne(n),u=a===`input`?(n.getAttribute(`type`)??`text`).toLowerCase():void 0,d=n.getAttribute(`tabindex`),f=d===null?-1:Number.parseInt(d,10)||0,p=n.hasAttribute(`disabled`)||n.getAttribute(`aria-disabled`)===`true`,m={tagName:a,hasHref:n.hasAttribute(`href`),hasClickAttribute:n.hasAttribute(`onclick`),tabIndex:f,...o===void 0?{}:{role:o},...u===void 0?{}:{inputType:u}},g={x:r.x+t.scrollX,y:r.y+t.scrollY,width:r.width,height:r.height},_={index:t.index,parent:t.parent,landmark:t.landmark,precedingHeading:t.precedingHeading,tagName:a,classNames:l?[]:[...n.classList].slice(0,12),accessibleName:l?{name:``,source:`none`,weak:!1}:h(n),aria:l?{}:We(n),textLength:0,rect:r,documentRect:g,inViewport:Be(r,t.viewportWidth,t.viewportHeight),interactive:He(m),focusable:Ue({...m,disabled:p}),tabIndex:f,disabled:p,ariaHidden:n.getAttribute(`aria-hidden`)===`true`,styles:ve(i),redacted:l};if(c!==void 0&&(_.headingLevel=c),o&&(_.role=o),s&&(_.implicitRole=s),l)return _.form=K(n,`none`),_;let v=n.getAttribute(`id`);v&&(_.id=v);let y=Ke(n);y.trim()&&(_.textLength=y.trim().length,t.allowText&&(_.text=G(y)));let b=n.getAttribute(`alt`);b!==null&&(_.alt=G(b));let x=n.getAttribute(`placeholder`);x&&(_.placeholder=G(x));let w=n.getAttribute(`title`);w&&(_.title=G(w));let T=Ie(n.getAttribute(`href`),location.href);return T&&(_.href=T),(a===`input`||a===`select`||a===`textarea`)&&(_.form=K(n,Ge(_.accessibleName))),_}function qe(e){let[t]=H([e]);if(!t)throw Error(`element could not be measured`);return J(t,{index:0,parent:null,landmark:null,precedingHeading:null,scrollX:Math.round(window.scrollX),scrollY:Math.round(window.scrollY),viewportWidth:window.innerWidth,viewportHeight:window.innerHeight,allowText:!0})}var Y=1500,Je=6e3,X=`a.button.input.select.textarea.label.form.fieldset.legend.h1.h2.h3.h4.h5.h6.p.li.dt.dd.th.td.caption.header.nav.main.aside.footer.section.article.img.picture.svg.video.audio.iframe.canvas.table.dialog.details.summary.ul.ol.dl.[role].[tabindex].[onclick].[aria-label].[aria-labelledby]`.split(`.`).join(`,`),Ye=[`div`,`span`,`figure`,`figcaption`,`blockquote`,`pre`,`hgroup`,`time`].join(`,`),Xe=new Set([`a`,`button`,`input`,`select`,`textarea`,`label`,`h1`,`h2`,`h3`,`h4`,`h5`,`h6`,`header`,`nav`,`main`,`aside`,`footer`]);function Ze(e){let t=e.tagName.toLowerCase();return Xe.has(t)||e.hasAttribute(`role`)?1:e.matches(X)?2:3}function Qe(){let e=[...(document.body??document.documentElement).querySelectorAll(`${X},${Ye}`)];return e.length<=6e3?{elements:e,truncated:!1}:{elements:e.slice(0,Je),truncated:!0}}function $e(e){if(e.length<=1500)return{items:e,truncated:!1};let t=[],n=[];for(let r of e)Ze(r.element)===3?n.push(r):t.push(r);if(t.length>=1500)return{items:t.slice(0,Y),truncated:!0};let r=new Set([...t,...n.slice(0,Y-t.length)]);return{items:e.filter(e=>r.has(e)),truncated:!0}}function et(){let e=0;for(let t of document.querySelectorAll(`iframe`)){let n=t.getAttribute(`src`);if(n)try{new URL(n,location.href).origin!==location.origin&&(e+=1)}catch{e+=1}}return e}function tt(e){let t=Date.now(),{elements:n,truncated:r}=Qe(),i=H(n),a=window.innerWidth,o=window.innerHeight,s=[];for(let t of i){let n=t.style;Le({display:n.display,visibility:n.visibility,opacity:Number.parseFloat(n.opacity)||0,contentVisibility:n.contentVisibility})||Re(t.rect)||(e.includeOffscreen||!ze(t.rect,o,a))&&s.push(t)}let{items:c,truncated:l}=$e(s),u=new Map;c.forEach((e,t)=>u.set(e.element,t));let d=e=>{let t=e.parentElement;for(;t;){let e=u.get(t);if(e!==void 0)return e;t=t.parentElement}return null},f=e=>{let t=e.parentElement;for(;t;){if(y.has(t.tagName.toLowerCase())){let e=u.get(t);if(e!==void 0)return e}t=t.parentElement}return null},p=Math.round(window.scrollX),m=Math.round(window.scrollY),h=Me,g=null,_=c.map((e,t)=>{let n=J(e,{index:t,parent:d(e.element),landmark:f(e.element),precedingHeading:g,scrollX:p,scrollY:m,viewportWidth:a,viewportHeight:o,allowText:h>0});return n.text&&(h-=n.text.length),n.headingLevel!==void 0&&(g=t),n});return{capturedAt:t,durationMs:Date.now()-t,url:location.href,origin:location.origin,title:document.title,viewport:{width:a,height:o,devicePixelRatio:window.devicePixelRatio,scrollX:p,scrollY:m,documentWidth:Math.max(document.documentElement.scrollWidth,a),documentHeight:Math.max(document.documentElement.scrollHeight,o)},elements:_,truncated:r||l,crossOriginFrames:et()}}var nt=[{action:`audit`,label:`Audit`,enabled:!1},{action:`select`,label:`Select`,enabled:!1},{action:`inspect`,label:`Inspect`,enabled:!1},{action:`report`,label:`Report`,enabled:!1}],rt=[{action:`settings`,label:`Settings`,icon:`⚙`,enabled:!0},{action:`close`,label:`Close ${M}`,icon:`✕`,enabled:!0}],Z=12;function it(e){let t=new AbortController,{signal:n}=t,r=document.createElement(`div`);r.className=`toolbar`,r.setAttribute(`role`,`toolbar`),r.setAttribute(`aria-label`,M),r.setAttribute(`aria-orientation`,`horizontal`);let i=document.createElement(`div`);i.className=`grip`,i.title=`Drag to move ${M}`;for(let e=0;e<6;e+=1)i.append(document.createElement(`span`));let a=document.createElement(`div`);a.className=`brand`,a.textContent=M;let o=document.createElement(`div`);o.className=`sr`,o.setAttribute(`role`,`status`),o.setAttribute(`aria-live`,`polite`),r.append(i,a,Q());let s=new Map,c=t=>{let i=document.createElement(`button`);i.type=`button`,i.dataset.action=t.action,i.disabled=!t.enabled,i.tabIndex=-1,t.icon?(i.className=`icon-btn`,i.textContent=t.icon,i.setAttribute(`aria-label`,t.label)):(i.textContent=t.label,i.setAttribute(`aria-pressed`,`false`)),i.addEventListener(`click`,()=>e.onAction(t.action),{signal:n}),s.set(t.action,i),r.append(i)};for(let e of nt)c(e);r.append(Q());for(let e of rt)c(e);r.append(o);let l=()=>[...s.values()].filter(e=>!e.disabled),u=e=>{for(let t of s.values())t.tabIndex=t===e?0:-1};u(l()[0]),r.addEventListener(`keydown`,e=>{let t=l();if(t.length===0)return;let n=t.indexOf(document.activeElement===r?t[0]:e.target),i=-1;if(e.key===`ArrowRight`)i=(n+1)%t.length;else if(e.key===`ArrowLeft`)i=(n-1+t.length)%t.length;else if(e.key===`Home`)i=0;else if(e.key===`End`)i=t.length-1;else if(e.key===`Escape`&&r.dataset.dragging===`true`){g();return}else return;e.preventDefault();let a=t[i];a&&(u(a),a.focus())},{signal:n});let d=e.initialPosition??at(),f=null,p=0,m=()=>{r.style.transform=`translate3d(${Math.round(d.x)}px, ${Math.round(d.y)}px, 0)`};m();let h=e=>{let t=r.getBoundingClientRect(),n=Math.max(Z,window.innerWidth-t.width-Z),i=Math.max(Z,window.innerHeight-t.height-Z);return{x:Math.min(Math.max(e.x,Z),n),y:Math.min(Math.max(e.y,Z),i)}};function g(){f=null,r.dataset.dragging=`false`}i.addEventListener(`pointerdown`,e=>{e.button===0&&(e.preventDefault(),i.setPointerCapture(e.pointerId),f={pointerX:e.clientX,pointerY:e.clientY,originX:d.x,originY:d.y},r.dataset.dragging=`true`)},{signal:n}),i.addEventListener(`pointermove`,e=>{if(!f)return;let t={x:f.originX+(e.clientX-f.pointerX),y:f.originY+(e.clientY-f.pointerY)};p||=requestAnimationFrame(()=>{p=0,d=h(t),m()})},{signal:n});let _=t=>{f&&(g(),i.releasePointerCapture?.(t.pointerId),d=h(d),m(),e.onMoved(d))};return i.addEventListener(`pointerup`,_,{signal:n}),i.addEventListener(`pointercancel`,_,{signal:n}),window.addEventListener(`resize`,()=>{d=h(d),m()},{signal:n,passive:!0}),{element:r,setPressed(e,t){s.get(e)?.setAttribute(`aria-pressed`,String(t))},setEnabled(e,t){let n=s.get(e);n&&(n.disabled=!t,l().some(e=>e.tabIndex===0)||u(l()[0]))},announce(e){o.textContent=e},destroy(){p&&cancelAnimationFrame(p),t.abort(),r.remove()}}}function Q(){let e=document.createElement(`div`);return e.className=`sep`,e}function at(){return{x:Math.max(Z,Math.round(window.innerWidth/2)-180),y:Z}}var $=`__thursdayRuntime`;function ot(){let e=document.documentElement;return{width:window.innerWidth,height:window.innerHeight,devicePixelRatio:window.devicePixelRatio,scrollX:Math.round(window.scrollX),scrollY:Math.round(window.scrollY),documentWidth:Math.max(e.scrollWidth,e.clientWidth),documentHeight:Math.max(e.scrollHeight,e.clientHeight)}}function st(){let n=globalThis,r=n[$];if(r){r.reveal();return}let i=null,a=null,o=null,s=null,c=null,l=null,u=0,d=!1,f=e=>{try{c?.postMessage({from:`content`,message:e})}catch{}},p=()=>{f({type:`PAGE_ACTIVATED`,payload:{url:location.href,title:document.title,viewport:ot()}})},m=t=>{switch(t.type){case`DEACTIVATE`:b();return;case`REQUEST_PAGE_INFO`:p();return;case`START_SELECTION`:s?.start();return;case`CANCEL_SELECTION`:s?.cancel();return;case`REQUEST_SNAPSHOT`:h(t.payload.includeOffscreen);return;case`FOCUS_ELEMENT`:_(t.payload.ref);return;case`RENDER_PINS`:case`CLEAR_PINS`:return;case`ACTIVATE_PAGE`:case`PAGE_ACTIVATED`:case`GET_PAGE_STATUS`:case`PAGE_STATUS`:case`DEACTIVATED`:case`ELEMENT_HOVERED`:case`ELEMENT_SELECTED`:case`SELECTION_STATE`:case`SNAPSHOT_READY`:case`AUDIT_PROGRESS`:case`PIN_CLICKED`:case`ELEMENT_RESOLVED`:case`TOOLBAR_ACTION`:case`ERROR`:return;default:e(t,`content.handle`)}},h=e=>{try{let t=tt({includeOffscreen:e});f({type:`SNAPSHOT_READY`,payload:t})}catch(e){f({type:`ERROR`,payload:{code:`SNAPSHOT_FAILED`,detail:e instanceof Error?e.message:void 0}})}},g=e=>{l=e;let t=qe(e),n=oe(e,t.rect);f({type:`ELEMENT_SELECTED`,payload:{element:t,reference:n}}),a?.announce(`Selected ${t.tagName}${t.accessibleName.name?`, ${t.accessibleName.name}`:``}`)},_=e=>{let t=l?.isConnected&&l.tagName.toLowerCase()===e.tagName?l:null,n=t,r=null;if(!n){let t=ce(e,document,e=>V(e.getBoundingClientRect()));n=t.element,r=t.level}if(!n){f({type:`ELEMENT_RESOLVED`,payload:{ref:e,level:null}});return}n.scrollIntoView({block:`center`,inline:`nearest`,behavior:`smooth`});let i=V(n.getBoundingClientRect());o?.flash(i,z(n)),t||f({type:`ELEMENT_RESOLVED`,payload:{ref:e,level:r}})},v=()=>{if(!d){try{c=chrome.runtime.connect({name:`content`})}catch{c=null;return}c.onMessage.addListener(e=>{t(e)&&m(e.message)}),c.onDisconnect.addListener(()=>{c=null,!d&&(u>=3||(u+=1,setTimeout(()=>{v(),c&&p()},250*u)))}),u=0}},y=e=>{if(e===`close`){b();return}e===`select`&&(s?.isActive()?s.cancel():s?.start()),f({type:`TOOLBAR_ACTION`,payload:{action:e}})};function b(){if(!d){d=!0,f({type:`DEACTIVATED`}),s?.destroy(),o?.destroy(),a?.destroy(),i?.destroy();try{c?.disconnect()}catch{}c=null,delete n[$]}}i=ge(),o=_e(i.layer),s=Ce(o,{onHover:e=>f({type:`ELEMENT_HOVERED`,payload:{preview:e}}),onPick:g,onStateChange:e=>{a?.setPressed(`select`,e),a?.announce(e?`Selection mode on. Click an element, or press Escape to cancel.`:`Selection mode off.`),f({type:`SELECTION_STATE`,payload:{active:e}})}}),v(),ue(`toolbarPosition`).then(e=>{!d&&i&&(a=it({initialPosition:e,onAction:y,onMoved:e=>void de(`toolbarPosition`,e)}),i.layer.append(a.element),a.setEnabled(`select`,!0),a.setEnabled(`inspect`,!0),p())}),n[$]={version:1,reveal(){p(),window.dispatchEvent(new Event(`resize`))},teardown:b}}st()})();