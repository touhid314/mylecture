import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// Every emitted revision is immutable so generation ahead of speech cannot
// overwrite the document the student is still watching.
// Math in HTML visuals: KaTeX renders $...$ (math, not "$5 and $10"),
// \(...\), \[...\] and $$...$$ in the visual's text, including text its
// scripts add later. window.katex is there for scripts to use directly.
export const MATH_BRIDGE = String.raw`<link rel="stylesheet" href="mylecture://app/vendor/katex/katex.min.css"><script src="mylecture://app/vendor/katex/katex.min.js"></script><script>(()=>{
  const RE=/\$\$([^$]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g;
  const isMath=(s)=>/[\\^_{}=]/.test(s)||/^\s*[A-Za-z](?:_?\d)?\s*$/.test(s);
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
        html+=katex.renderToString(tex,{displayMode:display,throwOnError:false,strict:'ignore'});
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
  const bridge = `<script>(()=>{
    addEventListener('message',e=>{const t=e.data?.type;if(e.source!==parent||(t!=='tutor:point'&&t!=='tutor:reveal'))return;const id=String(e.data.id);const kind=t==='tutor:reveal'?'show':'look';dispatchEvent(new CustomEvent('tutor:cue',{detail:{id,kind}}));const el=document.getElementById(id);if(!el)return;if(kind==='show'){el.hidden=false;el.style.transition=el.style.transition||'opacity .45s ease';el.style.visibility='visible';el.style.opacity='1';if(el.hasAttribute('opacity'))el.setAttribute('opacity','1');el.classList.add('tutor-shown');}el.scrollIntoView({block:'nearest',behavior:'smooth'});if(kind==='look')el.animate([{outline:'4px solid #f59e0b',outlineOffset:'4px'},{outline:'4px solid transparent',outlineOffset:'8px'}],{duration:3200});});
    const report=()=>parent.postMessage({type:'tutor:height',height:Math.max(document.body?.scrollHeight||0,document.documentElement.scrollHeight)},'*');
    addEventListener('load',()=>{report();new ResizeObserver(report).observe(document.body);});
    addEventListener('error',e=>parent.postMessage({type:'tutor:html-error',message:String(e.message||'Visual failed')},'*'));
  })();</script>`;
  // Appending also avoids rewriting a literal "</body>" inside user JavaScript.
  const doc = html + "\n" + MATH_BRIDGE + "\n" + bridge;
  const name = `.visual-${createHash("sha256").update(doc).digest("hex").slice(0, 24)}.html`;
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, name), doc);
  const rel = path.relative(root, path.join(folder, name)).split(path.sep).map(encodeURIComponent).join("/");
  return { ...data, src: `mylecture://app/tutor-file/${encodeURIComponent(sessionId)}/${rel}` };
}
