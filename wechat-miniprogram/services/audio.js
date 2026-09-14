function createAudioPlayer(wxApi) {
  if (typeof wxApi.setInnerAudioOption === 'function') {
    wxApi.setInnerAudioOption({ obeyMuteSwitch: false });
  }
  const context = wxApi.createInnerAudioContext();
  context.obeyMuteSwitch = false;
  let activePlayback = null;

  function cancelActive(message) {
    if (!activePlayback) return;
    const playback = activePlayback;
    activePlayback = null;
    playback.cleanup();
    const error = new Error(message);
    error.code = 'PLAYBACK_CANCELLED';
    playback.reject(error);
  }

  function play(url, rate = 1) {
    cancelActive('已切换到新的单词');
    context.stop();
    if (!url) return Promise.reject(new Error('没有可用的美音音频'));

    context.src = url;
    context.playbackRate = rate;

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        context.offEnded(onEnded);
        context.offError(onError);
      };
      const onEnded = () => {
        activePlayback = null;
        cleanup();
        resolve();
      };
      const onError = () => {
        activePlayback = null;
        cleanup();
        reject(new Error('美音播放失败，请检查网络后重试'));
      };

      activePlayback = { cleanup, reject };
      context.onEnded(onEnded);
      context.onError(onError);
      try {
        context.play();
      } catch (_) {
        onError();
      }
    });
  }

  return {
    play,
    stop() {
      cancelActive('播放已停止');
      context.stop();
    },
    destroy() {
      cancelActive('播放已停止');
      context.destroy();
    }
  };
}

module.exports = { createAudioPlayer };
