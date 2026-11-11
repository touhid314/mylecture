import fs from "node:fs";
import { normalizeLatex, isMathExpression } from "../../app/shared/speech-text.js";
import path from "node:path";
import { createHash } from "node:crypto";

// Defined before the visual's own scripts run, so they can register steps:
// tutor.on("s1", () => swap(0)). Cues run one at a time, in order; a handler
// that returns milliseconds (or a Promise) holds the next cue until it is done,
// so steps cued close together in speech still play one after another.
// The --wb-* variables are the whiteboard's palette, for visuals that want it.
// It starts with the charset: browsers only honour one in the first 1024
// bytes, and this script pushes the visual's own <meta charset> past that, so
// without it UTF-8 text such as "↑" or "→" shows as "â†‘".
export const TUTOR_API = `<meta charset="utf-8"><style>:root{--wb-ink:#1f2328;--wb-muted:#5b6168;--wb-line:#e6e2da;--wb-card:#fff;--wb-blue:#2563eb;--wb-red:#dc2626;--wb-green:#16a34a;--wb-purple:#7c3aed;--wb-orange:#ea580c}</style><script>window.tutor=(()=>{
  // Cues that arrive with the page wait until it has been painted once, so a
  // first step's CSS transition starts from what the student saw.
  const handlers={};let queue=new Promise((ok)=>addEventListener('load',()=>{setTimeout(ok,120);requestAnimationFrame(()=>requestAnimationFrame(ok));},{once:true}));
  const wait=(r)=>r&&typeof r.then==='function'?r:typeof r==='number'&&r>0?new Promise((ok)=>setTimeout(ok,Math.min(r,15000))):null;
  const fail=(e)=>parent.postMessage({type:'tutor:html-error',message:String(e&&e.message||e||'Visual failed')},'*');
  // A look highlights just that element: an outline, or a glow on SVG shapes.
  const mark=(el,kind)=>{if(kind==='show'){el.hidden=false;el.style.transition=el.style.transition||'opacity .45s ease';el.style.visibility='visible';el.style.opacity='1';if(el.hasAttribute('opacity'))el.setAttribute('opacity','1');el.classList.add('tutor-shown');}try{el.scrollIntoView({block:'nearest',behavior:'smooth'});}catch{}if(kind!=='look'||!el.animate)return;if(el instanceof SVGElement&&!(el instanceof SVGSVGElement))el.animate([{filter:'drop-shadow(0 0 5px #f59e0b) drop-shadow(0 0 2px #f59e0b)'},{filter:'drop-shadow(0 0 5px #f59e0b) drop-shadow(0 0 2px #f59e0b)',offset:.8},{filter:'none'}],{duration:3200});else el.animate([{outline:'4px solid #f59e0b',outlineOffset:'4px'},{outline:'4px solid #f59e0b',outlineOffset:'4px',offset:.8},{outline:'4px solid transparent',outlineOffset:'8px'}],{duration:3200});};
  // The element that spoken words name ("the left ventricle"): by id, label
  // or short text, earliest in the words, then the most specific.
  const toks=(s)=>String(s||'').replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase().split(/[^\\p{L}\\p{N}]+/u).filter(Boolean);
  const STOP=new Set(['the','this','that','these','those','here','there','and','now','look','see','its','our','your','one','all','top','left','right','bottom']);
  const at=(a,w)=>{for(let i=0;i+a.length<=w.length;i++){let ok=true;for(let j=0;j<a.length;j++)if(w[i+j]!==a[j]){ok=false;break;}if(ok)return i;}return -1;};
  const find=(words)=>{const w=toks(words).slice(0,10);if(!w.length||!document.body)return null;let best=null;
    for(const el of document.body.querySelectorAll('*')){if(el.closest('script,style,.katex-mathml'))continue;const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;
      const names=[el.id,el.getAttribute('aria-label'),el.getAttribute('data-label')];const txt=(el.textContent||'').trim();if(txt.length<=40&&el.children.length<=3)names.push(txt);
      for(const n of names){const a=toks(n);if(!a.length||a.join(' ').length<3||(a.length===1&&STOP.has(a[0])))continue;const i=at(a,w);if(i<0)continue;const area=r.width*r.height;
        if(!best||i<best.i||(i===best.i&&(a.length>best.n||(a.length===best.n&&area<best.area))))best={el,i,n:a.length,area};}}
    return best&&best.el;};
  // A look at an id that isn't one ({look:demo.membrane} for "outer-membrane"): found by its words.
  const show=(id,kind)=>{const el=document.getElementById(id)||(kind==='look'?find(id):null);if(el)mark(el,kind);};
  Object.defineProperty(window,'__tutorFind',{value:(words)=>{const el=find(words);if(el)mark(el,'look');return!!el;}});
  const cue=(id,kind)=>{queue=queue.then(async()=>{
    show(id,kind);
    const waits=[];
    try{dispatchEvent(new CustomEvent('tutor:cue',{detail:{id,kind}}));}catch(e){fail(e);}
    for(const f of handlers[id]||[]){try{const w=wait(f({id,kind}));if(w)waits.push(w);}catch(e){fail(e);}}
    await Promise.all(waits.map((w)=>w.catch(fail)));
  });};
  Object.defineProperty(window,'__tutorCue',{value:cue});
  // A hands-on activity reports what the student did: tutor.submit({answer, correct}).
  const submit=(r)=>{const o=r&&typeof r==='object'?r:{answer:r};parent.postMessage({type:'tutor:answer',answer:String(o.answer??'').slice(0,800),correct:o.correct===true?true:o.correct===false?false:null},'*');};
  return{on(id,fn){if(typeof fn==='function')(handlers[String(id)]||=[]).push(fn);},cue,submit};
})();</script>`;

// The API goes into the document's head (or right after a doctype), so a
// doctype stays first and the page keeps standards mode.
export function withTutorApi(html) {
  const at = html.match(/<head(?=[\s>])[^>]*>/i) || html.match(/<html(?=[\s>])[^>]*>/i) || html.match(/<!doctype[^>]*>/i);
  if (!at) return TUTOR_API + html;
  const i = at.index + at[0].length;
  return html.slice(0, i) + TUTOR_API + html.slice(i);
}

const BRIDGE = `<script>(()=>{
  addEventListener('message',e=>{const t=e.data?.type;if(e.source!==parent)return;
    if(t==='tutor:find'){let found=false;try{found=window.__tutorFind(String(e.data.words||''));}catch{}parent.postMessage({type:'tutor:found',seq:e.data.seq,found},'*');return;}
    if(t!=='tutor:point'&&t!=='tutor:reveal')return;window.__tutorCue(String(e.data.id),t==='tutor:reveal'?'show':'look');});
  const report=()=>parent.postMessage({type:'tutor:height',height:Math.max(document.body?.scrollHeight||0,document.documentElement.scrollHeight)},'*');
  addEventListener('load',()=>{report();new ResizeObserver(report).observe(document.body);});
  addEventListener('error',e=>parent.postMessage({type:'tutor:html-error',message:String(e.message||'Visual failed')},'*'));
})();</script>`;

// Every emitted revision is immutable so generation ahead of speech cannot
// overwrite the document the student is still watching.
// Math in HTML visuals: KaTeX renders $...$ (math, not "$5 and $10"),
// \(...\), \[...\] and $$...$$ in the visual's text, including text its
// scripts add later. window.katex is there for scripts to use directly.
export const MATH_BRIDGE = String.raw`<link rel="stylesheet" href="mylecture://app/vendor/katex/katex.min.css"><script src="mylecture://app/vendor/katex/katex.min.js"></script><script>(()=>{
  const normalizeLatex=${normalizeLatex.toString()};
  const RE=/\$\$([^$]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g;
  const isMath=${isMathExpression.toString()};
  const skip=(n)=>n.parentElement&&n.parentElement.closest('script,style,textarea,code,pre,.katex,[data-no-math]');
  let busy=false;
  const render=()=>{
    if(busy||!window.katex||!document.body)return;busy=true;
    const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);const todo=[];
    for(let n;(n=w.nextNode());)if(/\$|\\\(|\\\[/.test(n.nodeValue)&&!skip(n))todo.push(n);
    for(const n of todo){
      const t=n.nodeValue;let html='',last=0,hit=false;
      for(const m of t.matchAll(RE)){
        const tex=m[1]??m[2]??m[3]??m[4];const display=m[1]!=null||m[2]!=null;
        if(m[4]!=null&&!isMath(tex))continue;
        html+=t.slice(last,m.index).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
        html+=katex.renderToString(normalizeLatex(tex),{displayMode:display,throwOnError:false,strict:'ignore'});
        last=m.index+m[0].length;hit=true;
      }
      if(!hit)continue;
      html+=t.slice(last).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
      const span=document.createElement('span');span.innerHTML=html;n.replaceWith(...span.childNodes);
    }
    busy=false;
  };
  let timer=0;const soon=()=>{clearTimeout(timer);timer=setTimeout(render,30);};
  addEventListener('DOMContentLoaded',render);addEventListener('load',()=>{render();new MutationObserver(soon).observe(document.body,{childList:true,subtree:true,characterData:true});});
  if(document.readyState!=='loading')render();
})();</script>`;

export function prepareHtml(data, { workspace, sessionId }) {
  if (!workspace) throw new Error("A lesson workspace is required for HTML visuals.");
  const root = path.resolve(workspace);
  let folder = root, html = data.html;
  if (data.file) {
    const file = path.resolve(root, String(data.file));
    if (!file.startsWith(root + path.sep) || !/\.html?$/i.test(file)) throw new Error("HTML files must be inside this lesson's workspace.");
    if (fs.statSync(file).size > 2 * 1024 * 1024) throw new Error("HTML visual is too large.");
    folder = path.dirname(file);
    html = fs.readFileSync(file, "utf8");
  }
  if (typeof html !== "string" || !html.trim() || Buffer.byteLength(html) > 2 * 1024 * 1024) throw new Error("Provide an HTML document up to 2 MB.");
  const doc = withTutorApi(html) + "\n" + MATH_BRIDGE + "\n" + BRIDGE;
  const name = `.visual-${createHash("sha256").update(doc).digest("hex").slice(0, 24)}.html`;
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, name), doc);
  const rel = path.relative(root, path.join(folder, name)).split(path.sep).map(encodeURIComponent).join("/");
  return { ...data, src: `mylecture://app/tutor-file/${encodeURIComponent(sessionId)}/${rel}` };
}
