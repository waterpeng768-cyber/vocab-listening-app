# 微信听音背单词小程序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有仓库中新增一个可导入微信开发者工具、可自行录词、自动查询美式音标和中文释义并进行听音复习的原生微信小程序。

**Architecture:** 旧网页保留在仓库根目录，新版本完全放入 `wechat-miniprogram/`。微信页面只负责交互，音标、词典、存储和复习规则拆成 CommonJS 纯逻辑模块，既能被微信运行时调用，也能用 Node 内置测试运行器验证。

**Tech Stack:** 微信原生小程序（WXML/WXSS/JavaScript）、CommonJS、`wx.request`、`wx.createInnerAudioContext`、`wx.*StorageSync`、Node `node:test`。

**Spec:** `docs/superpowers/specs/2026-09-11-wechat-vocab-listening-design.md`

## Global Constraints

- 不预置“常见英语 900 词”，只保存用户自行录入的词。
- 现有根目录网页版本不得删除、改名或改写。
- 音标只把明确标记为 `US`、`American` 或 `en-US` 的候选认定为美音；只有英国候选时必须留空并提示核对。
- 中文机器翻译必须标记为 `review`，不得伪装成已核实释义。
- 所有词条保存前均允许用户修改；查询失败不能阻止手动录入。
- 本地存储升级不得清空已有词库；无效导入不得覆盖现有数据。
- 不增加 npm 运行时依赖；测试使用 Node 内置 `node:test`。
- 正式发布所需的微信主体认证、AppID、合法域名配置及审核不属于源码交付范围。

---

### Task 1: 小程序骨架与美式音标规则

**Files:**
- Create: `wechat-miniprogram/project.config.json`
- Create: `wechat-miniprogram/app.js`
- Create: `wechat-miniprogram/app.json`
- Create: `wechat-miniprogram/app.wxss`
- Create: `wechat-miniprogram/sitemap.json`
- Create: `wechat-miniprogram/package.json`
- Create: `wechat-miniprogram/utils/phonetics.js`
- Create: `wechat-miniprogram/tests/phonetics.test.js`

**Interfaces:**
- Consumes: 无。
- Produces: `normalizeWord(value): string`、`normalizePhonetic(value): string`、`classifyAccent(value): 'us' | 'uk' | 'generic'`、`pickAmericanPhonetic(candidates): { phonetic: string, accent: string }`。

- [ ] **Step 1: 写音标规则的失败测试**

```js
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
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `cd wechat-miniprogram; node --test tests/phonetics.test.js`

Expected: FAIL，错误包含 `Cannot find module '../utils/phonetics'`。

- [ ] **Step 3: 实现最小音标模块和可导入项目骨架**

```js
function normalizeWord(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizePhonetic(value) {
  const inner = String(value || '').trim()
    .replace(/^[\/\[]+/, '')
    .replace(/[\/\]]+$/, '')
    .trim();
  return inner ? `/${inner}/` : '';
}

function classifyAccent(value) {
  const label = String(value || '').toLowerCase();
  if (/(^|[^a-z])(us|usa|american|en-us)([^a-z]|$)/.test(label)) return 'us';
  if (/(^|[^a-z])(uk|british|england|en-gb)([^a-z]|$)/.test(label)) return 'uk';
  return 'generic';
}

function pickAmericanPhonetic(candidates) {
  const valid = (Array.isArray(candidates) ? candidates : [])
    .map((item) => ({ phonetic: normalizePhonetic(item.value), accent: classifyAccent(item.region) }))
    .filter((item) => item.phonetic);
  const us = valid.find((item) => item.accent === 'us');
  if (us) return us;
  const generic = valid.find((item) => item.accent === 'generic');
  if (generic) return generic;
  return valid.length ? { phonetic: '', accent: 'uk-only' } : { phonetic: '', accent: 'missing' };
}

module.exports = { normalizeWord, normalizePhonetic, classifyAccent, pickAmericanPhonetic };
```

`project.config.json` 使用 `appid: "touristappid"`、`compileType: "miniprogram"`、`miniprogramRoot: "./"`；`app.json` 只注册 `pages/index/index`，并设置导航栏标题“听音背单词”。

- [ ] **Step 4: 运行测试并检查配置 JSON**

Run: `cd wechat-miniprogram; node --test tests/phonetics.test.js; node -e "JSON.parse(require('fs').readFileSync('project.config.json','utf8')); JSON.parse(require('fs').readFileSync('app.json','utf8')); console.log('config ok')"`

Expected: 3 tests PASS，最后输出 `config ok`。

- [ ] **Step 5: 提交骨架和音标规则**

```bash
git add wechat-miniprogram
git commit -m "feat: scaffold WeChat mini program phonetics"
```

### Task 2: 词典解析、来源分级与联网查询

**Files:**
- Create: `wechat-miniprogram/config/services.js`
- Create: `wechat-miniprogram/services/request.js`
- Create: `wechat-miniprogram/services/dictionary.js`
- Create: `wechat-miniprogram/tests/dictionary.test.js`
- Create: `wechat-miniprogram/tests/request.test.js`

**Interfaces:**
- Consumes: `normalizeWord`、`normalizePhonetic`、`pickAmericanPhonetic`。
- Produces: `collectCandidates(payload): Array`、`parseDictionaryPayload(payload, word): LookupResult`、`lookupWord(word, request): Promise<LookupResult>`、`requestJson(options): Promise<object>`。
- `LookupResult` 固定为 `{ word, phonetic, meaning, audioUrl, source, confidence, warnings }`。

- [ ] **Step 1: 写回归测试和请求错误测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { collectCandidates, parseDictionaryPayload, lookupWord } = require('../services/dictionary');

test('parses tool with US IPA and Chinese dictionary meaning', () => {
  const payload = {
    entries: [{
      pronunciations: [
        { transcription: '/tuːl/', tags: ['UK'] },
        { transcription: '/tul/', tags: ['US'], audio: { url: 'https://audio.example/tool-us.mp3' } }
      ],
      senses: [{ translations: [{ language: 'zh-CN', text: '工具；用具' }] }]
    }]
  };
  const result = parseDictionaryPayload(payload, 'tool');
  assert.equal(result.phonetic, '/tul/');
  assert.match(result.meaning, /工具/);
  assert.equal(result.audioUrl, 'https://audio.example/tool-us.mp3');
  assert.equal(result.confidence, 'verified');
});

test('walks nested arrays without losing the visitor callback', () => {
  const payload = { a: [{ b: [{ pronunciation: { text: '/rɪˈfrɛʃ/', region: 'US' } }] }] };
  assert.doesNotThrow(() => collectCandidates(payload));
  assert.equal(parseDictionaryPayload(payload, 'refresh').phonetic, '/rɪˈfrɛʃ/');
});

test('marks machine-translated meaning for review', async () => {
  const fakeRequest = async ({ url }) => url.includes('freedictionaryapi')
    ? { entries: [{ pronunciations: [{ transcription: '/tul/', tags: ['US'] }] }] }
    : { responseData: { translatedText: '工具' } };
  const result = await lookupWord('tool', fakeRequest);
  assert.equal(result.meaning, '工具');
  assert.equal(result.confidence, 'review');
  assert.match(result.warnings.join(' '), /机器翻译/);
});
```

`request.test.js` 用伪造的 `wx.request` 分别模拟成功、超时、404 和“url not in domain list”，断言错误码依次为 `OK`、`NETWORK_TIMEOUT`、`NOT_FOUND`、`DOMAIN_NOT_ALLOWED`。

- [ ] **Step 2: 运行测试并确认词典和请求模块尚不存在**

Run: `cd wechat-miniprogram; node --test tests/dictionary.test.js tests/request.test.js`

Expected: FAIL，错误包含 `Cannot find module '../services/dictionary'`。

- [ ] **Step 3: 实现可递归解析的词典模块**

```js
function walk(value, visitor, key = '', parent = null) {
  visitor(value, key, parent);
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visitor, key, value));
  } else if (value && typeof value === 'object') {
    Object.keys(value).forEach((childKey) => walk(value[childKey], visitor, childKey, value));
  }
}
```

`collectCandidates` 必须从嵌套响应中收集 IPA、地区标签、音频和中文翻译；`parseDictionaryPayload` 调用 `pickAmericanPhonetic`，US 音频只能绑定到 US 候选；`lookupWord` 依次请求 FreeDictionaryAPI 和 MyMemory，前者有可靠中文释义时返回 `verified`，后者只能返回 `review`。服务地址集中在 `config/services.js`，美式 TTS 模板使用 `type=2` 并作为音频备用地址。

- [ ] **Step 4: 实现微信请求封装**

```js
function createRequestJson(wxApi) {
  return function requestJson({ url, timeout = 8000 }) {
    return new Promise((resolve, reject) => wxApi.request({
      url,
      timeout,
      success(response) {
        if (response.statusCode === 404) return reject(Object.assign(new Error('未找到单词'), { code: 'NOT_FOUND' }));
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(Object.assign(new Error('词典服务暂时不可用'), { code: 'HTTP_ERROR' }));
        resolve(response.data);
      },
      fail(error) {
        const message = String(error && error.errMsg || '');
        const code = /domain list/i.test(message) ? 'DOMAIN_NOT_ALLOWED' : /timeout/i.test(message) ? 'NETWORK_TIMEOUT' : 'NETWORK_ERROR';
        reject(Object.assign(new Error(message), { code }));
      }
    }));
  };
}
```

- [ ] **Step 5: 运行全部词典测试**

Run: `cd wechat-miniprogram; node --test tests/phonetics.test.js tests/dictionary.test.js tests/request.test.js`

Expected: 所有测试 PASS，`tool` 和 `refresh` 回归测试通过，英国候选不会被标成美音。

- [ ] **Step 6: 提交词典服务**

```bash
git add wechat-miniprogram/config wechat-miniprogram/services wechat-miniprogram/tests
git commit -m "feat: add verified American dictionary lookup"
```

### Task 3: 本地词库、缓存迁移与安全导入

**Files:**
- Create: `wechat-miniprogram/utils/storage.js`
- Create: `wechat-miniprogram/tests/storage.test.js`

**Interfaces:**
- Consumes: `normalizeWord`、`normalizePhonetic`。
- Produces: `createStorage(wxStorage): StorageService`；服务公开 `loadState()`、`saveWord(input)`、`deleteWord(id)`、`saveSettings(settings)`、`exportBackup()`、`importBackup(text)`、`readLookupCache(word)`、`writeLookupCache(word, result)`。

- [ ] **Step 1: 写存储和导入的失败测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStorage } = require('../utils/storage');

function memoryStorage(initial = {}) {
  const values = { ...initial };
  return {
    getStorageSync(key) { return values[key]; },
    setStorageSync(key, value) { values[key] = value; },
    removeStorageSync(key) { delete values[key]; }
  };
}

test('updates a duplicate word instead of adding another row', () => {
  const service = createStorage(memoryStorage());
  service.saveWord({ word: 'Tool', phonetic: '/tul/', meaning: '工具', confidence: 'verified' });
  service.saveWord({ word: ' tool ', phonetic: '/tul/', meaning: '工具；用具', confidence: 'manual' });
  const state = service.loadState();
  assert.equal(state.words.length, 1);
  assert.equal(state.words[0].meaning, '工具；用具');
});

test('rejects invalid backup without replacing current words', () => {
  const service = createStorage(memoryStorage());
  service.saveWord({ word: 'tool', meaning: '工具' });
  assert.throws(() => service.importBackup('{broken'), /备份格式不正确/);
  assert.equal(service.loadState().words[0].word, 'tool');
});

test('migrates a legacy bare array and keeps valid rows', () => {
  const memory = memoryStorage({ 'vocab-listening-words': [{ word: 'Refresh', phonetic: '[rɪˈfrɛʃ]', meaning: '刷新' }] });
  const state = createStorage(memory).loadState();
  assert.equal(state.version, 1);
  assert.equal(state.words[0].phonetic, '/rɪˈfrɛʃ/');
});
```

- [ ] **Step 2: 运行测试并确认缺少存储模块**

Run: `cd wechat-miniprogram; node --test tests/storage.test.js`

Expected: FAIL，错误包含 `Cannot find module '../utils/storage'`。

- [ ] **Step 3: 实现版本化本地状态和不可破坏的导入**

状态键固定为 `vocab-listening-state-v1`，查询缓存键固定为 `vocab-listening-lookup-cache-v1`。`importBackup` 先完整解析、验证和规范化到临时变量，确认至少包含合法 `words` 数组后再合并写入；任何异常都不得调用 `setStorageSync` 覆盖现有状态。`saveWord` 以规范化后的 `word` 去重，并保留原条目的 `id` 与 `createdAt`。

```js
const STATE_KEY = 'vocab-listening-state-v1';
const CACHE_KEY = 'vocab-listening-lookup-cache-v1';

function createStorage(wxStorage) {
  function readState() {
    const current = wxStorage.getStorageSync(STATE_KEY);
    if (current && current.version === 1 && Array.isArray(current.words)) return sanitizeState(current);
    const legacy = wxStorage.getStorageSync('vocab-listening-words');
    return sanitizeState({ version: 1, words: Array.isArray(legacy) ? legacy : [], settings: { mode: 'random', rate: 1 } });
  }

  function importBackup(text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { throw new Error('备份格式不正确'); }
    if (!parsed || !Array.isArray(parsed.words)) throw new Error('备份中没有有效词库');
    const incoming = sanitizeState({ version: 1, words: parsed.words }).words;
    const merged = mergeWords(readState().words, incoming);
    wxStorage.setStorageSync(STATE_KEY, { ...readState(), words: merged });
    return merged;
  }

  return { loadState: readState, saveWord, deleteWord, saveSettings, exportBackup, importBackup, readLookupCache, writeLookupCache };
}
```

- [ ] **Step 4: 运行存储测试及全部现有测试**

Run: `cd wechat-miniprogram; node --test tests/*.test.js`

Expected: 所有测试 PASS。

- [ ] **Step 5: 提交存储模块**

```bash
git add wechat-miniprogram/utils/storage.js wechat-miniprogram/tests/storage.test.js
git commit -m "feat: persist and migrate local vocabulary"
```

### Task 4: 随机与顺序复习逻辑

**Files:**
- Create: `wechat-miniprogram/utils/review.js`
- Create: `wechat-miniprogram/tests/review.test.js`

**Interfaces:**
- Consumes: 词条数组与设置 `{ mode: 'random' | 'ordered', rate: number }`。
- Produces: `nextReviewIndex(words, currentIndex, mode, randomFn): number`、`clampRate(value): number`。

- [ ] **Step 1: 写复习规则失败测试**

```js
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

test('rate remains within the supported range', () => {
  assert.equal(clampRate(0.2), 0.6);
  assert.equal(clampRate(2), 1.2);
});
```

- [ ] **Step 2: 运行测试并确认缺少复习模块**

Run: `cd wechat-miniprogram; node --test tests/review.test.js`

Expected: FAIL，错误包含 `Cannot find module '../utils/review'`。

- [ ] **Step 3: 实现可注入随机函数的纯逻辑模块**

`nextReviewIndex` 在空数组时返回 `-1`；顺序模式循环递增；随机模式把随机偏移限定在 `1..length-1`，从算法上避免立即重复。`clampRate` 只允许 `0.6`、`0.8`、`1.0`、`1.2` 四档并选择最近值。

```js
function nextReviewIndex(words, currentIndex, mode, randomFn = Math.random) {
  const length = Array.isArray(words) ? words.length : 0;
  if (!length) return -1;
  if (length === 1) return 0;
  if (mode === 'ordered') return (Math.max(currentIndex, -1) + 1) % length;
  const offset = 1 + Math.floor(randomFn() * (length - 1));
  return ((Math.max(currentIndex, 0) + offset) % length);
}

function clampRate(value) {
  return [0.6, 0.8, 1, 1.2].reduce((best, item) => Math.abs(item - value) < Math.abs(best - value) ? item : best, 1);
}

module.exports = { nextReviewIndex, clampRate };
```

- [ ] **Step 4: 运行全部逻辑测试**

Run: `cd wechat-miniprogram; node --test tests/*.test.js`

Expected: 所有测试 PASS。

- [ ] **Step 5: 提交复习模块**

```bash
git add wechat-miniprogram/utils/review.js wechat-miniprogram/tests/review.test.js
git commit -m "feat: add deterministic review sequencing"
```

### Task 5: 页面状态控制与音频生命周期

**Files:**
- Create: `wechat-miniprogram/pages/index/controller.js`
- Create: `wechat-miniprogram/tests/controller.test.js`

**Interfaces:**
- Consumes: `{ storage, lookup, audio, randomFn, onChange }`，其中 `storage` 是 `StorageService`，`lookup(word)` 返回 `LookupResult`，`audio.play(url, rate)` 返回 Promise。
- Produces: `createController(dependencies): Controller`；公开 `initialize()`、`lookupDraft(word)`、`saveDraft(draft)`、`revealAnswer()`、`moveNext()`、`playCurrent()`、`destroy()`、`getState()`。

- [ ] **Step 1: 写页面状态和音频失败测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createController } = require('../pages/index/controller');

function fakeDependencies(options = {}) {
  const words = options.words || [];
  return {
    storage: {
      loadState: () => ({ version: 1, words, settings: { mode: 'random', rate: 1 } }),
      saveWord: (word) => word,
      deleteWord: () => words,
      saveSettings: () => undefined
    },
    lookup: async () => {
      if (options.lookupErrorCode) throw Object.assign(new Error('lookup failed'), { code: options.lookupErrorCode });
      return { word: 'tool', phonetic: '/tul/', meaning: '工具', confidence: 'verified', warnings: [] };
    },
    audio: {
      play: async () => { if (options.audioFails) throw new Error('播放失败'); },
      destroy: () => undefined
    },
    randomFn: () => 0,
    onChange: () => undefined
  };
}

test('keeps answer hidden until revealAnswer is called', () => {
  const controller = createController(fakeDependencies({ words: [{ id: '1', word: 'tool' }] }));
  controller.initialize();
  assert.equal(controller.getState().answerVisible, false);
  controller.revealAnswer();
  assert.equal(controller.getState().answerVisible, true);
});

test('lookup domain errors become actionable Chinese status text', async () => {
  const controller = createController(fakeDependencies({ lookupErrorCode: 'DOMAIN_NOT_ALLOWED' }));
  await controller.lookupDraft('tool');
  assert.match(controller.getState().lookupStatus, /合法域名/);
  assert.equal(controller.getState().lookupBusy, false);
});

test('audio failure keeps the same word and clears busy state', async () => {
  const controller = createController(fakeDependencies({ words: [{ id: '1', word: 'tool' }], audioFails: true }));
  controller.initialize();
  await assert.rejects(() => controller.playCurrent());
  assert.equal(controller.getState().currentWord.id, '1');
  assert.equal(controller.getState().audioBusy, false);
});
```

- [ ] **Step 2: 运行测试并确认控制器不存在**

Run: `cd wechat-miniprogram; node --test tests/controller.test.js`

Expected: FAIL，错误包含 `Cannot find module '../pages/index/controller'`。

- [ ] **Step 3: 实现与微信 UI 解耦的控制器**

控制器内部使用不可变状态快照，并通过可选 `onChange(state)` 通知页面调用 `setData`。`lookupDraft` 将 `DOMAIN_NOT_ALLOWED`、`NETWORK_TIMEOUT`、`NOT_FOUND`、其他错误分别映射为明确中文提示；`saveDraft` 要求单词非空，音标和释义允许手动填写；`destroy` 必须停止并释放音频。

```js
const LOOKUP_MESSAGES = {
  DOMAIN_NOT_ALLOWED: '微信尚未允许访问词典域名，请先配置合法域名；你也可以手动填写。',
  NETWORK_TIMEOUT: '查询超时，请检查网络后重试；你也可以手动填写。',
  NOT_FOUND: '没有查到这个单词，请检查拼写或手动填写。'
};

function createController({ storage, lookup, audio, randomFn = Math.random, onChange = () => {} }) {
  let state = initialState();
  const publish = (patch) => { state = { ...state, ...patch }; onChange({ ...state }); };
  async function lookupDraft(word) {
    publish({ lookupBusy: true, lookupStatus: '正在查询...' });
    try {
      const result = await lookup(word);
      publish({ draft: result, lookupBusy: false, lookupStatus: result.confidence === 'verified' ? '已找到，请核对后保存。' : '结果需要核对后再保存。' });
      return result;
    } catch (error) {
      publish({ lookupBusy: false, lookupStatus: LOOKUP_MESSAGES[error.code] || '查询失败，请重试或手动填写。' });
      return null;
    }
  }
  return { initialize, lookupDraft, saveDraft, revealAnswer, moveNext, playCurrent, destroy, getState: () => ({ ...state }) };
}
```

- [ ] **Step 4: 运行全部测试**

Run: `cd wechat-miniprogram; node --test tests/*.test.js`

Expected: 所有测试 PASS，控制器异常路径不会留下加载状态。

- [ ] **Step 5: 提交页面控制器**

```bash
git add wechat-miniprogram/pages/index/controller.js wechat-miniprogram/tests/controller.test.js
git commit -m "feat: coordinate vocabulary and audio state"
```

### Task 6: 微信主页面、完整交互与视觉适配

**Files:**
- Create: `wechat-miniprogram/pages/index/index.json`
- Create: `wechat-miniprogram/pages/index/index.js`
- Create: `wechat-miniprogram/pages/index/index.wxml`
- Create: `wechat-miniprogram/pages/index/index.wxss`
- Create: `wechat-miniprogram/services/audio.js`
- Create: `wechat-miniprogram/tests/audio.test.js`

**Interfaces:**
- Consumes: `createController`、`createStorage`、`lookupWord`、`createRequestJson`、`createAudioPlayer(wxApi)`。
- Produces: 微信页面事件处理器 `switchTab`、`onLookup`、`onSave`、`onEdit`、`onDelete`、`onPlay`、`onReveal`、`onNext`、`onModeChange`、`onRateChange`、`onCopyBackup`、`onImportBackup`。

- [ ] **Step 1: 写音频适配器失败测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAudioPlayer } = require('../services/audio');

function createFakeAudioWx() {
  const context = {
    src: '', playbackRate: 1,
    stop() {}, play() {}, destroy() {},
    onEnded(fn) { this.ended = fn; },
    onError(fn) { this.failed = fn; },
    offEnded() {}, offError() {},
    emitEnded() { this.ended(); }
  };
  return { context, createInnerAudioContext: () => context };
}

test('sets playback rate and resolves after audio ends', async () => {
  const fakeWx = createFakeAudioWx();
  const player = createAudioPlayer(fakeWx);
  const pending = player.play('https://audio.example/tool.mp3', 0.8);
  assert.equal(fakeWx.context.src, 'https://audio.example/tool.mp3');
  assert.equal(fakeWx.context.playbackRate, 0.8);
  fakeWx.context.emitEnded();
  await pending;
});

test('rejects with a Chinese message when URL is empty', async () => {
  const player = createAudioPlayer(createFakeAudioWx());
  await assert.rejects(() => player.play('', 1), /没有可用的美音音频/);
});
```

- [ ] **Step 2: 运行测试并确认音频模块不存在**

Run: `cd wechat-miniprogram; node --test tests/audio.test.js`

Expected: FAIL，错误包含 `Cannot find module '../services/audio'`。

- [ ] **Step 3: 实现音频适配器和页面事件绑定**

`createAudioPlayer` 只能维护一个 `InnerAudioContext`；每次播放先 `stop()`，在 `onEnded` 解析 Promise，在 `onError` 拒绝并清理回调，`destroy()` 调用上下文的 `destroy()`。`index.js` 在 `onLoad` 创建依赖和控制器，在 `onUnload` 调用 `destroy()`；所有表单输入通过 `bindinput` 更新草稿，不直接修改存储。

```js
function createAudioPlayer(wxApi) {
  const context = wxApi.createInnerAudioContext();
  function play(url, rate = 1) {
    if (!url) return Promise.reject(new Error('没有可用的美音音频'));
    context.stop();
    context.src = url;
    context.playbackRate = rate;
    return new Promise((resolve, reject) => {
      const cleanup = () => { context.offEnded(onEnded); context.offError(onError); };
      const onEnded = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error('美音播放失败，请检查网络后重试')); };
      context.onEnded(onEnded);
      context.onError(onError);
      context.play();
    });
  }
  return { play, stop: () => context.stop(), destroy: () => context.destroy() };
}
```

- [ ] **Step 4: 实现两个标签页和所有状态视图**

`index.wxml` 必须包含：顶部标题与词数、复习/词库分段控件、空词库状态、听音状态区、答案区、播放/显示答案/下一个按钮、随机/顺序控件、四档语速控件、单词查询表单、来源提醒、词库搜索列表、编辑/删除按钮、复制备份和粘贴导入区域。

音标节点固定使用 `class="phonetic"` 与 `style="direction:ltr;text-align:left;unicode-bidi:isolate"`。按钮使用明确图标字符与文字；卡片圆角不超过 `16rpx`；输入框、按钮和固定控件设置稳定高度；使用 `env(safe-area-inset-bottom)` 适配 iPhone 底部安全区；`@media (min-width: 700px)` 限制内容最大宽度，避免平板过度拉伸。

```xml
<view class="page safe-bottom">
  <view class="segmented" role="tablist">
    <button data-tab="review" bindtap="switchTab">复习</button>
    <button data-tab="library" bindtap="switchTab">词库</button>
  </view>
  <view wx:if="{{activeTab === 'review'}}">
    <view wx:if="{{!currentWord}}" class="empty"><button data-tab="library" bindtap="switchTab">去添加单词</button></view>
    <view wx:else>
      <view class="listen-state">{{audioStatus}}</view>
      <view wx:if="{{answerVisible}}" class="answer">
        <text class="word">{{currentWord.word}}</text>
        <text class="phonetic" style="direction:ltr;text-align:left;unicode-bidi:isolate">{{currentWord.phonetic}}</text>
        <text>{{currentWord.meaning}}</text>
      </view>
      <button bindtap="onPlay">🔊 播放</button>
      <button bindtap="onReveal">◉ 显示答案</button>
      <button bindtap="onNext">▷ 下一个</button>
    </view>
  </view>
  <view wx:if="{{activeTab === 'library'}}">
    <input value="{{draft.word}}" data-field="word" bindinput="onDraftInput" placeholder="输入英语单词" />
    <button bindtap="onLookup" loading="{{lookupBusy}}">自动查询</button>
    <input class="phonetic" style="direction:ltr;text-align:left;unicode-bidi:isolate" value="{{draft.phonetic}}" data-field="phonetic" bindinput="onDraftInput" />
    <textarea value="{{draft.meaning}}" data-field="meaning" bindinput="onDraftInput" />
    <button bindtap="onSave">保存到词库</button>
  </view>
</view>
```

- [ ] **Step 5: 做静态结构与语法检查**

Run: `cd wechat-miniprogram; node --check app.js; node --check pages/index/index.js; node --check pages/index/controller.js; node --check services/audio.js; node --test tests/*.test.js; node -e "const fs=require('fs'); const w=fs.readFileSync('pages/index/index.wxml','utf8'); for(const x of ['onLookup','onSave','onPlay','onReveal','onNext','phonetic']) if(!w.includes(x)) throw new Error('missing '+x); console.log('page structure ok')"`

Expected: 所有语法检查和测试通过，最后输出 `page structure ok`。

- [ ] **Step 6: 在微信开发者工具中进行编译检查**

先检查 Windows 常见安装路径中的 `cli.bat`。若存在，使用微信开发者工具 CLI 打开 `wechat-miniprogram/` 并确认无 WXML、WXSS 或 JavaScript 编译错误；若不存在，则记录“本机未安装微信开发者工具”，保留 Task 7 的人工导入验收步骤，不能声称已完成真机编译。

- [ ] **Step 7: 提交微信页面**

```bash
git add wechat-miniprogram/pages wechat-miniprogram/services/audio.js wechat-miniprogram/tests/audio.test.js wechat-miniprogram/app.wxss
git commit -m "feat: build WeChat vocabulary listening interface"
```

### Task 7: 说明、完整验证、压缩包与 GitHub 交付

**Files:**
- Create: `wechat-miniprogram/README.md`
- Modify: `README.md`
- Create: `wechat-miniprogram-v1.zip`（由验证后的目录生成，不纳入 Git 提交）

**Interfaces:**
- Consumes: 完成的 `wechat-miniprogram/`。
- Produces: 可导入微信开发者工具的源码目录、用户操作说明、ZIP 压缩包和 GitHub 提交。

- [ ] **Step 1: 编写面向非技术用户的导入和发布说明**

说明必须逐步写清：下载安装微信开发者工具、选择“导入项目”、选择 `wechat-miniprogram` 文件夹、测试阶段使用测试号、开发工具中临时关闭合法域名校验仅供预览、正式 AppID 下在公众平台配置 request/download 合法域名、点击预览生成二维码、iPhone 微信扫码体验。列出当前查询和音频所需域名，并强调正式发布由用户本人完成主体信息和审核。

- [ ] **Step 2: 更新仓库首页说明**

在根 `README.md` 增加“微信小程序版本”段落，链接 `wechat-miniprogram/README.md`，保留原网页版本的全部说明。

- [ ] **Step 3: 运行最终自动验证**

Run: `cd wechat-miniprogram; node --test tests/*.test.js; Get-ChildItem -Recurse -File | Where-Object Length -eq 0 | ForEach-Object { throw "empty file: $($_.FullName)" }; node -e "for(const p of ['app.json','project.config.json','sitemap.json']) JSON.parse(require('fs').readFileSync(p,'utf8')); console.log('json ok')"`

Expected: 所有测试 PASS，没有空文件，最后输出 `json ok`。

- [ ] **Step 4: 检查范围和 Git 工作区**

Run: `git diff --check; git status --short; git diff --stat HEAD~1`

Expected: 没有空白错误；修改只涉及 `wechat-miniprogram/`、根 `README.md` 和计划/规格文档，不得出现根目录网页文件的非预期修改。

- [ ] **Step 5: 生成并验证 ZIP**

用 PowerShell `Compress-Archive` 将 `wechat-miniprogram/` 目录整体压缩到仓库父目录 `vocab-listening-wechat-miniprogram.zip`。随后用 `System.IO.Compression.ZipFile::OpenRead()` 检查压缩包，确认包含 `wechat-miniprogram/project.config.json`、`wechat-miniprogram/app.json`、`wechat-miniprogram/pages/index/index.wxml` 且每个必要文件长度大于零。

- [ ] **Step 6: 提交说明并推送 GitHub**

```bash
git add README.md wechat-miniprogram/README.md
git commit -m "docs: add WeChat setup instructions"
git push origin main
```

Expected: 推送成功，远端 `main` 指向本地最新提交。若认证失败，保留本地提交并报告准确错误，不重复覆盖文件。

- [ ] **Step 7: 交付人工验收清单**

向用户提供 ZIP 的可点击本地路径和 GitHub 仓库链接，并说明自动测试数量、微信开发者工具编译是否实际执行。请用户在 iPhone 预览中依次验证：添加 `tool`、核对 `/tul/` 和“工具”、播放美音、显示答案、下一个、关闭后重新打开仍有词条、复制备份后删除再导入恢复。
