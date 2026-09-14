const test = require('node:test');
const assert = require('node:assert/strict');
const { createAudioPlayer } = require('../services/audio');

function createFakeAudioWx() {
  const context = {
    src: '',
    playbackRate: 1,
    stopCalls: 0,
    playCalls: 0,
    destroyCalls: 0,
    stop() { this.stopCalls += 1; },
    play() { this.playCalls += 1; },
    destroy() { this.destroyCalls += 1; },
    onEnded(fn) { this.ended = fn; },
    onError(fn) { this.failed = fn; },
    offEnded(fn) { if (this.ended === fn) this.ended = null; },
    offError(fn) { if (this.failed === fn) this.failed = null; },
    emitEnded() { this.ended(); },
    emitError() { this.failed(); }
  };
  return {
    context,
    innerAudioOptions: null,
    createInnerAudioContext: () => context,
    setInnerAudioOption(options) { this.innerAudioOptions = options; }
  };
}

test('plays pronunciation through the iPhone silent switch', () => {
  const fakeWx = createFakeAudioWx();
  const player = createAudioPlayer(fakeWx);

  assert.deepEqual(fakeWx.innerAudioOptions, { obeyMuteSwitch: false });
  assert.equal(fakeWx.context.obeyMuteSwitch, false);
  player.destroy();
});

test('sets playback rate and resolves after audio ends', async () => {
  const fakeWx = createFakeAudioWx();
  const player = createAudioPlayer(fakeWx);
  const pending = player.play('https://audio.example/tool.mp3', 0.8);

  assert.equal(fakeWx.context.src, 'https://audio.example/tool.mp3');
  assert.equal(fakeWx.context.playbackRate, 0.8);
  assert.equal(fakeWx.context.stopCalls, 1);
  assert.equal(fakeWx.context.playCalls, 1);
  fakeWx.context.emitEnded();
  await pending;
  assert.equal(fakeWx.context.ended, null);
  assert.equal(fakeWx.context.failed, null);
});

test('rejects with a Chinese message when URL is empty', async () => {
  const player = createAudioPlayer(createFakeAudioWx());
  await assert.rejects(() => player.play('', 1), /没有可用的美音音频/);
});

test('empty URL cancels active playback before rejecting the new request', async () => {
  const fakeWx = createFakeAudioWx();
  const player = createAudioPlayer(fakeWx);
  const active = player.play('https://audio.example/tool.mp3');
  const activeCheck = assert.rejects(active, /已切换到新的单词/);

  const emptyRequest = player.play('', 1);
  const emptyCheck = assert.rejects(emptyRequest, /没有可用的美音音频/);

  assert.equal(fakeWx.context.stopCalls, 2);
  assert.equal(fakeWx.context.ended, null);
  assert.equal(fakeWx.context.failed, null);
  await Promise.all([activeCheck, emptyCheck]);
});

test('rejects playback errors and releases callbacks', async () => {
  const fakeWx = createFakeAudioWx();
  const player = createAudioPlayer(fakeWx);
  const pending = player.play('https://audio.example/tool.mp3');

  fakeWx.context.emitError();
  await assert.rejects(pending, /美音播放失败，请检查网络后重试/);
  assert.equal(fakeWx.context.ended, null);
  assert.equal(fakeWx.context.failed, null);
});

test('stop and destroy reuse the only audio context', () => {
  const fakeWx = createFakeAudioWx();
  const player = createAudioPlayer(fakeWx);

  player.stop();
  player.destroy();

  assert.equal(fakeWx.context.stopCalls, 1);
  assert.equal(fakeWx.context.destroyCalls, 1);
});

test('starting another playback rejects and cleans up the previous one', async () => {
  const fakeWx = createFakeAudioWx();
  const player = createAudioPlayer(fakeWx);
  const first = player.play('https://audio.example/first.mp3');

  const second = player.play('https://audio.example/second.mp3', 1.2);

  await assert.rejects(first, /已切换到新的单词/);
  assert.equal(fakeWx.context.src, 'https://audio.example/second.mp3');
  assert.equal(fakeWx.context.playbackRate, 1.2);
  fakeWx.context.emitEnded();
  await second;
});
