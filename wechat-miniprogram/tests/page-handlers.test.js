const test = require('node:test');
const assert = require('node:assert/strict');

function loadPageDefinition() {
  let definition;
  const previousPage = global.Page;
  global.Page = (value) => { definition = value; };
  const modulePath = require.resolve('../pages/index/index');
  delete require.cache[modulePath];
  require(modulePath);
  global.Page = previousPage;
  return definition;
}

function pageHarness(overrides = {}) {
  const definition = loadPageDefinition();
  const page = {
    ...definition,
    data: {
      ...definition.data,
      draft: { ...definition.data.draft },
      words: [],
      ...overrides.data
    },
    setData(patch) { this.data = { ...this.data, ...patch }; },
    controller: overrides.controller
  };
  return page;
}

test('lookup passes the complete editing draft so its id is retained', async () => {
  const calls = [];
  const draft = { id: 'word-1', word: 'instrument', meaning: '工具' };
  const page = pageHarness({
    data: { draft },
    controller: { lookupDraft: async (...args) => calls.push(args) }
  });

  await page.onLookup();

  assert.deepEqual(calls, [['instrument', draft]]);
});

test('invalid input stops lookup and shows actionable Chinese feedback', async (t) => {
  const calls = [];
  const previousWx = global.wx;
  t.after(() => { global.wx = previousWx; });
  global.wx = { showToast: (options) => calls.push(options) };
  const page = pageHarness({
    data: { draft: { word: 'tool2' } },
    controller: { lookupDraft: async () => assert.fail('lookup must not run') }
  });

  await page.onLookup();

  assert.match(calls[0].title, /只支持英文字母/);
});

test('invalid input stops save before controller persistence', (t) => {
  const calls = [];
  const previousWx = global.wx;
  t.after(() => { global.wx = previousWx; });
  global.wx = { showToast: (options) => calls.push(options) };
  const page = pageHarness({
    data: { draft: { word: 'tool--box' } },
    controller: { saveDraft: () => assert.fail('save must not run') }
  });

  page.onSave();

  assert.match(calls[0].title, /连字符或撇号/);
});

test('next handler delegates selection to the controller', () => {
  let moveCalls = 0;
  const page = pageHarness({
    controller: { moveNext: () => { moveCalls += 1; } }
  });

  page.onNext();

  assert.equal(moveCalls, 1);
});

test('row play handler requests audio for that vocabulary id', async () => {
  const calls = [];
  const page = pageHarness({
    controller: { playWord: async (id) => calls.push(id) }
  });

  await page.onPlayWord({ currentTarget: { dataset: { id: 'word-2' } } });

  assert.deepEqual(calls, ['word-2']);
});

test('shows exactly the four supported playback rates', () => {
  const page = pageHarness();
  assert.deepEqual(page.data.rateOptions, [0.6, 0.8, 1, 1.2]);
});

test('normal page lookup writes and then reuses the versioned cache', async (t) => {
  const previousWx = global.wx;
  t.after(() => { global.wx = previousWx; });
  const values = {};
  let requestCount = 0;
  const audioContext = {
    stop() {}, play() {}, destroy() {},
    onEnded() {}, onError() {}, offEnded() {}, offError() {}
  };
  global.wx = {
    getStorageSync: (key) => values[key],
    setStorageSync: (key, value) => { values[key] = value; },
    createInnerAudioContext: () => audioContext,
    request(options) {
      requestCount += 1;
      options.success({
        statusCode: 200,
        data: {
          entries: [{
            pronunciations: [{ transcription: '/tul/', tags: ['US'] }],
            translations: [{ language: 'zh-CN', text: '工具' }]
          }]
        }
      });
    }
  };
  const page = pageHarness({ data: { draft: { word: 'tool' } } });
  page.onLoad();

  await page.onLookup();
  await page.onLookup();

  assert.equal(requestCount, 1);
  assert.equal(values['vocab-listening-lookup-cache-v1'].version, 1);
  assert.equal(values['vocab-listening-lookup-cache-v1'].entries.tool.word, 'tool');
  page.onUnload();
});
