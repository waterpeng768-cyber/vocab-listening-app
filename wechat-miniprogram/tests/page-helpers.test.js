const test = require('node:test');
const assert = require('node:assert/strict');
const {
  blankDraft,
  filterWords,
  pageStateFromController,
  updateDraftField
} = require('../pages/index/page-helpers');

test('maps controller state to stable review display values', () => {
  const state = pageStateFromController({
    words: [{ id: '1', word: 'Tool' }],
    settings: { mode: 'sequential', rate: 0.8 },
    currentWord: { id: '1', word: 'Tool' },
    answerVisible: false,
    lookupBusy: false,
    lookupStatus: '',
    audioBusy: true,
    draft: null
  });

  assert.deepEqual(state.words, [{ id: '1', word: 'Tool' }]);
  assert.equal(state.wordCount, 1);
  assert.equal(state.audioStatus, '正在播放美音...');
  assert.equal(state.mode, 'sequential');
  assert.equal(state.rate, 0.8);
  assert.equal(Object.hasOwn(state, 'draft'), false);
});

test('maps a lookup result to an editable copy', () => {
  const draft = { word: 'tool', phonetic: '/tuːl/', warnings: ['请核对'] };
  const state = pageStateFromController({
    words: [], settings: { mode: 'random', rate: 1 }, currentWord: null,
    answerVisible: false, lookupBusy: false, lookupStatus: '已找到', audioBusy: false, draft
  });

  assert.deepEqual(state.draft, draft);
  assert.notEqual(state.draft, draft);
  assert.notEqual(state.draft.warnings, draft.warnings);
});

test('updates only an allowed draft field without mutating the old draft', () => {
  const original = { ...blankDraft(), word: 'tool' };
  const updated = updateDraftField(original, 'phonetic', ' /tuːl/ ');

  assert.equal(original.phonetic, '');
  assert.equal(updated.word, 'tool');
  assert.equal(updated.phonetic, ' /tuːl/ ');
  assert.equal(updateDraftField(original, 'id', 'changed'), original);
});

test('filters words case-insensitively by word, phonetic, or meaning', () => {
  const words = [
    { id: '1', word: 'Tool', phonetic: '/tuːl/', meaning: '工具' },
    { id: '2', word: 'Refresh', phonetic: '/rɪˈfreʃ/', meaning: '刷新' }
  ];

  assert.deepEqual(filterWords(words, 'TOO').map((word) => word.id), ['1']);
  assert.deepEqual(filterWords(words, '刷新').map((word) => word.id), ['2']);
  assert.deepEqual(filterWords(words, 'freʃ').map((word) => word.id), ['2']);
  assert.notEqual(filterWords(words, ''), words);
});
