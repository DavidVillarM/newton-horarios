<?php
if (!defined('ABSPATH')) exit;

/**
 * Shortcode [newton_horarios_app] — montar en una página con slug "horarios".
 */
class NH_Shortcode {

  public static function init(): void {
    add_shortcode('newton_horarios_app', [__CLASS__, 'render']);

    add_action('wp_enqueue_scripts', function () {
      if (!is_page()) return;
      global $post;
      if (!$post || !in_array($post->post_name, ['horarios'], true)) return;

      NH_Roles::enforce_access_or_die();

      $js_path  = NH_PATH . 'assets/app.js';
      $css_path = NH_PATH . 'assets/app.css';
      $js_ver   = file_exists($js_path) ? filemtime($js_path) : NH_VERSION;
      $css_ver  = file_exists($css_path) ? filemtime($css_path) : NH_VERSION;

      wp_enqueue_style('nh-app', NH_URL . 'assets/app.css', [], $css_ver);
      wp_enqueue_script('nh-app', NH_URL . 'assets/app.js', [], $js_ver, true);

      wp_localize_script('nh-app', 'NH_APP', [
        'apiUrl'        => esc_url_raw(rest_url('horarios/v1')),
        'nonce'         => wp_create_nonce('wp_rest'),
        'currentUserId' => get_current_user_id(),
        'esManager'     => NH_Roles::user_is_manager(),
      ]);
    });
  }

  public static function render(): string {
    NH_Roles::enforce_access_or_die();
    return '<div id="nh-root"></div>';
  }
}
