import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

class Element {
  constructor(tag, attrs = {}, children = []) { this.tag = tag; this.children = []; this.classList = { toggle() {} }; Object.assign(this, attrs); this.append(...children); }
  append(...children) { this.children.push(...children.flat().filter(x => x != null && x !== false)); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  get textContent() { return this.children.map(x => x instanceof Element ? x.textContent : String(x)).join(''); }
  set textContent(value) { this.children = [String(value)]; }
}
const fixture = { confirmations: [], confirmed: true, notices: [] };
globalThis.__connectPanelFixture = {
  h: (tag, attrs, ...children) => new Element(tag, attrs, children),
  confirmBox: async (...args) => { fixture.confirmations.push(args); return fixture.confirmed; },
  toast: (...args) => fixture.notices.push(args),
};
const hooks = registerHooks({ load(url, context, next) {
  if (url.endsWith('/app/js/ui.js')) return { format:'module', shortCircuit:true, source:'export const h=globalThis.__connectPanelFixture.h; export const confirmBox=globalThis.__connectPanelFixture.confirmBox; export const toast=globalThis.__connectPanelFixture.toast; export const bus={emit(){}};' };
  if (url.endsWith('/app/js/api-key.js')) return { format:'module', shortCircuit:true, source:'export const showApiKeyDialog=()=>{};' };
  return next(url, context);
} });
const { connectPanel } = await import('../app/js/connect.js');
const settle = () => new Promise(resolve => setImmediate(resolve));
const descendants = node => node.children.flatMap(child => child instanceof Element ? [child, ...descendants(child)] : []);
const button = (panel, label) => descendants(panel.el).find(node => node.tag === 'button' && node.textContent === label);
const previousWindow = globalThis.window;
test.after(() => {
  hooks.deregister();
  delete globalThis.__connectPanelFixture;
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
});

async function setup(t, settings = {}, statusFn) {
  const state = { settings: { engine:'codex', connected:{codex:true}, accountRevision:{codex:0}, accountSwitch:{}, ...settings } };
  const actions = [], writes = [], statusCalls = [];
  const statuses = { codex:{installed:true,ready:true,account:{email:'old@example.test'}}, antigravity:{installed:false,ready:false}, 'claude-code':{installed:false,ready:false} };
  const merge = patch => { for (const [key,value] of Object.entries(patch)) state.settings[key] = value && typeof value === 'object' ? {...state.settings[key],...value} : value; return structuredClone(state.settings); };
  fixture.confirmations = [];
  fixture.confirmed = true;
  fixture.notices = [];
  globalThis.window = { addEventListener(){}, removeEventListener(){}, ml: {
    engines:{status:async (id,options) => { statusCalls.push({id,options}); return statusFn ? statusFn(id,statuses) : statuses[id]; }},
    settings:{set:async patch => { writes.push(patch); return merge(patch); }},
    connect:{services:async()=>Object.fromEntries(['codex','antigravity','claude-code'].map(id=>[id,{title:id,plan:'subscription'}])),run:async(id,action,options)=>{
      actions.push({id,action,options});
      if(action==='remove-account'||action==='switch-account') return merge({connected:{[id]:false},engine:'',accountRevision:{[id]:(state.settings.accountRevision[id]||0)+1},accountSwitch:{[id]:action==='switch-account'},accountSwitchFrom:{[id]:action==='switch-account'?statuses[id].account?.email||'':''}});
      if(action==='complete-account'||action==='connect-account') return merge({connected:{[id]:true},engine:id,accountSwitch:{[id]:false}});
    }},
  }};
  const mount = async (options = {manageAccounts:true}) => {
    const panel = connectPanel(state,options);
    t.after(()=>panel.stop());
    await settle(); await settle();
    return panel;
  };
  const panel = await mount();
  await settle(); await settle();
  return {state,panel,actions,writes,statuses,statusCalls,mount};
}

test('Settings exposes account actions and removal stays disconnected despite ready local credentials', async t=>{
  const h=await setup(t);
  assert.ok(button(h.panel,'Add new account'));
  assert.ok(button(h.panel,'Remove account'));
  await button(h.panel,'Remove account').onclick(); await settle();
  assert.equal(h.state.settings.connected.codex,false);
  await h.panel.refresh(); await settle();
  assert.equal(h.state.settings.connected.codex,false);
  assert.equal(h.actions.filter(a=>a.action==='connect-account').length,0);
  assert.ok(button(h.panel,'Connect'));
  assert.equal(button(h.panel,'Remove account'),undefined);
  assert.match(fixture.notices.at(-1)[0],/command-line sign-in is unchanged/);
});

test('switching never accepts old ready credentials automatically; explicit completion names the live account', async t=>{
  const h=await setup(t);
  await button(h.panel,'Add new account').onclick(); await settle();
  assert.match(fixture.confirmations[0][1],/command-line tool, including outside MyLecture/);
  assert.match(fixture.confirmations[0][1],/Only one account per provider/);
  await h.panel.refresh(); await settle();
  assert.equal(h.state.settings.connected.codex,false);
  assert.equal(h.state.settings.accountSwitch.codex,true);
  assert.equal(h.actions.filter(a=>a.action==='complete-account').length,0);
  assert.equal(h.actions.filter(a=>a.action==='connect-account').length,0);
  h.statuses.codex.account.email='new@example.test';
  h.statusCalls.length=0;
  await button(h.panel,'Use this account').onclick(); await settle();
  const complete=h.actions.find(a=>a.action==='complete-account');
  assert.deepEqual(complete.options,{revision:1,email:'new@example.test'});
  assert.equal(fixture.confirmations.length,1, 'only switching the shared login needs confirmation');
  assert.deepEqual(h.statusCalls[0],{id:'codex',options:{fresh:true}});
  assert.equal(h.state.settings.connected.codex,true);
});

test('stopping a panel prevents a delayed ready status from initiating a connection', async t=>{
  let resolveStatus, hold=false;
  const h=await setup(t,{engine:'',connected:{codex:false}},(id,statuses)=>id==='codex'&&hold ? new Promise(resolve=>{resolveStatus=resolve;}) : statuses[id]);
  hold=true;
  const pending=button(h.panel,'Connect').onclick();
  await settle(); h.panel.stop(); resolveStatus(h.statuses.codex); await pending;
  assert.deepEqual(h.actions,[]);
  assert.equal(h.state.settings.connected.codex,false);
});

test('cancelled pending account changes remain disconnected across later ready polls', async t=>{
  const h=await setup(t,{engine:'',connected:{codex:false},accountRevision:{codex:2},accountSwitch:{codex:true}});
  await button(h.panel,'Cancel').onclick(); await settle();
  await h.panel.refresh();
  assert.equal(h.state.settings.accountSwitch.codex,false);
  assert.equal(h.state.settings.connected.codex,false);
  assert.deepEqual(h.actions.map(a=>a.action),['remove-account']);
});

test('ordinary connect panels omit Settings account management controls', async t=>{
  const h=await setup(t);
  const panel=await h.mount({compact:true});
  assert.equal(button(panel,'Add new account'),undefined);
  assert.equal(button(panel,'Remove account'),undefined);
});

test('declining the shared CLI account warning leaves the connection unchanged', async t=>{
  const h=await setup(t);
  fixture.confirmed=false;
  await button(h.panel,'Add new account').onclick();
  assert.equal(fixture.confirmations.length,1);
  assert.deepEqual(h.actions,[]);
  assert.equal(h.state.settings.connected.codex,true);
  assert.ok(button(h.panel,'Remove account'));
});

test('switch state survives panel replacement without automatically accepting the old ready account', async t=>{
  const h=await setup(t);
  await button(h.panel,'Add new account').onclick(); await settle();
  h.panel.stop();
  const replacement=await h.mount();
  await replacement.refresh();
  assert.ok(button(replacement,'Use this account'));
  assert.ok(button(replacement,'Cancel'));
  assert.equal(button(replacement,'Connect'),undefined);
  assert.equal(button(replacement,'Add new account'),undefined);
  assert.equal(h.state.settings.connected.codex,false);
  assert.equal(h.state.settings.accountSwitch.codex,true);
  assert.deepEqual(h.actions.map(a=>a.action),['switch-account']);
  assert.ok(h.statusCalls.filter(call=>call.id==='codex').slice(1).every(call=>call.options.fresh));
});

test('existing pending sign-in connects in one click once the local account is ready', async t=>{
  const h=await setup(t,{engine:'',connected:{codex:false},accountRevision:{codex:4},accountSwitch:{codex:true}});
  h.statuses.codex={installed:true,ready:false};
  await button(h.panel,'Use this account').onclick();
  assert.equal(fixture.confirmations.length,0);
  assert.match(fixture.notices.at(-1)[0],/Finish signing in/);
  h.statuses.codex={installed:true,ready:true,account:{email:'new@example.test'}};
  fixture.confirmed=false;
  await button(h.panel,'Use this account').onclick();
  assert.equal(fixture.confirmations.length,0);
  assert.deepEqual(h.actions.map(a=>a.action),['complete-account']);
  assert.equal(h.state.settings.connected.codex,true);
  assert.equal(h.state.settings.accountSwitch.codex,false);
});

test('a newly signed-in replacement identity completes automatically while the old identity cannot', async t=>{
  const h=await setup(t);
  await button(h.panel,'Add new account').onclick(); await settle();
  await h.panel.refresh();
  assert.equal(h.state.settings.connected.codex,false);
  h.statuses.codex.account.email='replacement@example.test';
  await h.panel.refresh(); await settle();
  const complete=h.actions.find(a=>a.action==='complete-account');
  assert.deepEqual(complete.options,{revision:1,email:'replacement@example.test',automatic:true});
  assert.equal(h.state.settings.connected.codex,true);
  assert.equal(fixture.confirmations.length,1);
});

test('stop prevents an in-flight pending sign-in poll from connecting after it becomes ready', async t=>{
  let resolvePoll,hold=false;
  const h=await setup(t,{engine:'',connected:{codex:false}},(id,statuses)=>id==='codex'&&hold ? new Promise(resolve=>{resolvePoll=resolve;}) : statuses[id]);
  h.statuses.codex={installed:true,ready:false};
  await h.panel.refresh();
  await button(h.panel,'Connect').onclick(); await settle();
  assert.deepEqual(h.actions.map(a=>a.action),['login']);
  assert.ok(button(h.panel,'Open sign-in again'));
  hold=true;
  const poll=h.panel.refresh();
  await settle();
  assert.equal(typeof resolvePoll,'function');
  h.panel.stop();
  resolvePoll({installed:true,ready:true,account:{email:'late@example.test'}});
  await poll;
  assert.deepEqual(h.actions.map(a=>a.action),['login']);
  assert.equal(h.state.settings.connected.codex,false);
  assert.deepEqual(h.writes,[]);
});
