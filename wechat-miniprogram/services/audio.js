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

    return new Promise((resolve, reject) => {
      let playback = null;
      const cleanup = () => {
        context.offEnded(onEnded);
        context.offError(onError);
      };
      const onEnded = () => {
        activePlayback = null;
        cleanup();
        resolve();
      };
      const fail = (message) => {
        if (activePlayback !== playback) return;
        activePlayback = null;
        cleanup();
        reject(new Error(message));
      };
      const onError = (detail) => {
        const code = detail && detail.errCode;
        const codeText = code === undefined || code === null ? '' : `（错误码 ${code}）`;
        const nativeMessage = detail && detail.errMsg
          ? String(detail.errMsg).trim().slice(0, 100)
          : '';
        const nativeText = nativeMessage ? `：${nativeMessage}` : '';
        fail(`美音播放失败${codeText}${nativeText}，请检查网络后重试`);
      };

      playback = {
        cleanup,
        reject
      };
      activePlayback = playback;
      context.onEnded(onEnded);
      context.onError(onError);
      context.autoplay = true;
      context.playbackRate = rate;
      context.volume = 1;
      context.src = url;
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
