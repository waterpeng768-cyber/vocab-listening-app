const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeWord,
  normalizePhonetic,
  pickAmericanPhonetic
} = require('../utils/phonetics');

test('normalizes words and IPA wrappers', () => {
  assert.equal(normalizeWord('  Tool  '), 'tool');
  assert.equal(normalizePhonetic(' [ tul ] '), '/tul/');
  assert.equal(normalizePhonetic('/rɪˈfrɛʃ/'), '/rɪˈfrɛʃ/');
});

test('prefers explicit US IPA over UK and generic candidates', () => {
  const result = pickAmericanPhonetic([
    { value: '/tuːl/', region: 'UK' },
    { value: '/tul/', region: 'US' },
    { value: '/tool/', region: '' }
  ]);
  assert.deepEqual(result, { phonetic: '/tul/', accent: 'us' });
});

test('does not present a UK-only IPA as American', () => {
  assert.deepEqual(
    pickAmericanPhonetic([{ value: '/tuːl/', region: 'British English' }]),
    { phonetic: '', accent: 'uk-only' }
  );
});
