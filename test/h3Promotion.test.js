import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createH3PromotionCoordinator,
  findExistingH3Promotion
} from '../lib/h3Promotion.js';

describe('promoción MiniMax H3 a 2K', () => {
  test('encuentra la promoción 2K ya persistida para el video original', () => {
    const existing = { id: 'upgrade', modelId: 'minimax-h3', resolution: '2K', h3RegeneratedFrom: 'source' };
    const history = [
      { id: 'other', modelId: 'minimax-h3', resolution: '768P' },
      existing
    ];

    assert.equal(findExistingH3Promotion(history, 'source'), existing);
    assert.equal(findExistingH3Promotion(history, 'missing'), null);
  });

  test('comparte una sola ejecución entre solicitudes simultáneas del mismo video', async () => {
    const coordinator = createH3PromotionCoordinator();
    let executions = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const work = async () => {
      executions += 1;
      await gate;
      return { id: 'upgrade' };
    };

    const first = coordinator.run('source', work);
    const second = coordinator.run('source', work);
    release();

    assert.deepEqual(await Promise.all([first, second]), [{ id: 'upgrade' }, { id: 'upgrade' }]);
    assert.equal(executions, 1);
  });

  test('permite reintentar después de una ejecución fallida', async () => {
    const coordinator = createH3PromotionCoordinator();
    await assert.rejects(coordinator.run('source', async () => { throw new Error('falló'); }), /falló/);

    const result = await coordinator.run('source', async () => ({ id: 'retry' }));
    assert.deepEqual(result, { id: 'retry' });
  });
});
