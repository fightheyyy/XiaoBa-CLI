import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import { decidePatchRegression } from '../src/arena/patch-regression';

describe('Arena Patch regression decision', () => {
  test('passes only when every isolated replay passes', () => {
    assert.equal(decidePatchRegression(['pass', 'pass', 'pass']), 'pass');
  });

  test('keeps mixed outcomes unstable and repeated failures reopened', () => {
    assert.equal(decidePatchRegression(['pass', 'fail', 'pass']), 'unstable');
    assert.equal(decidePatchRegression(['fail', 'fail', 'fail']), 'reopened');
  });

  test('fails closed for blocked or unsafe execution', () => {
    assert.equal(decidePatchRegression(['blocked', 'blocked']), 'blocked');
    assert.equal(decidePatchRegression(['pass', 'unsafe']), 'unsafe');
  });
});
