import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLinkedIssues } from './pr-linking.ts';

const REPO = 'acme/widgets';

function links(body: string) {
  return extractLinkedIssues({ title: '', body, repo_full_name: REPO });
}
function nums(body: string) {
  return links(body)
    .map((l) => l.number)
    .sort((a, b) => a - b);
}

// Regression for issue #151: the keyword alternation had no leading word
// boundary, so it matched the keyword as the *tail* of a larger word before
// `#<n>`. GitHub does not treat those as closing references.
void test('does not link a keyword that is the tail of a larger word (issue #151)', () => {
  assert.deepEqual(nums('quick hotfix #1234 for the crash'), []);
  assert.deepEqual(nums('bugfix #42 landed'), []);
  assert.deepEqual(nums('Adds a prefix #7 to the keys'), []);
  assert.deepEqual(nums('still unresolved #5 after this'), []);
  assert.deepEqual(nums('discloses #3 in the report'), []);
  // A word char (incl. `_`) immediately before the keyword is also not a link.
  assert.deepEqual(nums('see foo_fixes #9'), []);
});

void test('recognises standalone closing keywords and their tenses', () => {
  assert.deepEqual(nums('closes #10'), [10]);
  assert.deepEqual(nums('close #10'), [10]);
  assert.deepEqual(nums('closed #10'), [10]);
  assert.deepEqual(nums('fixes #11'), [11]);
  assert.deepEqual(nums('fix #11'), [11]);
  assert.deepEqual(nums('fixed #11'), [11]);
  assert.deepEqual(nums('resolves #12'), [12]);
  assert.deepEqual(nums('resolve #12'), [12]);
  assert.deepEqual(nums('resolved #12'), [12]);
});

void test('keyword may be preceded by punctuation, parens or a newline', () => {
  assert.deepEqual(nums('(closes #5)'), [5]);
  assert.deepEqual(nums('This change closes #6.'), [6]);
  assert.deepEqual(nums('line one\nFixes #7'), [7]);
  assert.deepEqual(nums('fixes: #8'), [8]);
  assert.deepEqual(nums('Closes #1 at start of string'), [1]);
});

void test('a plain cross-reference is not a closing link', () => {
  assert.deepEqual(nums('see #12 for context'), []);
  assert.deepEqual(nums('related to #13'), []);
});

void test('cross-repo and full-URL references keep their owner/repo', () => {
  assert.deepEqual(links('fixes octo/cat#9'), [{ repo: 'octo/cat', number: 9 }]);
  assert.deepEqual(links('closes https://github.com/octo/cat#21'), [
    { repo: 'octo/cat', number: 21 },
  ]);
});

void test('same-repo references default to the PR repo', () => {
  assert.deepEqual(links('fixes #4'), [{ repo: REPO, number: 4 }]);
});

void test('title is scanned too, and duplicate references are de-duped', () => {
  const out = extractLinkedIssues({
    title: 'fixes #1',
    body: 'also fixes #1 and closes #2',
    repo_full_name: REPO,
  });
  assert.deepEqual(
    out.map((l) => l.number).sort((a, b) => a - b),
    [1, 2],
  );
});
