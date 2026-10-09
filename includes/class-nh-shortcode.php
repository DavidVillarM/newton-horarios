<?php
if (!defined('ABSPATH')) exit;

/**
 * Shortcode [newton_horarios_app] — montar en una página con slug "horarios".
 */
class NH_Shortcode {

  public static function init(): void {
    add_shortcode('newton_horarios_app', [__CLASS__, 'render']);

    // Evitar que LiteSpeed / caches sirvan HTML o nonce de otro usuario.
    add_action('template_redirect', [__CLASS__, 'disable_page_cache'], 0);

    add_action('wp_enqueue_scripts', function () {
      if (!is_page()) return;
      global $post;
      if (!$post || !in_array($post->post_name, ['horarios'], true)) return;

      NH_Roles::enforce_access_or_die();

      $js_path  = NH_PATH . 'assets/app.js';
      $css_path = NH_PATH . 'assets/app.css';
      $cartel_path = NH_PATH . 'assets/cartel-import.js';
      $js_ver   = file_exists($js_path) ? filemtime($js_path) : NH_VERSION;
      $css_ver  = file_exists($css_path) ? filemtime($css_path) : NH_VERSION;
      $cartel_ver = file_exists($cartel_path) ? filemtime($cartel_path) : NH_VERSION;

      wp_enqueue_style(
        'nh-font',
        'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
        [],
        null
      );
      wp_enqueue_style('nh-app', NH_URL . 'assets/app.css', ['nh-font'], $css_ver);
      wp_enqueue_script('nh-cartel', NH_URL . 'assets/cartel-import.js', [], $cartel_ver, true);
      wp_enqueue_script('nh-app', NH_URL . 'assets/app.js', ['nh-cartel'], $js_ver, true);

      wp_localize_script('nh-app', 'NH_APP', [
        'apiUrl'        => esc_url_raw(rest_url('horarios/v1')),
        'nonce'         => wp_create_nonce('wp_rest'),
        'currentUserId' => get_current_user_id(),
        // Valor inicial; el front lo confirma con /catalogos (anti-caché).
        'esManager'     => NH_Roles::user_is_manager(),
      ]);
    });
  }

  public static function disable_page_cache(): void {
    if (!is_page()) return;
    global $post;
    if (!$post || !in_array($post->post_name, ['horarios'], true)) return;

    if (!defined('DONOTCACHEPAGE')) define('DONOTCACHEPAGE', true);
    if (!defined('DONOTCACHEOBJECT')) define('DONOTCACHEOBJECT', true);
    if (!defined('DONOTCACHEDB')) define('DONOTCACHEDB', true);
    if (!defined('LSCACHE_NO_CACHE')) define('LSCACHE_NO_CACHE', true);

    nocache_headers();
    header('Cache-Control: private, no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');

    if (function_exists('do_action')) {
      do_action('litespeed_control_set_nocache', 'newton-horarios');
    }
  }

  public static function render(): string {
    NH_Roles::enforce_access_or_die();
    return '<div id="nh-root"></div>';
  }
}
