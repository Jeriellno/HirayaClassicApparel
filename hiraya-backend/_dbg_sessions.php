<?php
foreach (App\Models\TryOnSession::latest()->take(5)->get() as $r) {
    $len = strlen((string) $r->result_image_base64);
    $head = substr((string) $r->result_image_base64, 0, 22);
    echo $r->session_id . ' | ' . $r->status . ' | plan=' . ($r->render_plan_json ? 'yes' : 'no')
        . ' | result=' . $len . ' | head=' . $head . PHP_EOL;
}
