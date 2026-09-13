const test = require('node:test');
const assert = require('node:assert/strict');
const { nextReviewIndex, clampRate } = require('../utils/review');

test('ordered mode advances and wraps', () => {
  assert.equal(nextReviewIndex(['a', 'b', 'c'], 1, 'ordered', () => 0), 2);
  assert.equal(nextReviewIndex(['a', 'b', 'c'], 2, 'ordered', () => 0), 0);
});

test('random mode avoids the current item when alternatives exist', () => {
  assert.notEqual(nextReviewIndex(['a', 'b'], 0, 'random', () => 0), 0);
  assert.equal(nextReviewIndex(['a'], 0, 'random', () => 0), 0);
});

test('empty vocabulary has no review index', () => {
  assert.equal(nextReviewIndex([], 0, 'ordered', () => 0), -1);
});

test('rate uses only the four visible supported choices', () => {
  for (const rate of [0.6, 0.8, 1, 1.2]) assert.equal(clampRate(rate), rate);
  assert.equal(clampRate(0.2), 0.6);
  assert.equal(clampRate(2), 1.2);
  assert.equal(clampRate(0.69), 0.6);
  assert.equal(clampRate(0.71), 0.8);
});
