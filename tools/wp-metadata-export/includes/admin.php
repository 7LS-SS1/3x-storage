<?php
if (!defined('ABSPATH')) { exit; }

final class WPMB_Admin {
    public static function init() {
        add_action('admin_menu', function () { add_management_page('Metadata Backup Export', 'Metadata Backup Export', 'manage_options', 'wpmb-export', [self::class, 'page']); });
        add_action('wp_ajax_wpmb_export', [self::class, 'ajax']);
    }
    public static function guard() {
        if (!current_user_can('manage_options')) { throw new RuntimeException('administrator_required'); }
        if (!check_ajax_referer('wpmb_export', 'nonce', false)) { throw new RuntimeException('invalid_nonce'); }
    }
    public static function filters($input) {
        $type = $input['post_type'] ?? 'post'; $status = $input['post_status'] ?? 'publish';
        if (!is_string($type) || !in_array($type, get_post_types(['show_ui' => true]), true) || $type === 'attachment') { throw new RuntimeException('invalid_post_type'); }
        if (!is_string($status) || ($status !== 'all' && !in_array($status, get_post_stati(), true))) { throw new RuntimeException('invalid_status'); }
        $basis = $input['date_basis'] ?? 'post_date';
        if (!in_array($basis, ['post_date', 'post_modified'], true)) { throw new RuntimeException('invalid_date_basis'); }
        $dates = [];
        foreach (['date_from','date_to'] as $k) {
            $v = $input[$k] ?? '';
            if (!is_string($v)) { throw new RuntimeException('invalid_date'); }
            if ($v !== '') {
                $d = DateTimeImmutable::createFromFormat('!Y-m-d', $v);
                if (!$d || $d->format('Y-m-d') !== $v) { throw new RuntimeException('invalid_date'); }
            }
            $dates[$k] = $v;
        }
        if ($dates['date_from'] && $dates['date_to'] && $dates['date_from'] > $dates['date_to']) { throw new RuntimeException('reversed_date_range'); }
        // All means all matching posts, regardless of IDs left in the form.
        $ids = ($input['scope'] ?? '') === 'all' ? '' : trim((string)($input['post_ids'] ?? ''));
        if ($ids !== '' && !preg_match('/^\d+(?:[\s,]+\d+)*$/D', $ids)) { throw new RuntimeException('invalid_post_ids'); }
        $ids = $ids === '' ? [] : array_values(array_unique(array_map('intval', preg_split('/[\s,]+/', $ids))));
        if (count($ids) > 200 || in_array(0, $ids, true)) { throw new RuntimeException('post_ids_must_be_positive_max_200'); }
        if (!$ids && ($input['scope'] ?? '') !== 'all') { throw new RuntimeException('enter_post_ids_or_choose_all'); }
        return ['post_type' => $type, 'post_status' => $status, 'date_basis' => $basis, 'timezone' => wp_timezone_string(), 'post_ids' => $ids] + $dates;
    }
    public static function where($f) {
        global $wpdb;
        $sql = $wpdb->prepare('post_type=%s', $f['post_type']);
        if ($f['post_status'] !== 'all') { $sql .= $wpdb->prepare(' AND post_status=%s', $f['post_status']); }
        if ($f['post_ids']) { $sql .= ' AND ID IN (' . implode(',', array_map('intval', $f['post_ids'])) . ')'; }
        if ($f['date_from']) { $sql .= $wpdb->prepare(" AND {$f['date_basis']} >= %s", $f['date_from'] . ' 00:00:00'); }
        if ($f['date_to']) { $sql .= $wpdb->prepare(" AND {$f['date_basis']} <= %s", $f['date_to'] . ' 23:59:59'); }
        return $sql;
    }
    public static function sign($state) {
        $raw = base64_encode(WPMB_Export::json($state));
        return $raw . '.' . hash_hmac('sha256', $raw, wp_salt('auth'));
    }
    public static function verify($token) {
        $parts = explode('.', $token, 2);
        if (count($parts) !== 2 || !hash_equals(hash_hmac('sha256', $parts[0], wp_salt('auth')), $parts[1])) { throw new RuntimeException('invalid_cursor'); }
        $s = json_decode(base64_decode($parts[0], true), true, 512, JSON_THROW_ON_ERROR);
        if ($s['user'] !== get_current_user_id() || $s['expires'] < time()) { throw new RuntimeException('expired_or_wrong_user_cursor'); }
        return $s;
    }
    public static function start($input) {
        global $wpdb;
        $filters = self::filters($input); $where = self::where($filters);
        $stats = WPMB_Export::rows("SELECT COUNT(*) n,MAX(ID) max_id FROM {$wpdb->posts} WHERE $where")[0];
        $missing = [];
        if ($filters['post_ids']) {
            $found = array_map('intval', array_column(WPMB_Export::rows("SELECT ID FROM {$wpdb->posts} WHERE $where"), 'ID'));
            foreach (array_diff($filters['post_ids'], $found) as $id) { $missing[] = ['post_id' => $id, 'reason' => 'not_found_or_excluded_by_filters']; }
        }
        $state = ['user' => get_current_user_id(), 'expires' => time()+12*HOUR_IN_SECONDS, 'filters' => $filters, 'max_id' => (int)$stats['max_id'], 'after' => 0, 'mapping' => WPMB_Export::mapping()];
        return ['cursor' => self::sign($state), 'expected_records' => (int)$stats['n'], 'skipped' => $missing, 'header' => ['schema_version' => WPMB_Export::VERSION, 'exported_at_utc' => gmdate('c'), 'site_url' => site_url(), 'filters' => $filters, 'field_mapping' => $state['mapping'], 'expected_records' => (int)$stats['n'], 'source_environment' => ['theme' => get_stylesheet(), 'parent_theme' => get_template(), 'registered_taxonomies' => array_values(get_object_taxonomies($filters['post_type']))], 'warnings' => ['Read-only export. No destination storage connection.', 'Keyset batches exclude new IDs after start; this is not a cross-request database snapshot. Avoid editing source posts during export.', 'Secret-bearing fields are omitted with reasons; secret-like raw content blocks the record without changing it.', 'Unknown custom keys are excluded explicitly; review excluded_meta_keys before treating this as a complete backup.', 'WordPress-resolved URLs are not fetched or verified.']], 'csv_header' => WPMB_Export::csv_header()];
    }
    public static function batch($token, $limit = WPMB_Export::BATCH) {
        global $wpdb;
        // One consistent, read-only InnoDB view per batch. Always release it, even on failure.
        self::verify($token);
        if ($wpdb->query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ') === false || $wpdb->query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY') === false) {
            throw new RuntimeException('database_read_failed');
        }
        try { return self::read_batch($token, $limit); }
        finally { $wpdb->query('ROLLBACK'); }
    }
    private static function read_batch($token, $limit) {
        global $wpdb;
        $s = self::verify($token); $where = self::where($s['filters']);
        // Explicit projection excludes post_password and other unrequested internal columns.
        $posts = WPMB_Export::rows($wpdb->prepare("SELECT ID,post_type,post_status,post_date,post_date_gmt,post_modified,post_modified_gmt,post_name,post_author,post_title,post_content,post_excerpt FROM {$wpdb->posts} WHERE $where AND ID>%d AND ID<=%d ORDER BY ID ASC LIMIT %d", $s['after'], $s['max_id'], $limit));
        $records = []; $failed = []; $csv = '';
        foreach ($posts as $p) {
            try { $r = WPMB_Export::record($p, $s['mapping']); $records[] = $r; $csv .= WPMB_Export::csv_record($r); }
            catch (Throwable $e) { $failed[] = ['post_id' => (int)$p['ID'], 'reason' => in_array($e->getMessage(), ['invalid_serialized_metadata','database_read_failed','credential_like_value_in_record_export_blocked'], true) ? $e->getMessage() : 'record_encoding_or_read_failed']; }
            $s['after'] = (int)$p['ID'];
        }
        return ['records' => $records, 'failed' => $failed, 'csv' => $csv, 'cursor' => self::sign($s), 'done' => count($posts)<$limit || $s['after'] >= $s['max_id']];
    }
    public static function ajax() {
        nocache_headers(); header('X-Content-Type-Options: nosniff');
        try {
            self::guard();
            $input = wp_unslash($_POST);
            if (($input['operation'] ?? '') === 'start') { $result = self::start($input); }
            elseif (($input['operation'] ?? '') === 'preview') { $start = self::start($input); $result = $start + ['preview' => self::batch($start['cursor'], 2)]; }
            elseif (($input['operation'] ?? '') === 'batch') { $result = self::batch((string)($input['cursor'] ?? '')); }
            else { throw new RuntimeException('invalid_operation'); }
            wp_send_json_success($result);
        } catch (Throwable $e) {
            // No database errors, field values or stack traces reach a response.
            $allowed = ['administrator_required','invalid_nonce','invalid_post_type','invalid_status','invalid_date_basis','invalid_date','reversed_date_range','invalid_post_ids','post_ids_must_be_positive_max_200','enter_post_ids_or_choose_all','invalid_cursor','expired_or_wrong_user_cursor','invalid_operation','database_read_failed'];
            wp_send_json_error(['message' => in_array($e->getMessage(), $allowed, true) ? $e->getMessage() : 'export_request_failed'], 400);
        }
    }
    public static function page() {
        if (!current_user_can('manage_options')) { wp_die('Administrator required'); }
        wp_enqueue_script('wpmb-export', plugins_url('assets/admin.js', dirname(__DIR__) . '/wp-metadata-export.php'), [], WPMB_Export::VERSION, true);
        wp_localize_script('wpmb-export', 'WPMB', ['url' => admin_url('admin-ajax.php'), 'nonce' => wp_create_nonce('wpmb_export')]);
        ?>
        <div class="wrap"><h1>RetroTube — Metadata Backup Export</h1>
        <p>อ่านและ export เท่านั้น • ไม่เชื่อมต่อ 3x-storage หรือ Video Core • ไม่แก้บทความ รูปภาพ หรือ iframe</p>
        <p>เริ่มจาก Post ID 1–2 รายการ ตรวจตัวอย่าง แล้วจึง export ทั้งหมด ใช้ Chrome/Edge ผ่าน HTTPS หรือ localhost เพื่อเขียนไฟล์ลงเครื่องเป็น batch โดยไม่เก็บไฟล์บนเว็บเซิร์ฟเวอร์</p>
        <form id="wpmb-form"><table class="form-table"><tbody>
        <tr><th>Post type</th><td><select name="post_type"><?php foreach (get_post_types(['show_ui'=>true]) as $type) { if ($type === 'attachment') { continue; } echo '<option '.selected($type, 'post', false).' value="'.esc_attr($type).'">'.esc_html($type).'</option>'; } ?></select></td></tr>
        <tr><th>สถานะ</th><td><select name="post_status"><option value="all">ทุกสถานะ (รวมร่าง ส่วนตัว ถังขยะ และร่างอัตโนมัติ)</option><?php foreach (get_post_stati() as $status) { echo '<option value="'.esc_attr($status).'">'.esc_html($status).'</option>'; } ?></select></td></tr>
        <tr><th>ช่วงวันที่ (รวมวันสุดท้าย)</th><td><select name="date_basis"><option value="post_date">วันที่เผยแพร่</option><option value="post_modified">วันที่แก้ไข</option></select> <input name="date_from" type="date"> ถึง <input name="date_to" type="date"><p>เขตเวลา WordPress: <?php echo esc_html(wp_timezone_string()); ?> (วันที่ในตาราง posts ของเว็บไซต์) • เว้นช่วงวันที่ว่างเพื่อส่งออกทุกวัน</p></td></tr>
        <tr><th>ขอบเขต</th><td><label><input type="radio" name="scope" value="ids"> ระบุ Post ID</label> <input name="post_ids" placeholder="101, 102" aria-label="Post IDs"><br><label><input type="radio" name="scope" value="all" checked> บทความทั้งหมดตามตัวกรอง (ไม่ใช้ Post ID ที่กรอกค้างไว้)</label></td></tr>
        </tbody></table><button type="button" id="wpmb-preview" class="button">ตรวจตัวอย่าง 1–2 รายการ</button> <button type="button" id="wpmb-download" class="button button-primary" disabled>ยืนยันและบันทึก JSON + CSV</button> <button type="button" id="wpmb-cancel" class="button" disabled>หยุด</button></form>
        <p>iframe แสดงเป็นข้อความเท่านั้น ไม่ render หรือเล่นวิดีโอ ค่าหลัง /embed/ เป็นค่าที่ parse ได้ ยังไม่ใช่ Video ID ที่ยืนยันแล้ว</p>
        <p>JSON เก็บต้นฉบับและทุก taxonomy ส่วน CSV เป็นสรุป ฟิลด์ที่ไม่อยู่ใน mapping จะมีเหตุผลใน excluded_meta_keys หากพบข้อมูลรับรองจะตัดฟิลด์หรือปฏิเสธรายการนั้นโดยไม่แก้ต้นฉบับ</p>
        <details><summary>Field mapping ที่ตรวจจากโค้ด RetroTube</summary><pre><?php echo esc_html(WPMB_Export::json(WPMB_Export::mapping())); ?></pre></details>
        <p id="wpmb-status" role="status" aria-live="polite">ยังไม่ได้ตรวจตัวอย่าง</p><pre id="wpmb-preview-data" style="white-space:pre-wrap;overflow-wrap:anywhere;background:#fff;padding:16px;max-height:600px;overflow:auto"></pre></div>
        <?php
    }
}
WPMB_Admin::init();
