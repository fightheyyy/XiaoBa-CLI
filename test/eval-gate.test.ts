import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import { getEvalGateItemsForProfile } from '../src/eval';

describe('eval gate', () => {
  test('exposes only live agent eval benchmark items', () => {
    const items = getEvalGateItemsForProfile();

    assert.deepEqual(items.map(item => item.id), ['base-runtime-benchmark']);
    assert.deepEqual(items.map(item => item.kind), ['benchmark']);
    assert.ok(items.every(item => item.path.startsWith('eval/benchmarks/')));
    assert.ok(!items.some(item => item.path.includes('test/contract-smoke')));
  });
});
