import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../public/llm-chats.js', import.meta.url), 'utf8');
test('chat scroll follows the latest message after rendering without scrolling the page', () => {
  let callback;
  const messages={scrollTop:0,scrollHeight:900,isConnected:true};
  const context=vm.createContext({root:{querySelector:()=>messages},requestAnimationFrame:fn=>callback=fn});
  vm.runInContext(source.slice(source.indexOf('  function scrollChatToEnd()'),source.indexOf('  function associationOptions')),context);
  context.scrollChatToEnd();
  assert.equal(messages.scrollTop,900);
  messages.scrollHeight=1100;callback();
  assert.equal(messages.scrollTop,1100);
  messages.isConnected=false;messages.scrollTop=100;callback();
  assert.equal(messages.scrollTop,100);
  assert.match(source,/scrollChatToEnd\(\);\s*}\s*async function action/);
});
test('waiting indicator appears immediately on send, follows pending status and supports reduced motion', () => {
  assert.match(source,/class="llm-waiting" role="status" aria-live="polite"/);
  assert.match(source,/pending \? '' : ' hidden'/);
  assert.match(source,/querySelector\('\.llm-waiting'\)\.hidden = false/);
  const css=fs.readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
  assert.match(css,/prefers-reduced-motion:reduce.*llm-waiting-spinner.*animation:none/);
});
