import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const port = process.env.APPROVAL_TEST_PORT ?? '4111';
const endpoint = 'http://127.0.0.1:' + port + '/api/agents/approval-fixture/stream';
const memory = { thread: crypto.randomUUID(), resource: 'approval-fixture' };

async function stream(messages) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, memory }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.text();
  assert.equal(response.status, 200, body);
  return body;
}

const first = await stream('Start fixture workflow');
assert.ok(first.includes('Fixture needs your approval'), 'The first request did not suspend');
await delay(250);
const second = await stream('I approve the fixture');
assert.ok(second.includes('tool-call-resumed'), 'The suspended tool did not resume');
assert.ok(second.includes('FIXTURE_FINAL_REPLY'), 'The agent did not produce the final reply');
console.log('Direct /stream control passed. The workflow suspended and resumed on the same thread.');

