<?php
$GLOBALS['wp_filter']['option_active_plugins'][10][] = ['function' => fn($p)=>[], 'accepted_args'=>1];
require '/var/www/html/wp-load.php';
require dirname(__DIR__).'/wp-metadata-export.php';
global $wpdb;
$checks=0;
function check_import($ok,$label) { global $checks;if(!$ok)throw new RuntimeException('FAIL '.$label);$checks++;echo "PASS $label\n"; }
$original=['posts'=>$wpdb->posts,'postmeta'=>$wpdb->postmeta];$tables=[];
$admin=get_users(['role'=>'administrator','fields'=>'ID','number'=>1])[0];wp_set_current_user($admin);
$csv=tempnam('/tmp','wpmb-import-');
try {
    // Real isolated InnoDB fixture tables test rollback; never modify source tables.
    foreach($original as $key=>$table){$name='wpmb_import_test_'.getmypid().'_'.$key;if($wpdb->query("CREATE TABLE $name LIKE $table")===false)throw new RuntimeException('fixture_create_failed');$tables[]=$name;$wpdb->$key=$name;}
    $embed='<iframe src="https://player.example.test/embed/demo-1" width="100%" height="100%" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>';
    foreach([1=>'ทดสอบ "ไทย", title',2=>'duplicate',3=>'duplicate',4=>'=formula',5=>'fail',6=>'file duplicate',7=>'stale'] as $id=>$title){$wpdb->insert($wpdb->posts,['ID'=>$id,'post_author'=>$admin,'post_type'=>'post','post_status'=>'publish','post_title'=>$title,'post_content'=>'raw unchanged','post_excerpt'=>'','post_content_filtered'=>'','to_ping'=>'','pinged'=>'']);}
    foreach([1,5,7] as $id)$wpdb->insert($wpdb->postmeta,['post_id'=>$id,'meta_key'=>'embed','meta_value'=>'old embed']);
    $f=fopen($csv,'wb');fwrite($f,"\xEF\xBB\xBF");fputcsv($f,['title','หมวดหมู่','videos url','url images'],',','"','');
    foreach(['ทดสอบ "ไทย", title','duplicate','missing',"'=formula",'fail','file duplicate','file duplicate','stale'] as $title)fputcsv($f,[$title,'',$embed,''],',','"','');fclose($f);
    $p=WPMB_Import::preview($csv,'post');$r=$p['rows'];
    check_import($p['total']===8 && $r[0]['status']==='ready','CSV Thai quotes BOM exact match');
    check_import($r[1]['reason']==='duplicate_title_in_wordpress' && $r[2]['reason']==='title_not_found','ambiguous and missing titles blocked');
    check_import($r[3]['title']==='=formula' && $r[3]['status']==='ready','3x formula escaping reversed');
    check_import($r[5]['reason']==='duplicate_title_in_file' && $r[6]['reason']==='duplicate_title_in_file','duplicate input blocked');
    $saved=WPMB_Import::mutate($r[0]['token']);
    check_import($saved['status']==='applied' && WPMB_Import::meta(1)[0]['meta_value']===$embed,'confirmed apply exact iframe');
    check_import(WPMB_Import::mutate($r[0]['token'])['status']==='unchanged','replayed approval idempotent');
    check_import(WPMB_Import::preview($csv,'post')['rows'][0]['status']==='unchanged','reimport unchanged');
    check_import(WPMB_Import::mutate($saved['undo_token'],true)['status']==='rolled_back' && WPMB_Import::meta(1)[0]['meta_value']==='old embed','rollback restores original');
    $added=WPMB_Import::mutate($r[3]['token']);WPMB_Import::mutate($added['undo_token'],true);
    check_import(WPMB_Import::meta(4)===[],'rollback removes newly created embed');
    $wpdb->update($wpdb->postmeta,['meta_value'=>'external change'],['post_id'=>7,'meta_key'=>'embed']);
    try{WPMB_Import::mutate($r[7]['token']);check_import(false,'stale');}catch(RuntimeException $e){check_import($e->getMessage()==='embed_changed_since_preview','stale preview blocked');}
    $filter=function($sql){return str_contains($sql,'INSERT INTO') && str_contains($sql,WPMB_Import::AUDIT_KEY)?'INSERT INTO wpmb_deliberately_missing_table VALUES (1)':$sql;};
    add_filter('query',$filter);$wpdb->suppress_errors(true);
    try{WPMB_Import::mutate($r[4]['token']);check_import(false,'failure');}catch(RuntimeException $e){check_import($e->getMessage()==='audit_write_failed','audit failure surfaced');}finally{remove_filter('query',$filter);$wpdb->suppress_errors(false);}
    check_import(WPMB_Import::meta(5)[0]['meta_value']==='old embed','mid-write failure rolls back embed');
    foreach(['<script>alert(1)</script>','<iframe src="javascript:alert(1)"></iframe>','<iframe src="https://example.test/embed/x" onload="alert(1)"></iframe>'] as $bad){try{WPMB_Import::embed($bad);check_import(false,'unsafe');}catch(RuntimeException $e){check_import(true,'unsafe embed rejected');}}
    try{WPMB_Import::mutate($r[0]['token'].'tampered');check_import(false,'tamper');}catch(RuntimeException $e){check_import($e->getMessage()==='invalid_cursor','tampered approval rejected');}
    wp_set_current_user(0);try{WPMB_Import::mutate($r[0]['token']);check_import(false,'auth');}catch(RuntimeException $e){check_import(true,'anonymous mutation denied');}wp_set_current_user($admin);
    check_import($wpdb->get_var("SELECT post_content FROM {$wpdb->posts} WHERE ID=1")==='raw unchanged','post content untouched');
    WPMB_Import::mutate(WPMB_Import::preview($csv,'post')['rows'][0]['token']);
    ob_start();WPMB_Import::page();$html=ob_get_clean();check_import(!str_contains($html,'<iframe') && str_contains($html,'wpmb-undo'),'history escaped and rollback available after reload');
    file_put_contents('/tmp/wpmb-import-page.html','<!doctype html><html lang="th"><meta charset="utf-8">'.$html.'</html>');
    echo "WPMB_IMPORT_OK checks=$checks\n";
}finally{foreach($original as $key=>$table)$wpdb->$key=$table;foreach($tables as $table)$wpdb->query("DROP TABLE $table");unlink($csv);}
