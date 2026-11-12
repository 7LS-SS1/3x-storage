<?php
if (!defined('ABSPATH')) { exit; }

/** Explicitly approved embed updates. Export remains read-only. */
final class WPMB_Import {
    const AUDIT_KEY = '_wpmb_embed_audit';
    public static function init() {
        add_action('admin_menu', function () { add_management_page('3x-storage Embed Import', '3x-storage Embed Import', 'manage_options', 'wpmb-import', [self::class, 'page']); });
        add_action('wp_ajax_wpmb_import', [self::class, 'ajax']);
    }
    public static function embed($value) {
        // Accept only the iframe shape actually emitted by 3x-storage. Never render it.
        if (!is_string($value) || strlen($value)>16384 || !preg_match('~^<iframe\s+[^<>]*></iframe>$~D', $value)) { throw new RuntimeException('invalid_embed'); }
        $allowed=['iframe'=>['src'=>true,'width'=>true,'height'=>true,'loading'=>true,'allow'=>true,'allowfullscreen'=>true]];
        if (wp_kses($value, $allowed, ['https','http']) !== $value) { throw new RuntimeException('unsafe_embed'); }
        preg_match_all('/\bsrc="([^"]+)"/', $value, $matches);
        if (count($matches[1])!==1) { throw new RuntimeException('invalid_embed_src'); }
        $url=html_entity_decode($matches[1][0],ENT_QUOTES|ENT_HTML5,'UTF-8');
        $parts=wp_parse_url($url);
        if (!$parts || !in_array($parts['scheme']??'', ['https','http'],true) || empty($parts['host']) || isset($parts['user']) || isset($parts['pass']) || !preg_match('~^/embed/[^/]+$~D',$parts['path']??'')) { throw new RuntimeException('invalid_embed_url'); }
        return $value;
    }
    public static function meta($id, $lock=false) {
        global $wpdb;
        return WPMB_Export::rows($wpdb->prepare("SELECT meta_id,meta_value FROM {$wpdb->postmeta} WHERE post_id=%d AND meta_key='embed' ORDER BY meta_id".($lock?' FOR UPDATE':''),$id));
    }
    // Compare the complete decoded src, including host, path, query and fragment.
    public static function old_src($html) {
        if (!is_string($html) || strlen($html)>65536) return null;
        preg_match_all('~<iframe\b[^>]*>~is', $html, $tags);
        if (count($tags[0])!==1) return null;
        preg_match_all('~\s src\s*=\s*(["\'])(.*?)\1~isx', $tags[0][0], $src);
        if (count($src[2])!==1) return null;
        $url=html_entity_decode($src[2][0],ENT_QUOTES|ENT_HTML5,'UTF-8');
        $parts=wp_parse_url($url);
        return $parts && in_array($parts['scheme']??'', ['https','http'],true) && !empty($parts['host']) && !isset($parts['user']) && !isset($parts['pass']) ? $url : null;
    }
    public static function embed_matches($type,$wanted) {
        global $wpdb;
        $found=[];$cursor=0;
        do {
            $rows=WPMB_Export::rows($wpdb->prepare("SELECT m.meta_id,m.meta_value,p.ID,p.post_title,p.post_status FROM {$wpdb->postmeta} m JOIN {$wpdb->posts} p ON p.ID=m.post_id WHERE p.post_type=%s AND m.meta_key='embed' AND m.meta_id>%d ORDER BY m.meta_id LIMIT 250",$type,$cursor));
            foreach($rows as $entry) {
                $cursor=(int)$entry['meta_id'];$src=self::old_src($entry['meta_value']);
                if ($src===null || !isset($wanted[$src])) continue;
                $found[$src][]=$entry;
            }
        } while(count($rows)===250);
        return $found;
    }
    public static function preview($path, $type) {
        global $wpdb;
        if (!in_array($type,get_post_types(['show_ui'=>true]),true) || $type==='attachment') { throw new RuntimeException('invalid_post_type'); }
        if (filesize($path)>10*1024*1024) { throw new RuntimeException('file_exceeds_10_mb'); }
        $f=fopen($path,'rb'); if (!$f) { throw new RuntimeException('file_read_failed'); }
        $rows=[];$counts=[];$batch=wp_generate_uuid4();
        try {
            $head=fgetcsv($f,0,',','"','');
            if (!$head) { throw new RuntimeException('empty_csv'); }
            $head[0]=preg_replace('/^\xEF\xBB\xBF/','',$head[0]);
            if ($head!==['title','หมวดหมู่','videos url','url images'] && $head!==['title','หมวดหมู่','videos url','url images','old_embed']) { throw new RuntimeException('expected_3x_storage_csv_columns'); }
            while (($cells=fgetcsv($f,0,',','"',''))!==false) {
                if ($cells===[null]) { continue; }
                if (count($rows)>=2000) { throw new RuntimeException('max_2000_rows_split_file'); }
                if (count($cells)!==count($head) || !preg_match('//u',implode('',$cells))) { throw new RuntimeException('invalid_csv_row_or_utf8'); }
                $title=$cells[0];
                // Reverse exactly the formula protection in video-export.ts.
                if (preg_match("/^'[=+\\-@\\t\\r]/",$title)) { $title=substr($title,1); }
                $rows[]=['row'=>count($rows)+1,'title'=>$title,'after'=>$cells[2],'old_embed'=>count($head)===5?$cells[4]:null];
                $counts[$title]=($counts[$title]??0)+1;
            }
        } finally { fclose($f); }
        $wanted=[];$embedCounts=[];
        foreach($rows as $entry) {
            $src=self::old_src($entry['old_embed']);
            if($src!==null) {$wanted[$src]=true;$embedCounts[$src][$entry['after']]=true;}
        }
        $embedMatches=$wanted?self::embed_matches($type,$wanted):[];
        $expanded=[];$seen=[];
        foreach($rows as $entry) {
            $src=self::old_src($entry['old_embed']);$posts=$src!==null?($embedMatches[$src]??[]):[];
            if($src!==null && count($embedCounts[$src])===1) {if(isset($seen[$src]))continue;$seen[$src]=true;}
            if ($posts) {foreach($posts as $post){$copy=$entry;$copy['_matched_post']=$post;$expanded[]=$copy;}}
            else $expanded[]=$entry;
        }
        $rows=$expanded;
        foreach ($rows as &$row) {
            $row['status']='blocked';
            try {
                self::embed($row['after']);
                $src=null;
                if ($row['old_embed']!==null) {
                    $src=self::old_src($row['old_embed']);
                    if ($src===null) throw new RuntimeException('missing_or_invalid_old_embed');
                    if (count($embedCounts[$src])!==1) throw new RuntimeException('conflicting_new_embeds_for_same_old_embed');
                    $posts=isset($row['_matched_post'])?[$row['_matched_post']]:[];
                    if(!$posts) throw new RuntimeException('old_embed_not_found');
                    $row['match_basis']='old_embed';
                } else {
                    if ($row['title']==='') { throw new RuntimeException('empty_title'); }
                    if ($counts[$row['title']]!==1) { throw new RuntimeException('duplicate_title_in_file'); }
                    $posts=WPMB_Export::rows($wpdb->prepare("SELECT ID,post_title,post_status FROM {$wpdb->posts} WHERE post_type=%s AND BINARY post_title=BINARY %s ORDER BY ID LIMIT 2",$type,$row['title']));
                    if (count($posts)!==1) { throw new RuntimeException($posts?'duplicate_title_in_wordpress':'title_not_found'); }
                    $row['match_basis']='title';
                }
                $id=(int)$posts[0]['ID'];
                if (!current_user_can('edit_post',$id)) { throw new RuntimeException('post_permission_denied'); }
                $before=self::meta($id);
                if (count($before)>1) { throw new RuntimeException('multiple_embed_values'); }
                $row['post_id']=$id;$row['post_status']=$posts[0]['post_status'];$row['before']=$before[0]['meta_value']??null;
                $row['status']=($row['before']===$row['after'])?'unchanged':'ready';
                if ($row['status']==='ready') { $row['token']=WPMB_Admin::sign(['purpose'=>'embed_apply','user'=>get_current_user_id(),'expires'=>time()+HOUR_IN_SECONDS,'batch'=>$batch,'id'=>$id,'type'=>$type,'title'=>$posts[0]['post_title'],'old_src'=>$src,'before'=>$before,'after'=>$row['after']]); }
            } catch (RuntimeException $e) { $row['reason']=$e->getMessage(); }
        }
        unset($row);
        return ['batch_id'=>$batch,'total'=>count($rows),'rows'=>$rows];
    }
    public static function mutate($token, $undo=false) {
        global $wpdb;
        $s=WPMB_Admin::verify($token);
        if (($s['purpose']??'')!==($undo?'embed_undo':'embed_apply')) { throw new RuntimeException('invalid_token_purpose'); }
        $id=(int)$s['id'];
        if (!current_user_can('manage_options') || !current_user_can('edit_post',$id)) { throw new RuntimeException('post_permission_denied'); }
        // Fail closed if either persistent table cannot participate in rollback.
        foreach ([$wpdb->posts,$wpdb->postmeta] as $table) {
            $engine=$wpdb->get_var($wpdb->prepare('SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s',$table));
            if (strtoupper((string)$engine)!=='INNODB') { throw new RuntimeException('transactional_tables_required'); }
        }
        if ($wpdb->query('START TRANSACTION')===false) { throw new RuntimeException('transaction_failed'); }
        try {
            $post=WPMB_Export::rows($wpdb->prepare("SELECT post_title,post_type FROM {$wpdb->posts} WHERE ID=%d FOR UPDATE",$id));
            if (!$post) { throw new RuntimeException('post_missing'); }
            $current=self::meta($id,true);
            if ($undo) {
                $auditRows=WPMB_Export::rows($wpdb->prepare("SELECT meta_value FROM {$wpdb->postmeta} WHERE meta_id=%d AND post_id=%d AND meta_key=%s FOR UPDATE",$s['audit_id'],$id,self::AUDIT_KEY));
                $audit=$auditRows?json_decode($auditRows[0]['meta_value'],true,512,JSON_THROW_ON_ERROR):null;
                if (!$audit || !empty($audit['undone_at'])) { throw new RuntimeException('audit_missing_or_already_undone'); }
                if (count($current)!==1 || $current[0]['meta_value']!==$audit['after']) { throw new RuntimeException('embed_changed_since_apply'); }
                $restore=$audit['before'];
                if ($restore===null) { $ok=$wpdb->delete($wpdb->postmeta,['meta_id'=>(int)$current[0]['meta_id']]); }
                else { $ok=$wpdb->update($wpdb->postmeta,['meta_value'=>$restore],['meta_id'=>(int)$current[0]['meta_id']]); }
                if ($ok===false) { throw new RuntimeException('write_failed'); }
                $audit['undone_at']=gmdate('c');$audit['undone_by']=get_current_user_id();
                if ($wpdb->update($wpdb->postmeta,['meta_value'=>WPMB_Export::json($audit)],['meta_id'=>(int)$s['audit_id']])===false) { throw new RuntimeException('audit_write_failed'); }
                $result=['status'=>'rolled_back','post_id'=>$id];
            } else {
                self::embed($s['after']);
                if ($post[0]['post_title']!==$s['title'] || $post[0]['post_type']!==$s['type']) { throw new RuntimeException('post_changed_since_preview'); }
                if (!empty($s['old_src'])) {
                    $matches=self::embed_matches($s['type'],[$s['old_src']=>true])[$s['old_src']]??[];
                    // A repeated signed approval is a no-op only on the originally selected post.
                    if (!(count($current)===1 && $current[0]['meta_value']===$s['after']) && !in_array($id,array_map(fn($match)=>(int)$match['ID'],$matches),true)) throw new RuntimeException('old_embed_match_changed');
                } else {
                    $matches=WPMB_Export::rows($wpdb->prepare("SELECT ID FROM {$wpdb->posts} WHERE post_type=%s AND BINARY post_title=BINARY %s LIMIT 2",$s['type'],$s['title']));
                    if (count($matches)!==1) { throw new RuntimeException('duplicate_title_in_wordpress'); }
                }
                if (count($current)===1 && $current[0]['meta_value']===$s['after']) { $wpdb->query('ROLLBACK');return ['status'=>'unchanged','post_id'=>$id]; }
                if ($current!==$s['before']) { throw new RuntimeException('embed_changed_since_preview'); }
                $audit=['batch_id'=>$s['batch'],'post_id'=>$id,'title'=>$s['title'],'before'=>$current[0]['meta_value']??null,'after'=>$s['after'],'actor'=>get_current_user_id(),'at_utc'=>gmdate('c')];
                if ($current) { $ok=$wpdb->update($wpdb->postmeta,['meta_value'=>$s['after']],['meta_id'=>(int)$current[0]['meta_id']]); }
                else { $ok=$wpdb->insert($wpdb->postmeta,['post_id'=>$id,'meta_key'=>'embed','meta_value'=>$s['after']]); }
                if ($ok===false) { throw new RuntimeException('write_failed'); }
                if ($wpdb->insert($wpdb->postmeta,['post_id'=>$id,'meta_key'=>self::AUDIT_KEY,'meta_value'=>WPMB_Export::json($audit)])===false) { throw new RuntimeException('audit_write_failed'); }
                $result=['status'=>'applied','post_id'=>$id,'undo_token'=>WPMB_Admin::sign(['purpose'=>'embed_undo','user'=>get_current_user_id(),'expires'=>time()+12*HOUR_IN_SECONDS,'id'=>$id,'audit_id'=>(int)$wpdb->insert_id])];
            }
            if ($wpdb->query('COMMIT')===false) { throw new RuntimeException('commit_failed'); }
        } catch (Throwable $e) { $wpdb->query('ROLLBACK');throw $e; }
        wp_cache_delete($id,'post_meta');clean_post_cache($id);
        return $result;
    }
    public static function ajax() {
        nocache_headers();
        try {
            WPMB_Admin::guard();
            $op=$_POST['operation']??'';
            if ($op==='preview') {
                $file=$_FILES['file']??null;
                if (!$file || $file['error']!==UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) { throw new RuntimeException('upload_failed'); }
                $result=self::preview($file['tmp_name'],sanitize_key($_POST['post_type']??'post'));
            } elseif (in_array($op,['apply','undo'],true) && ($_POST['confirmed']??'')==='yes') {
                $result=self::mutate(wp_unslash((string)($_POST['token']??'')),$op==='undo');
            } else { throw new RuntimeException('confirmation_required'); }
            wp_send_json_success($result);
        } catch (Throwable $e) {
            $message=$e instanceof RuntimeException && preg_match('/^[a-z_0-9]+$/D',$e->getMessage())?$e->getMessage():'import_failed';
            wp_send_json_error(['message'=>$message],400);
        }
    }
    public static function page() {
        if (!current_user_can('manage_options')) { wp_die('Administrator required'); }
        wp_enqueue_script('wpmb-import',plugins_url('assets/import.js',dirname(__DIR__).'/wp-metadata-export.php'),[],WPMB_Export::VERSION,true);
        wp_localize_script('wpmb-import','WPMBI',['url'=>admin_url('admin-ajax.php'),'nonce'=>wp_create_nonce('wpmb_export')]);
        echo '<div class="wrap"><h1>นำเข้า embed จาก 3x-storage</h1><p>CSV ใหม่จับคู่ด้วย src ของ old_embed แบบตรงกันทั้ง URL แม้ชื่อเปลี่ยน • หลายบทความใช้ embed เดิมเดียวกันจะเปลี่ยนทั้งหมด • ไม่พบจะไม่แก้ไข • CSV เก่า 4 คอลัมน์ใช้ชื่อเรื่องตรงทุกตัวอักษร</p><p>แก้เฉพาะ custom field <code>embed</code> ของ RetroTube ไม่เปลี่ยนเนื้อหา ชื่อเรื่อง รูป หรือข้อมูลใน 3x-storage ตรวจค่าเดิม–ใหม่แล้วอนุมัติทีละรายการ หรือกดอนุมัติทั้งหมดครั้งเดียว</p><p>ไฟล์ UTF-8 ไม่เกิน 10 MiB / 2,000 รายการ คอลัมน์ title, หมวดหมู่, videos url, url images และ old_embed สำหรับไฟล์ใหม่</p><select id="wpmb-import-type">';
        foreach(get_post_types(['show_ui'=>true]) as $type) { if($type==='attachment')continue;echo '<option value="'.esc_attr($type).'" '.selected($type,'post',false).'>'.esc_html($type).'</option>'; }
        echo '</select> <input id="wpmb-import-file" type="file" accept=".csv,text/csv"> <button id="wpmb-import-preview" class="button">ตรวจไฟล์และแสดงรายการ</button><p id="wpmb-import-status" role="status"></p><div id="wpmb-import-rows"></div><p>บันทึกประวัติค่าเดิม–ใหม่ ผู้ดำเนินการ เวลา และ batch ID ใน post meta ส่วนตัว ประวัติด้านล่างใช้ย้อนคืนได้แม้เปิดหน้าใหม่ (โทเคนของแต่ละหน้าอายุ 12 ชั่วโมง) ควรสำรองด้วย Export ก่อนเริ่ม และอย่าแก้บทความพร้อมกันระหว่างนำเข้า</p></div>';
        global $wpdb;
        echo '<h2>ประวัติ 50 รายการล่าสุด</h2><div id="wpmb-import-history">';
        $history=WPMB_Export::rows($wpdb->prepare("SELECT meta_id,post_id,meta_value FROM {$wpdb->postmeta} WHERE meta_key=%s ORDER BY meta_id DESC LIMIT 50",self::AUDIT_KEY));
        foreach($history as $entry) {
            $audit=json_decode($entry['meta_value'],true);
            if (!$audit || !current_user_can('edit_post',(int)$entry['post_id']))continue;
            echo '<details><summary>'.esc_html('Post '.$entry['post_id'].' • '.$audit['title'].' • '.$audit['at_utc'].' • ผู้ดำเนินการ '.$audit['actor'].' • Batch '.$audit['batch_id']).'</summary><pre style="white-space:pre-wrap">'.esc_html(WPMB_Export::json($audit)).'</pre>';
            if(empty($audit['undone_at'])) {
                $token=WPMB_Admin::sign(['purpose'=>'embed_undo','user'=>get_current_user_id(),'expires'=>time()+12*HOUR_IN_SECONDS,'id'=>(int)$entry['post_id'],'audit_id'=>(int)$entry['meta_id']]);
                echo '<span class="wpmb-undo" data-token="'.esc_attr($token).'"></span>';
            }
            echo '</details>';
        }
        echo '</div>';
    }
}
WPMB_Import::init();
