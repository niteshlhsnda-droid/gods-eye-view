var x=`/* Toastry — Beautiful, modern toast notifications */

:root {
    --toastry-bg: #fff;
    --toastry-border: #e5e5e5;
    --toastry-text: #171717;
    --toastry-text-muted: #6b7280;
    --toastry-text-faint: #9ca3af;
    --toastry-accent: #2563eb;
    --toastry-success: #16a34a;
    --toastry-error: #dc2626;
    --toastry-warning: #f59e0b;
    --toastry-close-hover-bg: #f3f4f6;
    --toastry-action-border: #e5e7eb;
    --toastry-action-border-hover: #d1d5db;
    --toastry-spinner-track: #e5e7eb;
    --toastry-font: system-ui, -apple-system, sans-serif;
}

[data-toastry] {
    position: fixed;
    width: 356px;
    z-index: 999999;
    display: flex;
    align-items: flex-end;
    pointer-events: none;
    box-sizing: border-box;
}

/* Position variants */
[data-toastry][data-position="bottom-right"] {
    bottom: 32px;
    right: 32px;
}

[data-toastry][data-position="bottom-left"] {
    bottom: 32px;
    left: 32px;
}

[data-toastry][data-position="top-right"] {
    top: 32px;
    right: 32px;
}

[data-toastry][data-position="top-left"] {
    top: 32px;
    left: 32px;
}

[data-toastry-toast] {
    position: absolute;
    width: 356px;
    padding: 14px 16px;
    background: var(--toastry-bg, #fff);
    border: 1px solid var(--toastry-border, #e5e5e5);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    font-family: var(--toastry-font, system-ui, -apple-system, sans-serif);
    font-size: 14px;
    line-height: 1.4;
    color: var(--toastry-text, #171717);
    pointer-events: auto;
    cursor: grab;
    user-select: none;
    box-sizing: border-box;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    opacity: 0;
    will-change: transform, opacity;
    transition: transform 0.35s cubic-bezier(0.2, 0, 0, 1),
                opacity 0.3s ease,
                box-shadow 0.3s ease;
    touch-action: none;
}

/* Bottom positions — toasts stack upward */
[data-position="bottom-right"] [data-toastry-toast],
[data-position="bottom-left"] [data-toastry-toast] {
    bottom: 0;
    transform: translateY(calc(var(--toastry-offset, 0) * -1px))
               scale(var(--toastry-scale, 1));
}

/* Top positions — toasts stack downward */
[data-position="top-right"] [data-toastry-toast],
[data-position="top-left"] [data-toastry-toast] {
    top: 0;
    transform: translateY(calc(var(--toastry-offset, 0) * 1px))
               scale(var(--toastry-scale, 1));
}

/* Left positions — align to left edge */
[data-position="bottom-left"] [data-toastry-toast],
[data-position="top-left"] [data-toastry-toast] {
    left: 0;
}

/* Right positions — align to right edge */
[data-position="bottom-right"] [data-toastry-toast],
[data-position="top-right"] [data-toastry-toast] {
    right: 0;
}

[data-toastry-toast]:active {
    cursor: grabbing;
}

/* Entrance animation */
[data-toastry-toast][data-mounted="true"] {
    opacity: 1;
}

/* Initial state before mount — bottom positions */
[data-position="bottom-right"] [data-toastry-toast][data-mounted="false"],
[data-position="bottom-left"] [data-toastry-toast][data-mounted="false"] {
    opacity: 0;
    transform: translateY(80px) scale(0.95);
}

/* Initial state before mount — top positions */
[data-position="top-right"] [data-toastry-toast][data-mounted="false"],
[data-position="top-left"] [data-toastry-toast][data-mounted="false"] {
    opacity: 0;
    transform: translateY(-80px) scale(0.95);
}

/* Dismissing — front toast slides off-screen (bottom) */
[data-position="bottom-right"] [data-toastry-toast][data-dismissing="true"][data-front="true"],
[data-position="bottom-left"] [data-toastry-toast][data-dismissing="true"][data-front="true"],
[data-position="bottom-right"][data-expanded="true"] [data-toastry-toast][data-dismissing="true"],
[data-position="bottom-left"][data-expanded="true"] [data-toastry-toast][data-dismissing="true"] {
    opacity: 0;
    transform: translateY(100%);
    transition: transform 400ms, opacity 400ms;
}

/* Dismissing — front toast slides off-screen (top) */
[data-position="top-right"] [data-toastry-toast][data-dismissing="true"][data-front="true"],
[data-position="top-left"] [data-toastry-toast][data-dismissing="true"][data-front="true"],
[data-position="top-right"][data-expanded="true"] [data-toastry-toast][data-dismissing="true"],
[data-position="top-left"][data-expanded="true"] [data-toastry-toast][data-dismissing="true"] {
    opacity: 0;
    transform: translateY(-100%);
    transition: transform 400ms, opacity 400ms;
}

/* Dismissing — non-front toast in collapsed stack fades out (bottom) */
[data-position="bottom-right"] [data-toastry-toast][data-dismissing="true"][data-front="false"],
[data-position="bottom-left"] [data-toastry-toast][data-dismissing="true"][data-front="false"] {
    opacity: 0;
    transform: translateY(40%);
    transition: transform 500ms, opacity 200ms;
}

/* Dismissing — non-front toast in collapsed stack fades out (top) */
[data-position="top-right"] [data-toastry-toast][data-dismissing="true"][data-front="false"],
[data-position="top-left"] [data-toastry-toast][data-dismissing="true"][data-front="false"] {
    opacity: 0;
    transform: translateY(-40%);
    transition: transform 500ms, opacity 200ms;
}

/* Swiping — disable transitions, JS handles transform inline */
[data-toastry-toast][data-swiping="true"] {
    transition: none !important;
    cursor: grabbing;
}

/* Expanded — container becomes hover target */
[data-toastry][data-expanded="true"] {
    pointer-events: auto;
}

/* Expanded — bottom positions */
[data-position="bottom-right"][data-expanded="true"] [data-toastry-toast],
[data-position="bottom-left"][data-expanded="true"] [data-toastry-toast] {
    transition: transform 0.35s cubic-bezier(0.2, 0, 0, 1),
                opacity 0.3s ease;
    transform: translateY(calc(var(--toastry-expanded-offset, 0) * -1px))
               scale(1);
}

/* Expanded — top positions */
[data-position="top-right"][data-expanded="true"] [data-toastry-toast],
[data-position="top-left"][data-expanded="true"] [data-toastry-toast] {
    transition: transform 0.35s cubic-bezier(0.2, 0, 0, 1),
                opacity 0.3s ease;
    transform: translateY(calc(var(--toastry-expanded-offset, 0) * 1px))
               scale(1);
}

/* Non-front toasts when collapsed */
[data-toastry-toast][data-front="false"][data-mounted="true"] {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

/* Toast content layout */
.toastry-icon {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 1px;
}

.toastry-icon svg {
    width: 20px;
    height: 20px;
}

.toastry-icon img {
    width: 20px;
    height: 20px;
    border-radius: 4px;
    object-fit: cover;
}

.toastry-content {
    flex: 1;
    min-width: 0;
    line-height: 1.7;
}

.toastry-title {
    font-weight: 500;
    color: var(--toastry-text, #171717);
    word-break: break-word;
}

.toastry-description {
    margin-top: 2px;
    font-size: 13px;
    color: var(--toastry-text-muted, #6b7280);
    word-break: break-word;
}

.toastry-close {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: none;
    color: var(--toastry-text-faint, #9ca3af);
    cursor: pointer;
    padding: 0;
    border-radius: 4px;
    opacity: 0;
    transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
    margin-top: 1px;
}

[data-toastry-toast]:hover .toastry-close {
    opacity: 1;
}

.toastry-close:hover {
    background: var(--toastry-close-hover-bg, #f3f4f6);
    color: var(--toastry-text, #171717);
}

.toastry-close svg {
    width: 14px;
    height: 14px;
}

/* Action button inside toast */
.toastry-action {
    display: inline-flex;
    align-items: center;
    margin-top: 8px;
    padding: 4px 10px;
    font-size: 13px;
    font-weight: 500;
    font-family: inherit;
    color: var(--toastry-accent, #2563eb);
    background: none;
    border: 1px solid var(--toastry-action-border, #e5e7eb);
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
}

.toastry-action:hover {
    background: var(--toastry-close-hover-bg, #f3f4f6);
    border-color: var(--toastry-action-border-hover, #d1d5db);
}

/* Dismiss-all button — opt-in via toast.configure({ clearAll: true }).
   Sits on the stack's growing edge (above for bottom positions, below for
   top), right-aligned like each toast's close button. Hidden via visibility
   as well as opacity so it can't take focus while it isn't shown. */
.toastry-clear-all {
    position: absolute;
    right: 0;
    padding: 4px 10px;
    font-family: var(--toastry-font, system-ui, -apple-system, sans-serif);
    font-size: 12px;
    font-weight: 500;
    line-height: 1.4;
    color: var(--toastry-text-muted, #6b7280);
    background: var(--toastry-bg, #fff);
    border: 1px solid var(--toastry-border, #e5e5e5);
    border-radius: 999px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    cursor: pointer;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    /* Hide only after the fade-out; show instantly (see below) so a quick
       Tab press can land on it. */
    transition: opacity 0.2s ease, visibility 0s linear 0.2s, background 0.15s ease, color 0.15s ease;
}

/* Transparent bridge across the gap to the stack, so moving the pointer from
   a toast to the button never leaves the container and collapses it. */
.toastry-clear-all::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 8px;
}

[data-position="bottom-right"] .toastry-clear-all,
[data-position="bottom-left"] .toastry-clear-all {
    bottom: calc(100% + 8px);
}

[data-position="bottom-right"] .toastry-clear-all::after,
[data-position="bottom-left"] .toastry-clear-all::after {
    top: 100%;
}

[data-position="top-right"] .toastry-clear-all,
[data-position="top-left"] .toastry-clear-all {
    top: calc(100% + 8px);
}

[data-position="top-right"] .toastry-clear-all::after,
[data-position="top-left"] .toastry-clear-all::after {
    bottom: 100%;
}

.toastry-clear-all:hover {
    background: var(--toastry-close-hover-bg, #f3f4f6);
    color: var(--toastry-text, #171717);
}

[data-toastry][data-clearable="true"][data-expanded="true"] .toastry-clear-all {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transition-delay: 0s;
}

/* No hover on touch — the stack never expands on its own there, so show the
   button whenever it applies. */
@media (hover: none) {
    [data-toastry][data-clearable="true"] .toastry-clear-all {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
        transition-delay: 0s;
    }
}

/* Type-specific icon colors */
[data-type="success"] .toastry-icon { color: var(--toastry-success, #16a34a); }
[data-type="error"] .toastry-icon { color: var(--toastry-error, #dc2626); }
[data-type="warning"] .toastry-icon { color: var(--toastry-warning, #f59e0b); }
[data-type="info"] .toastry-icon { color: var(--toastry-accent, #2563eb); }

/* Loading spinner */
.toastry-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--toastry-spinner-track, #e5e7eb);
    border-top-color: var(--toastry-text-muted, #6b7280);
    border-radius: 50%;
    animation: toastry-spin 0.6s linear infinite;
}

@keyframes toastry-spin {
    to { transform: rotate(360deg); }
}

/* Mobile responsive */
@media (max-width: 600px) {
    [data-toastry] {
        width: auto;
    }

    [data-toastry][data-position="bottom-right"],
    [data-toastry][data-position="bottom-left"] {
        bottom: 16px;
        right: 16px;
        left: 16px;
    }

    [data-toastry][data-position="top-right"],
    [data-toastry][data-position="top-left"] {
        top: 16px;
        right: 16px;
        left: 16px;
    }

    [data-toastry-toast] {
        width: 100%;
    }
}
`,f=8,b=60,_=.3,w=200,A=200,T=2,v=!1;function k(){if(v||typeof document>"u")return;v=!0;let t=document.createElement("style");t.setAttribute("data-toastry-styles",""),t.textContent=x,document.head.appendChild(t)}var l={maxVisible:3,maxToasts:5,duration:4e3,position:"bottom-right",clearAll:!1,clearAllLabel:"Dismiss all"},m={success:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="8"/><path d="M6.5 10.5l2 2 5-5.5"/></svg>',error:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="8"/><path d="M12.5 7.5l-5 5M7.5 7.5l5 5"/></svg>',warning:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L1.5 17.5h17L10 3z"/><path d="M10 8.5v4M10 14.5v.5"/></svg>',info:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="8"/><path d="M10 9v5M10 6.5v.5"/></svg>',loading:'<div class="toastry-spinner"></div>'},E='<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 1l12 12M13 1L1 13"/></svg>',L=0;function C(t){try{return t.matches(":focus-visible")}catch{return!1}}var g=typeof document<"u"?document.createElement("div"):null,S=class{constructor(){this.toasts=[],this.container=null,this.expanded=!1,this.hovering=!1,this.focused=!1,this._collapseTimer=null,this._visibilityHandler=null,this._clearAllBtn=null,this._clearAllPointer=null,this.swipingToast=null,this.pointerStart=null,this.swipeStartTime=0}_ensureContainer(){this.container||(k(),this.container=document.createElement("div"),this.container.setAttribute("data-toastry",""),this.container.setAttribute("data-position",l.position),document.body.appendChild(this.container),this.container.addEventListener("mouseenter",()=>{this.hovering=!0,this._engage()}),this.container.addEventListener("mouseleave",()=>{this.hovering=!1,this.swipingToast||this._scheduleCollapse()}),this.container.addEventListener("focusin",t=>{C(t.target)&&(this.focused=!0,this._engage())}),this.container.addEventListener("focusout",t=>{this.container&&this.container.contains(t.relatedTarget)||this._onFocusLost()}),this._visibilityHandler=()=>{document.hidden?this._pauseAllTimers():this._isEngaged()||this._resumeAllTimers()},document.addEventListener("visibilitychange",this._visibilityHandler))}_isEngaged(){return this.hovering||this.focused}_engage(){clearTimeout(this._collapseTimer),this._collapseTimer=null,this._setExpanded(!0),this._pauseAllTimers()}_scheduleCollapse(){clearTimeout(this._collapseTimer),this._collapseTimer=setTimeout(()=>{this._collapseTimer=null,this._isEngaged()||(this._resumeAllTimers(),this._setExpanded(!1))},A)}_onFocusLost(){this.focused&&(this.focused=!1,!this.hovering&&!this.swipingToast&&this._scheduleCollapse())}_setExpanded(t){this.expanded=t,this.container&&this.container.setAttribute("data-expanded",t?"true":"false"),this._updateLayout()}create(t,a={}){this._ensureContainer(),this.container.getAttribute("data-position")!==l.position&&this.container.setAttribute("data-position",l.position);let e=++L,s=a.type||"default",i=a.duration!==void 0?a.duration:l.duration,o=document.createElement("div");o.setAttribute("data-toastry-toast",e),o.setAttribute("data-type",s),o.setAttribute("data-mounted","false"),o.setAttribute("data-front","true"),o.setAttribute("role",s==="error"?"alert":"status"),o.setAttribute("aria-live",s==="error"?"assertive":"polite"),o.setAttribute("aria-atomic","true");let r="";a.icon?r+=`<div class="toastry-icon"><img src="${this._escape(a.icon)}" alt=""></div>`:m[s]&&(r+=`<div class="toastry-icon">${m[s]}</div>`),r+='<div class="toastry-content">',r+=`<div class="toastry-title">${this._escape(t)}</div>`,a.description&&(r+=`<div class="toastry-description">${this._escape(a.description)}</div>`),a.action&&(r+=`<button class="toastry-action">${this._escape(a.action.label)}</button>`),r+="</div>",r+=`<button class="toastry-close" aria-label="Close">${E}</button>`,o.innerHTML=r,a.action&&o.querySelector(".toastry-action").addEventListener("click",n=>{var h,p;n.stopPropagation(),(p=(h=a.action).onClick)==null||p.call(h),this.dismiss(e)}),o.querySelector(".toastry-close").addEventListener("click",n=>{n.stopPropagation(),this.dismiss(e)}),o.addEventListener("pointerdown",n=>{n.target.closest(".toastry-close")||n.target.closest(".toastry-action")||this._onPointerDown(n,e)}),o.addEventListener("pointermove",n=>this._onPointerMove(n,e)),o.addEventListener("pointerup",n=>this._onPointerUp(n,e)),o.addEventListener("pointercancel",()=>this._onPointerCancel(e)),this.container.insertBefore(o,this._clearAllBtn);let d={id:e,el:o,type:s,duration:i,height:o.offsetHeight,timer:null,remaining:i,startTime:null,dismissing:!1};return this.toasts.push(d),this._pruneOld(),this._updateLayout(),requestAnimationFrame(()=>{o.setAttribute("data-mounted","true"),i>0&&this._startTimer(d)}),e}dismissAll(){[...this.toasts].filter(t=>!t.dismissing&&t.type!=="loading").forEach(t=>this.dismiss(t.id))}dismiss(t){if(t===void 0){[...this.toasts].forEach(e=>this.dismiss(e.id));return}let a=this.toasts.find(e=>e.id===t);!a||a.dismissing||(a.dismissing=!0,clearTimeout(a.timer),a.el.setAttribute("data-dismissing","true"),this._updateLayout(),setTimeout(()=>{a.el.remove(),this.toasts=this.toasts.filter(e=>e.id!==t),this._updateLayout(),this.focused&&this.container&&!this.container.contains(document.activeElement)&&this._onFocusLost(),this.toasts.length===0&&(clearTimeout(this._collapseTimer),this._collapseTimer=null,this.expanded=!1,this.hovering=!1,this.focused=!1,this._visibilityHandler&&(document.removeEventListener("visibilitychange",this._visibilityHandler),this._visibilityHandler=null),this.container&&(this.container.remove(),this.container=null,this._clearAllBtn=null))},w))}_update(t,a,e={}){let s=this.toasts.find(p=>p.id===t);if(!s||s.dismissing)return;let i=e.type||"default";s.el.setAttribute("data-type",i),s.el.setAttribute("role",i==="error"?"alert":"status"),s.el.setAttribute("aria-live",i==="error"?"assertive":"polite"),s.type=i;let o=s.el.querySelector(".toastry-icon"),r=e.icon?`<img src="${this._escape(e.icon)}" alt="">`:m[i]||null;if(r)if(o)o.innerHTML=r;else{let p=document.createElement("div");p.className="toastry-icon",p.innerHTML=r,s.el.insertBefore(p,s.el.firstChild)}else o&&o.remove();let d=s.el.querySelector(".toastry-title");d&&(d.textContent=a);let n=s.el.querySelector(".toastry-description");if(e.description)if(n)n.textContent=e.description;else{let p=s.el.querySelector(".toastry-content"),y=document.createElement("div");y.className="toastry-description",y.textContent=e.description,p.appendChild(y)}else n&&n.remove();s.height=s.el.offsetHeight,this._updateLayout();let h=e.duration!==void 0?e.duration:l.duration;s.duration=h,s.remaining=h,h>0&&this._startTimer(s)}_startTimer(t){clearTimeout(t.timer),t.startTime=Date.now(),t.timer=setTimeout(()=>this.dismiss(t.id),t.remaining)}_pauseAllTimers(){this.toasts.forEach(t=>{t.timer&&t.remaining>0&&(clearTimeout(t.timer),t.timer=null,t.remaining-=Date.now()-(t.startTime||Date.now()),t.remaining<0&&(t.remaining=0))})}_resumeAllTimers(){this.toasts.forEach(t=>{!t.timer&&t.remaining>0&&!t.dismissing&&t.duration>0&&this._startTimer(t)})}_updateLayout(){let t=this.toasts.filter(i=>!i.dismissing),a=t.length;l.position.startsWith("top");let e=0,s=0;if(t.forEach((i,o)=>{let r=a-1-o,d=r===0;i.el.setAttribute("data-front",d?"true":"false");let n=r*f,h=1-r*.05;i.el.style.setProperty("--toastry-offset",n),i.el.style.setProperty("--toastry-scale",Math.max(h,.85)),i.el.style.setProperty("--toastry-expanded-offset",e),e+=i.height+f,d&&(s=i.height+(a-1)*f),this.swipingToast!==i.id&&(!this.expanded&&r>=l.maxVisible?(i.el.style.opacity="0",i.el.style.pointerEvents="none"):(i.el.style.opacity="",i.el.style.pointerEvents=""))}),this.container){let i=this.expanded?e:s;this.container.style.height=(i||0)+"px"}this._syncClearAll(t)}_syncClearAll(t){if(!this.container)return;if(!l.clearAll){this._clearAllBtn&&(this._clearAllBtn.remove(),this._clearAllBtn=null),this.container.removeAttribute("data-clearable");return}if(!this._clearAllBtn){let e=document.createElement("button");e.type="button",e.className="toastry-clear-all",e.addEventListener("click",s=>{s.stopPropagation(),this.dismissAll(),document.activeElement===e&&e.blur()}),e.addEventListener("pointerdown",s=>{s.pointerType!=="mouse"&&(this._clearAllPointer=s.pointerId)}),e.addEventListener("pointercancel",()=>{this._clearAllPointer=null}),e.addEventListener("pointerup",s=>{s.pointerType==="mouse"||s.pointerId!==this._clearAllPointer||(this._clearAllPointer=null,s.stopPropagation(),this.dismissAll())}),this.container.appendChild(e),this._clearAllBtn=e}this._clearAllBtn.textContent!==l.clearAllLabel&&(this._clearAllBtn.textContent=l.clearAllLabel);let a=t.filter(e=>e.type!=="loading").length;this.container.setAttribute("data-clearable",a>=T?"true":"false")}_pruneOld(){for(;this.toasts.filter(t=>!t.dismissing).length>l.maxToasts;){let t=this.toasts.find(a=>!a.dismissing);t&&this.dismiss(t.id)}}_getSwipeBaseTransform(t){let a=l.position.startsWith("top")?1:-1;return`translateY(${(this.expanded?parseFloat(t.el.style.getPropertyValue("--toastry-expanded-offset"))||0:parseFloat(t.el.style.getPropertyValue("--toastry-offset"))||0)*a}px)`}_onPointerDown(t,a){let e=this.toasts.find(s=>s.id===a);!e||e.dismissing||(e.el.setPointerCapture(t.pointerId),this.swipingToast=a,this.pointerStart={x:t.clientX,y:t.clientY},this.swipeStartTime=Date.now())}_onPointerMove(t,a){if(this.swipingToast!==a||!this.pointerStart)return;let e=this.toasts.find(o=>o.id===a);if(!e||e.dismissing)return;let s=t.clientX-this.pointerStart.x,i=Math.abs(s);if(i>2){e.el.setAttribute("data-swiping","true");let o=this._getSwipeBaseTransform(e);e.el.style.transform=`${o} translateX(${s}px)`,e.el.style.opacity=Math.max(0,1-i/(b*2.5))}}_onPointerCancel(t){if(this.swipingToast!==t)return;let a=this.toasts.find(e=>e.id===t);a&&!a.dismissing&&(a.el.removeAttribute("data-swiping"),a.el.style.transform="",a.el.style.opacity=""),this._resetSwipe()}_onPointerUp(t,a){if(this.swipingToast!==a||!this.pointerStart)return;let e=this.toasts.find(d=>d.id===a);if(!e||e.dismissing){this._resetSwipe();return}let s=t.clientX-this.pointerStart.x,i=Math.abs(s),o=Date.now()-this.swipeStartTime,r=i/Math.max(o,1);if(i>=b||r>=_){let d=s>0?"150%":"-150%",n=this._getSwipeBaseTransform(e);e.el.style.transform=`${n} translateX(${d})`,e.el.style.opacity="0",e.el.style.transition="transform 0.2s ease, opacity 0.15s ease",setTimeout(()=>this.dismiss(a),150)}else e.el.removeAttribute("data-swiping"),e.el.style.transform="",e.el.style.opacity="";this._resetSwipe()}_resetSwipe(){this.swipingToast=null,this.pointerStart=null,this._isEngaged()||this._setExpanded(!1)}_escape(t){return g?(g.textContent=t,g.innerHTML):String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}},c=new S;function u(t,a){return c.create(t,a)}u.success=function(t,a){return c.create(t,{...a,type:"success"})};u.error=function(t,a){return c.create(t,{...a,type:"error"})};u.warning=function(t,a){return c.create(t,{...a,type:"warning"})};u.info=function(t,a){return c.create(t,{...a,type:"info"})};u.loading=function(t,a){return c.create(t,{...a,type:"loading",duration:0})};u.promise=function(t,a={}){let e=c.create(a.loading||"Loading...",{type:"loading",duration:0});return t.then(s=>{let i=typeof a.success=="function"?a.success(s):a.success||"Done";c._update(e,i,{type:"success"})}).catch(s=>{let i=typeof a.error=="function"?a.error(s):a.error||"Something went wrong";c._update(e,i,{type:"error"})}),t};u.dismiss=function(t){c.dismiss(t)};u.dismissAll=function(){c.dismissAll()};u.configure=function(t={}){t.position&&(l.position=t.position),t.duration!==void 0&&(l.duration=t.duration),t.maxVisible!==void 0&&(l.maxVisible=t.maxVisible),t.maxToasts!==void 0&&(l.maxToasts=t.maxToasts),t.clearAll!==void 0&&(l.clearAll=!!t.clearAll),t.clearAllLabel&&(l.clearAllLabel=String(t.clearAllLabel)),c._updateLayout()};var P=u;export{P as default,u as toast};
