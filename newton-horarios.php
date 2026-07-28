<?php
/**
 * Plugin Name: Newton Horarios
 * Description: Registro y control de horarios de docentes para Secretaría Directiva. Integrado con Newton OPM (conducta): usa sus aulas, materias, docentes y el llamado de lista como registro de asistencia (llegada/salida manual).
 * Version: 1.2.0
 * Author: Newton Centro de Estudios
 * Text Domain: newton-horarios
 */

if (!defined('ABSPATH')) exit;

define('NH_VERSION', '1.2.0');
define('NH_PATH', plugin_dir_path(__FILE__));
define('NH_URL', plugin_dir_url(__FILE__));

require_once NH_PATH . 'includes/class-nh-db.php';
require_once NH_PATH . 'includes/class-nh-roles.php';
require_once NH_PATH . 'includes/class-nh-opm.php';
require_once NH_PATH . 'includes/class-nh-rest.php';
require_once NH_PATH . 'includes/class-nh-export.php';
require_once NH_PATH . 'includes/class-nh-import.php';
require_once NH_PATH . 'includes/class-nh-shortcode.php';

register_activation_hook(__FILE__, function () {
  NH_DB::activate();
  NH_Roles::ensure_roles();
});

add_action('plugins_loaded', function () {
  NH_DB::maybe_upgrade();
});

add_action('rest_api_init', ['NH_Rest', 'register_routes']);

NH_Shortcode::init();
