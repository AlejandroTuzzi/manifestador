import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('cada creador explícito de categorías ofrece editar y borrar', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8')
  ]);
  const contexts = [...html.matchAll(/id="btnNew([A-Z][A-Za-z]+)Category"/g)].map((match) => match[1]);

  assert.deepEqual(contexts.sort(), ['Prompt', 'Snippet', 'Vocabulary']);
  for (const context of contexts) {
    assert.match(html, new RegExp(`id="btnEdit${context}Category"`));
    assert.match(html, new RegExp(`id="btnDelete${context}Category"`));
    assert.match(app, new RegExp(`\\$\\('#btnEdit${context}Category'\\)\\.addEventListener`));
    assert.match(app, new RegExp(`\\$\\('#btnDelete${context}Category'\\)\\.addEventListener`));
  }
});
