import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyScore } from '../src/components/fuzzy.ts';

test('fuzzyScore matches subsequences and rejects non-matches', () => {
  assert.equal(fuzzyScore('', 'anything'), 0);
  assert.ok(fuzzyScore('brb', 'Broiler Behavior') >= 0);
  assert.equal(fuzzyScore('xyz', 'Projects'), -1);
});

test('fuzzyScore prefers contiguous and word-start matches', () => {
  assert.ok(fuzzyScore('proj', 'Projects') > fuzzyScore('proj', 'Pr ob ject'));
  assert.ok(fuzzyScore('dt', 'DeckTection') < fuzzyScore('dt', 'deck tection'));
});
