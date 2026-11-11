<?php
// Run in wp_app: php /tmp/wp-metadata-export/tests/integration.php
// All fixture writes go to connection-local TEMPORARY tables, never WordPress source tables.
$GLOBALS['wp_filter']['option_active_plugins'][10][] = ['function' => function ($plugins) { return array_values(array_filter($plugins, fn($p) => $p === 'wp-script-core/wp-script-core.php')); }, 'accepted_args' => 1];
require '/var/www/html/wp-load.php';
require dirname(__DIR__) . '/wp-metadata-export.php';
global $wpdb;
$checks = 0;
function expect($condition, $label) { global $checks; if (!$condition) { throw new RuntimeException('FAIL: '.$label); } $checks++; echo "PASS $label\n"; }
$source_tables = [];
foreach (['posts','postmeta','terms','term_taxonomy','term_relationships'] as $property) {
    $original = $wpdb->$property; $source_tables[$property] = $original;
    $temporary = 'wpmb_fixture_'.$property;
    if ($wpdb->query("CREATE TEMPORARY TABLE $temporary LIKE $original") === false) { throw new RuntimeException('Could not isolate fixtures'); }
    $wpdb->$property = $temporary;
}
$before = [];
foreach ($source_tables as $key => $table) { $before[$key] = $wpdb->get_row("SELECT COUNT(*) n FROM $table", ARRAY_A); }
$body = '<p>ตัวอย่างภาษาไทย "A,B"</p>'."\n".'[gallery ids="1,2"]<iframe src="https://storage.example.test/embed/demo-101?a=1&amp;b=2"></iframe><iframe src=//storage.example.test/embed/demo-102></iframe>';
$embed = '<iframe title="a > b" src=\'https://storage.example.test/embed/demo-103?x=1&amp;y=2\'></iframe>';
for ($i=1;$i<=103;$i++) {
    $id=900000+$i;
    $wpdb->insert($wpdb->posts, ['ID'=>$id,'post_author'=>1,'post_type'=>'post','post_status'=>'publish','post_title'=>$i===1 ? '=ทดสอบ "CSV", ภาษาไทย' : 'ตัวอย่าง '.$i,'post_content'=>$i===1?$body:'','post_excerpt'=>$i===1?"คำอธิบาย\nบรรทัดสอง":'','post_name'=>'fixture-'.$i,'post_date'=>'2026-11-01 12:00:00','post_date_gmt'=>'2026-11-01 05:00:00','post_modified'=>'2026-11-02 12:00:00','post_modified_gmt'=>'2026-11-02 05:00:00','post_content_filtered'=>'','to_ping'=>'','pinged'=>'']);
}
$metas = [
    ['embed',$embed], ['embed','<iframe src="/embed/second-value"></iframe>'],
    ['thumbs',serialize(['https://example.test/a.jpg','https://example.test/b.jpg'])],
    ['rank_math_description','คำอธิบาย SEO <b>เดิม</b>'],
    ['video_url','https://example.test/video.mp4'],
    ['api_token','NEVER-EXPORT'], ['unreviewed_field','not-exported'],
    ['duration', serialize((object)['seconds'=>12])],
];
foreach ($metas as [$key,$value]) { $wpdb->insert($wpdb->postmeta,['post_id'=>900001,'meta_key'=>$key,'meta_value'=>$value]); }
$wpdb->insert($wpdb->postmeta,['post_id'=>900002,'meta_key'=>'embed','meta_value'=>'<iframe src="https://example.test/embed/x?token=DO-NOT-EXPORT"></iframe>']);
$wpdb->insert($wpdb->postmeta,['post_id'=>900003,'meta_key'=>'thumbs','meta_value'=>serialize(['nested'=>['api_key'=>'DO-NOT-EXPORT']])]);
// An invalid UTF-8 source must produce a reported failure, not lossy JSON.
// Instead use credential-bearing raw content because this MySQL table enforces valid UTF-8.
$wpdb->update($wpdb->posts,['post_content'=>'<iframe src="https://example.test/embed/x?token=DO-NOT-EXPORT"></iframe>'],['ID'=>900004]);
foreach ([['category',1],['category',2],['post_tag',3],['post_tag',4],['actors',5],['custom_video_tag',6]] as [$taxonomy,$id]) {
    $wpdb->insert($wpdb->terms,['term_id'=>$id,'name'=>'ชื่อ '.$id,'slug'=>'term-'.$id,'term_group'=>0]);
    $wpdb->insert($wpdb->term_taxonomy,['term_taxonomy_id'=>$id,'term_id'=>$id,'taxonomy'=>$taxonomy,'description'=>'','parent'=>$id===2?1:0,'count'=>1]);
    $wpdb->insert($wpdb->term_relationships,['object_id'=>900001,'term_taxonomy_id'=>$id,'term_order'=>0]);
}
// Attachment evidence without reading or downloading an image file.
$wpdb->insert($wpdb->posts,['ID'=>990001,'post_type'=>'attachment','post_status'=>'inherit','post_author'=>1,'post_title'=>'Image','post_name'=>'image','post_mime_type'=>'image/jpeg','post_excerpt'=>'caption ไทย','post_content'=>'description ไทย','post_content_filtered'=>'','to_ping'=>'','pinged'=>'','guid'=>'https://example.test/uploads/photo-scaled.jpg']);
foreach ([['_thumbnail_id','990001',900001],['_wp_attached_file','2026/11/photo-scaled.jpg',990001],['_wp_attachment_image_alt','alt ไทย',990001],['_wp_attachment_metadata',serialize(['width'=>1200,'height'=>800,'file'=>'2026/11/photo-scaled.jpg','original_image'=>'photo.jpg','sizes'=>['thumbnail'=>['file'=>'photo-150x150.jpg','width'=>150,'height'=>150,'mime-type'=>'image/jpeg']]]),990001]] as [$key,$value,$id]) { $wpdb->insert($wpdb->postmeta,['post_id'=>$id,'meta_key'=>$key,'meta_value'=>$value]); }

wp_set_current_user(0);
$_REQUEST['nonce']='invalid';
try { WPMB_Admin::guard(); expect(false,'anonymous denied'); } catch (RuntimeException $e) { expect($e->getMessage()==='administrator_required','anonymous denied'); }
$admin_ids=get_users(['role'=>'administrator','fields'=>'ID','number'=>1]);
if (!$admin_ids) { throw new RuntimeException('No local administrator for read-only auth test'); }
wp_set_current_user((int)$admin_ids[0]);
try { WPMB_Admin::guard(); expect(false,'bad nonce denied'); } catch (RuntimeException $e) { expect($e->getMessage()==='invalid_nonce','bad nonce denied'); }
$_REQUEST['nonce']=wp_create_nonce('wpmb_export'); WPMB_Admin::guard(); expect(true,'admin and nonce accepted');
$input=['post_type'=>'post','post_status'=>'publish','scope'=>'all','date_basis'=>'post_date'];
$start=WPMB_Admin::start($input); expect($start['expected_records']===103,'matched count');
try { WPMB_Admin::verify($start['cursor'].'x'); expect(false,'tampered cursor'); } catch (RuntimeException $e) { expect($e->getMessage()==='invalid_cursor','tampered cursor denied'); }
$cursor=$start['cursor']; $records=[];$failures=[];$batches=0;$csv=WPMB_Export::csv_header();
do { $batch=WPMB_Admin::batch($cursor);$batches++;$records=array_merge($records,$batch['records']);$failures=array_merge($failures,$batch['failed']);$csv.=$batch['csv'];$cursor=$batch['cursor']; } while (!$batch['done']);
expect($batches===3,'103 records in three bounded keyset batches');
expect(count($records)===102 && count($failures)===1 && $failures[0]['post_id']===900004,'record failure isolated and reported');
expect(count(array_unique(array_column($records,'post_id')))===102,'no duplicate post IDs across batches');
$r=$records[0];
expect($r['content_raw']===$body && $r['excerpt_raw']==="คำอธิบาย\nบรรทัดสอง",'Thai HTML shortcode and newlines exact');
expect($r['video_embed_code_raw'][0]['value']===$embed && count($r['video_embed_code_raw'])===2,'multiple embed values exact');
expect(count($r['iframe_sources'])===4,'all content and embed iframes');
expect($r['iframe_sources'][0]['src_raw']==='https://storage.example.test/embed/demo-101?a=1&amp;b=2','raw src exact');
expect($r['iframe_sources'][0]['src_decoded']==='https://storage.example.test/embed/demo-101?a=1&b=2','entity decoding separate');
expect($r['iframe_sources'][0]['parsed_embed_id']==='demo-101' && $r['iframe_sources'][0]['id_status']==='parsed_only_not_verified_video_id','parsed ID not matched to storage');
expect(count($r['taxonomies']->category)===2 && count($r['taxonomies']->post_tag)===2 && isset($r['taxonomies']->actors,$r['taxonomies']->custom_video_tag),'all real and unregistered taxonomy relationships');
expect($r['taxonomies']->category[1]['parent']===1,'term parent preserved');
expect($r['custom_fields']->thumbs[0]['value'][1]==='https://example.test/b.jpg','array metadata preserved');
expect($r['custom_fields']->duration[0]['stored_raw']===serialize((object)['seconds'=>12]),'object original serialized bytes preserved without class instantiation');
expect(isset($r['excluded_meta_keys']->api_token,$r['excluded_meta_keys']->unreviewed_field),'secret and unmapped keys reported');
expect(isset($records[1]['excluded_meta_keys']->embed) && $records[1]['video_embed_code_raw']===[],'credential URL omitted without rewriting embed');
expect(isset($records[2]['excluded_meta_keys']->thumbs),'nested credential excluded');
expect($r['filename']==='photo-scaled.jpg' && $r['original_filename']==='photo.jpg' && count($r['image_sizes'])===1 && $r['width']===1200,'attachment dimensions original evidence and sizes');
expect($records[1]['featured_image_id']===null && $records[1]['image_sizes']===[] && in_array('mapped_embed_missing',$records[1]['warnings'],true),'missing image and embed explicit');
expect(strpos($csv,'"\'=ทดสอบ')!==false,'CSV formula neutralized');
$stream=fopen('php://temp','r+'); fwrite($stream,$csv);rewind($stream);$csvRows=[];while (($row=fgetcsv($stream,0,',','"',''))!==false) {$csvRows[]=$row;}fclose($stream);
expect(count($csvRows)===103 && count($csvRows[1])===9 && $csvRows[1][7]===implode("\n",array_column($r['iframe_sources'],'src_raw')),'CSV roundtrip quoting newline and count');
foreach (['=1','+1','-1','@SUM(A1)','  =1',"\t=1","\n=1"] as $formula) { expect(str_starts_with(WPMB_Export::csv_cell($formula),"'"),'formula escaped '.json_encode($formula)); }
$document=$start['header'];$document['site_url']='https://wordpress.example.test';$sample=array_slice($records,0,2);foreach($sample as &$item){$item['site_url']='https://wordpress.example.test';$item['post_url']='https://wordpress.example.test/?p='.$item['post_id'];}unset($item);
$document['records']=$sample;$document['total_records']=2;
$document['expected_records']=2;$document['filters']['post_ids']=[900001,900002];
$encoded=WPMB_Export::json($document);$decoded=json_decode($encoded,true,512,JSON_THROW_ON_ERROR);
expect($decoded['records'][0]['content_raw']===$body && $decoded['records'][0]['video_embed_code_raw'][0]['value']===$embed,'JSON roundtrip exact raw fields');
expect(!str_contains($encoded,'DO-NOT-EXPORT')&&!str_contains($encoded,'NEVER-EXPORT'),'no fixture credentials exported');
$again=WPMB_Admin::batch($start['cursor']);expect(WPMB_Export::json($again['records'])===WPMB_Export::json(array_slice($records,0,49)),'repeating batch deterministic read-only');
$one=WPMB_Admin::start(array_replace($input,['scope'=>'ids','post_ids'=>'900001,900001,999999']));expect($one['expected_records']===1 && count($one['skipped'])===1,'duplicate input IDs normalized missing ID reported');
try { WPMB_Admin::filters($input+['date_from'=>'2026-02-30']);expect(false,'bad date'); }catch(RuntimeException $e){expect($e->getMessage()==='invalid_date','invalid calendar date rejected');}
$reversed=$input+['date_from'=>'2026-11-30','date_to'=>'2026-11-01'];try{WPMB_Admin::filters($reversed);expect(false,'reversed dates');}catch(RuntimeException $e){expect($e->getMessage()==='reversed_date_range','reversed date range rejected');}
$all=WPMB_Admin::start($input+['post_ids'=>'900001']);
expect($all['expected_records']===103 && $all['header']['filters']['post_ids']===[], 'all ignores stale post IDs');
foreach (['draft','private','trash','auto-draft','future','pending'] as $offset=>$status) {
    $wpdb->update($wpdb->posts,['post_status'=>$status],['ID'=>900010+$offset]);
}
$every=WPMB_Admin::start(array_replace($input,['post_status'=>'all']));
expect($every['expected_records']===103,'all statuses includes drafts private trash and scheduled');
expect(WPMB_Admin::start($input)['expected_records']===97,'explicit publish filter still applies');
$seen=[];$cursor=$every['cursor'];$failureCount=0;
do { $part=WPMB_Admin::batch($cursor); $cursor=$part['cursor']; $seen=array_merge($seen,array_column($part['records'],'post_id')); $failureCount+=count($part['failed']); } while (!$part['done']);
expect(count($seen)===102 && count(array_unique($seen))===102 && $failureCount===1,'all status batches complete without duplicates and account for failure');
expect(WPMB_Admin::start(array_replace($input,['post_status'=>'all','date_from'=>'2026-12-01']))['expected_records']===0,'all retains explicit date filter');
// Simulated database failure must abort request, not falsely return an empty success.
$posts=$wpdb->posts; $wpdb->posts='wpmb_nonexistent_fixture_table';$wpdb->suppress_errors(true);
try{WPMB_Admin::batch($start['cursor']);expect(false,'DB failure');}catch(RuntimeException $e){expect($e->getMessage()==='database_read_failed','database failure surfaced');}finally{$wpdb->posts=$posts;$wpdb->suppress_errors(false);}
foreach ($source_tables as $key=>$table) {expect($before[$key]===$wpdb->get_row("SELECT COUNT(*) n FROM $table",ARRAY_A),'source table count unchanged '.$key);}
// Samples contain only generic fixture content, never real posts.
file_put_contents('/tmp/wpmb-sample.json',json_encode($document,JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR));
file_put_contents('/tmp/wpmb-sample.csv',"\xEF\xBB\xBF".WPMB_Export::csv_header().WPMB_Export::csv_record($sample[0]).WPMB_Export::csv_record($sample[1]));
ob_start(); WPMB_Admin::page(); $page=ob_get_clean();
expect(!str_contains($page,'<iframe'),'admin page has no rendered iframe');
file_put_contents('/tmp/wpmb-page.html','<!doctype html><html lang="th"><meta charset="utf-8"><title>RetroTube Metadata Export — local fixture</title><style>body{font:16px system-ui;margin:28px;color:#202b36;background:#f0f0f1}.form-table th{text-align:left;padding:14px}.form-table td{padding:10px}input,select,button{font:inherit;padding:7px}button{margin:8px 4px}pre{font-size:13px}h1{font-size:28px}.button-primary{background:#2271b1;color:white}</style>'.$page.'</html>');
echo "WPMB_INTEGRATION_OK checks=$checks\n";
