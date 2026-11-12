<?php
if (!defined('ABSPATH')) { exit; }

final class WPMB_Export {
    const VERSION = '1.1.4';
    const BATCH = 50;

    // Evidence and provenance are documented in docs/WORDPRESS_METADATA_EXPORT.md.
    public static function mapping() {
        return [
            'embed' => ['embed', 'shortcode'],
            'video' => ['video_url', 'video_url_4k', 'video_url_1080', 'video_url_720', 'video_url_480', 'video_url_360', 'video_url_240', 'trailer_url'],
            'thumbnail' => ['thumb', 'thumbs'],
            'description' => ['rank_math_description'],
            'related' => ['duration', 'featured_video', 'hd_video', 'post_views_count', 'likes_count', 'dislikes_count'],
        ];
    }

    public static function json($value) {
        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    public static function secret_key($key) {
        return (bool) preg_match('/password|passwd|secret|token|cookie|session|credential|authorization|api[_-]?key|private[_-]?key|signature|access[_-]?key/i', (string)$key);
    }

    // Fail closed for credential-bearing values; never rewrite the source to hide a secret.
    public static function secret_value($value) {
        if (is_array($value) || is_object($value)) {
            foreach ((array)$value as $k => $v) {
                if (self::secret_key($k) || self::secret_value($v)) { return true; }
            }
            return false;
        }
        if (!is_string($value)) { return false; }
        $decoded = html_entity_decode(rawurldecode($value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        if (preg_match('~(?:password|passwd|secret|token|cookie|session|credential|authorization|api[_-]?key|private[_-]?key|signature|access[_-]?key)[\w-]*[\s"\x27]*[:=]|Bearer\s+[\w.-]+|-----BEGIN .*PRIVATE KEY-----|https?://[^\s/<>]+:[^\s/<>]+@~i', $decoded)) { return true; }
        $json = json_decode($value, true);
        return is_array($json) && self::secret_value($json);
    }

    public static function decode_meta($raw) {
        if (!is_serialized($raw)) { return $raw; }
        // No PHP classes are instantiated, including from historical object metadata.
        $value = @unserialize(trim($raw), ['allowed_classes' => false]);
        if (false === $value && 'b:0;' !== trim($raw)) { throw new RuntimeException('invalid_serialized_metadata'); }
        return $value;
    }

    public static function iframes($html, $source) {
        $result = [];
        // Tokenize tags while respecting quotes; preserve the exact attribute bytes.
        preg_match_all('~<iframe\b(?:[^>"\x27]|"[^"]*"|\x27[^\x27]*\x27)*>~is', $html, $tags);
        foreach ($tags[0] as $index => $tag) {
            preg_match_all('~\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|\x27([^\x27]*)\x27|([^\s>]+)))?~s', $tag, $attributes, PREG_SET_ORDER | PREG_UNMATCHED_AS_NULL);
            $raw = null;
            foreach ($attributes as $attribute) {
                if (strtolower($attribute[1]) === 'src') { $raw = $attribute[2] ?? $attribute[3] ?? $attribute[4] ?? ''; break; }
            }
            $decoded = $raw === null ? null : html_entity_decode($raw, ENT_QUOTES | ENT_HTML5, 'UTF-8');
            $parts = $decoded === null ? [] : (parse_url($decoded) ?: []);
            $id = null;
            if (preg_match('~/embed/([^/]+)~', $parts['path'] ?? '', $match)) { $id = $match[1]; }
            $result[] = ['source_field' => $source, 'index' => $index, 'src_raw' => $raw, 'src_decoded' => $decoded, 'hostname' => $parts['host'] ?? null, 'parsed_embed_id' => $id, 'id_status' => 'parsed_only_not_verified_video_id'];
        }
        return $result;
    }

    public static function csv_cell($value) {
        $value = (string)($value ?? '');
        if (preg_match('/^[\s\x00-\x20\x{FEFF}]*[=+@-]/u', $value) || preg_match('/^[\t\r\n]/', $value)) { $value = "'" . $value; }
        return $value;
    }

    public static function csv_line($cells) {
        $stream = fopen('php://temp', 'r+');
        fputcsv($stream, array_map([self::class, 'csv_cell'], $cells), ',', '"', '', "\r\n");
        rewind($stream); $line = stream_get_contents($stream); fclose($stream);
        return $line;
    }

    public static function csv_header() {
        return self::csv_line(['site_url', 'post_id', 'title', 'post_status', 'post_url', 'featured_image_url', 'filename', 'iframe_src', 'parsed_embed_id']);
    }

    public static function csv_record($r) {
        return self::csv_line([$r['site_url'], $r['post_id'], $r['title'], $r['post_status'], $r['post_url'], $r['featured_image_url'], $r['filename'], implode("\n", array_column($r['iframe_sources'], 'src_raw')), implode("\n", array_map(fn($x) => $x['parsed_embed_id'] ?? '', $r['iframe_sources']))]);
    }

    public static function rows($sql) {
        global $wpdb;
        $rows = $wpdb->get_results($sql, ARRAY_A);
        if ($wpdb->last_error) { throw new RuntimeException('database_read_failed'); }
        return $rows ?: [];
    }

    public static function metadata($id) {
        global $wpdb;
        return self::rows($wpdb->prepare("SELECT meta_key, meta_value FROM {$wpdb->postmeta} WHERE post_id=%d ORDER BY meta_id", $id));
    }

    public static function image($id) {
        global $wpdb;
        $out = ['featured_image_id' => $id ?: null, 'featured_image_url' => null, 'original_image_url' => null, 'attached_file' => null, 'filename' => null, 'original_filename' => null, 'mime_type' => null, 'width' => null, 'height' => null, 'alt_text' => null, 'caption' => null, 'description' => null, 'image_sizes' => [], 'image_provenance' => [], 'warnings' => []];
        if (!$id) { $out['warnings'][] = 'featured_image_missing'; return $out; }
        $rows = self::rows($wpdb->prepare("SELECT post_mime_type,post_excerpt,post_content FROM {$wpdb->posts} WHERE ID=%d AND post_type='attachment'", $id));
        if (!$rows) { $out['warnings'][] = 'featured_attachment_missing'; return $out; }
        $meta = [];
        foreach (self::metadata($id) as $row) {
            if (in_array($row['meta_key'], ['_wp_attached_file', '_wp_attachment_metadata', '_wp_attachment_image_alt'], true)) { $meta[$row['meta_key']] = self::decode_meta($row['meta_value']); }
        }
        $data = (array)($meta['_wp_attachment_metadata'] ?? []);
        $out['featured_image_url'] = wp_get_attachment_url($id) ?: null;
        $out['original_image_url'] = wp_get_original_image_url($id) ?: null;
        $out['attached_file'] = $meta['_wp_attached_file'] ?? null;
        $out['filename'] = $out['attached_file'] ? basename($out['attached_file']) : null;
        $out['original_filename'] = $data['original_image'] ?? null;
        $out['mime_type'] = $rows[0]['post_mime_type'] ?: null;
        $out['caption'] = $rows[0]['post_excerpt']; $out['description'] = $rows[0]['post_content'];
        $out['alt_text'] = $meta['_wp_attachment_image_alt'] ?? null;
        $out['width'] = $data['width'] ?? null; $out['height'] = $data['height'] ?? null;
        foreach (($data['sizes'] ?? []) as $name => $size) {
            $src = wp_get_attachment_image_src($id, $name);
            $out['image_sizes'][] = ['name' => $name, 'url' => $src ? $src[0] : null, 'width' => $size['width'] ?? null, 'height' => $size['height'] ?? null, 'file' => $size['file'] ?? null, 'mime_type' => $size['mime-type'] ?? null];
        }
        $out['image_provenance'] = ['attached_file' => '_wp_attached_file', 'filename' => 'derived_basename_of_attached_file', 'original_filename' => '_wp_attachment_metadata.original_image_only', 'dimensions_and_sizes' => '_wp_attachment_metadata', 'urls' => 'WordPress_attachment_API_resolved_not_network_verified'];
        if (!$out['original_filename']) { $out['warnings'][] = 'original_filename_not_recorded'; }
        return $out;
    }

    public static function record($p, $mapping) {
        global $wpdb;
        $id = (int)$p['ID'];
        $r = ['site_url' => site_url(), 'post_id' => $id];
        foreach (['post_type','post_status','post_date','post_date_gmt','post_modified','post_modified_gmt'] as $k) { $r[$k] = $p[$k]; }
        $r += ['post_url' => get_permalink($id) ?: null, 'post_slug' => $p['post_name'], 'author_id' => (int)$p['post_author'], 'title' => $p['post_title'], 'content_raw' => $p['post_content'], 'excerpt_raw' => $p['post_excerpt'], 'description_sources' => [], 'taxonomies' => new stdClass(), 'video_embed_code_raw' => [], 'iframe_sources' => self::iframes($p['post_content'], 'post_content'), 'video_urls' => [], 'custom_thumbnail_urls' => [], 'custom_fields' => new stdClass(), 'exported_meta_keys' => [], 'excluded_meta_keys' => [], 'warnings' => []];
        // Password-protected posts can be exported, but post_password never leaves the database.
        $thumb = 0; $fields = []; $allowed = array_unique(array_merge(...array_values($mapping)));
        foreach (self::metadata($id) as $m) {
            $key = $m['meta_key'];
            if ($key === '_thumbnail_id') { $thumb = (int)$m['meta_value']; }
            if (self::secret_key($key) || !in_array($key, $allowed, true)) {
                $r['excluded_meta_keys'][$key] = self::secret_key($key) ? 'credential_key' : 'not_in_reviewed_field_mapping'; continue;
            }
            $value = self::decode_meta($m['meta_value']);
            if (self::secret_value($value) || self::secret_value($m['meta_value'])) {
                // Omit every value of a key when one is credential-bearing.
                $r['excluded_meta_keys'][$key] = 'credential_value'; unset($fields[$key]); continue;
            }
            if (isset($r['excluded_meta_keys'][$key])) { continue; }
            $fields[$key][] = ['value' => $value, 'stored_raw' => $m['meta_value']];
        }
        foreach ($fields as $key => $values) {
            $r['exported_meta_keys'][] = $key;
            foreach ($values as $index => $entry) {
                $v = $entry['value']; $item = ['source_field' => $key, 'value_index' => $index, 'value' => $v];
                if (in_array($key, $mapping['description'], true)) { $r['description_sources'][] = $item; }
                if (in_array($key, $mapping['video'], true)) { $r['video_urls'][] = $item; }
                if (in_array($key, $mapping['thumbnail'], true)) { $r['custom_thumbnail_urls'][] = $item; }
                if (in_array($key, $mapping['embed'], true)) {
                    $r['video_embed_code_raw'][] = $item;
                    if (is_string($v)) { $r['iframe_sources'] = array_merge($r['iframe_sources'], self::iframes($v, "meta:$key:$index")); }
                }
            }
        }
        $r['custom_fields'] = (object)$fields;
        $r['excluded_meta_keys'] = (object)$r['excluded_meta_keys'];
        $tax = [];
        foreach (self::rows($wpdb->prepare("SELECT tt.taxonomy,t.term_id,t.name,t.slug,tt.parent FROM {$wpdb->term_relationships} tr JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id=tr.term_taxonomy_id JOIN {$wpdb->terms} t ON t.term_id=tt.term_id WHERE tr.object_id=%d ORDER BY tt.taxonomy,t.term_id", $id)) as $term) {
            $name = $term['taxonomy']; unset($term['taxonomy']); $term['term_id'] = (int)$term['term_id']; $term['parent'] = (int)$term['parent']; $tax[$name][] = $term;
        }
        $r['taxonomies'] = (object)$tax;
        $image = self::image($thumb); $r['warnings'] = array_merge($r['warnings'], $image['warnings']); unset($image['warnings']); $r += $image;
        if (!$r['video_embed_code_raw']) { $r['warnings'][] = 'mapped_embed_missing'; }
        if (!$r['description_sources']) { $r['warnings'][] = 'mapped_description_missing'; }
        if (!$r['iframe_sources']) { $r['warnings'][] = 'iframe_not_found'; }
        if ((array)$r['excluded_meta_keys']) { $r['warnings'][] = 'metadata_exclusions_see_excluded_meta_keys'; }
        $safe_check = $r; unset($safe_check['excluded_meta_keys']);
        if (self::secret_value($safe_check)) { throw new RuntimeException('credential_like_value_in_record_export_blocked'); }
        self::json($r); // Reject invalid UTF-8 instead of silently substituting or truncating bytes.
        return $r;
    }
}
