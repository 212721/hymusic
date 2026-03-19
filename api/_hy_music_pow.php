<?php
declare(strict_types=1);

// 音乐接口 PoW 防刷门禁（按 IP 计数）
// 需求（测试阶段）：
// - 前 2 次：不需要 PoW
// - 第 3-4 次：需要较高算力 PoW
// - 第 5 次起：PoW 难度再暴增 N（不封禁，解完继续用）
//
// 正式版阈值（短时间窗口内计数，而不是累计计数）：
// - 窗口内前 200 次：不需要 PoW
// - 窗口内第 201-400 次：需要较高算力 PoW
// - 窗口内第 401 次起：PoW 难度再暴增 N（不封禁，解完继续用）

// “短时间”窗口（秒）
const HY_MUSIC_POW_WINDOW_SECONDS = 120;

const HY_MUSIC_POW_FREE_LIMIT = 200;
const HY_MUSIC_POW_STAGE2_LIMIT = 400;

// PoW 难度：sha256(token:nonce) 前 N 个 hex 为 0
// “算力比较大”：建议 >= 5
const HY_MUSIC_POW_DIFFICULTY_STAGE1 = 5;
// 暴增 N 个难度（谨慎：+2 会明显变慢）
const HY_MUSIC_POW_DIFFICULTY_SPIKE = 1;

const HY_MUSIC_POW_CHALLENGE_TTL_SECONDS = 120;
const HY_MUSIC_POW_OK_TTL_SECONDS = 6 * 3600;

function hy_music_pow_client_ip(): string
{
    // 兼容 Cloudflare：优先信任 CF-Connecting-IP
    $cf = (string)($_SERVER['HTTP_CF_CONNECTING_IP'] ?? '');
    if ($cf !== '' && filter_var($cf, FILTER_VALIDATE_IP)) {
        return $cf;
    }

    // 兼容反代：取 XFF 第一个
    $xff = (string)($_SERVER['HTTP_X_FORWARDED_FOR'] ?? '');
    if ($xff !== '') {
        $parts = array_map('trim', explode(',', $xff));
        if (isset($parts[0]) && filter_var($parts[0], FILTER_VALIDATE_IP)) {
            return $parts[0];
        }
    }

    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
    return $ip !== '' ? $ip : '0.0.0.0';
}

function hy_music_pow_storage_dir(): string
{
    $dir = dirname(__DIR__) . '/data/hy_music_pow';
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    return $dir;
}

function hy_music_pow_state_path(string $ip): string
{
    return hy_music_pow_storage_dir() . '/' . hash('sha256', $ip) . '.json';
}

function hy_music_pow_read_state(string $path): array
{
    if (!is_file($path)) {
        return [
            'count' => 0,
            'window_start' => time(),
            'ok_until' => 0,
            'ok_stage' => 0,
            'challenge' => null,
            'updated_at' => time(),
        ];
    }

    $raw = @file_get_contents($path);
    if (!is_string($raw) || trim($raw) === '') {
        return [
            'count' => 0,
            'window_start' => time(),
            'ok_until' => 0,
            'ok_stage' => 0,
            'challenge' => null,
            'updated_at' => time(),
        ];
    }

    $json = json_decode($raw, true);
    if (!is_array($json)) {
        return [
            'count' => 0,
            'window_start' => time(),
            'ok_until' => 0,
            'ok_stage' => 0,
            'challenge' => null,
            'updated_at' => time(),
        ];
    }

    return $json;
}

function hy_music_pow_write_state(string $path, array $state): void
{
    $state['updated_at'] = time();
    @file_put_contents($path, json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}

function hy_music_pow_required_stage(int $count): int
{
    if ($count <= HY_MUSIC_POW_FREE_LIMIT) return 0;
    if ($count <= HY_MUSIC_POW_STAGE2_LIMIT) return 1;
    return 2;
}

function hy_music_pow_stage_difficulty(int $stage): int
{
    if ($stage <= 0) return 0;
    if ($stage === 1) return HY_MUSIC_POW_DIFFICULTY_STAGE1;
    return HY_MUSIC_POW_DIFFICULTY_STAGE1 + HY_MUSIC_POW_DIFFICULTY_SPIKE;
}

function hy_music_pow_is_ok(array $state, int $requiredStage): bool
{
    $until = (int)($state['ok_until'] ?? 0);
    $stage = (int)($state['ok_stage'] ?? 0);
    return $requiredStage > 0 && $stage >= $requiredStage && $until >= time();
}

function hy_music_pow_issue_challenge(array &$state, int $stage): array
{
    $token = rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
    $difficulty = hy_music_pow_stage_difficulty($stage);
    $expiresAt = time() + HY_MUSIC_POW_CHALLENGE_TTL_SECONDS;

    $state['challenge'] = [
        'token' => $token,
        'stage' => $stage,
        'difficulty' => $difficulty,
        'expires_at' => $expiresAt,
        'issued_at' => time(),
    ];

    return [
        'algo' => 'sha256',
        'token' => $token,
        'stage' => $stage,
        'difficultyHexZeros' => $difficulty,
        'expiresInSeconds' => HY_MUSIC_POW_CHALLENGE_TTL_SECONDS,
        'format' => 'sha256(token + ":" + nonce) startsWith 0 * difficultyHexZeros',
    ];
}

function hy_music_pow_verify_solution(array &$state, string $token, string $nonce): array
{
    $challenge = $state['challenge'] ?? null;
    if (!is_array($challenge)) {
        return ['ok' => false, 'error' => 'NO_CHALLENGE', 'status' => 400];
    }

    $expiresAt = (int)($challenge['expires_at'] ?? 0);
    if ($expiresAt <= 0 || time() > $expiresAt) {
        $state['challenge'] = null;
        return ['ok' => false, 'error' => 'CHALLENGE_EXPIRED', 'status' => 400];
    }

    if (!hash_equals((string)($challenge['token'] ?? ''), $token)) {
        return ['ok' => false, 'error' => 'TOKEN_MISMATCH', 'status' => 400];
    }

    $difficulty = (int)($challenge['difficulty'] ?? 0);
    if ($difficulty < 1 || $difficulty > 10) {
        return ['ok' => false, 'error' => 'BAD_DIFFICULTY', 'status' => 400];
    }

    // nonce 限制，避免异常请求占用资源
    if ($nonce === '' || strlen($nonce) > 64) {
        return ['ok' => false, 'error' => 'BAD_NONCE', 'status' => 400];
    }

    $hash = hash('sha256', $token . ':' . $nonce);
    if (strncmp($hash, str_repeat('0', $difficulty), $difficulty) !== 0) {
        return ['ok' => false, 'error' => 'INVALID_POW', 'status' => 400];
    }

    $stage = (int)($challenge['stage'] ?? 0);
    $state['challenge'] = null;
    $state['ok_stage'] = max((int)($state['ok_stage'] ?? 0), $stage);
    $state['ok_until'] = time() + HY_MUSIC_POW_OK_TTL_SECONDS;

    return [
        'ok' => true,
        'okUntil' => $state['ok_until'],
        'okStage' => $state['ok_stage'],
        'status' => 200,
    ];
}
