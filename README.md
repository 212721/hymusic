# 🎵 HY Music Player

> 可嵌入任意网页的悬浮音乐播放器组件，上传目录、插入一段脚本即可使用。

## 简介

HY Music Player 是一个轻量级的网页音乐播放器，设计理念类似"明月浩空播放器"。它支持**固定悬浮**和**容器内嵌**两种模式，内置随机歌曲、点歌搜索、歌词展示、多平台音源切换等功能，并通过 PoW（工作量证明）机制防止接口被滥用。

### 核心特性

| 特性 | 说明 |
|------|------|
| 🎯 两种模式 | 固定悬浮模式（适合首页/博客）+ 容器内嵌模式（适合文章/后台页） |
| 🎲 随机播放 | 支持全局随机、按歌手随机、按关键词搜索 |
| 📝 歌词展示 | 歌词面板 + 底部滚动歌词条 |
| 🔗 分享功能 | 生成分享链接，方便传播 |
| 🛡️ PoW 防刷 | 高频请求自动触发工作量证明，前端无感解题 |
| 📂 任意路径部署 | 不限制子目录，`baseUrl` 配置正确即可 |

## 环境要求

- **PHP** 7.4+ 或 8.x
- **PHP 扩展**：`curl`
- **目录权限**：`data/hy_music_pow/` 需要可写权限
- **前端**：需能正常加载外部静态资源（Font Awesome 等）

> ⚠️ 本项目依赖 PHP 后端接口，纯静态托管（如 GitHub Pages）无法使用。

## 快速开始

### 第一步：上传目录

将整个项目目录上传至网站，并重命名为 `hy-player`（或任意名称）：

```
https://your-site.com/hy-player/
```

### 第二步：配置音源 Key

编辑 `api/hy_music_config.local.php`，填入你自己的 TuneHub API Key：

```php
'tunehub_key' => 'your_api_key_here'
```

> 仓库内附带了一个公开测试 Key，可直接使用但**不保证长期可用**。正式部署时请务必替换为你自己的 Key。

### 第三步：验证部署

访问演示页确认播放器正常工作：

```
https://your-site.com/hy-player/index.php
```

## 接入方式

### 固定悬浮模式

播放器固定在页面角落，适合个人主页、博客首页等全站场景。

```html
<script>
window.HYPlayerConfig = {
  baseUrl: "/hy-player",
  mode: "fixed"
};
</script>
<script src="/hy-player/embed.js" defer></script>
```

### 容器内嵌模式

播放器挂载到指定 DOM 容器，适合文章页、作品展示页等局部场景。

```html
<div id="hy-player-root"></div>
<script>
window.HYPlayerConfig = {
  baseUrl: "/hy-player",
  mode: "inline",
  mount: "#hy-player-root"
};
</script>
<script src="/hy-player/embed.js" defer></script>
```

### 手动初始化

关闭自动初始化，由你控制播放器启动时机。

```html
<div id="hy-player-root"></div>
<script>
window.HYPlayerConfig = {
  baseUrl: "/hy-player",
  autoInit: false
};
</script>
<script src="/hy-player/embed.js" defer></script>
<script>
document.addEventListener("DOMContentLoaded", function () {
  window.HYPlayer.init({
    baseUrl: "/hy-player",
    mode: "inline",
    mount: "#hy-player-root"
  });
});
</script>
```

## 配置项

通过 `window.HYPlayerConfig` 设置以下选项：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `baseUrl` | `string` | 自动推断 | 组件目录路径，如 `"/hy-player"` |
| `mode` | `string` | `"fixed"` | `"fixed"` 悬浮模式 / `"inline"` 内嵌模式 |
| `mount` | `string \| HTMLElement` | `null` | 内嵌模式的挂载目标（CSS 选择器或 DOM 元素） |
| `lyricBar` | `boolean` | `true` | 底部歌词条开关（仅悬浮模式有效） |
| `autoPlay` | `boolean` | `true` | 初始化后是否自动获取歌曲并播放 |
| `autoInit` | `boolean` | `true` | `embed.js` 加载后是否自动调用 `HYPlayer.init()` |

## 项目结构

```
hy-player/
├── api/                              # 后端接口
│   ├── _hy_music_http.php            # HTTP 请求/响应工具
│   ├── _hy_music_pow.php             # PoW 状态与校验逻辑
│   ├── hy_music_random.php           # 音乐数据接口（随机/搜索/歌手）
│   ├── hy_music_pow_verify.php       # PoW 校验接口
│   ├── hy_music_config.local.php     # 本地配置文件（含 API Key）
│   └── hy_music_config.local.php.example  # 配置模板
├── css/
│   └── hy-player.css                 # 播放器样式
├── js/
│   └── hy-player.js                  # 播放器核心逻辑
├── data/
│   └── hy_music_pow/                 # PoW 状态文件（需要写权限）
├── embed.js                          # 嵌入加载器（对外唯一推荐入口）
├── index.php                         # 演示页面
├── LICENSE                           # PolyForm Noncommercial 1.0.0
├── NOTICE                            # 署名通知
└── README.md
```

## 已知行为

- 初始化后默认自动获取歌曲并尝试播放
- 浏览器拦截有声自动播放时，会自动降级为静音播放或提示用户手动允许
- 悬浮模式支持隐藏/展开、底部歌词条交互
- 内嵌模式自动关闭侧滑隐藏等浮动交互

## 许可证

本项目采用 [PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) 许可证。

**这意味着：**

- ✅ 允许个人学习、研究、测试、非商业二次开发
- ❌ 禁止任何形式的商业用途
- 📋 分发或二次开发时，必须保留 `NOTICE` 文件中的署名信息

> 严格来说，本许可证不属于 OSI 定义的"开源许可证"，更准确的描述是 **source-available**（源码公开，但限制商用）。

## 致谢

```
Copyright (c) 2026 HY Music Player
Original project name: hymusic
```
