<?php
declare(strict_types=1);

function hy_music_json_response(array $data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function hy_music_require_post_json(): array
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        hy_music_json_response(['ok' => false, 'error' => 'METHOD_NOT_ALLOWED'], 405);
    }

    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        hy_music_json_response(['ok' => false, 'error' => 'INVALID_JSON'], 400);
    }

    $data = json_decode($raw, true);
    if (!is_array($data)) {
        hy_music_json_response(['ok' => false, 'error' => 'INVALID_JSON'], 400);
    }

    return $data;
}
