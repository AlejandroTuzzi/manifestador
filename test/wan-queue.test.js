import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function setup(jobs = []) {
  const result = { jobs, entries: [] };
  const context = vm.createContext({
    document: { hidden: false }, state: { config: {}, generationJobs: [], history: [],
      videoModels: [{ id: 'wan-3', provider: 'wan', name: 'Wan 3.0' }, { id: 'other', provider: 'minimax', name: 'Other' }] },
    api: async () => result, tr: key => key, renderHistory() {}, renderGenerationQueue() {}
  });
  vm.runInContext(source.slice(source.indexOf('let wanSyncBusy = false;'), source.indexOf('function pumpGenerationQueue()')), context);
  return { context, result, sync: () => context.syncWanGenerationJobs() };
}
const pending = { id: 'old', clientId: 'client', taskId: 'task', modelId: 'wan-3', createdAt: 1, failed: true };

test('old Wan failures never reappear while generating with other models', async () => {
  const { context, sync } = setup([pending]);
  context.state.generationJobs.push({ id: 'client', body: { modelId: 'other' }, status: 'running' });
  await sync(); await sync();
  assert.equal(context.state.generationJobs.length, 1);
  assert.equal(context.state.generationJobs[0].status, 'running');
  assert.equal(context.state.generationJobs[0].wanTaskId, undefined);
});

test('a recovered live task reports failure once and stays dismissed', async () => {
  const { context, result, sync } = setup([{ ...pending, failed: false }]);
  await sync();
  assert.equal(context.state.generationJobs[0].status, 'running');
  result.jobs[0].failed = true;
  await sync();
  assert.equal(context.state.generationJobs[0].status, 'error');
  context.state.generationJobs = [];
  await sync();
  assert.equal(context.state.generationJobs.length, 0);
});

test('non-Wan and malformed status records cannot create Wan cards', async () => {
  const { context, sync } = setup([{ ...pending, modelId: 'other', failed: false }, { ...pending, taskId: '', failed: false }, { ...pending, modelId: 'unknown', failed: false }]);
  await sync();
  assert.equal(context.state.generationJobs.length, 0);
});

test('completed recovered Wan tasks still reach history', async () => {
  const { context, result, sync } = setup([{ ...pending, failed: false }]);
  await sync();
  result.jobs = [];
  result.entries = [{ id: 'entry', modelId: 'wan-3', wanTaskId: 'task', ts: 5 }];
  await sync();
  assert.equal(context.state.generationJobs[0].status, 'done');
  assert.equal(context.state.history[0].id, 'entry');
});
