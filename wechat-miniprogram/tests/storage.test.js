const test = require('node:test');
const assert = require('node:assert/strict');
const { createStorage } = require('../utils/storage');

function memoryStorage(initial = {}) {
  const values = { ...initial };
  const writes = [];
  return {
    getStorageSync(key) { return values[key]; },
    setStorageSync(key, value) {
      writes.push({ key, value });
      values[key] = value;
    },
    removeStorageSync(key) { delete values[key]; },
    values,
    writes
  };
}

test('updates a duplicate word instead of adding another row', () => {
  const service = createStorage(memoryStorage());
  const original = service.saveWord({
    word: 'Tool',
    phonetic: '/tul/',
    meaning: '工具',
    confidence: 'verified'
  });
  const updated = service.saveWord({
    word: ' tool ',
    phonetic: '/tul/',
    meaning: '工具；用具',
    confidence: 'manual'
  });

  const state = service.loadState();
  assert.equal(state.words.length, 1);
  assert.equal(state.words[0].meaning, '工具；用具');
  assert.equal(updated.id, original.id);
  assert.equal(updated.createdAt, original.createdAt);
});

test('renames an existing word by id without creating a duplicate id', () => {
  const service = createStorage(memoryStorage());
  const original = service.saveWord({ word: 'tool', meaning: '工具' });

  const renamed = service.saveWord({
    id: original.id,
    word: 'instrument',
    meaning: '器具',
    createdAt: original.createdAt,
    updatedAt: original.updatedAt + 1
  });

  const state = service.loadState();
  assert.equal(state.words.length, 1);
  assert.equal(state.words[0].word, 'instrument');
  assert.equal(state.words[0].id, original.id);
  assert.equal(state.words[0].createdAt, original.createdAt);
  assert.equal(renamed.id, original.id);
});

test('rejects renaming an id onto a word owned by another id without writing', () => {
  const memory = memoryStorage();
  const service = createStorage(memory);
  const original = service.saveWord({ word: 'tool', meaning: '工具' });
  service.saveWord({ word: 'refresh', meaning: '刷新' });
  const before = service.loadState();
  const writesBeforeRename = memory.writes.length;

  assert.throws(
    () => service.saveWord({ ...original, word: ' Refresh ', meaning: '冲突' }),
    (error) => error.message === '词库中已存在这个单词'
  );
  assert.equal(memory.writes.length, writesBeforeRename);
  assert.deepEqual(service.loadState(), before);
});

test('rejects invalid backup without replacing current words', () => {
  const memory = memoryStorage();
  const service = createStorage(memory);
  service.saveWord({ word: 'tool', meaning: '工具' });
  const writesBeforeImport = memory.writes.length;

  assert.throws(() => service.importBackup('{broken'), /备份格式不正确/);
  assert.equal(memory.writes.length, writesBeforeImport);
  assert.equal(service.loadState().words[0].word, 'tool');
});

test('rejects a parsed backup without words before writing', () => {
  const memory = memoryStorage();
  const service = createStorage(memory);

  assert.throws(() => service.importBackup('{"version":1}'), /备份中没有有效词库/);
  assert.equal(memory.writes.length, 0);
});

test('rejects an import with no valid rows without changing current state', () => {
  const current = {
    version: 1,
    words: [{ word: 'tool', meaning: '工具' }],
    settings: { mode: 'random', rate: 1 }
  };
  const memory = memoryStorage({ 'vocab-listening-state-v1': current });
  const service = createStorage(memory);

  assert.throws(
    () => service.importBackup(JSON.stringify({ words: [{ word: '   ' }, null, {}] })),
    /备份中没有有效词库/
  );
  assert.equal(memory.writes.length, 0);
  assert.deepEqual(memory.values['vocab-listening-state-v1'], current);
});

test('migrates a legacy bare array and keeps valid rows', () => {
  const memory = memoryStorage({
    'vocab-listening-words': [
      { word: 'Refresh', phonetic: '[rɪˈfrɛʃ]', meaning: '刷新' },
      { word: '   ', meaning: '无效' }
    ]
  });
  const state = createStorage(memory).loadState();

  assert.equal(state.version, 1);
  assert.equal(state.words.length, 1);
  assert.equal(state.words[0].word, 'refresh');
  assert.equal(state.words[0].phonetic, '/rɪˈfrɛʃ/');
});

test('migrates the actual prior web storage key', () => {
  const memory = memoryStorage({
    'vocab-listening-words-v5': [
      { word: 'Subtle', phonetic: '[ˈsʌtəl]', meaning: '微妙的' }
    ]
  });

  const state = createStorage(memory).loadState();

  assert.equal(state.words.length, 1);
  assert.equal(state.words[0].word, 'subtle');
});

test('current versioned state takes priority over both legacy keys', () => {
  const memory = memoryStorage({
    'vocab-listening-state-v1': {
      version: 1,
      words: [{ word: 'Current', meaning: '当前' }],
      settings: { mode: 'sequential', rate: 0.8 }
    },
    'vocab-listening-words': [{ word: 'Older', meaning: '旧' }],
    'vocab-listening-words-v5': [{ word: 'Old', meaning: '旧网页' }]
  });

  const state = createStorage(memory).loadState();

  assert.deepEqual(state.words.map((item) => item.word), ['current']);
  assert.deepEqual(state.settings, { mode: 'sequential', rate: 0.8 });
});

test('recovers legacy words when the current versioned state is damaged', () => {
  const memory = memoryStorage({
    'vocab-listening-state-v1': { version: 1, words: 'damaged' },
    'vocab-listening-words-v5': [
      { word: 'Resilient', phonetic: '[rɪˈzɪliənt]', meaning: '有复原力的' }
    ]
  });

  const state = createStorage(memory).loadState();

  assert.deepEqual(state.words.map((item) => item.word), ['resilient']);
  assert.equal(state.words[0].phonetic, '/rɪˈzɪliənt/');
});

test('recovers legacy words when non-empty current rows are all corrupt', () => {
  const memory = memoryStorage({
    'vocab-listening-state-v1': { version: 1, words: [null, {}, { word: '   ' }] },
    'vocab-listening-words': [
      { word: 'Refresh', phonetic: '[rɪˈfrɛʃ]', meaning: '刷新' }
    ]
  });

  const state = createStorage(memory).loadState();

  assert.deepEqual(state.words.map((item) => item.word), ['refresh']);
  assert.equal(state.words[0].phonetic, '/rɪˈfrɛʃ/');
});

test('accepts the version 5 web backup and merges without replacing local words', () => {
  const service = createStorage(memoryStorage());
  const original = service.saveWord({ word: 'tool', meaning: '工具' });

  const merged = service.importBackup(JSON.stringify({
    app: 'vocab-listening-app',
    version: 5,
    words: [
      { word: ' Tool ', phonetic: '[tul]', meaning: '工具；用具' },
      { word: 'Refresh', phonetic: '/rɪˈfrɛʃ/', meaning: '刷新' }
    ]
  }));

  assert.equal(merged.length, 2);
  const tool = merged.find((item) => item.word === 'tool');
  assert.equal(tool.id, original.id);
  assert.equal(tool.createdAt, original.createdAt);
  assert.equal(tool.meaning, '工具；用具');
  assert.equal(merged.find((item) => item.word === 'refresh').phonetic, '/rɪˈfrɛʃ/');
});

test('persists deletion and settings while exporting a versioned backup', () => {
  const service = createStorage(memoryStorage());
  const saved = service.saveWord({ word: 'tool', meaning: '工具' });
  service.saveWord({ word: 'refresh', meaning: '刷新' });

  assert.equal(service.deleteWord(saved.id), true);
  const settings = service.saveSettings({ mode: 'sequential', rate: 0.8 });
  const backup = JSON.parse(service.exportBackup());

  assert.deepEqual(settings, { mode: 'sequential', rate: 0.8 });
  assert.equal(backup.app, 'vocab-listening-app');
  assert.equal(backup.version, 1);
  assert.deepEqual(backup.words.map((item) => item.word), ['refresh']);
});

test('reads and writes lookup cache by normalized word', () => {
  const service = createStorage(memoryStorage());
  const result = { word: 'tool', phonetic: '/tul/', meaning: '工具' };

  service.writeLookupCache(' Tool ', result);

  assert.deepEqual(service.readLookupCache('tool'), result);
  assert.equal(service.readLookupCache('missing'), null);
});
