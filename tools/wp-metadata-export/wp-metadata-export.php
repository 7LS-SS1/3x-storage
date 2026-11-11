<?php
/**
 * Plugin Name: WordPress Metadata Backup Export
 * Description: Metadata backup and administrator-reviewed RetroTube embed import from 3x-storage CSV.
 * Version: 1.1.3
 * Requires at least: 6.2
 * Requires PHP: 8.0
 */
if (!defined('ABSPATH')) { exit; }
require_once __DIR__ . '/includes/core.php';
require_once __DIR__ . '/includes/admin.php';
require_once __DIR__ . '/includes/import.php';
