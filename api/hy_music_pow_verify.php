<?php
declare(strict_types=1);

require_once __DIR__ . '/_hy_music_http.php';
require_once __DIR__ . '/_hy_music_pow.php';

ini_set('display_errors', '0');
ini_set('html_errors', '0');

$payload = hy_music_require_post_json();
$token = (string)($payload['token'] ?? '');
$nonce = (string)($payload['nonce'] ?? '');

$ip = hy_music_pow_client_ip();
$path = hy_music_pow_state_path($ip);

// 简单并发保护：文件锁
$fp = @fopen($path, 'c+');
if (!is_resource($fp)) {
    hy_music_json_response(['ok' => false, 'error' => 'STORAGE_ERROR'], 500);
}

try {
    if (!flock($fp, LOCK_EX)) {
        hy_music_json_response(['ok' => false, 'error' => 'LOCK_FAILED'], 500);
    }

    // 读
    $raw = stream_get_contents($fp);
    $state = is_string($raw) && trim($raw) !== '' ? json_decode($raw, true) : null;
    if (!is_array($state)) $state = hy_music_pow_read_state($path);

    $res = hy_music_pow_verify_solution($state, $token, $nonce);

    // 写回
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    fflush($fp);

    $status = (int)($res['status'] ?? 200);
    unset($res['status']);
    hy_music_json_response($res, $status);
} finally {
    @flock($fp, LOCK_UN);
    @fclose($fp);
}
