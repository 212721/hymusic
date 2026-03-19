<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HY Music Player Embed Demo</title>
<meta name="description" content="上传目录后，通过一段脚本即可在任意页面调用 HY 音乐播放器。">
<style>
  :root {
    color-scheme: dark;
    --page-bg: #070b12;
    --page-panel: rgba(9, 14, 24, 0.72);
    --page-border: rgba(255, 255, 255, 0.12);
    --page-text: rgba(255, 248, 228, 0.96);
    --page-muted: rgba(226, 217, 193, 0.72);
    --page-accent: #d4af37;
    --page-accent-soft: rgba(212, 175, 55, 0.18);
  }

  * {
    box-sizing: border-box;
  }

  html,
  body {
    min-height: 100%;
  }

  body {
    margin: 0;
    font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
    color: var(--page-text);
    background:
      radial-gradient(circle at top left, rgba(86, 42, 12, 0.36), transparent 32%),
      radial-gradient(circle at top right, rgba(45, 62, 120, 0.28), transparent 28%),
      linear-gradient(160deg, #05070b 0%, #0a1220 45%, #0c0f17 100%);
    overflow-x: hidden;
  }

  body::before,
  body::after {
    content: "";
    position: fixed;
    inset: auto;
    border-radius: 999px;
    pointer-events: none;
    filter: blur(16px);
    opacity: 0.72;
  }

  body::before {
    width: 280px;
    height: 280px;
    top: 8vh;
    left: -90px;
    background: radial-gradient(circle, rgba(212, 175, 55, 0.28), transparent 70%);
  }

  body::after {
    width: 360px;
    height: 360px;
    right: -120px;
    bottom: 8vh;
    background: radial-gradient(circle, rgba(96, 165, 250, 0.18), transparent 70%);
  }

  .page-shell {
    position: relative;
    max-width: 920px;
    margin: 0 auto;
    padding: 40px 20px 80px;
  }

  .hero,
  .code-card,
  .demo-card {
    border: 1px solid var(--page-border);
    border-radius: 26px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.01)),
      var(--page-panel);
    box-shadow:
      0 24px 80px rgba(0, 0, 0, 0.42),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
  }

  .hero {
    padding: 34px;
  }

  .eyebrow {
    margin: 0 0 14px;
    color: var(--page-accent);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.32em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    font-size: clamp(38px, 8vw, 72px);
    line-height: 0.98;
    letter-spacing: -0.04em;
  }

  .summary {
    margin: 18px 0 0;
    max-width: 640px;
    color: var(--page-muted);
    font-size: 16px;
    line-height: 1.75;
  }

  .feature-grid,
  .code-grid {
    display: grid;
    gap: 16px;
    margin-top: 26px;
  }

  .feature-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .code-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-top: 22px;
  }

  .feature-card,
  .code-card,
  .demo-card {
    padding: 18px;
  }

  .feature-card {
    min-height: 138px;
    border-radius: 20px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.03)),
      rgba(9, 12, 19, 0.54);
  }

  .feature-card strong,
  .code-card strong,
  .demo-card strong {
    display: block;
    margin-bottom: 10px;
    color: var(--page-text);
    font-size: 15px;
  }

  .feature-card p,
  .code-card p,
  .demo-card p {
    margin: 0;
    color: var(--page-muted);
    font-size: 13px;
    line-height: 1.75;
  }

  .feature-card--accent {
    border-color: rgba(212, 175, 55, 0.22);
    box-shadow: inset 0 0 0 1px var(--page-accent-soft);
  }

  .code-card pre {
    margin: 12px 0 0;
    padding: 16px;
    border-radius: 18px;
    background: rgba(0, 0, 0, 0.32);
    border: 1px solid rgba(255, 255, 255, 0.06);
    color: #f5f1df;
    overflow-x: auto;
    font-size: 12px;
    line-height: 1.7;
  }

  .demo-card {
    margin-top: 22px;
  }

  .demo-mount {
    margin-top: 16px;
    min-height: 270px;
    padding: 24px 20px;
    border-radius: 20px;
    background: rgba(0, 0, 0, 0.22);
    border: 1px dashed rgba(255, 255, 255, 0.14);
  }

  .path-line {
    margin-top: 16px;
    color: var(--page-muted);
    font-size: 13px;
    line-height: 1.7;
  }

  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  }

  @media (max-width: 820px) {
    .feature-grid,
    .code-grid {
      grid-template-columns: 1fr;
    }

    .hero {
      padding: 24px;
    }
  }
</style>
</head>
<body>
<main class="page-shell">
  <section class="hero" aria-label="音乐播放器嵌入说明">
    <p class="eyebrow">HY Music Player Embed</p>
    <h1>上传目录，插入代码，即可调用播放器</h1>
    <p class="summary">这个目录已经改造成可嵌入组件。用户只要把整个 <code>hy-player</code> 目录上传到自己网站，再在页面里插入一段脚本，就能像明月浩空播放器那样调用悬浮播放器或内嵌播放器。</p>

    <div class="feature-grid">
      <article class="feature-card feature-card--accent">
        <strong>固定悬浮</strong>
        <p>适合个人主页、导航页、博客首页。播放器会固定在页面角落，保留歌词条与悬浮交互。</p>
      </article>
      <article class="feature-card">
        <strong>容器内嵌</strong>
        <p>支持挂到指定容器节点，便于放进文章页、作品页、控制台页，不污染整页布局。</p>
      </article>
      <article class="feature-card">
        <strong>本地接口</strong>
        <p>音乐接口和 PoW 校验都走组件目录内的 <code>api/</code>，上传到子目录后也能自动定位。</p>
      </article>
    </div>

    <div class="code-grid">
      <article class="code-card">
        <strong>固定悬浮模式</strong>
        <p>不需要容器，贴到页面底部即可。</p>
<pre><code>&lt;script&gt;
window.HYPlayerConfig = {
  baseUrl: "/hy-player",
  mode: "fixed"
};
&lt;/script&gt;
&lt;script src="/hy-player/embed.js" defer&gt;&lt;/script&gt;</code></pre>
      </article>

      <article class="code-card">
        <strong>容器内嵌模式</strong>
        <p>先准备容器，再指定 <code>mount</code> 选择器。</p>
<pre><code>&lt;div id="hy-player-root"&gt;&lt;/div&gt;
&lt;script&gt;
window.HYPlayerConfig = {
  baseUrl: "/hy-player",
  mode: "inline",
  mount: "#hy-player-root"
};
&lt;/script&gt;
&lt;script src="/hy-player/embed.js" defer&gt;&lt;/script&gt;</code></pre>
      </article>
    </div>

    <div class="demo-card">
      <strong>当前页面演示</strong>
      <p>下面这个实例就是通过 <code>embed.js</code> 挂到页面容器里的内嵌播放器。</p>
      <div id="hy-player-demo" class="demo-mount"></div>
      <p class="path-line">建议发布时把当前目录整体改名为 <code>hy-player</code>，然后原样上传即可。</p>
    </div>
  </section>
</main>

<script>
window.HYPlayerConfig = {
  baseUrl: '.',
  mode: 'inline',
  mount: '#hy-player-demo'
};
</script>
<script src="embed.js" defer></script>
</body>
</html>
