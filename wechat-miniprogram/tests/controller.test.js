const test = require('node:test');
const assert = require('node:assert/strict');
const { createController } = require('../pages/index/controller');
const { createStorage } = require('../utils/storage');

function memoryStorage() {
  const values = {};
  return {
    getStorageSync(key) { return values[key]; },
    setStorageSync(key, value) { values[key] = value; },
    removeStorageSync(key) { delete values[key]; }
  };
}

function fakeDependencies(options = {}) {
  const persisted = {
    version: 1,
    words: (options.words || []).map((word) => ({ ...word })),
    settings: { mode: 'random', rate: 1 }
  };
  const calls = {
    audioPlay: [],
    audioStop: 0,
    audioDestroy: 0,
    changes: [],
    deletedIds: [],
    settingsPatches: []
  };
  const dependencies = {
    storage: {
      loadState: () => ({
        version: persisted.version,
        words: persisted.words.map((word) => ({ ...word })),
        settings: { ...persisted.settings }
      }),
      saveWord: (word) => {
        const saved = { ...word, id: word.id || `saved-${persisted.words.length + 1}` };
        const index = persisted.words.findIndex((item) => item.word === saved.word);
        if (index === -1) persisted.words.push(saved);
        else persisted.words[index] = { ...persisted.words[index], ...saved };
        return { ...saved };
      },
      deleteWord: (id) => {
        calls.deletedIds.push(id);
        const length = persisted.words.length;
        persisted.words = persisted.words.filter((word) => word.id !== id);
        return persisted.words.length !== length;
      },
      saveSettings: (patch) => {
        calls.settingsPatches.push({ ...patch });
        persisted.settings = { ...persisted.settings, ...patch };
        return { ...persisted.settings };
      }
    },
    lookup: async () => {
      if (options.lookupErrorCode) {
        throw Object.assign(new Error('lookup failed'), { code: options.lookupErrorCode });
      }
      return {
        word: 'tool',
        phonetic: '/tul/',
        meaning: '工具',
        confidence: 'verified',
        warnings: []
      };
    },
    audio: {
      play: async (url, rate) => {
        calls.audioPlay.push({ url, rate });
        if (options.audioFails) throw new Error('播放失败');
      },
      stop: () => { calls.audioStop += 1; },
      destroy: () => { calls.audioDestroy += 1; }
    },
    randomFn: () => 0,
    onChange: (state) => { calls.changes.push(state); }
  };
  return { dependencies, calls, persisted };
}

test('keeps answer hidden until revealAnswer is called', () => {
  const { dependencies } = fakeDependencies({ words: [{ id: '1', word: 'tool' }] });
  const controller = createController(dependencies);
  controller.initialize();
  assert.equal(controller.getState().answerVisible, false);
  controller.revealAnswer();
  assert.equal(controller.getState().answerVisible, true);
});

test('lookup domain errors become actionable Chinese status text', async () => {
  const { dependencies } = fakeDependencies({ lookupErrorCode: 'DOMAIN_NOT_ALLOWED' });
  const controller = createController(dependencies);
  await controller.lookupDraft('tool');
  assert.match(controller.getState().lookupStatus, /合法域名/);
  assert.equal(controller.getState().lookupBusy, false);
});

test('audio failure keeps the same word and clears busy state', async () => {
  const { dependencies } = fakeDependencies({
    words: [{ id: '1', word: 'tool' }],
    audioFails: true
  });
  const controller = createController(dependencies);
  controller.initialize();
  await assert.rejects(() => controller.playCurrent());
  assert.equal(controller.getState().currentWord.id, '1');
  assert.equal(controller.getState().audioBusy, false);
  assert.match(controller.getState().audioStatus, /播放失败.*重试/);
});

test('maps every lookup failure and preserves a manually editable draft', async () => {
  const cases = [
    ['NETWORK_TIMEOUT', /查询超时/],
    ['NOT_FOUND', /检查拼写/],
    ['UNEXPECTED', /手动填写/]
  ];

  for (const [lookupErrorCode, expectedStatus] of cases) {
    const { dependencies } = fakeDependencies({ lookupErrorCode });
    const controller = createController(dependencies);
    const manualDraft = { word: 'tool', phonetic: '', meaning: '' };
    controller.saveDraft(manualDraft);

    assert.equal(await controller.lookupDraft('tool'), null);
    assert.match(controller.getState().lookupStatus, expectedStatus);
    assert.equal(controller.getState().lookupBusy, false);
    assert.equal(controller.getState().draft.word, 'tool');
  }
});

test('rejects an empty word but allows manually blank phonetic and meaning', () => {
  const { dependencies } = fakeDependencies();
  const controller = createController(dependencies);

  assert.throws(() => controller.saveDraft({ word: '   ', meaning: 'ignored' }), /有效单词/);
  const saved = controller.saveDraft({ word: 'tool', phonetic: '', meaning: '' });
  assert.equal(saved.word, 'tool');
  assert.equal(saved.phonetic, '');
  assert.equal(saved.meaning, '');
});

test('moves sequentially, wraps, and hides the next answer', () => {
  const { dependencies } = fakeDependencies({
    words: [{ id: '1', word: 'tool' }, { id: '2', word: 'refresh' }]
  });
  dependencies.storage.loadState = () => ({
    version: 1,
    words: [{ id: '1', word: 'tool' }, { id: '2', word: 'refresh' }],
    settings: { mode: 'sequential', rate: 0.8 }
  });
  const controller = createController(dependencies);
  controller.initialize();
  controller.revealAnswer();

  assert.equal(controller.moveNext().id, '2');
  assert.equal(controller.getState().answerVisible, false);
  assert.equal(controller.moveNext().id, '1');
});

test('moving next cancels in-flight audio before selecting another word', async () => {
  const { dependencies, calls } = fakeDependencies({
    words: [
      { id: '1', word: 'tool', audioUrl: 'https://audio.example/tool.mp3' },
      { id: '2', word: 'refresh', audioUrl: 'https://audio.example/refresh.mp3' }
    ]
  });
  let rejectPlayback;
  dependencies.audio.play = () => new Promise((resolve, reject) => { rejectPlayback = reject; });
  dependencies.audio.stop = () => {
    calls.audioStop += 1;
    const error = Object.assign(new Error('播放已停止'), { code: 'PLAYBACK_CANCELLED' });
    rejectPlayback(error);
  };
  const controller = createController(dependencies);
  controller.initialize();
  const playback = controller.playCurrent();

  controller.moveNext();

  await assert.rejects(playback, (error) => error.code === 'PLAYBACK_CANCELLED');
  assert.equal(calls.audioStop, 1);
  assert.equal(controller.getState().currentWord.id, '2');
  assert.equal(controller.getState().audioBusy, false);
});

test('plays a selected vocabulary row without changing the review word', async () => {
  const words = [
    { id: '1', word: 'tool', audioUrl: 'https://audio.example/tool.mp3' },
    { id: '2', word: 'refresh', audioUrl: 'https://audio.example/refresh.mp3' }
  ];
  const { dependencies, calls } = fakeDependencies({ words });
  const controller = createController(dependencies);
  controller.initialize();

  await controller.playWord('2');

  assert.deepEqual(calls.audioPlay, [{ url: words[1].audioUrl, rate: 1 }]);
  assert.equal(controller.getState().currentWord.id, '1');
  assert.equal(controller.getState().audioStatus, '播放完成');
});

test('lookup while editing preserves identity across a spelling change', async () => {
  const storage = createStorage(memoryStorage());
  const original = storage.saveWord({ word: 'tool', meaning: '工具' });
  const { dependencies } = fakeDependencies();
  dependencies.storage = storage;
  dependencies.lookup = async (word) => ({
    word,
    phonetic: '/ˈɪnstrəmənt/',
    meaning: '器具',
    confidence: 'verified',
    warnings: []
  });
  const controller = createController(dependencies);
  controller.initialize();

  const result = await controller.lookupDraft('instrument', { ...original, word: 'instrument' });
  controller.saveDraft(result);

  const words = storage.loadState().words;
  assert.equal(result.id, original.id);
  assert.equal(words.length, 1);
  assert.equal(words[0].id, original.id);
  assert.equal(words[0].word, 'instrument');
});

test('rejects malformed English input before lookup and save', async () => {
  const { dependencies, calls } = fakeDependencies();
  const controller = createController(dependencies);

  await assert.rejects(() => controller.lookupDraft('to2ol'), /只支持英文字母/);
  assert.throws(() => controller.saveDraft({ word: '-tool' }), /连字符或撇号/);
  assert.equal(calls.changes.length, 0);
});

test('plays the current audio at the saved rate and publishes fresh snapshots', async () => {
  const word = { id: '1', word: 'tool', audioUrl: 'https://audio.example/tool.mp3' };
  const { dependencies, calls } = fakeDependencies({ words: [word] });
  dependencies.storage.loadState = () => ({
    version: 1,
    words: [word],
    settings: { mode: 'random', rate: 0.8 }
  });
  const controller = createController(dependencies);
  controller.initialize();

  await controller.playCurrent();

  assert.deepEqual(calls.audioPlay, [{ url: word.audioUrl, rate: 0.8 }]);
  assert.equal(calls.changes.at(-2).audioBusy, true);
  assert.equal(calls.changes.at(-1).audioBusy, false);
  assert.notEqual(calls.changes.at(-2), calls.changes.at(-1));
});

test('destroy releases audio and clears a pending busy state', async () => {
  let finishPlayback;
  const { dependencies, calls } = fakeDependencies({
    words: [{ id: '1', word: 'tool', audioUrl: 'https://audio.example/tool.mp3' }]
  });
  dependencies.audio.play = () => new Promise((resolve) => { finishPlayback = resolve; });
  const controller = createController(dependencies);
  controller.initialize();
  const playback = controller.playCurrent();

  controller.destroy();
  assert.equal(calls.audioDestroy, 1);
  assert.equal(controller.getState().audioBusy, false);

  finishPlayback();
  await playback;
});

test('getState protects controller state from consumer mutation', () => {
  const { dependencies } = fakeDependencies({ words: [{ id: '1', word: 'tool' }] });
  const controller = createController(dependencies);
  controller.initialize();
  const exposed = controller.getState();
  exposed.words[0].word = 'changed';
  exposed.settings.rate = 9;

  assert.equal(controller.getState().currentWord.word, 'tool');
  assert.equal(controller.getState().settings.rate, 1);
});

test('getState protects lookup warnings from consumer mutation', async () => {
  const { dependencies } = fakeDependencies();
  const controller = createController(dependencies);
  await controller.lookupDraft('tool');
  const exposed = controller.getState();
  exposed.draft.warnings.push('changed');

  assert.deepEqual(controller.getState().draft.warnings, []);
});

test('renames and deletes the current word through real storage without data loss', () => {
  const storage = createStorage(memoryStorage());
  const original = storage.saveWord({ word: 'tool', meaning: '工具' });
  const unrelated = storage.saveWord({ word: 'refresh', meaning: '刷新' });
  const { dependencies } = fakeDependencies();
  dependencies.storage = storage;
  const controller = createController(dependencies);
  controller.initialize();

  controller.saveDraft({ ...original, word: 'instrument', meaning: '器具' });

  assert.deepEqual(controller.getState().words, dependencies.storage.loadState().words);
  assert.deepEqual(controller.getState().words.map((word) => word.word), ['instrument', 'refresh']);
  assert.equal(new Set(controller.getState().words.map((word) => word.id)).size, 2);
  assert.equal(controller.getState().currentWord.id, original.id);
  assert.equal(controller.getState().currentWord.word, 'instrument');

  assert.equal(controller.deleteWord(original.id), true);
  assert.deepEqual(controller.getState().words.map((word) => word.word), ['refresh']);
  assert.equal(controller.getState().currentWord.id, unrelated.id);
  assert.deepEqual(storage.loadState().words.map((word) => word.word), ['refresh']);
});

test('keeps controller and real storage unchanged when a rename collides', () => {
  const storage = createStorage(memoryStorage());
  const original = storage.saveWord({ word: 'tool', meaning: '工具' });
  const unrelated = storage.saveWord({ word: 'refresh', meaning: '刷新' });
  const { dependencies } = fakeDependencies();
  dependencies.storage = storage;
  const controller = createController(dependencies);
  controller.initialize();
  const controllerBefore = controller.getState();
  const storageBefore = storage.loadState();

  assert.throws(
    () => controller.saveDraft({ ...original, word: 'REFRESH', meaning: '冲突' }),
    (error) => error.message === '词库中已存在这个单词'
  );

  assert.deepEqual(controller.getState().words, controllerBefore.words);
  assert.equal(controller.getState().currentWord.id, original.id);
  assert.equal(controller.getState().currentWord.word, 'tool');
  assert.deepEqual(storage.loadState(), storageBefore);
  assert.equal(storage.loadState().words.find((word) => word.id === unrelated.id).word, 'refresh');
});

test('deleteWord reloads storage and safely selects the word at the deleted position', () => {
  const words = [
    { id: '1', word: 'tool' },
    { id: '2', word: 'refresh' },
    { id: '3', word: 'resilient' }
  ];
  const { dependencies, calls } = fakeDependencies({ words });
  dependencies.storage.saveSettings({ mode: 'sequential' });
  const controller = createController(dependencies);
  controller.initialize();
  controller.moveNext();

  assert.equal(controller.deleteWord('2'), true);
  assert.deepEqual(calls.deletedIds, ['2']);
  assert.deepEqual(controller.getState().words, dependencies.storage.loadState().words);
  assert.equal(controller.getState().currentIndex, 1);
  assert.equal(controller.getState().currentWord.id, '3');
});

test('updateSettings reloads and publishes persisted settings', () => {
  const { dependencies, calls, persisted } = fakeDependencies({
    words: [{ id: '1', word: 'tool' }]
  });
  dependencies.storage.saveSettings = (patch) => {
    calls.settingsPatches.push({ ...patch });
    persisted.settings = { mode: 'sequential', rate: 0.8 };
    return { mode: patch.mode, rate: 99 };
  };
  const controller = createController(dependencies);
  controller.initialize();

  const settings = controller.updateSettings({ mode: 'sequential', rate: 0.81 });

  assert.deepEqual(calls.settingsPatches, [{ mode: 'sequential', rate: 0.81 }]);
  assert.deepEqual(settings, { mode: 'sequential', rate: 0.8 });
  assert.deepEqual(controller.getState().settings, dependencies.storage.loadState().settings);
  assert.deepEqual(calls.changes.at(-1).settings, { mode: 'sequential', rate: 0.8 });
});
