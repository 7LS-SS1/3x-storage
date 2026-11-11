<?php
// Test-only CLI development server. Never include this file in the release ZIP.
if (PHP_SAPI !== 'cli-server' || ($_SERVER['REMOTE_ADDR'] ?? '') !== '127.0.0.1') { http_response_code(403); exit; }
ob_start(); require __DIR__.'/integration.php'; ob_end_clean();
$mode=$_GET['mode'] ?? 'anonymous';
if ($mode==='anonymous') { wp_set_current_user(0); }
$_REQUEST['nonce']=$mode==='valid' ? wp_create_nonce('wpmb_export') : 'invalid';
$_POST=['operation'=>'preview','post_type'=>'post','post_status'=>'publish','scope'=>'ids','post_ids'=>'900001,900002'];
do_action('wp_ajax_wpmb_export');
