# HY Music Player

一个可嵌入网页的悬浮音乐播放器，部署方式接近“明月浩空播放器”：

- 用户上传整个 `hy-player/` 目录到自己网站
- 在页面插入一段脚本
- 播放器自动挂载到页面
- 音乐接口、歌词、PoW 防刷校验都走组件目录内的本地 `api/`

当前项目既支持固定悬浮模式，也支持挂载到指定容器的内嵌模式。

## 许可证

本项目使用：

- `PolyForm Noncommercial 1.0.0`

你可以在仓库中查看：

- `LICENSE`
- `NOTICE`

这意味着：

- 允许个人学习、研究、测试、非商用二次开发
- 禁止商用
- 分发和二开时，必须保留原项目附带的署名通知

严格来说，这类许可证不属于 OSI 意义上的“开源许可证”，更准确的描述是：

- `source-available`
- 源码公开，但禁止商用

## 功能特性

- 固定悬浮播放器
- 容器内嵌播放器
- 随机歌曲播放
- 点歌、歌手范围随机、歌手列表选歌
- 歌词面板与底部歌词条
- 分享链接
- 多平台音源切换
- 高频请求 PoW 防刷校验
- 支持部署在任意子目录，不要求站点根路径

## 目录结构

```text
hy-player/
  api/
    _hy_music_http.php
    _hy_music_pow.php
    hy_music_random.php
    hy_music_pow_verify.php
    hy_music_config.local.php
    hy_music_config.local.php.example
  css/
    hy-player.css
  js/
    hy-player.js
  data/
    hy_music_pow/
  embed.js
  index.php
  README.md
```

说明：

- `embed.js`：对外唯一推荐入口
- `js/hy-player.js`：播放器核心逻辑
- `api/`：音乐接口与 PoW 校验接口
- `data/hy_music_pow/`：PoW 状态文件目录，需要可写
- `index.php`：演示页，不是必须文件，但建议保留

## 运行要求

- PHP 7.4+ 或 PHP 8.x
- 启用 PHP `curl` 扩展
- Web 服务对 `hy-player/data/hy_music_pow/` 有写权限
- 前端页面可以正常访问外部静态资源

纯静态托管无法直接使用本项目，因为音乐接口依赖 PHP。

## 快速部署

### 1. 上传目录

把整个 `hy-player/` 目录上传到网站，例如：

```text
https://example.com/hy-player/
```

### 2. 配置音源 Key

编辑：

`api/hy_music_config.local.php`

当前仓库内已经包含一个公开测试 Key：

```php
'tunehub_key' => 'th_4ab80b40da9da71bc1397616e1a03f3ef1ceb36ebb584b01'
```

说明：

- 这个 Key 当前是公开放在仓库里的
- 作者不介意公开
- 但不保证它长期可用，也不保证不会被限流
- 你自己部署时，强烈建议替换成你自己的 Key

如果你不替换，项目也许能跑，但后续可用性由你自己承担。

### 3. 检查接口

可先访问：

```text
/hy-player/index.php
```

如果页面能正常出现播放器，说明基础部署通常没问题。

## 接入方式

### 方式一：固定悬浮模式

适合个人主页、导航页、博客首页。

```html
<script>
window.HYPlayerConfig = {
  baseUrl: "/hy-player",
  mode: "fixed"
};
</script>
<script src="/hy-player/embed.js" defer></script>
```

### 方式二：容器内嵌模式

适合文章页、作品页、后台页面。

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

### 方式三：手动初始化

如果你不想自动初始化，可以关闭 `autoInit`，然后自己调用：

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

`window.HYPlayerConfig` 支持以下字段：

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `baseUrl` | `string` | 自动推断 | 组件上传目录路径，例如 `"/hy-player"` |
| `mode` | `string` | `"fixed"` | `"fixed"` 为悬浮模式，`"inline"` 为内嵌模式 |
| `mount` | `string \| HTMLElement` | `null` | 内嵌模式时的挂载目标 |
| `lyricBar` | `boolean` | `true` | 仅固定模式有效，控制底部歌词条是否启用 |
| `autoPlay` | `boolean` | `true` | 初始化后是否自动取歌并尝试播放 |
| `autoInit` | `boolean` | `true` | `embed.js` 是否自动调用 `HYPlayer.init()` |

## 接口说明

主要接口：

- `api/hy_music_random.php`
- `api/hy_music_pow_verify.php`

说明：

- `hy_music_random.php` 负责随机歌曲、按关键词搜索、按歌手随机、按歌手列歌
- 当请求频率过高时，会返回 PoW 挑战
- 前端脚本会自动解题，再自动重试
- `verifyUrl` 现在会自动按当前组件目录生成，不再写死 `/api/...`

这意味着你把组件部署到：

```text
/hy-player
/assets/hy-player
/tool/music/hy-player
```

都可以工作，只要 `baseUrl` 配对正确。

## 已知行为

- 默认会自动取歌并尝试播放
- 浏览器若拦截有声自动播放，播放器会自动降级为静音播放，或提示手动允许播放
- 固定模式下支持隐藏、展开、底部歌词条
- 内嵌模式下会自动关闭“隐藏侧滑”相关交互
- 代码里保留了切换到第三方播放器的逻辑入口

## 安全与公开说明

这个仓库当前包含公开的测试配置文件：

- `api/hy_music_config.local.php`

其中包含可见的 `tunehub_key`。

再次明确：

- 这个 Key 是公开的
- 作者知道它会被看到
- 作者不在乎公开
- 但任何部署者都应该自行替换为自己的 Key

如果你准备长期运行、公开提供服务、或者并发较高，不替换就是不负责任。

## 作者署名要求

本项目通过 `NOTICE` 文件附带 Required Notice，用于要求下游分发和二次开发时保留原项目署名信息。

当前仓库内的署名通知为：

```text
Required Notice: Copyright (c) 2026 HY Music Player
Required Notice: Original project name: hymusic
Required Notice: Derivative works and redistributions must preserve attribution to the original author of hymusic.
```

如果你准备正式公开发布，并希望把署名写成你公开使用的名字、ID 或主页地址，可以直接修改 `NOTICE` 文件中的这些行。

## 开发说明

当前前端入口分层如下：

- `embed.js`：加载器，负责注入样式与脚本
- `js/hy-player.js`：播放器组件本体，暴露 `window.HYPlayer.init()`
- `index.php`：演示页，展示接入方式与内嵌示例

当前后端分层如下：

- `_hy_music_http.php`：轻量 JSON 请求/响应工具
- `_hy_music_pow.php`：PoW 状态与校验逻辑
- `hy_music_random.php`：音乐数据入口
- `hy_music_pow_verify.php`：PoW 校验入口

## 建议补充

如果你准备正式开源，建议你再补以下文件：

- `LICENSE`
- `.gitignore`
- `CHANGELOG.md`

至少先补一个许可证文件，不然别人默认没有明确使用授权。
