<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

require_once __DIR__ . '/_hy_music_pow.php';

function respond(int $code, array $payload): void {
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function hy_music_api_self_url(string $file): string
{
    $scriptName = str_replace('\\', '/', (string)($_SERVER['SCRIPT_NAME'] ?? '/api/hy_music_random.php'));
    $dir = rtrim(dirname($scriptName), '/.');
    $target = ltrim($file, '/');
    if ($dir === '') {
        return '/' . $target;
    }
    return $dir . '/' . $target;
}

function hy_music_pow_gate_or_challenge(): void
{
    $ip = hy_music_pow_client_ip();
    $path = hy_music_pow_state_path($ip);

    $fp = @fopen($path, 'c+');
    if (!is_resource($fp)) {
        // 存储不可用时，不直接放开；返回错误避免被刷穿上游
        respond(500, ['ok' => false, 'error' => 'POW_STORAGE_ERROR']);
    }

    try {
        if (!flock($fp, LOCK_EX)) {
            respond(500, ['ok' => false, 'error' => 'POW_LOCK_FAILED']);
        }

        $raw = stream_get_contents($fp);
        $state = is_string($raw) && trim($raw) !== '' ? json_decode($raw, true) : null;
        if (!is_array($state)) $state = hy_music_pow_read_state($path);

        $now = time();
        $windowStart = (int)($state['window_start'] ?? 0);
        if ($windowStart <= 0 || ($now - $windowStart) >= HY_MUSIC_POW_WINDOW_SECONDS) {
            $windowStart = $now;
            $state['count'] = 0;
        }
        $state['window_start'] = $windowStart;

        $count = (int)($state['count'] ?? 0) + 1;
        $state['count'] = $count;

        $stage = hy_music_pow_required_stage($count);
        if ($stage > 0 && !hy_music_pow_is_ok($state, $stage)) {
            $challenge = hy_music_pow_issue_challenge($state, $stage);

            ftruncate($fp, 0);
            rewind($fp);
            fwrite($fp, json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            fflush($fp);

            respond(429, [
                'ok' => false,
                'error' => 'POW_REQUIRED',
                'message' => '请求过于频繁，请完成算力验证后继续使用。',
                'count' => $count,
                'stage' => $stage,
                'challenge' => $challenge,
                'verifyUrl' => hy_music_api_self_url('hy_music_pow_verify.php'),
            ]);
        }

        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        fflush($fp);
    } finally {
        @flock($fp, LOCK_UN);
        @fclose($fp);
    }
}

hy_music_pow_gate_or_challenge();

function loadLocalConfig(): array {
    $path = __DIR__ . '/hy_music_config.local.php';
    if (is_file($path)) {
        $cfg = require $path;
        if (is_array($cfg)) {
            return $cfg;
        }
    }
    return [];
}

function buildTunehubCandidates(string $base, array $candidates): array {
    $base = rtrim($base, '/');
    $out = [];
    foreach ($candidates as $c) {
        if (!is_string($c)) continue;
        $c = trim($c);
        if ($c === '') {
            $out[] = $base;
            continue;
        }
        if ($c[0] === '/') {
            $out[] = $base . $c;
            continue;
        }
        if ($c[0] === '?') {
            $out[] = $base . $c;
            continue;
        }
        $out[] = $base . '/' . $c;
    }
    return array_values(array_unique($out));
}

function curlGet(string $url, array $headers = [], int $timeoutSec = 12): array {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, $timeoutSec);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, min(5, $timeoutSec));
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, 0);
    if (!empty($headers)) {
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    }
    $body = curl_exec($ch);
    $err = curl_error($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $ctype = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);
    return ['ok' => $err === '' && $code >= 200 && $code < 300, 'code' => $code, 'ctype' => $ctype, 'body' => $body, 'error' => $err];
}

function curlRequestJson(string $url, string $method, array $headers = [], ?array $jsonBody = null, int $timeoutSec = 12): array {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, strtoupper($method));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, $timeoutSec);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, min(5, $timeoutSec));
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, 0);

    $finalHeaders = $headers;
    if ($jsonBody !== null) {
        $finalHeaders[] = 'Content-Type: application/json';
        $payload = json_encode($jsonBody, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    }

    if (!empty($finalHeaders)) {
        curl_setopt($ch, CURLOPT_HTTPHEADER, $finalHeaders);
    }

    $body = curl_exec($ch);
    $err = curl_error($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $ctype = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);
    return ['ok' => $err === '' && $code >= 200 && $code < 300, 'code' => $code, 'ctype' => $ctype, 'body' => $body, 'error' => $err];
}

function tryDecodeJson(string $text) {
    $text = trim($text);
    if ($text === '') return null;
    $data = json_decode($text, true);
    if (json_last_error() === JSON_ERROR_NONE) return $data;
    return null;
}

function isListArray(array $arr): bool {
    $i = 0;
    foreach ($arr as $k => $_) {
        if ($k !== $i) return false;
        $i++;
    }
    return true;
}

$local = loadLocalConfig();
$tunehubBase = (string)($local['tunehub_base'] ?? getenv('TUNEHUB_BASE') ?: 'https://tunehub.sayqz.com/api');
$tunehubKey = (string)($local['tunehub_key'] ?? getenv('TUNEHUB_KEY') ?: '');
$authMode = (string)($local['auth_mode'] ?? getenv('TUNEHUB_AUTH_MODE') ?: 'query_key');
$allowFallback = (bool)($local['allow_fallback'] ?? true);
$platform = 'kuwo';
if (isset($_GET['platform'])) {
    $p = strtolower(trim((string)$_GET['platform']));
    $allowed = ['kuwo' => true, 'netease' => true, 'qq' => true, 'kugou' => true, 'migu' => true, 'kuwo_web' => true];
    if (isset($allowed[$p])) {
        $platform = $p;
    }
}

if ($tunehubKey === '') {
    respond(400, [
        'error' => 'missing_key',
        'message' => '未配置 TuneHub API Key（请在 api/hy_music_config.local.php 里填写 tunehub_key）。',
    ]);
}

$tunehubBase = rtrim($tunehubBase, '/');

function isProbablyHtml(string $body, string $ctype = ''): bool {
    if (stripos($ctype, 'text/html') !== false) return true;
    $s = ltrim($body);
    if ($s === '') return false;
    return stripos($s, '<!doctype html') === 0 || stripos($s, '<html') === 0;
}

// 调试探测：返回前端 bundle 与可能的 API 路径片段，便于配置 random_candidates
if (isset($_GET['probe']) && $_GET['probe'] === '1') {
    $resp = curlGet(rtrim($tunehubBase, '/'));
    $body = is_string($resp['body']) ? (string)$resp['body'] : '';
    $bundle = '';

    if ($resp['ok'] && isProbablyHtml($body, (string)$resp['ctype'])) {
        if (preg_match('#src=\"(?P<src>/assets/index-[^\"]+\\.js)\"#i', $body, $m)) {
            $bundle = 'https://tunehub.sayqz.com' . $m['src'];
        }
    }

    $paths = [];
    $urlCandidates = [];
    $snippets = [];
    if ($bundle !== '') {
        $bundleResp = curlGet($bundle);
        $bundleBody = is_string($bundleResp['body']) ? (string)$bundleResp['body'] : '';
        if ($bundleResp['ok'] && $bundleBody !== '') {
            // 1) 常见路径形态（不限定 /api）
            $pathRegexes = [
                '#/api/[a-zA-Z0-9_\\-\\/]{1,80}#',
                '#/v\\d+/[a-zA-Z0-9_\\-\\/]{1,80}#',
                '#/(?:music|song|parse|search|lyric|lyrics|lrc)/[a-zA-Z0-9_\\-\\/]{1,80}#i',
            ];
            foreach ($pathRegexes as $re) {
                if (preg_match_all($re, $bundleBody, $mm)) {
                    foreach ($mm[0] as $p) {
                        $paths[$p] = true;
                        if (count($paths) >= 120) break 2;
                    }
                }
            }

            // 2) URL 候选（可能是完整 API 地址）
            if (preg_match_all('#https?://[^\"\\\'\\s]{1,140}#i', $bundleBody, $uu)) {
                foreach ($uu[0] as $u) {
                    $urlCandidates[$u] = true;
                    if (count($urlCandidates) >= 60) break;
                }
            }

            // 3) 关键词片段（用于人工定位真实端点）
            $keywords = ['random', 'lyric', 'lrc', 'lyrics', 'parse', 'search', 'song', 'music'];
            foreach ($keywords as $kw) {
                $pos = 0;
                $hits = 0;
                while (($pos = stripos($bundleBody, $kw, $pos)) !== false) {
                    $start = max(0, $pos - 70);
                    $snippet = substr($bundleBody, $start, 160);
                    $snippets[] = $kw . ': ' . $snippet;
                    $pos = $pos + strlen($kw);
                    $hits++;
                    if ($hits >= 6) break;
                    if (count($snippets) >= 40) break 2;
                }
            }
        }
    }

    respond(200, [
        'probe' => true,
        'tunehub_base' => $tunehubBase,
        'bundle' => $bundle,
        'found_paths' => array_keys($paths),
        'url_candidates' => array_keys($urlCandidates),
        'snippets' => $snippets,
        'note' => '根据 found_paths 选择可能的随机歌曲端点，写入 api/hy_music_config.local.php 的 random_candidates',
    ]);
}

// 探测 API 文档/规格（OpenAPI/Swagger 等），帮助定位真实端点
if (isset($_GET['probe']) && $_GET['probe'] === '2') {
    $base = rtrim($tunehubBase, '/');
    $targets = [
        $base . '/openapi.json',
        $base . '/swagger.json',
        $base . '/api-docs',
        $base . '/docs',
        $base . '/doc',
        $base . '/redoc',
        $base . '/v1/openapi.json',
        $base . '/v1/swagger.json',
        $base . '/v1/api-docs',
        $base . '/v3/api-docs',
    ];

    $results = [];
    foreach ($targets as $t) {
        $resp = curlGet($t);
        $body = is_string($resp['body']) ? (string)$resp['body'] : '';
        $preview = trim(substr($body, 0, 200));
        $results[] = [
            'url' => $t,
            'ok' => $resp['ok'],
            'code' => $resp['code'],
            'ctype' => $resp['ctype'],
            'preview' => $preview,
        ];
    }

    respond(200, [
        'probe' => true,
        'mode' => 2,
        'tunehub_base' => $tunehubBase,
        'results' => $results,
        'note' => '若返回 OpenAPI/Swagger JSON，可据此填写 random_candidates 与 auth_mode',
    ]);
}

// 探测“可能的音乐接口”路径：用于快速定位随机歌曲/歌词端点
if (isset($_GET['probe']) && $_GET['probe'] === '3') {
    $base = rtrim($tunehubBase, '/');
    $pathsToTry = [
        '/api/random',
        '/api/song/random',
        '/api/music/random',
        '/api.php?type=random',
        '/api.php?random=1',
        '/api?type=random',
        '/api?random=1',
        '/random',
        '/song/random',
        '/music/random',
        '/randomSong',
        '/random_song',
        '/rand',
        '/parse',
        '/music/parse',
        '/song/parse',
        '/search',
        '/music/search',
        '/song/search',
        '/lyric',
        '/lyrics',
        '/lrc',
        '/music',
        '/song',
        '/info',
        '/detail',
        '/recommend',
        '/hot',
        '/top',
        '/ncm',
        '/netease',
        '/qq',
        '/kugou',
        '/kuwo',
        '/migu',
        '?type=random',
        '?random=1',
    ];

    $results = [];
    foreach ($pathsToTry as $p) {
        $headers = [];
        $url = $base;
        if (is_string($p) && $p !== '') {
            if ($p[0] === '/') $url .= $p;
            elseif ($p[0] === '?') $url .= $p;
            else $url .= '/' . $p;
        }

        if ($tunehubKey !== '') {
            if ($authMode === 'query_key') {
                $join = (strpos($url, '?') === false) ? '?' : '&';
                $url .= $join . 'key=' . rawurlencode($tunehubKey);
            } elseif ($authMode === 'bearer') {
                $headers[] = 'Authorization: Bearer ' . $tunehubKey;
            } elseif ($authMode === 'x_api_key') {
                $headers[] = 'X-API-Key: ' . $tunehubKey;
            }
        }

        $resp = curlGet($url, $headers, 10);
        $body = is_string($resp['body']) ? (string)$resp['body'] : '';
        $preview = trim(substr($body, 0, 160));

        // 不回传包含 key 的 URL（避免误泄露）
        $results[] = [
            'path' => $p,
            'ok' => $resp['ok'],
            'code' => $resp['code'],
            'ctype' => $resp['ctype'],
            'is_html' => isProbablyHtml($body, (string)$resp['ctype']),
            'preview' => $preview,
        ];
    }

    respond(200, [
        'probe' => true,
        'mode' => 3,
        'tunehub_base' => $tunehubBase,
        'auth_mode' => $authMode,
        'has_key' => $tunehubKey !== '',
        'results' => $results,
        'note' => '找到 code=200 且包含 url/歌词字段的路径后，把它写入 random_candidates（只保留最短的那几个）',
    ]);
}

// 探测可能的“真正 API base”（有些站点 /api 是前端，真实接口在 /api.php 等）
if (isset($_GET['probe']) && $_GET['probe'] === '4') {
    $bases = [
        'https://tunehub.sayqz.com/api',
        'https://tunehub.sayqz.com',
        'https://tunehub.sayqz.com/v1',
        'https://tunehub.sayqz.com/v2',
        'https://tunehub.sayqz.com/v3',
        'https://tunehub.sayqz.com/api/v1',
        'https://tunehub.sayqz.com/api/v2',
        'https://tunehub.sayqz.com/api/v3',
        'https://tunehub.sayqz.com/api.php',
        'https://tunehub.sayqz.com/api/api.php',
        'https://tunehub.sayqz.com/api/index.php',
    ];

    $results = [];
    foreach ($bases as $b) {
        $resp = curlGet($b, [], 10);
        $body = is_string($resp['body']) ? (string)$resp['body'] : '';
        $json = tryDecodeJson($body);
        $preview = $json !== null ? $json : trim(substr($body, 0, 140));
        $results[] = [
            'base' => $b,
            'ok' => $resp['ok'],
            'code' => $resp['code'],
            'ctype' => $resp['ctype'],
            'is_html' => isProbablyHtml($body, (string)$resp['ctype']),
            'json' => $json !== null,
            'preview' => $preview,
        ];
    }

    respond(200, [
        'probe' => true,
        'mode' => 4,
        'results' => $results,
        'note' => '找到返回 JSON 且不是 Not Found 的 base，再配合 probe=3 继续定位随机歌曲端点',
    ]);
}

$last = null;
$debugPieces = [];
$tunehubHeaders = [];
if ($authMode === 'x_api_key') {
    $tunehubHeaders[] = 'X-API-Key: ' . $tunehubKey;
} elseif ($authMode === 'bearer') {
    $tunehubHeaders[] = 'Authorization: Bearer ' . $tunehubKey;
} else {
    // 兼容旧模式（不推荐）
    $tunehubHeaders[] = 'X-API-Key: ' . $tunehubKey;
}

function pickRandomKeyword(): string {
    $keywords = [
        '周杰伦', '林俊杰', '陈奕迅', '邓紫棋', '王菲', '薛之谦',
        '五月天', '孙燕姿', '张学友', 'Taylor Swift', 'Aimer', 'YOASOBI',
    ];
    return $keywords[array_rand($keywords)];
}

function parseKuwoSearch(string $body): array {
    $body = trim($body);
    if ($body === '') return [];

    // JSONP 兼容
    if ($body[0] !== '{' && $body[0] !== '[') {
        if (preg_match('/^[a-zA-Z_][a-zA-Z0-9_]*\\((.*)\\)\\s*;?$/s', $body, $m)) {
            $body = $m[1];
        }
    }

    $json = json_decode($body, true);
    if (json_last_error() !== JSON_ERROR_NONE || !is_array($json)) return [];

    // Kuwo 常见结构：abslist / data.list / songs
    $list = [];
    if (isset($json['abslist']) && is_array($json['abslist'])) $list = $json['abslist'];
    elseif (isset($json['data']['list']) && is_array($json['data']['list'])) $list = $json['data']['list'];
    elseif (isset($json['songs']) && is_array($json['songs'])) $list = $json['songs'];

    $items = [];
    foreach ($list as $item) {
        if (!is_array($item)) continue;
        $rid = $item['rid'] ?? null;
        $musicrid = $item['MUSICRID'] ?? $item['musicrid'] ?? null;
        if (is_string($musicrid) && preg_match('/(\\d+)/', $musicrid, $mm)) {
            $rid = (int)$mm[1];
        }
        if (!is_numeric($rid)) continue;
        $rid = (int)$rid;
        if ($rid <= 0) continue;

        $name = $item['name'] ?? $item['songName'] ?? $item['songname'] ?? $item['SONGNAME'] ?? $item['title'] ?? '';
        $artist = $item['artist'] ?? $item['artistName'] ?? $item['artistname'] ?? $item['ARTIST'] ?? $item['singer'] ?? '';
        if (is_string($name)) {
            $name = html_entity_decode(strip_tags($name), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
            $name = trim($name);
        } else {
            $name = '';
        }
        if (is_string($artist)) {
            $artist = html_entity_decode(strip_tags($artist), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
            $artist = trim($artist);
        } else {
            $artist = '';
        }

        $items[] = ['rid' => $rid, 'name' => $name, 'artist' => $artist];
    }

    // 去重：按 rid
    $seen = [];
    $out = [];
    foreach ($items as $it) {
        $k = (string)$it['rid'];
        if (isset($seen[$k])) continue;
        $seen[$k] = true;
        $out[] = $it;
    }
    return $out;
}

function parseSearchItems(string $platform, string $body): array {
    $platform = strtolower(trim($platform));
    if ($platform === 'kuwo' || $platform === 'kuwo_web') {
        return parseKuwoSearch($body);
    }

    $body = trim($body);
    if ($body === '') return [];

    // JSONP 兼容
    if ($body[0] !== '{' && $body[0] !== '[') {
        if (preg_match('/^[a-zA-Z_][a-zA-Z0-9_]*\\((.*)\\)\\s*;?$/s', $body, $m)) {
            $body = $m[1];
        }
    }

    $json = json_decode($body, true);
    if (json_last_error() !== JSON_ERROR_NONE || !is_array($json)) return [];

    $lists = [];
    $tryPaths = [
        ['abslist'],
        ['data', 'list'],
        ['data', 'song', 'list'],
        ['result', 'songs'],
        ['data', 'songs'],
        ['songs'],
        ['list'],
    ];
    foreach ($tryPaths as $path) {
        $cur = $json;
        foreach ($path as $k) {
            if (!is_array($cur) || !array_key_exists($k, $cur)) { $cur = null; break; }
            $cur = $cur[$k];
        }
        if (is_array($cur)) $lists[] = $cur;
    }
    if (empty($lists) && isListArray($json)) $lists[] = $json;
    $list = [];
    foreach ($lists as $cand) {
        if (!is_array($cand)) continue;
        // 取第一个“像列表”的候选
        $count = 0;
        foreach ($cand as $it) {
            if (is_array($it)) $count++;
            if ($count >= 2) break;
        }
        if ($count >= 1) { $list = $cand; break; }
    }
    if (empty($list)) return [];

    $items = [];
    foreach ($list as $item) {
        if (!is_array($item)) continue;

        $rawId =
            $item['rid'] ??
            $item['id'] ??
            $item['songid'] ??
            $item['songId'] ??
            $item['mid'] ??
            $item['songmid'] ??
            $item['hash'] ??
            $item['encodeId'] ??
            $item['encode_id'] ??
            null;

        $id = '';
        if (is_int($rawId) || is_float($rawId) || is_numeric($rawId)) {
            $id = (string)$rawId;
        } elseif (is_string($rawId)) {
            $rawId = trim($rawId);
            if ($rawId !== '' && preg_match('/^[a-zA-Z0-9_\\-]{1,40}$/', $rawId)) {
                $id = $rawId;
            } elseif (preg_match('/([a-zA-Z0-9_\\-]{1,40})/', $rawId, $mm)) {
                $id = (string)$mm[1];
            }
        }
        if ($id === '') continue;

        $name = $item['name'] ?? $item['songName'] ?? $item['songname'] ?? $item['title'] ?? $item['song'] ?? '';
        $artist = $item['artist'] ?? $item['author'] ?? $item['singer'] ?? $item['artists'] ?? '';

        if (is_array($artist)) {
            // e.g. artists: [{name:..}] or ["a","b"]
            $parts = [];
            foreach ($artist as $a) {
                if (is_string($a)) $parts[] = $a;
                elseif (is_array($a) && is_string($a['name'] ?? null)) $parts[] = (string)$a['name'];
            }
            $artist = implode(' / ', array_values(array_filter(array_map('trim', $parts))));
        }

        if (is_string($name)) {
            $name = html_entity_decode(strip_tags($name), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
            $name = trim($name);
        } else {
            $name = '';
        }
        if (is_string($artist)) {
            $artist = html_entity_decode(strip_tags($artist), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
            $artist = trim($artist);
        } else {
            $artist = '';
        }

        $items[] = ['rid' => $id, 'name' => $name, 'artist' => $artist];
    }

    $seen = [];
    $out = [];
    foreach ($items as $it) {
        $k = (string)($it['rid'] ?? '');
        if ($k === '' || isset($seen[$k])) continue;
        $seen[$k] = true;
        $out[] = $it;
    }
    return $out;
}

function parseUserQuery(string $q): array {
    $q = trim($q);
    if ($q === '') return ['', ''];

    // 推荐输入：歌名 - 歌手
    if (preg_match('/^(.+?)\\s*[-—–\\/\\|@]+\\s*(.+)$/u', $q, $m)) {
        $title = trim((string)$m[1]);
        $artist = trim((string)$m[2]);
        return [$title, $artist];
    }

    return [$q, ''];
}

function normSearchText(string $s): string {
    if (function_exists('mb_strtolower')) {
        $s = mb_strtolower($s, 'UTF-8');
    } else {
        $s = strtolower($s);
    }
    $s = preg_replace('/[\\s\\-\\_\\~\\·\\.,，。()（）\\[\\]【】{}《》“”"\\\'!！?？:：;；|\\/\\\\]+/u', '', $s) ?? '';
    return trim($s);
}

function utf8Pos(string $haystack, string $needle) {
    if ($needle === '') return 0;
    if (function_exists('mb_strpos')) {
        return mb_strpos($haystack, $needle, 0, 'UTF-8');
    }
    return strpos($haystack, $needle);
}

function pickBestKuwoItem(array $items, string $wantedTitle, string $wantedArtist): ?array {
    $wt = normSearchText($wantedTitle);
    $wa = normSearchText($wantedArtist);
    if ($wt === '' && $wa === '') return null;

    $best = null;
    $bestScore = -1;

    foreach ($items as $it) {
        if (!is_array($it) || !isset($it['rid'])) continue;
        $name = is_string($it['name'] ?? null) ? (string)$it['name'] : '';
        $artist = is_string($it['artist'] ?? null) ? (string)$it['artist'] : '';

        $nt = normSearchText($name);
        $na = normSearchText($artist);

        $score = 0;

        if ($wt !== '' && $nt !== '') {
            if ($nt === $wt) $score += 1000;
            elseif (utf8Pos($nt, $wt) !== false) $score += 650;
            elseif (utf8Pos($wt, $nt) !== false) $score += 450;
        }

        if ($wa !== '' && $na !== '') {
            if ($na === $wa) $score += 850;
            elseif (utf8Pos($na, $wa) !== false) $score += 550;
            elseif (utf8Pos($wa, $na) !== false) $score += 450;
        }

        if ($wt !== '' && $wa !== '' && $nt === $wt && $na === $wa) $score += 200;

        if ($score > $bestScore) {
            $bestScore = $score;
            $best = $it;
        }
    }

    return $best;
}

// 1) 先通过 TuneHub 下发“搜索方法配置”
$methodResp = curlRequestJson($tunehubBase . '/v1/methods/' . rawurlencode($platform) . '/search', 'GET', $tunehubHeaders, null, 12);
$last = $methodResp + ['url' => $tunehubBase . '/v1/methods/' . $platform . '/search'];
if (!$methodResp['ok'] || !is_string($methodResp['body'])) {
    goto fallback_or_fail;
}
$debugPieces[] = ['step' => 'tunehub_methods', 'preview' => substr((string)$methodResp['body'], 0, 400)];
$methodJson = tryDecodeJson((string)$methodResp['body']);
if (!is_array($methodJson) || !isset($methodJson['data']) || !is_array($methodJson['data'])) {
    goto fallback_or_fail;
}
$methodData = $methodJson['data'];
$upstreamUrl = isset($methodData['url']) && is_string($methodData['url']) ? $methodData['url'] : '';
$upstreamParams = isset($methodData['params']) && is_array($methodData['params']) ? $methodData['params'] : [];
$upstreamHeaders = isset($methodData['headers']) && is_array($methodData['headers']) ? $methodData['headers'] : [];

// 2) 组装搜索请求（服务端代发，避免 CORS）
$customQuery = '';
if (isset($_GET['q'])) {
    $customQuery = trim((string)$_GET['q']);
    // 限制长度，避免异常请求占用资源
    if (strlen($customQuery) > 60) {
        $customQuery = substr($customQuery, 0, 60);
    }
    // 清理不可见字符
    $customQuery = preg_replace('/[\\x00-\\x1F\\x7F]/', '', $customQuery) ?? '';
    $customQuery = trim($customQuery);
}

// 额外参数：歌手范围随机 / 列表选歌 / 直接按 id 解析
$customArtist = '';
if (isset($_GET['artist'])) {
    $customArtist = trim((string)$_GET['artist']);
    if (strlen($customArtist) > 30) {
        $customArtist = substr($customArtist, 0, 30);
    }
    $customArtist = preg_replace('/[\\x00-\\x1F\\x7F]/', '', $customArtist) ?? '';
    $customArtist = trim($customArtist);
}

$listOnly = isset($_GET['list']) && (string)$_GET['list'] === '1';
$listLimit = 25;
if (isset($_GET['limit'])) {
    $n = (int)$_GET['limit'];
    if ($n > 0) $listLimit = max(1, min(50, $n));
}

$pickedIdFromUser = null;
if (isset($_GET['id'])) {
    $id = trim((string)$_GET['id']);
    if ($id !== '' && preg_match('/^[a-zA-Z0-9_\\-]{1,40}$/', $id)) {
        $pickedIdFromUser = $id;
    }
}

$keyword = $customQuery !== '' ? $customQuery : ($customArtist !== '' ? $customArtist : pickRandomKeyword());
if ($upstreamUrl === '') {
    // 兜底：直接用 Kuwo 搜索（按文档示例）
    $upstreamUrl = 'http://search.kuwo.cn/r.s';
    $upstreamParams = ['client' => 'kt', 'all' => '', 'pn' => '0', 'rn' => '30'];
}

foreach ($upstreamParams as $k => $v) {
    if (!is_string($v)) continue;
    $v = str_replace(['{{keyword}}', '{{page}}', '{{pageSize}}'], [$keyword, '0', '50'], $v);
    $upstreamParams[$k] = $v;
}

// 强制写入 keyword / pageSize（避免模板表达式未被服务端计算导致搜索无结果）
$upstreamParams['all'] = $keyword;
$upstreamParams['pn'] = '0';
$upstreamParams['rn'] = '50';

$urlObj = $upstreamUrl;
$query = http_build_query($upstreamParams);
if (strpos($urlObj, '?') === false) $urlObj .= '?' . $query;
else $urlObj .= '&' . $query;

$hdr = [];
foreach ($upstreamHeaders as $hk => $hv) {
    if (!is_string($hk) || $hk === '' || !is_string($hv)) continue;
    $hdr[] = $hk . ': ' . $hv;
}

$searchResp = curlGet($urlObj, $hdr, 12);
$last = $searchResp + ['url' => $urlObj];
if (!$searchResp['ok'] || !is_string($searchResp['body'])) {
    goto fallback_or_fail;
}
$debugPieces[] = ['step' => 'kuwo_search', 'preview' => substr((string)$searchResp['body'], 0, 500)];

$items = parseSearchItems($platform, (string)$searchResp['body']);
if (empty($items)) {
    goto fallback_or_fail;
}

// 歌手范围过滤：只在提供 artist 且未指定 id 时启用
if ($customArtist !== '' && $pickedIdFromUser === null) {
    $want = normSearchText($customArtist);
    if ($want !== '') {
        $filtered = [];
        foreach ($items as $it) {
            if (!is_array($it)) continue;
            $a = is_string($it['artist'] ?? null) ? (string)$it['artist'] : '';
            $na = normSearchText($a);
            if ($na !== '' && utf8Pos($na, $want) !== false) {
                $filtered[] = $it;
            }
        }
        if (!empty($filtered)) {
            $items = $filtered;
        }
    }
}

// 仅返回列表（用于前端“选择歌曲”）
if ($listOnly) {
    $out = [];
    $i = 0;
    foreach ($items as $it) {
        if (!is_array($it) || !isset($it['rid'])) continue;
        $rid = trim((string)$it['rid']);
        if ($rid === '') continue;
        $out[] = [
            'rid' => $rid,
            'name' => (string)($it['name'] ?? ''),
            'artist' => (string)($it['artist'] ?? ''),
        ];
        $i++;
        if ($i >= $listLimit) break;
    }
    respond(200, [
        'ok' => true,
        'keyword' => $keyword,
        'artist' => $customArtist,
        'items' => $out,
        '_source' => 'tunehub',
        '_platform' => $platform,
    ]);
}

// 自定义点歌：尽量按“歌名 + 歌手”精准命中，而不是同名随机
$pickedId = null;
if ($customQuery !== '') {
    [$wantedTitle, $wantedArtist] = parseUserQuery($customQuery);
    $best = pickBestKuwoItem($items, $wantedTitle, $wantedArtist);
    if (is_array($best) && isset($best['rid'])) {
        $pickedId = trim((string)$best['rid']);
    }
}

if (is_string($pickedIdFromUser) && $pickedIdFromUser !== '') {
    $pickedId = $pickedIdFromUser;
}

if (!is_string($pickedId) || $pickedId === '') {
    $picked = $items[array_rand($items)];
    $pickedId = trim((string)($picked['rid'] ?? ''));
}
if (!is_string($pickedId) || $pickedId === '') {
    goto fallback_or_fail;
}

// 3) 调用 TuneHub 解析接口（消耗积分）：返回播放链接 + 歌词
$parsePayload = [
    'platform' => $platform,
    'ids' => $pickedId,
    'quality' => '320k',
];
$parseResp = curlRequestJson($tunehubBase . '/v1/parse', 'POST', $tunehubHeaders, $parsePayload, 12);
$last = $parseResp + ['url' => $tunehubBase . '/v1/parse'];
if (!$parseResp['ok'] || !is_string($parseResp['body'])) {
    goto fallback_or_fail;
}
$debugPieces[] = ['step' => 'tunehub_parse', 'preview' => substr((string)$parseResp['body'], 0, 500)];
$parseJson = tryDecodeJson((string)$parseResp['body']);
if (!is_array($parseJson)) {
    goto fallback_or_fail;
}

// 兼容返回结构：data 可能是数组/对象
$data = $parseJson['data'] ?? $parseJson;
if (is_array($data) && isset($data['data']) && is_array($data['data']) && isset($data['data'][0]) && is_array($data['data'][0])) {
    $data = $data['data'][0];
}
if (is_array($data) && isListArray($data) && isset($data[0]) && is_array($data[0])) {
    $data = $data[0];
}

if (!is_array($data)) {
    goto fallback_or_fail;
}

$musicUrl = $data['url'] ?? $data['music_url'] ?? $data['play_url'] ?? $data['link'] ?? null;
if (!is_string($musicUrl) || !preg_match('#^https?://#i', $musicUrl)) {
    goto fallback_or_fail;
}

respond(200, [
    'url' => $musicUrl,
    'title' => $data['info']['name'] ?? $data['name'] ?? $data['title'] ?? $data['songname'] ?? $keyword,
    'author' => $data['info']['artist'] ?? $data['artist'] ?? $data['author'] ?? $data['singer'] ?? '',
    'pic' => $data['cover'] ?? $data['pic'] ?? $data['image'] ?? $data['info']['cover'] ?? '',
    'lrc' => $data['lrc'] ?? $data['lyric'] ?? $data['lyrics'] ?? $data['ly'] ?? '',
    '_source' => 'tunehub',
    '_platform' => $platform,
    '_id' => $pickedId,
]);

fallback_or_fail:

// 若 TuneHub 不可用，则降级到公开随机音乐 API，避免首页播放器完全不可用
if ($allowFallback) {
    $fallback = curlGet('https://music-api.gdstudio.xyz/api.php?_=' . time(), [], 10);
    if ($fallback['ok'] && is_string($fallback['body'])) {
        $body = (string)$fallback['body'];
        $json = tryDecodeJson($body);
        if ($json !== null) {
            $json['_fallback'] = 'music-api.gdstudio.xyz';
            respond(200, $json);
        }
        $text = trim($body);
        if ($text !== '' && preg_match('#^https?://#i', $text)) {
            respond(200, ['url' => $text, '_fallback' => 'music-api.gdstudio.xyz']);
        }
    }
}

respond(502, [
    'error' => 'upstream_failed',
    'message' => '随机歌曲 API 请求失败，请检查 TuneHub API 配置/网络/鉴权方式。',
    'hint' => '可创建 api/hy_music_config.local.php 参考 api/hy_music_config.local.php.example',
    'debug' => [
        'base' => $tunehubBase,
        'auth_mode' => $authMode,
        'last' => $last ? ['code' => $last['code'], 'error' => $last['error'], 'ctype' => $last['ctype']] : null,
        'steps' => (isset($_GET['debug']) && $_GET['debug'] === '1') ? $debugPieces : null,
    ],
]);
