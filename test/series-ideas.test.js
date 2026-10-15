import test from 'node:test';
import assert from 'node:assert/strict';
import { changeIdeas } from '../lib/series-ideas.js';
test('ideas own their characters and category CRUD preserves entries', () => {
  let data = changeIdeas({}, 'categories', 'POST', 'cat', {name:'Drama'});
  data = changeIdeas(data, 'entries', 'POST', 'one', {name:'Idea', categoryId:'cat', characters:[{name:'Ana', emotionalLever:'Family'}]});
  data = changeIdeas(data, 'entries', 'POST', 'two', {name:'Other', characters:[{name:'Ana'}]});
  data = changeIdeas(data, 'categories', 'PUT', 'cat', {name:'Romance'});
  assert.equal(data.entries[0].categoryId, 'cat');
  assert.equal(data.entries[0].characters[0].emotionalLever, 'Family');
  assert.equal(data.entries[1].characters[0].emotionalLever, '');
  assert.throws(() => changeIdeas(data, 'categories', 'POST', 'duplicate', {name:'romance'}));
  data = changeIdeas(data, 'categories', 'DELETE', 'cat', {});
  assert.equal(data.entries[0].categoryId, '');
  assert.equal(data.entries.length, 2);
  data = changeIdeas(data, 'entries', 'DELETE', 'one', {});
  assert.equal(data.entries[0].id, 'two');
  assert.throws(() => changeIdeas(data, 'entries', 'POST', 'empty', {}));
});
