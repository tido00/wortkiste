import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoryBackend } from '../store.js';
import { newCardState, review } from '../srs.js';

test('backup → reset → restore gives identical state', async () => {
  const store = await createStore(memoryBackend());
  await store.set('settings', { newPerDay: 10, retention: 0.95, typing: true });
  await store.set('started', { L1A: true, L1B: true });
  await store.set('introduced', { abc: 20500, def: 20501 });
  await store.set('quiz', [{ day: 20500, score: 8, total: 10 }]);
  let st = newCardState(1e12);
  st = review(st, 3, 1e12);
  await store.putCard('abc:recognise', st);
  await store.putCard('abc:produce', review(st, 1, 1e12 + 6e5));
  await store.addLog({ cardId: 'abc:recognise', noteId: 'abc', t: 1e12, rating: 3, wasNew: true });
  await store.addLog({ cardId: 'abc:produce', noteId: 'abc', t: 1e12 + 6e5, rating: 1, wasNew: false });

  const backup = JSON.parse(JSON.stringify(store.exportJSON()));
  const before = structuredClone(store.state);

  await store.reset();
  assert.deepEqual(store.state.cards, {});
  assert.equal(store.state.revlog.length, 0);

  await store.importJSON(backup);
  assert.deepEqual(store.state, before);

  // A second store on the same data sees the same thing (it was written, not just kept in memory).
  const again = JSON.parse(JSON.stringify(store.exportJSON()));
  delete again.exportedAt; delete backup.exportedAt;
  assert.deepEqual(again, backup);
});

test('restore rejects files that are not backups', async () => {
  const store = await createStore(memoryBackend());
  await store.set('x', 1);
  await assert.rejects(store.importJSON({ hello: 'world' }));
  assert.equal(store.get('x'), 1, 'nothing was wiped');
});
