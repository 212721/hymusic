<?php
/**
 * 本地音乐 API 配置（本文件已在 .gitignore 中忽略）
 * 测试 key：由用户提供，仅用于本地验证。
 */

return [
    'tunehub_base' => 'https://tunehub.sayqz.com/api',
    'tunehub_key' => 'th_4ab80b40da9da71bc1397616e1a03f3ef1ceb36ebb584b01',
    // TuneHub 文档要求：X-API-Key
    'auth_mode' => 'x_api_key',
    // 目前 TuneHub 未提供“随机歌曲”直出接口：通过“搜索→随机选取→parse”实现
    'allow_fallback' => false,
];
