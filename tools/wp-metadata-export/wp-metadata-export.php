<?php
/**
 * Plugin Name: WordPress Metadata Backup Export
 * Description: Read-only, administrator-only metadata backup with bounded batches and local JSON/CSV output.
 * Version: 1.0.0
 * Requires at least: 6.2
 * Requires PHP: 8.0
 */
if (!defined('ABSPATH')) { exit; }
require_once __DIR__ . '/includes/core.php';
require_once __DIR__ . '/includes/admin.php';
