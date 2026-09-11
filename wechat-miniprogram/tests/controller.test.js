const test = require('node:test');
const assert = require('node:assert/strict');
const { createController } = require('../pages/index/controller');

function fakeDependencies(options = {}) {
  const words = options.words || [];
  const calls = { audioPlay: [], audioDestroy: 0, changes: [] };
  const dependencies = {
    storage: {
      loadState: () => ({ version: 1, words, settings: { mode: 'random', rate: 1 } }),
      saveWord: (word) => word,
      deleteWord: () => words,
      saveSettings: () => undefined
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
      destroy: () => { calls.audioDestroy += 1; }
    },
    randomFn: () => 0,
    onChange: (state) => { calls.changes.push(state); }
  };
  return { dependencies, calls };
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
  assert.deepEqual(
    controller.saveDraft({ word: 'tool', phonetic: '', meaning: '' }),
    { word: 'tool', phonetic: '', meaning: '' }
  );
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
