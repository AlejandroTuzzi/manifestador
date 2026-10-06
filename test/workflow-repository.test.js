import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowRepositoryItem, workflowRepositorySummary } from '../lib/workflow-repository.js';
test('workflow categories are optional, editable and preserved with existing files', () => {
  const original = workflowRepositoryItem({ title:'Example', filename:'a.json', content:'{"nodes":[]}' }, {}, 'id');
  assert.equal(original.category, '');
  const categorized = workflowRepositoryItem({ category:'  Video  ' }, original);
  assert.equal(categorized.category, 'Video');
  assert.equal(workflowRepositorySummary(categorized).category, 'Video');
  assert.equal(workflowRepositoryItem({ title:'Updated' }, categorized).category, 'Video');
  assert.equal(workflowRepositoryItem({ category:'' }, categorized).category, '');
  assert.equal(categorized.content, original.content);
  assert.equal(workflowRepositoryItem({ category:'x'.repeat(100) }, original).category.length, 80);
});
test('repository preserves JSON contents and filename, omits contents from listing', () => {
  const content = '\uFEFF{\n "nodes": [], "extra": {"note":"example"}\n}\n';
  const item = workflowRepositoryItem({ title:'Example', description:'Notes', filename:'example.json', content }, {}, 'id1');
  assert.equal(item.content,content);
  assert.equal(item.filename,'example.json');
  assert.equal(workflowRepositorySummary(item).content,undefined);
  const updated = workflowRepositoryItem({ title:'Renamed' },item,'unused');
  assert.equal(updated.content,content); assert.equal(updated.id,'id1');
});
test('accepts API workflows without executing nodes and rejects invalid uploads', () => {
  assert.doesNotThrow(() => workflowRepositoryItem({ title:'API',filename:'api.json',content:'{"1":{"class_type":"Example","inputs":{}}}' },{},'id'));
  for (const body of [{title:'',filename:'a.json',content:'{"nodes":[]}'}, {title:'A',filename:'a.json',content:'invalid'}, {title:'A',filename:'a.html',content:'{"nodes":[]}'}, {title:'A',filename:'a.json',content:'[]'}, {title:'A',filename:'a.json',content:'{}'}]) {
    assert.throws(() => workflowRepositoryItem(body,{},'id'), { localizationCode:'workflowRepositoryInvalid' });
  }
});
