(() => {
  const DISPLAY_MODE_FIXED = 'fixed';
  const DISPLAY_MODE_INLINE = 'inline';
  const STORAGE_LOOP_KEY = 'hy_player_loop';
  const STORAGE_LYRICBAR_HIDDEN_KEY = 'hy_player_lyricbar_hidden';
  const STORAGE_SCOPE_ARTIST_KEY = 'hy_player_scope_artist';
  const STORAGE_PLATFORM_KEY = 'hy_player_platform';
  // 旧版本用 localStorage 记住第三方模式，导致刷新后“回不来”。
  // 现在改成 sessionStorage 一次性开关：仅本次跳转/刷新进入第三方；再次刷新自动回原生。
  const STORAGE_MODE_KEY = 'hy_player_mode'; // legacy: localStorage
  const SESSION_MODE_KEY = 'hy_player_mode_once';
  const MODE_HY = 'hy';
  const MODE_THIRD = 'third';
  const THIRD_PLAYER = {
    jquery: 'https://myhkw.cn/player/js/jquery.min.js',
    script: 'https://myhkw.cn/api/player/1702724007119',
    key: '1702724007119',
    m: '1',
  };
  let hyPlayerInstanceSeq = 0;
  const HY_PLAYER_SCRIPT_BASE_URL = (() => {
    const src = document.currentScript && document.currentScript.src ? document.currentScript.src : '';
    if (!src) return '';
    try {
      const url = new URL(src, window.location.href);
      return url.pathname.replace(/\/js\/hy-player\.js$/i, '');
    } catch {
      return '';
    }
  })();

  function trimTrailingSlash(value) {
    if (value === '/') return '';
    return value.replace(/\/+$/, '');
  }

  function joinUrl(base, path) {
    const cleanPath = String(path || '').replace(/^\/+/, '');
    const cleanBase = trimTrailingSlash(String(base || '').trim());
    if (!cleanBase) return `/${cleanPath}`;
    return `${cleanBase}/${cleanPath}`;
  }

  function normalizeBaseUrl(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text) return trimTrailingSlash(text);
    return trimTrailingSlash(HY_PLAYER_SCRIPT_BASE_URL);
  }

  function resolveMountElement(mount, mode) {
    if (mode !== DISPLAY_MODE_INLINE) return document.body;
    if (mount && mount.nodeType === 1) return mount;
    if (typeof mount === 'string' && mount.trim()) {
      const found = document.querySelector(mount.trim());
      if (found) return found;
    }
    const host = document.createElement('div');
    host.className = 'hy-player-host';
    document.body.appendChild(host);
    return host;
  }

  function normalizeInitConfig(rawConfig = {}) {
    const sharedConfig = window.HYPlayerConfig && typeof window.HYPlayerConfig === 'object' ? window.HYPlayerConfig : {};
    const merged = {
      ...sharedConfig,
      ...(rawConfig && typeof rawConfig === 'object' ? rawConfig : {}),
    };
    const mode = String(merged.mode || DISPLAY_MODE_FIXED).trim().toLowerCase() === DISPLAY_MODE_INLINE
      ? DISPLAY_MODE_INLINE
      : DISPLAY_MODE_FIXED;
    return {
      baseUrl: normalizeBaseUrl(merged.baseUrl),
      mode,
      mount: merged.mount ?? null,
      mountElement: resolveMountElement(merged.mount, mode),
      enableLyricBar: mode === DISPLAY_MODE_FIXED && merged.lyricBar !== false,
      autoPlayOnInit: merged.autoPlay !== false,
    };
  }

  function getMode() {
    try {
      const legacy = localStorage.getItem(STORAGE_MODE_KEY);
      if (legacy) localStorage.removeItem(STORAGE_MODE_KEY);
    } catch {
    }

    try {
      const mode = sessionStorage.getItem(SESSION_MODE_KEY);
      if (mode === MODE_THIRD) {
        // 一次性：用过即清，确保下次刷新回原生
        sessionStorage.removeItem(SESSION_MODE_KEY);
        return MODE_THIRD;
      }
    } catch {}

    return MODE_HY;
  }

  function setMode(mode) {
    try {
      if (mode === MODE_THIRD) sessionStorage.setItem(SESSION_MODE_KEY, MODE_THIRD);
      else sessionStorage.removeItem(SESSION_MODE_KEY);
    } catch {}
  }

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function looksLikeUrl(value) {
    return typeof value === 'string' && /^https?:\/\//i.test(value);
  }

  function resolveRequestUrl(url, apiBaseUrl = '') {
    const text = typeof url === 'string' ? url.trim() : '';
    if (!text) return text;
    if (looksLikeUrl(text) || text.startsWith('/')) return text;
    return joinUrl(apiBaseUrl, text);
  }

  function safeText(value, fallback = '') {
    if (typeof value === 'string' && value.trim()) return value.trim();
    return fallback;
  }

  function sanitizeQueryText(value, maxLen = 60) {
    if (typeof value !== 'string') return '';
    let text = value;
    text = text.replace(/[\x00-\x1F\x7F]/g, '');
    text = text.replace(/\s+/g, ' ').trim();
    if (text.length > maxLen) text = text.slice(0, maxLen);
    return text.trim();
  }

  function parseLrc(lrcText) {
    if (!lrcText || typeof lrcText !== 'string') return [];
    const lines = lrcText.split(/\r?\n/);
    const items = [];
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      const timeTags = [...line.matchAll(/\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g)];
      const text = line.replace(/\[[^\]]+\]/g, '').trim();
      if (timeTags.length === 0) {
        if (text) items.push({ time: null, text });
        continue;
      }
      for (const tag of timeTags) {
        const mm = Number(tag[1]);
        const ss = Number(tag[2]);
        const ms = Number((tag[3] || '0').padEnd(3, '0'));
        const time = mm * 60 + ss + ms / 1000;
        items.push({ time, text: text || '…' });
      }
    }
    items.sort((a, b) => {
      if (a.time === null && b.time === null) return 0;
      if (a.time === null) return 1;
      if (b.time === null) return -1;
      return a.time - b.time;
    });
    return items;
  }

  async function fetchJsonOrText(url) {
    const response = await fetch(url, { cache: 'no-store' });
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    if (contentType.includes('application/json')) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async function sha256Hex(input) {
    const encoder = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', encoder.encode(input));
    const bytes = new Uint8Array(buf);
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
    return out;
  }

  async function solvePow({ token, difficultyHexZeros, signal }) {
    const difficulty = Number(difficultyHexZeros) || 0;
    if (!token || difficulty < 1 || difficulty > 10) throw new Error('PoW 参数错误');
    const prefix = '0'.repeat(difficulty);

    let nonce = 0;
    while (true) {
      if (signal?.aborted) throw new Error('PoW 已取消');
      const hash = await sha256Hex(`${token}:${nonce}`);
      if (hash.startsWith(prefix)) return String(nonce);
      nonce++;
      if (nonce % 500 === 0) await new Promise(requestAnimationFrame);
    }
  }

  async function verifyPow({ verifyUrl, token, nonce, apiBaseUrl }) {
    const resp = await fetch(resolveRequestUrl(verifyUrl, apiBaseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, nonce }),
    });
    const raw = await resp.text();
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
    if (!data || typeof data !== 'object') throw new Error('PoW 校验返回异常');
    if (!data.ok) throw new Error(data.error || 'PoW 校验失败');
    return data;
  }

  async function resolveLyric(lyric) {
    if (!lyric) return '';
    if (looksLikeUrl(lyric)) {
      try {
        const response = await fetch(lyric, { cache: 'no-store' });
        return await response.text();
      } catch {
        return '';
      }
    }
    return String(lyric);
  }

  function normalizeTrack(payload) {
    if (typeof payload === 'string') {
      const text = payload.trim();
      if (looksLikeUrl(text)) {
        return {
          url: text,
          title: '随机歌曲',
          artist: '未知歌手',
          cover: '',
          lyric: '',
        };
      }
      const urlMatch = text.match(/(?:url|music_url|song_url|mp3url)\s*[:=]\s*(https?:\/\/\S+)/i);
      if (urlMatch && looksLikeUrl(urlMatch[1])) {
        return {
          url: urlMatch[1],
          title: '随机歌曲',
          artist: '未知歌手',
          cover: '',
          lyric: '',
        };
      }
      return null;
    }
    if (!payload || typeof payload !== 'object') return null;

    const url =
      payload.url ||
      payload.music_url ||
      payload.song_url ||
      payload.mp3url ||
      payload.link ||
      payload.data?.url ||
      payload.data?.music_url;

    const title =
      payload.title ||
      payload.name ||
      payload.songname ||
      payload.song ||
      payload.data?.title ||
      payload.data?.name;

    const artist =
      payload.author ||
      payload.artist ||
      payload.singer ||
      payload.data?.author ||
      payload.data?.artist ||
      payload.data?.singer;

    const cover =
      payload.pic ||
      payload.cover ||
      payload.image ||
      payload.data?.pic ||
      payload.data?.cover ||
      payload.data?.image;

    const lyric =
      payload.lrc ||
      payload.lyric ||
      payload.lyrics ||
      payload.data?.lrc ||
      payload.data?.lyric ||
      payload.data?.lyrics;

    if (!looksLikeUrl(url)) return null;

    return {
      url,
      title: safeText(title, '随机歌曲'),
      artist: safeText(artist, '未知歌手'),
      cover: looksLikeUrl(cover) ? cover : '',
      lyric,
    };
  }

  function createPlayer(config) {
    const mountTarget = config.mountElement || document.body;
    const container = document.createElement('section');
    container.className = `hy-player ${config.mode === DISPLAY_MODE_INLINE ? 'hy-player--inline' : 'hy-player--fixed'}`;
    container.id = `hy-player-${++hyPlayerInstanceSeq}`;
    container.setAttribute('data-hy-player-mode', config.mode);
    container.setAttribute('aria-label', '音乐播放器');

    container.innerHTML = `
      <div class="hy-player__panel">
        <div class="hy-lyrics" aria-label="歌词面板" role="dialog" aria-modal="false">
          <div class="hy-lyrics__header">
            <div class="hy-lyrics__heading">歌词</div>
            <button class="hy-btn hy-btn--ghost" type="button" data-action="lyrics-close" aria-label="关闭歌词" title="关闭">
              <i class="fas fa-times" aria-hidden="true"></i>
            </button>
          </div>
          <div class="hy-lyrics__scroller" role="list"></div>
        </div>
        <div class="hy-player__main">
          <div class="hy-player__art" aria-label="封面与歌曲信息">
            <div class="hy-player__coverwrap">
              <img class="hy-player__cover" alt="封面" />
              <div class="hy-player__cap" title="">
                <span class="hy-player__cap-title"></span>
                <span class="hy-player__cap-sep" aria-hidden="true"> — </span>
                <span class="hy-player__cap-artist"></span>
              </div>
            </div>
          </div>
          <div class="hy-player__meta">
            <div class="hy-player__title">加载中…</div>
            <div class="hy-player__artist">请稍候</div>
            <div class="hy-player__status" aria-live="polite"></div>
            <button class="hy-scope" type="button" data-action="scope-pill" title="随机范围：全局（点击设置/清除）" aria-label="随机范围：全局（点击设置/清除）"></button>
          </div>
          <div class="hy-player__controls">
            <button class="hy-btn" type="button" data-action="next" title="换一首">
              <i class="fas fa-random" aria-hidden="true"></i>
            </button>
            <button class="hy-btn hy-btn--primary" type="button" data-action="toggle" title="播放/暂停">
              <i class="fas fa-play" aria-hidden="true"></i>
            </button>
            <div class="hy-search">
              <button class="hy-btn" type="button" data-action="search" title="点歌">
                <i class="fas fa-search" aria-hidden="true"></i>
              </button>
              <div class="hy-search__popover" aria-label="点歌">
                <div class="hy-search__row">
                  <input class="hy-search__input" type="text" placeholder="歌名 - 歌手（更精准）" />
                  <div class="hy-search__actions" aria-label="点歌操作">
                    <button class="hy-btn" type="button" data-action="search-play" title="播放">
                      <i class="fas fa-play" aria-hidden="true"></i>
                    </button>
                    <button class="hy-btn" type="button" data-action="search-artist-random" title="范围随机（歌手）">
                      <i class="fas fa-dice" aria-hidden="true"></i>
                    </button>
                    <button class="hy-btn" type="button" data-action="search-list" title="列出歌曲（歌手）">
                      <i class="fas fa-list" aria-hidden="true"></i>
                    </button>
                  </div>
                </div>
                <div class="hy-search__results" aria-label="搜索结果"></div>
              </div>
            </div>
            <div class="hy-volume">
              <button class="hy-btn" type="button" data-action="sound" title="声音（点击静音/取消静音，长按调音量）">
                <i class="fas fa-volume-mute" aria-hidden="true"></i>
              </button>
              <div class="hy-volume__popover" aria-label="音量调节">
                <input class="hy-volume__range" type="range" min="0" max="1" step="0.01" value="0.85" aria-label="音量" />
              </div>
            </div>
            <div class="hy-more">
              <button class="hy-btn" type="button" data-action="more" title="更多">
                <i class="fas fa-ellipsis-h" aria-hidden="true"></i>
              </button>
              <div class="hy-more__popover" aria-label="更多功能">
                <button class="hy-more__item" type="button" data-action="loop" title="循环播放">
                  <i class="fas fa-redo" aria-hidden="true"></i>
                  <span data-role="loop-label">循环播放：关</span>
                </button>
                <button class="hy-more__item" type="button" data-action="lyricbar" title="显示/隐藏底部歌词">
                  <i class="fas fa-align-center" aria-hidden="true"></i>
                  <span data-role="lyricbar-label">底部歌词：显示</span>
                </button>
                <button
                  class="hy-more__item hy-more__item--submenu"
                  type="button"
                  data-action="platform-menu"
                  aria-haspopup="true"
                  aria-expanded="false"
                  title="音源选择"
                >
                  <i class="fas fa-music" aria-hidden="true"></i>
                  <span data-role="platform-label">音源：酷我</span>
                  <i class="fas fa-chevron-right hy-more__chev" aria-hidden="true"></i>
                </button>
                <button class="hy-more__item" type="button" data-action="share">
                  <i class="fas fa-share-alt" aria-hidden="true"></i>
                  <span>分享链接</span>
                </button>
                <button class="hy-more__item" type="button" data-action="help">
                  <i class="fas fa-question-circle" aria-hidden="true"></i>
                  <span>说明文档</span>
                </button>
                <button class="hy-more__item" type="button" data-action="switch">
                  <i class="fas fa-exchange-alt" aria-hidden="true"></i>
                  <span>切换播放器</span>
                </button>
              </div>
              <div class="hy-more__submenu" role="radiogroup" aria-label="音源选择">
                <button class="hy-more__option" type="button" role="radio" aria-checked="true" data-action="platform-set" data-platform="kuwo">酷我</button>
                <button class="hy-more__option" type="button" role="radio" aria-checked="false" data-action="platform-set" data-platform="netease">网易云</button>
                <button class="hy-more__option" type="button" role="radio" aria-checked="false" data-action="platform-set" data-platform="qq">QQ音乐</button>
                <button class="hy-more__option" type="button" role="radio" aria-checked="false" data-action="platform-set" data-platform="kugou">酷狗</button>
                <button class="hy-more__option" type="button" role="radio" aria-checked="false" data-action="platform-set" data-platform="migu">咪咕</button>
              </div>
            </div>
            <button class="hy-btn" type="button" data-action="hide" title="隐藏">
              <i class="fas fa-chevron-left" aria-hidden="true"></i>
            </button>
          </div>
        </div>
        <div class="hy-player__bar">
          <div class="hy-progress" role="slider" aria-label="播放进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">
            <div class="hy-progress__fill"></div>
          </div>
          <div class="hy-player__time">
            <span class="hy-player__cur">00:00</span>
            <span class="hy-player__dur">00:00</span>
          </div>
        </div>
      </div>
      <button class="hy-player__handle" type="button" data-action="show" aria-label="展开播放器" title="展开播放器">
        <i class="fas fa-chevron-right" aria-hidden="true"></i>
      </button>
    `;

    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    container.appendChild(audio);

    mountTarget.appendChild(container);
    return { container, audio };
  }

  function init(rawConfig = {}) {
    const config = normalizeInitConfig(rawConfig);
    const apiBaseUrl = joinUrl(config.baseUrl, 'api');
    const apiUrl = joinUrl(apiBaseUrl, 'hy_music_random.php');
    const isInlineMode = config.mode === DISPLAY_MODE_INLINE;
    const isFixedMode = !isInlineMode;
    const enableLyricBar = config.enableLyricBar;

    if (getMode() === MODE_THIRD) {
      enableThirdPartyPlayer();
      return { mode: MODE_THIRD };
    }

    if (isFixedMode) {
      const existingFixed = document.querySelector('.hy-player[data-hy-player-mode="fixed"]');
      if (existingFixed) return { container: existingFixed, reused: true, config };
    } else if (config.mountElement) {
      const existingInline = Array.from(config.mountElement.children).find((node) =>
        node && node.classList && node.classList.contains('hy-player'),
      );
      if (existingInline) return { container: existingInline, reused: true, config };
    }

    const { container, audio } = createPlayer(config);

    function syncPlayingClass() {
      const playing = !audio.paused && !audio.ended;
      container.classList.toggle('hy-playing', playing);
    }

    audio.addEventListener('play', syncPlayingClass);
    audio.addEventListener('pause', syncPlayingClass);
    audio.addEventListener('ended', syncPlayingClass);
    syncPlayingClass();

    const panelEl = $('.hy-player__panel', container);
    const lyricsEl = $('.hy-lyrics', container);
    const lyricsScrollerEl = $('.hy-lyrics__scroller', container);
    const lyricsCloseBtn = $('[data-action="lyrics-close"]', container);
    const coverEl = $('.hy-player__cover', container);
    const capEl = $('.hy-player__cap', container);
    const capTitleEl = $('.hy-player__cap-title', container);
    const capArtistEl = $('.hy-player__cap-artist', container);
    const capSepEl = $('.hy-player__cap-sep', container);
    const titleEl = $('.hy-player__title', container);
    const artistEl = $('.hy-player__artist', container);
    const statusEl = $('.hy-player__status', container);
    const scopePillBtn = $('[data-action="scope-pill"]', container);
    const progressEl = $('.hy-progress', container);
    const progressFillEl = $('.hy-progress__fill', container);
    const curEl = $('.hy-player__cur', container);
    const durEl = $('.hy-player__dur', container);
    const toggleBtn = $('[data-action="toggle"]', container);
    const nextBtn = $('[data-action="next"]', container);
    const searchBtn = $('[data-action="search"]', container);
    const searchPopoverEl = $('.hy-search__popover', container);
    const searchInputEl = $('.hy-search__input', container);
    const searchPlayBtn = $('[data-action="search-play"]', container);
    const searchArtistRandomBtn = $('[data-action="search-artist-random"]', container);
    const searchListBtn = $('[data-action="search-list"]', container);
    const searchResultsEl = $('.hy-search__results', container);
    const soundBtn = $('[data-action="sound"]', container);
    const volumePopoverEl = $('.hy-volume__popover', container);
    const volumeRangeEl = $('.hy-volume__range', container);
    const shareBtn = $('[data-action="share"]', container);
    const helpBtn = $('[data-action="help"]', container);
    const moreBtn = $('[data-action="more"]', container);
    const morePopoverEl = $('.hy-more__popover', container);
    const platformMenuBtn = $('[data-action="platform-menu"]', container);
    const platformMenuEl = $('.hy-more__submenu', container);
    const loopBtn = $('[data-action="loop"]', container);
    const loopLabelEl = $('[data-role="loop-label"]', container);
    const platformLabelEl = $('[data-role="platform-label"]', container);
    const platformOptionEls = [...container.querySelectorAll('[data-action="platform-set"]')];
    const lyricBarToggleBtn = $('[data-action="lyricbar"]', container);
    const lyricBarLabelEl = $('[data-role="lyricbar-label"]', container);
    const hideBtn = $('[data-action="hide"]', container);
    const showBtn = $('[data-action="show"]', container);
    const switchBtn = $('[data-action="switch"]', container);

    if (isInlineMode) {
      if (hideBtn) hideBtn.style.display = 'none';
      if (showBtn) showBtn.style.display = 'none';
    }
    if (!enableLyricBar && lyricBarToggleBtn) {
      lyricBarToggleBtn.style.display = 'none';
    }

    let isLoading = false;
    let lyricItems = [];
    let activeLyricIndex = -1;
    let userVolume = 0.85;
    let lastNonZeroVolume = 0.85;
    let isMuted = true;
    let userToggledMute = false;
    let hasUnlockedSound = false;
    let isHidden = false;
    let isLoop = false;
    let isLyricBarHidden = false;
    let platformId = 'kuwo';
    let scopeArtist = '';
    let lyricsOpen = false;
    let lyricLineEls = [];

    function clampNumber(value, min, max) {
      const v = Number(value);
      if (!Number.isFinite(v)) return min;
      return Math.max(min, Math.min(max, v));
    }

    function positionPlatformMenu() {
      if (!platformMenuEl || !morePopoverEl) return;
      if (!platformMenuEl.classList.contains('is-open')) return;
      if (!morePopoverEl.classList.contains('is-open')) return;

      const pop = morePopoverEl.getBoundingClientRect();
      const menu = platformMenuEl.getBoundingClientRect();
      const vw = window.innerWidth || 0;
      const vh = window.innerHeight || 0;
      const gap = 12;
      const margin = 8;

      const top = clampNumber(pop.top, margin, Math.max(margin, vh - menu.height - margin));
      let left = pop.right + gap;
      let side = 'right';

      if (left + menu.width > vw - margin) {
        left = pop.left - gap - menu.width;
        side = 'left';
      }

      if (left < margin) {
        left = clampNumber((vw - menu.width) / 2, margin, Math.max(margin, vw - menu.width - margin));
        side = 'overlay';
      }

      platformMenuEl.style.left = `${Math.round(left)}px`;
      platformMenuEl.style.top = `${Math.round(top)}px`;
      platformMenuEl.style.right = 'auto';
      platformMenuEl.style.bottom = 'auto';

      if (platformMenuBtn) {
        const chev = $('.hy-more__chev', platformMenuBtn);
        if (chev) {
          chev.classList.remove('fa-chevron-left', 'fa-chevron-right', 'fa-chevron-down');
          chev.classList.add(side === 'left' ? 'fa-chevron-left' : 'fa-chevron-right');
        }
      }
    }

    function setPlatformMenuOpen(open) {
      if (!platformMenuEl) return;
      const nextOpen = Boolean(open);
      platformMenuEl.classList.toggle('is-open', nextOpen);
      if (platformMenuBtn) {
        platformMenuBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
        platformMenuBtn.classList.toggle('is-active', nextOpen);
      }
      if (nextOpen) {
        requestAnimationFrame(positionPlatformMenu);
      } else {
        platformMenuEl.style.removeProperty('left');
        platformMenuEl.style.removeProperty('top');
        platformMenuEl.style.removeProperty('right');
        platformMenuEl.style.removeProperty('bottom');
      }
    }

    function closeMoreMenus() {
      if (morePopoverEl) morePopoverEl.classList.remove('is-open');
      setPlatformMenuOpen(false);
    }

    function normalizeVolume(value, { allowZero } = { allowZero: false }) {
      const v = Number(value);
      if (!Number.isFinite(v)) return 0.85;
      if (v > 1) return 1;
      if (v < 0) return 0;
      // 旧版本可能把音量写成 0，导致“取消静音也没声音”。这里做一次性兜底。
      if (!allowZero && v === 0) return 0.85;
      return v;
    }

    function setStatus(text) {
      statusEl.textContent = text || '';
    }

    let flashStatusSeq = 0;
    function flashStatus(text, ms = 1800) {
      if (!text) return;
      const seq = ++flashStatusSeq;
      setStatus(text);
      window.setTimeout(() => {
        if (seq !== flashStatusSeq) return;
        if (isLoading) return;
        if (String(statusEl.textContent || '') === String(text)) setStatus('');
      }, Math.max(500, ms));
    }

    function setCapText(title, artist) {
      if (!capTitleEl || !capArtistEl) return;
      const t = typeof title === 'string' ? title : '';
      const a = typeof artist === 'string' ? artist : '';
      capTitleEl.textContent = t;
      capArtistEl.textContent = a;
      if (capEl) {
        const titleText = t && a ? `${t} - ${a}` : t || a || '';
        capEl.title = titleText;
        capEl.style.display = titleText ? '' : 'none';
      }
      if (capSepEl) capSepEl.style.display = t && a ? '' : 'none';
    }

    function setToggleIcon(isPlaying) {
      const icon = $('i', toggleBtn);
      icon.className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
    }

    function setHidden(nextHidden) {
      if (!isFixedMode) return;
      isHidden = Boolean(nextHidden);
      container.classList.toggle('is-hidden', isHidden);
      try {
        localStorage.setItem('hy_player_hidden', isHidden ? '1' : '0');
      } catch {}
    }

    function setLoop(nextLoop, { persist } = { persist: true }) {
      isLoop = Boolean(nextLoop);
      audio.loop = isLoop;
      if (loopLabelEl) loopLabelEl.textContent = isLoop ? '循环播放：开' : '循环播放：关';
      if (loopBtn) loopBtn.classList.toggle('is-active', isLoop);
      if (persist) {
        try {
          localStorage.setItem(STORAGE_LOOP_KEY, isLoop ? '1' : '0');
        } catch {}
      }
    }

    function setLyricBarHidden(nextHidden, { persist } = { persist: true }) {
      isLyricBarHidden = Boolean(nextHidden);
      document.body.classList.toggle('hy-lyricbar-hidden', isLyricBarHidden && Boolean(lyricBar));
      if (lyricBar && lyricBar.bar) lyricBar.bar.style.display = isLyricBarHidden ? 'none' : '';
      if (lyricBarLabelEl) lyricBarLabelEl.textContent = isLyricBarHidden ? '底部歌词：隐藏' : '底部歌词：显示';
      if (lyricBarToggleBtn) lyricBarToggleBtn.classList.toggle('is-active', isLyricBarHidden);
      if (persist) {
        try {
          localStorage.setItem(STORAGE_LYRICBAR_HIDDEN_KEY, isLyricBarHidden ? '1' : '0');
        } catch {}
      }
    }

    const PLATFORM_OPTIONS = [
      { id: 'kuwo', label: '酷我' },
      { id: 'netease', label: '网易云' },
      { id: 'qq', label: 'QQ音乐' },
      { id: 'kugou', label: '酷狗' },
      { id: 'migu', label: '咪咕' },
    ];

    function normalizePlatformId(value) {
      const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
      if (!v) return 'kuwo';
      return PLATFORM_OPTIONS.some((p) => p.id === v) ? v : 'kuwo';
    }

    function platformLabel(id) {
      const hit = PLATFORM_OPTIONS.find((p) => p.id === id);
      return hit ? hit.label : id;
    }

    function setPlatform(nextId, { persist, notify } = { persist: true, notify: false }) {
      platformId = normalizePlatformId(nextId);
      if (platformLabelEl) platformLabelEl.textContent = `音源：${platformLabel(platformId)}`;
      for (const el of platformOptionEls) {
        if (!el) continue;
        const id = String(el.getAttribute('data-platform') || '').trim().toLowerCase();
        const selected = id === platformId;
        el.classList.toggle('is-selected', selected);
        el.setAttribute('aria-checked', selected ? 'true' : 'false');
      }
      if (notify) flashStatus(`音源已切换：${platformLabel(platformId)}`);
      if (persist) {
        try {
          localStorage.setItem(STORAGE_PLATFORM_KEY, platformId);
        } catch {}
      }
    }

    function setScopeArtist(nextArtist, { persist, notify } = { persist: true, notify: false }) {
      scopeArtist = typeof nextArtist === 'string' ? nextArtist.trim() : '';
      container.classList.toggle('has-scope', Boolean(scopeArtist));
      if (scopePillBtn) {
        scopePillBtn.textContent = '';
        const label = scopeArtist ? `随机范围：${scopeArtist}（点击清除范围）` : '随机范围：全局（点击设置范围）';
        scopePillBtn.setAttribute('title', label);
        scopePillBtn.setAttribute('aria-label', label);
        scopePillBtn.classList.toggle('is-active', Boolean(scopeArtist));
      }
      if (nextBtn) nextBtn.title = scopeArtist ? `换一首（范围：${scopeArtist}）` : '换一首';
      if (notify) flashStatus(scopeArtist ? `已开启范围随机：${scopeArtist}` : '已切回全局随机');
      if (persist) {
        try {
          if (scopeArtist) localStorage.setItem(STORAGE_SCOPE_ARTIST_KEY, scopeArtist);
          else localStorage.removeItem(STORAGE_SCOPE_ARTIST_KEY);
        } catch {}
      }
    }

    function setMuteIcon() {
      if (!soundBtn) return;
      const icon = $('i', soundBtn);
      icon.className = isMuted ? 'fas fa-volume-mute' : 'fas fa-volume-up';
    }

    function applyVolume({ persist } = { persist: true }) {
      audio.muted = isMuted;
      audio.volume = isMuted ? 0 : userVolume;
      setMuteIcon();
      if (persist) {
        try {
          localStorage.setItem('hy_player_muted', isMuted ? '1' : '0');
          localStorage.setItem('hy_player_vol', String(userVolume));
          if (lastNonZeroVolume > 0) localStorage.setItem('hy_player_last_vol', String(lastNonZeroVolume));
        } catch {}
      }
    }

    const lyricBar = (() => {
      if (!enableLyricBar) return null;

      const bar = document.createElement('section');
      bar.className = 'hy-lyricbar';
      bar.setAttribute('aria-label', '歌词');
      bar.setAttribute('aria-live', 'polite');

      bar.innerHTML = `
        <div class="hy-lyricbar__inner">
          <div class="hy-lyricbar__text" style="--hy-lyric-pct: 0%;">
            <div class="hy-lyricbar__text-track">
              <span class="hy-lyricbar__text-base"></span>
              <span class="hy-lyricbar__text-hi" aria-hidden="true"></span>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(bar);
      const boxEl = $('.hy-lyricbar__text', bar);
      const trackEl = $('.hy-lyricbar__text-track', bar);
      const baseEl = $('.hy-lyricbar__text-base', bar);
      const hiEl = $('.hy-lyricbar__text-hi', bar);
      return { bar, boxEl, trackEl, baseEl, hiEl };
    })();

    let lyricMarqueeAnim = null;

    function setLyricLine(text) {
      if (!lyricBar) return;
      const t = typeof text === 'string' ? text : '';
      if (lyricBar.baseEl) lyricBar.baseEl.textContent = t;
      if (lyricBar.hiEl) lyricBar.hiEl.textContent = t;
      if (lyricBar.boxEl) lyricBar.boxEl.style.setProperty('--hy-lyric-pct', '0%');

      if (lyricMarqueeAnim) {
        try {
          lyricMarqueeAnim.cancel();
        } catch {}
        lyricMarqueeAnim = null;
      }

      // 长歌词滚动（marquee）：只在超出容器宽度时启用
      if (lyricBar.boxEl && lyricBar.trackEl) {
        const prefersReduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReduce) return;

        requestAnimationFrame(() => {
          const boxW = lyricBar.boxEl.clientWidth || 0;
          const trackW = lyricBar.trackEl.scrollWidth || 0;
          const dist = Math.max(0, trackW - boxW);
          if (dist <= 8) return;

          // 先停顿再滚动，避免一上来就跑
          const duration = Math.min(22000, 9000 + dist * 18);
          lyricMarqueeAnim = lyricBar.trackEl.animate(
            [{ transform: 'translateX(0px)' }, { transform: `translateX(${-dist}px)` }],
            { duration, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out', delay: 450 },
          );
        });
      }
    }

    function renderLyrics(items) {
      lyricItems = items || [];
      activeLyricIndex = -1;
      setLyricLine('');

      lyricLineEls = [];
      if (lyricsScrollerEl) lyricsScrollerEl.innerHTML = '';
      if (!lyricsScrollerEl || lyricItems.length === 0) return;

      const frag = document.createDocumentFragment();
      for (let i = 0; i < lyricItems.length; i++) {
        const it = lyricItems[i];
        if (!it || typeof it.text !== 'string') continue;
        const line = document.createElement('div');
        line.className = 'hy-lyrics__line';
        line.setAttribute('role', 'listitem');
        line.dataset.index = String(i);
        line.textContent = it.text.trim() || '…';
        frag.appendChild(line);
        lyricLineEls[i] = line;
      }
      lyricsScrollerEl.appendChild(frag);
    }

    function setLyricsOpen(nextOpen) {
      lyricsOpen = Boolean(nextOpen);
      if (lyricsEl) lyricsEl.classList.toggle('is-open', lyricsOpen);
      if (!lyricsOpen) return;
      // 打开时立刻对齐当前行
      requestAnimationFrame(() => {
        if (activeLyricIndex >= 0) highlightLyricsLine(activeLyricIndex, { center: true, smooth: false });
      });
    }

    function highlightLyricsLine(index, { center, smooth } = { center: false, smooth: true }) {
      if (!lyricsScrollerEl) return;
      const el = lyricLineEls[index];
      if (!el) return;

      for (let i = 0; i < lyricLineEls.length; i++) {
        const item = lyricLineEls[i];
        if (!item) continue;
        item.classList.toggle('is-active', i === index);
      }

      if (!center) return;
      const parent = lyricsScrollerEl;
      const parentRect = parent.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      const currentTop = parent.scrollTop;
      const delta = rect.top - parentRect.top;
      const target = Math.max(0, currentTop + delta - parentRect.height / 2 + rect.height / 2);
      parent.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' });
    }

    function updateLyricHighlight(currentTime) {
      if (!lyricItems || lyricItems.length === 0) return;

      let nextIndex = -1;
      for (let i = 0; i < lyricItems.length; i++) {
        const t = lyricItems[i].time;
        if (t === null) continue;
        if (currentTime + 0.05 >= t) nextIndex = i;
      }

      if (nextIndex === activeLyricIndex) return;
      activeLyricIndex = nextIndex;
      const line = activeLyricIndex >= 0 ? lyricItems[activeLyricIndex]?.text : '';
      const fallback = `${titleEl.textContent || '随机歌曲'} - ${artistEl.textContent || '未知歌手'}`;
      setLyricLine(line || fallback);
      if (lyricsOpen && activeLyricIndex >= 0) {
        highlightLyricsLine(activeLyricIndex, { center: true, smooth: true });
      } else if (activeLyricIndex >= 0) {
        highlightLyricsLine(activeLyricIndex, { center: false, smooth: false });
      }
    }

    function updateLyricProgress(currentTime) {
      if (!lyricBar || !lyricBar.boxEl) return;
      if (!lyricItems || lyricItems.length === 0) return;
      if (activeLyricIndex < 0) return;

      const cur = lyricItems[activeLyricIndex];
      if (!cur || cur.time === null || !Number.isFinite(cur.time)) return;

      let nextTime = null;
      for (let i = activeLyricIndex + 1; i < lyricItems.length; i++) {
        const t = lyricItems[i].time;
        if (t === null) continue;
        if (Number.isFinite(t) && t > cur.time) {
          nextTime = t;
          break;
        }
      }

      const start = cur.time;
      const end = nextTime !== null ? nextTime : start + 6;
      const denom = Math.max(0.25, end - start);
      const p = Math.max(0, Math.min(1, (currentTime - start) / denom));
      lyricBar.boxEl.style.setProperty('--hy-lyric-pct', `${Math.round(p * 100)}%`);
    }

    function updateProgress() {
      const duration = audio.duration || 0;
      const current = audio.currentTime || 0;
      curEl.textContent = formatTime(current);
      durEl.textContent = duration ? formatTime(duration) : '00:00';

      const percent = duration ? Math.min(100, Math.max(0, (current / duration) * 100)) : 0;
      progressFillEl.style.width = `${percent}%`;
      progressEl.setAttribute('aria-valuenow', String(Math.round(percent)));

      updateLyricHighlight(current);
      updateLyricProgress(current);
    }

    function seekToClientX(clientX) {
      const rect = progressEl.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      const duration = audio.duration || 0;
      if (!duration) return;
      audio.currentTime = Math.max(0, Math.min(duration, ratio * duration));
    }

    async function loadRandomTrack({ autoPlay, query, artist, trackId, powAttempted } = { autoPlay: false, query: '', artist: '', trackId: '', powAttempted: false }) {
      if (isLoading) return;
      isLoading = true;
      const q = typeof query === 'string' ? query.trim() : '';
      const a = typeof artist === 'string' ? artist.trim() : '';
      const tid = typeof trackId === 'string' || typeof trackId === 'number' ? String(trackId).trim() : '';
      if (tid) setStatus('正在加载歌曲…');
      else if (a) setStatus(`正在范围随机：${a}`);
      else setStatus(q ? '正在搜索歌曲…' : '正在随机获取歌曲…');
      titleEl.textContent = '加载中…';
      artistEl.textContent = '请稍候';
      coverEl.removeAttribute('src');
      if (panelEl) {
        panelEl.classList.remove('has-coverbg');
        panelEl.style.removeProperty('--hy-player-cover-bg');
      }
      renderLyrics([]);

      let lastPayload = null;
      try {
        const params = new URLSearchParams();
        params.set('_', String(Date.now()));
        if (platformId) params.set('platform', platformId);
        if (tid) params.set('id', tid);
        else if (a) params.set('artist', a);
        else if (q) params.set('q', q);
        const url = `${apiUrl}?${params.toString()}`;
        lastPayload = await fetchJsonOrText(url);

        // 后端 PoW 门禁：自动解题一次后重试
        if (
          lastPayload &&
          typeof lastPayload === 'object' &&
          lastPayload.error === 'POW_REQUIRED' &&
          lastPayload.challenge &&
          lastPayload.verifyUrl &&
          !powAttempted
        ) {
          try {
            setStatus('访问频繁，正在算力验证…');
            const controller = new AbortController();
            const nonce = await solvePow({
              token: String(lastPayload.challenge.token || ''),
              difficultyHexZeros: Number(lastPayload.challenge.difficultyHexZeros || 0),
              signal: controller.signal,
            });
            await verifyPow({
              verifyUrl: String(lastPayload.verifyUrl),
              token: String(lastPayload.challenge.token || ''),
              nonce,
              apiBaseUrl,
            });
            await loadRandomTrack({ autoPlay, query: q, artist: a, trackId: tid, powAttempted: true });
            return;
          } catch {
            setToggleIcon(false);
            setStatus('验证失败，请稍后再试');
            return;
          }
        }

        const track = normalizeTrack(lastPayload);
        if (!track) throw new Error('无法解析歌曲数据');

        titleEl.textContent = track.title;
        artistEl.textContent = track.artist;
        setCapText(track.title, track.artist);
        if (track.cover) coverEl.src = track.cover;
        if (panelEl && track.cover) {
          const u = String(track.cover);
          const safe = u.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          panelEl.style.setProperty('--hy-player-cover-bg', `url("${safe}")`);
          panelEl.classList.add('has-coverbg');
        }
        setLyricLine(`${track.title} - ${track.artist}`);

        audio.src = track.url;
        audio.load();

        const lyricText = await resolveLyric(track.lyric);
        renderLyrics(parseLrc(lyricText));

        setStatus(autoPlay ? '加载完成' : '已准备，点击播放');
        if (autoPlay) {
          // 浏览器自动播放策略：多数情况下“无交互有声播放”会被拦截。
          // 策略：若用户偏好“非静音”（isMuted=false），先尝试有声自动播；失败则降级静音自动播。
          const preferredMuted = isMuted;

          const tryPlay = async () => {
            await audio.play();
            setToggleIcon(true);
          };

          if (!preferredMuted) {
            isMuted = false;
            audio.muted = false;
            audio.volume = userVolume;
            setMuteIcon();
            try {
              await tryPlay();
              setStatus('');
              hasUnlockedSound = true;
            } catch {
              // 回退为静音自动播（不覆盖用户“偏好非静音”的持久化记录）
              isMuted = true;
              audio.muted = true;
              audio.volume = 0;
              setMuteIcon();
              try {
                await tryPlay();
                setStatus('已静音播放（首次交互自动开声）');
              } catch {
                setToggleIcon(false);
                setStatus('需要手动允许播放');
              }
            }
          } else {
            // 默认静音自动播：最大化成功率
            isMuted = true;
            audio.muted = true;
            audio.volume = 0;
            setMuteIcon();
            try {
              await tryPlay();
              setStatus('已静音播放（点击页面任意位置启用声音）');
            } catch {
              setToggleIcon(false);
              setStatus('需要手动允许播放');
            }
          }
        } else {
          setToggleIcon(false);
        }
      } catch (e) {
        setToggleIcon(false);
        const messageFromApi =
          lastPayload && typeof lastPayload === 'object'
            ? (lastPayload.message || lastPayload.msg || lastPayload.error || '')
            : '';
        setStatus(messageFromApi ? String(messageFromApi).slice(0, 60) : '获取失败，点“换一首”重试');
        titleEl.textContent = '随机歌曲';
        artistEl.textContent = '加载失败';
        setCapText('随机歌曲', '加载失败');
      } finally {
        isLoading = false;
      }
    }

    toggleBtn.addEventListener('click', async () => {
      if (isLoading) return;
      if (!audio.src) {
        await loadRandomTrack({ autoPlay: true, artist: scopeArtist || '' });
        return;
      }
      if (audio.paused) {
        try {
          await audio.play();
          setToggleIcon(true);
          setStatus('');
        } catch {
          setToggleIcon(false);
          setStatus('需要手动允许播放');
        }
      } else {
        audio.pause();
        setToggleIcon(false);
      }
    });

    nextBtn.addEventListener('click', () => loadRandomTrack({ autoPlay: true, artist: scopeArtist || '' }));

    // 用“用户手势”解锁有声播放（浏览器自动播放策略要求）
    async function unlockSoundByGesture() {
      if (isLoading) return;
      if (!audio.src) {
        await loadRandomTrack({ autoPlay: true, artist: scopeArtist || '' });
        return;
      }

      if (!userToggledMute && isMuted) {
        isMuted = false;
        if (!userVolume) userVolume = normalizeVolume(lastNonZeroVolume, { allowZero: false });
        applyVolume();
      }

      try {
        await audio.play();
        setToggleIcon(true);
        if (!isMuted) setStatus('');
        hasUnlockedSound = !isMuted;
      } catch {
        setToggleIcon(false);
        setStatus('需要手动允许播放');
      }
    }

    // 点击封面/标题区域也可播放，降低“不会播”的挫败感
    const mainArea = $('.hy-player__main', container);
    mainArea.addEventListener('pointerdown', (e) => {
      // 避免抢按钮点击
      if (e.target && e.target.closest && e.target.closest('button')) return;
      unlockSoundByGesture();
    });

    // 页面任意一次用户交互：尝试解锁“有声播放”（一次性）
    function bindGlobalUnlock() {
      const handler = () => {
        if (hasUnlockedSound || userToggledMute) return;
        unlockSoundByGesture().finally(() => {
          if (hasUnlockedSound || userToggledMute) {
            document.removeEventListener('pointerdown', handler, true);
            document.removeEventListener('keydown', handler, true);
            document.removeEventListener('touchstart', handler, true);
          }
        });
      };
      document.addEventListener('pointerdown', handler, true);
      document.addEventListener('keydown', handler, true);
      document.addEventListener('touchstart', handler, true);
    }

    if (soundBtn && volumePopoverEl) {
      let soundPressTimer = null;
      let suppressSoundClick = false;

      const openVolume = () => {
        volumePopoverEl.classList.add('is-open');
        setTimeout(() => volumeRangeEl && volumeRangeEl.focus(), 0);
      };

      soundBtn.addEventListener('pointerdown', () => {
        suppressSoundClick = false;
        if (soundPressTimer) clearTimeout(soundPressTimer);
        soundPressTimer = setTimeout(() => {
          suppressSoundClick = true;
          openVolume();
        }, 380);
      });

      soundBtn.addEventListener('pointerup', () => {
        if (soundPressTimer) clearTimeout(soundPressTimer);
        soundPressTimer = null;
      });

      soundBtn.addEventListener('pointercancel', () => {
        if (soundPressTimer) clearTimeout(soundPressTimer);
        soundPressTimer = null;
      });

      soundBtn.addEventListener('click', async (e) => {
        if (suppressSoundClick) {
          e.preventDefault();
          return;
        }

        userToggledMute = true;
        if (isMuted) {
          isMuted = false;
          if (!userVolume) userVolume = normalizeVolume(lastNonZeroVolume, { allowZero: false });
        } else {
          if (userVolume > 0) lastNonZeroVolume = userVolume;
          isMuted = true;
        }
        applyVolume();

        if (!isMuted && audio.paused && audio.src) {
          try {
            await audio.play();
            setToggleIcon(true);
            setStatus('');
            hasUnlockedSound = true;
          } catch {
            setToggleIcon(false);
            setStatus('需要手动允许播放');
          }
        }
        if (isMuted && !audio.paused) {
          setStatus('已静音播放');
        }
      });

      soundBtn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openVolume();
      });

      document.addEventListener('pointerdown', (e) => {
        if (!volumePopoverEl.classList.contains('is-open')) return;
        const volumeRoot = e.target && e.target.closest ? e.target.closest('.hy-volume') : null;
        if (!volumeRoot) volumePopoverEl.classList.remove('is-open');
      });
    }

    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        const title = String(titleEl.textContent || '').trim();
        const artist = String(artistEl.textContent || '').trim();
        const q = sanitizeQueryText([title, artist].filter(Boolean).join(' - '));

        const url = new URL(location.href);
        if (q) url.searchParams.set('hy_q', q);
        else url.searchParams.delete('hy_q');

        const shareText = url.toString();
        try {
          await navigator.clipboard.writeText(shareText);
          setStatus('分享链接已复制');
        } catch {
          window.prompt('复制分享链接（手动复制）', shareText);
          setStatus('');
        } finally {
          closeMoreMenus();
        }
      });
    }

    if (helpBtn) {
      helpBtn.addEventListener('click', () => {
        window.alert(
          [
            '说明文档（点歌/随机/设置）',
            '',
            '0) 完全随机 / 范围随机（歌手）/ 列表选歌',
            '   - 完全随机：点“换一首”',
            '   - 范围随机：点“点歌(放大镜)”→ 输入歌手名（或“歌名 - 歌手”）→ 点“骰子”',
            '   - 列表选歌：点“点歌(放大镜)”→ 输入歌手名 → 点“列表”→ 选择歌曲播放',
            '   - 范围随机会记住你的歌手；之后“换一首/播完自动换歌”会继续在该范围内随机',
            '   - 切回全局随机：点播放器信息区的小圆点（范围指示点）',
            '   - 开启范围随机后，“换一首”按钮会高亮提示当前范围',
            '',
            '1) 怎么找歌（更精准）',
            '   - 推荐输入：歌名 - 歌手（例如：稻香 - 周杰伦）',
            '   - 也支持：歌名/歌手、歌名@歌手、歌名|歌手',
            '',
            '1.1) 设置（...）',
            '   - 循环播放：开/关单曲循环（开启后播完不会自动换一首）',
            '   - 音源：选择搜索/解析平台（部分平台可能不可用；不可用时会提示失败或自动降级）',
            '   - 随机范围：播放器信息区小圆点显示；点一下可切回全局随机/设置范围',
            '   - 底部歌词：显示/隐藏下方歌词条',
            '',
            '2) 怎么调音量/静音',
            '   - 声音键：单击 静音/取消静音',
            '   - 声音键：长按（约0.4秒）或右键 打开音量滑块',
            '',
            '3) 怎么分享歌曲',
            '   - 点“分享”复制链接（链接会带 hy_q，打开即可自动点歌）',
            '',
            '4) 歌词面板',
            '   - 点击底部歌词条：展开/收起多行歌词（自动居中高亮当前行）',
            '',
            '提示：若浏览器拦截有声自动播放，点击页面任意位置一次即可开声。',
          ].join('\n'),
        );
        closeMoreMenus();
      });
    }

    if (moreBtn && morePopoverEl) {
      moreBtn.addEventListener('click', () => {
        morePopoverEl.classList.toggle('is-open');
        if (!morePopoverEl.classList.contains('is-open')) setPlatformMenuOpen(false);
        if (morePopoverEl.classList.contains('is-open')) requestAnimationFrame(positionPlatformMenu);
      });

      document.addEventListener('pointerdown', (e) => {
        if (!morePopoverEl.classList.contains('is-open')) return;
        const root = e.target && e.target.closest ? e.target.closest('.hy-more') : null;
        if (!root) closeMoreMenus();
      });
    }

    if (searchBtn && searchPopoverEl) {
      searchBtn.addEventListener('click', () => {
        searchPopoverEl.classList.toggle('is-open');
        if (searchPopoverEl.classList.contains('is-open')) {
          if (searchResultsEl) searchResultsEl.innerHTML = '';
          setTimeout(() => searchInputEl && searchInputEl.focus(), 0);
        } else {
          if (searchResultsEl) searchResultsEl.innerHTML = '';
        }
      });

      document.addEventListener('pointerdown', (e) => {
        if (!searchPopoverEl.classList.contains('is-open')) return;
        const searchRoot = e.target && e.target.closest ? e.target.closest('.hy-search') : null;
        if (!searchRoot) {
          searchPopoverEl.classList.remove('is-open');
          if (searchResultsEl) searchResultsEl.innerHTML = '';
        }
      });
    }

    async function playByQuery() {
      if (!searchInputEl) return;
      const q = sanitizeQueryText(String(searchInputEl.value || ''));
      if (!q) return;
      searchPopoverEl && searchPopoverEl.classList.remove('is-open');
      if (searchResultsEl) searchResultsEl.innerHTML = '';
      await loadRandomTrack({ autoPlay: true, query: q });
    }

    function extractArtistFromSearchInput() {
      if (!searchInputEl) return '';
      const raw = sanitizeQueryText(String(searchInputEl.value || ''), 60);
      if (!raw) return '';
      const m = raw.match(/^(.+?)\\s*[-—–\\/\\|@]+\\s*(.+)$/u);
      const artist = m && m[2] ? String(m[2]) : raw;
      return sanitizeQueryText(artist, 30);
    }

    function renderSearchResults(items) {
      if (!searchResultsEl) return;
      searchResultsEl.innerHTML = '';
      if (!Array.isArray(items) || items.length === 0) return;

      const frag = document.createDocumentFragment();
      for (const it of items) {
        if (!it || (typeof it !== 'object')) continue;
        const rid = String(it.rid || '').trim();
        if (!rid) continue;
        const name = typeof it.name === 'string' ? it.name.trim() : '';
        const artist = typeof it.artist === 'string' ? it.artist.trim() : '';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hy-search__result';
        btn.dataset.rid = rid;
        btn.title = `${name}${artist ? ` - ${artist}` : ''}`;
        btn.textContent = `${name}${artist ? ` - ${artist}` : ''}`;
        btn.addEventListener('click', async () => {
          searchPopoverEl && searchPopoverEl.classList.remove('is-open');
          if (searchResultsEl) searchResultsEl.innerHTML = '';
          await loadRandomTrack({ autoPlay: true, trackId: rid });
        });
        frag.appendChild(btn);
      }
      searchResultsEl.appendChild(frag);
    }

    async function listSongsByArtist() {
      const artist = extractArtistFromSearchInput();
      if (!artist) return;
      setScopeArtist(artist, { notify: true });
      if (searchResultsEl) searchResultsEl.innerHTML = '';
      setStatus(`正在获取歌手列表：${artist}`);

      try {
        const params = new URLSearchParams();
        params.set('artist', artist);
        params.set('list', '1');
        params.set('limit', '25');
        params.set('_', String(Date.now()));
        if (platformId) params.set('platform', platformId);
        const url = `${apiUrl}?${params.toString()}`;
        const payload = await fetchJsonOrText(url);
        const items = payload && typeof payload === 'object' ? payload.items : null;
        renderSearchResults(Array.isArray(items) ? items : []);
        if (!Array.isArray(items) || items.length === 0) setStatus('未找到可选歌曲');
        else setStatus('');
      } catch {
        setStatus('列表获取失败');
      }
    }

    async function playRandomByArtist() {
      const artist = extractArtistFromSearchInput();
      if (!artist) return;
      setScopeArtist(artist, { notify: true });
      searchPopoverEl && searchPopoverEl.classList.remove('is-open');
      if (searchResultsEl) searchResultsEl.innerHTML = '';
      await loadRandomTrack({ autoPlay: true, artist });
    }

    if (searchPlayBtn) {
      searchPlayBtn.addEventListener('click', () => {
        playByQuery();
      });
    }

    if (searchListBtn) {
      searchListBtn.addEventListener('click', () => {
        listSongsByArtist();
      });
    }

    if (searchArtistRandomBtn) {
      searchArtistRandomBtn.addEventListener('click', () => {
        playRandomByArtist();
      });
    }

    if (searchInputEl) {
      searchInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          playByQuery();
        }
      });
    }

    if (volumeRangeEl) {
      volumeRangeEl.addEventListener('input', () => {
        userVolume = Math.max(0, Math.min(1, Number(volumeRangeEl.value)));
        if (userVolume === 0) {
          isMuted = true;
        } else {
          isMuted = false;
          lastNonZeroVolume = userVolume;
        }
        applyVolume();
        try {
          localStorage.setItem('hy_player_vol', String(userVolume));
        } catch {}
      });
    }

    if (hideBtn) hideBtn.addEventListener('click', () => setHidden(true));
    if (showBtn) showBtn.addEventListener('click', () => setHidden(false));

    if (scopePillBtn) {
      scopePillBtn.addEventListener('click', () => {
        if (scopeArtist) {
          setScopeArtist('', { notify: true });
          return;
        }
        flashStatus('未设置范围随机：用“点歌”里的骰子/列表选择歌手范围', 2200);
        if (searchPopoverEl && searchInputEl) {
          searchPopoverEl.classList.add('is-open');
          if (searchResultsEl) searchResultsEl.innerHTML = '';
          setTimeout(() => searchInputEl.focus(), 0);
        }
      });
    }

    if (loopBtn) {
      loopBtn.addEventListener('click', () => {
        setLoop(!isLoop);
        closeMoreMenus();
      });
    }

    if (platformMenuBtn && platformMenuEl) {
      platformMenuBtn.addEventListener('click', () => {
        if (!morePopoverEl || !morePopoverEl.classList.contains('is-open')) return;
        setPlatformMenuOpen(!platformMenuEl.classList.contains('is-open'));
      });
    }

    window.addEventListener('resize', () => requestAnimationFrame(positionPlatformMenu));

    for (const el of platformOptionEls) {
      if (!el) continue;
      el.addEventListener('click', () => {
        const id = String(el.getAttribute('data-platform') || '').trim();
        if (!id) return;
        setPlatform(id, { notify: true });
        closeMoreMenus();
      });
    }

    if (lyricBarToggleBtn) {
      lyricBarToggleBtn.addEventListener('click', () => {
        setLyricBarHidden(!isLyricBarHidden);
        closeMoreMenus();
      });
    }

    if (lyricBar && lyricBar.boxEl) {
      lyricBar.boxEl.style.pointerEvents = 'auto';
      lyricBar.boxEl.style.cursor = 'pointer';
      lyricBar.boxEl.addEventListener('click', () => setLyricsOpen(!lyricsOpen));
    }

    if (lyricsCloseBtn) lyricsCloseBtn.addEventListener('click', () => setLyricsOpen(false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && lyricsOpen) setLyricsOpen(false);
    });
    document.addEventListener('pointerdown', (e) => {
      if (!lyricsOpen) return;
      const root = e.target && e.target.closest ? e.target.closest('.hy-lyrics') : null;
      const clickedPlayer = e.target && e.target.closest ? e.target.closest('.hy-player') : null;
      if (!root && clickedPlayer) setLyricsOpen(false);
    });

    if (switchBtn) {
      switchBtn.addEventListener('click', () => {
        closeMoreMenus();
        const ok = window.confirm(
          '将切换到第三方音乐播放器（会记住你的选择）。\n\n切换后会自动刷新页面。\n\n是否确认切换？',
        );
        if (!ok) return;
        setMode(MODE_THIRD);
        location.reload();
      });
    }

    progressEl.addEventListener('click', (e) => seekToClientX(e.clientX));
    progressEl.addEventListener('keydown', (e) => {
      const duration = audio.duration || 0;
      if (!duration) return;
      const step = 5;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        audio.currentTime = Math.max(0, (audio.currentTime || 0) - step);
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        audio.currentTime = Math.min(duration, (audio.currentTime || 0) + step);
      }
    });

    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', updateProgress);
    audio.addEventListener('play', () => setToggleIcon(true));
    audio.addEventListener('pause', () => setToggleIcon(false));
    audio.addEventListener('ended', () => {
      if (audio.loop) return;
      loadRandomTrack({ autoPlay: true, artist: scopeArtist || '' });
    });
    audio.addEventListener('error', () => setStatus('播放失败，点“换一首”'));

    try {
      const savedHidden = localStorage.getItem('hy_player_hidden');
      setHidden(savedHidden === '1');
    } catch {
      setHidden(false);
    }

    try {
      const savedLoop = localStorage.getItem(STORAGE_LOOP_KEY);
      setLoop(savedLoop === '1', { persist: false });
    } catch {
      setLoop(false, { persist: false });
    }

    try {
      const savedPlatform = String(localStorage.getItem(STORAGE_PLATFORM_KEY) || '').trim();
      setPlatform(savedPlatform || 'kuwo', { persist: false, notify: false });
    } catch {
      setPlatform('kuwo', { persist: false, notify: false });
    }

    try {
      const savedScopeArtist = String(localStorage.getItem(STORAGE_SCOPE_ARTIST_KEY) || '').trim();
      setScopeArtist(savedScopeArtist, { persist: false, notify: false });
    } catch {
      setScopeArtist('', { persist: false, notify: false });
    }

    try {
      const savedLyricBarHidden = localStorage.getItem(STORAGE_LYRICBAR_HIDDEN_KEY);
      setLyricBarHidden(savedLyricBarHidden === '1', { persist: false });
    } catch {
      setLyricBarHidden(false, { persist: false });
    }

    try {
      const savedVol = Number(localStorage.getItem('hy_player_vol'));
      if (Number.isFinite(savedVol) && savedVol >= 0 && savedVol <= 1) userVolume = normalizeVolume(savedVol, { allowZero: true });
      const savedLastVol = Number(localStorage.getItem('hy_player_last_vol'));
      if (Number.isFinite(savedLastVol) && savedLastVol > 0 && savedLastVol <= 1) lastNonZeroVolume = normalizeVolume(savedLastVol, { allowZero: false });
      if (userVolume > 0) lastNonZeroVolume = userVolume;
      const savedMuted = localStorage.getItem('hy_player_muted');
      // 默认优先“有声自动播”（可能被浏览器拦截）；若用户曾设置静音/取消静音，这里会记住
      isMuted = savedMuted === null ? false : savedMuted !== '0';
    } catch {}

    // 不强行覆盖用户偏好；后续由 loadRandomTrack 决定是否可“有声自动播”，失败则自动降级静音
    applyVolume({ persist: false });
    if (volumeRangeEl) volumeRangeEl.value = String(userVolume);

    const hyQ = (() => {
      try {
        const q = new URLSearchParams(location.search).get('hy_q') || '';
        return sanitizeQueryText(q);
      } catch {
        return '';
      }
    })();
    if (hyQ && searchInputEl) searchInputEl.value = hyQ;
    if (config.autoPlayOnInit) {
      if (hyQ) loadRandomTrack({ autoPlay: true, query: hyQ });
      else if (scopeArtist) loadRandomTrack({ autoPlay: true, artist: scopeArtist });
      else loadRandomTrack({ autoPlay: true });
    }
    bindGlobalUnlock();
    return { container, audio, config };
  }

  function enableThirdPartyPlayer() {
    // 注入第三方脚本（避免改动 index.php 的注释块）
    if (!document.getElementById('myhk')) {
      const injectMyhk = () => {
        const s = document.createElement('script');
        s.id = 'myhk';
        s.src = THIRD_PLAYER.script;
        s.setAttribute('key', THIRD_PLAYER.key);
        s.setAttribute('m', THIRD_PLAYER.m);
        document.body.appendChild(s);
      };

      if (!window.jQuery) {
        const jq = document.createElement('script');
        jq.src = THIRD_PLAYER.jquery;
        jq.onload = injectMyhk;
        document.head.appendChild(jq);
      } else {
        injectMyhk();
      }
    }
  }

  window.HYPlayer = Object.assign(window.HYPlayer || {}, {
    init,
  });
})();
