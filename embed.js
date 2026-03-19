(() => {
  const SCRIPT_ATTR = 'data-hy-player-script';
  const STYLE_ATTR = 'data-hy-player-style';
  const FA_ATTR = 'data-hy-player-fa';
  const DEFAULT_FA_URL = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.3/css/all.min.css';

  function trimTrailingSlash(value) {
    if (value === '/') return '';
    return value.replace(/\/+$/, '');
  }

  function inferBaseUrl() {
    const src = document.currentScript && document.currentScript.src ? document.currentScript.src : '';
    if (!src) return '';
    try {
      const url = new URL(src, window.location.href);
      return trimTrailingSlash(url.pathname.replace(/\/embed\.js$/i, ''));
    } catch {
      return '';
    }
  }

  function joinUrl(base, path) {
    const cleanBase = trimTrailingSlash(String(base || '').trim());
    const cleanPath = String(path || '').replace(/^\/+/, '');
    if (!cleanBase) return `/${cleanPath}`;
    return `${cleanBase}/${cleanPath}`;
  }

  function whenReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
      return;
    }
    fn();
  }

  function ensureStyle(href, attrName) {
    if (!href) return;
    const existed = document.querySelector(`link[${attrName}]`);
    if (existed) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute(attrName, '1');
    document.head.appendChild(link);
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      if (window.HYPlayer && typeof window.HYPlayer.init === 'function') {
        resolve(window.HYPlayer);
        return;
      }

      const existed = document.querySelector(`script[${SCRIPT_ATTR}]`);
      if (existed) {
        existed.addEventListener('load', () => resolve(window.HYPlayer), { once: true });
        existed.addEventListener('error', reject, { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.defer = true;
      script.setAttribute(SCRIPT_ATTR, '1');
      script.onload = () => resolve(window.HYPlayer);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  whenReady(async () => {
    const sharedConfig = window.HYPlayerConfig && typeof window.HYPlayerConfig === 'object' ? window.HYPlayerConfig : {};
    const baseUrl = trimTrailingSlash(String(sharedConfig.baseUrl || inferBaseUrl() || '.'));
    const config = {
      ...sharedConfig,
      baseUrl,
    };

    ensureStyle(DEFAULT_FA_URL, FA_ATTR);
    ensureStyle(joinUrl(baseUrl, 'css/hy-player.css'), STYLE_ATTR);

    try {
      const player = await loadScriptOnce(joinUrl(baseUrl, 'js/hy-player.js'));
      if (!player || typeof player.init !== 'function') {
        throw new Error('HYPlayer.init 不可用');
      }
      if (config.autoInit !== false) {
        player.init(config);
      }
    } catch (error) {
      console.error('[HYPlayer] 初始化失败', error);
    }
  });
})();
