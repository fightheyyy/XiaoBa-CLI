import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import {
  shouldRenderCliRuntimeLogs,
  shouldRestoreCliSession,
} from '../src/commands/chat';

describe('CLI chat command options', () => {
  test('restores CLI session only when resume is explicit', () => {
    assert.equal(shouldRestoreCliSession({}), false);
    assert.equal(shouldRestoreCliSession({ resume: false }), false);
    assert.equal(shouldRestoreCliSession({ resume: true }), true);
    assert.equal(shouldRestoreCliSession({ message: 'hello', resume: true }), false);
  });

  test('renders runtime logs only when verbose is explicit', () => {
    assert.equal(shouldRenderCliRuntimeLogs({}), false);
    assert.equal(shouldRenderCliRuntimeLogs({ verbose: false }), false);
    assert.equal(shouldRenderCliRuntimeLogs({ verbose: true }), true);
  });
});
