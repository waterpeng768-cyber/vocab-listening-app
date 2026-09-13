function nextReviewIndex(words, currentIndex, mode, randomFn = Math.random) {
  const length = Array.isArray(words) ? words.length : 0;
  if (!length) return -1;
  if (length === 1) return 0;
  if (mode === 'ordered') return (Math.max(currentIndex, -1) + 1) % length;
  const offset = 1 + Math.floor(randomFn() * (length - 1));
  return (Math.max(currentIndex, 0) + offset) % length;
}

function clampRate(value) {
  return [0.6, 0.8, 1, 1.2].reduce(
    (best, item) => Math.abs(item - value) < Math.abs(best - value) ? item : best,
    1
  );
}

module.exports = { nextReviewIndex, clampRate };
