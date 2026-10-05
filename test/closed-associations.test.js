import test from 'node:test';
import assert from 'node:assert/strict';
import { assertClosedAssociations } from '../lib/closed-associations.js';
test('completed containers reject new assets, characters and objects even while reopening', () => {
  for (const field of ['assetKeys','characterIds','elementIds','objectIds']) {
    const before = { archived:true, [field]:['old'] };
    assert.throws(() => assertClosedAssociations(before, { archived:false, [field]:['old','new'] }), { localizationCode:'closedAssociations' });
    assert.doesNotThrow(() => assertClosedAssociations(before, { ...before }));
    assert.doesNotThrow(() => assertClosedAssociations(before, { [field]:[] }));
    assert.doesNotThrow(() => assertClosedAssociations({ ...before, archived:false }, { [field]:['new'] }));
  }
});
