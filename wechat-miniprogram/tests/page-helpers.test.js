const test = require('node:test');
const assert = require('node:assert/strict');
const {
  blankDraft,
  filterWords,
  pageStateFromController,
  validateEnglishWord,
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

test('accepts letters with internal hyphens and apostrophes only', () => {
  for (const word of ['tool', 'Mother-in-law', "don't", "rock'n'roll"]) {
    assert.equal(validateEnglishWord(word), '');
  }

  assert.match(validateEnglishWord('工具'), /只支持英文字母/);
  assert.match(validateEnglishWord('tool2'), /只支持英文字母/);
  for (const word of ['-tool', 'tool-', "'tool", "tool'", 'tool--box', "tool''box"]) {
    assert.match(validateEnglishWord(word), /连字符或撇号/);
  }
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

test('keeps a useful playback failure status in page state', () => {
  const state = pageStateFromController({
    words: [], settings: {}, currentWord: null, answerVisible: false,
    lookupBusy: false, lookupStatus: '', audioBusy: false,
    audioStatus: '美音播放失败，请检查网络后重试'
  });

  assert.equal(state.audioStatus, '美音播放失败，请检查网络后重试');
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
