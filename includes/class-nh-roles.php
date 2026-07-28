<?php
if (!defined('ABSPATH')) exit;

/**
 * Roles y permisos del módulo Horarios.
 *
 * - secretaria_directiva: rol compartido por los funcionarios de Secretaría Directiva.
 *   Puede CRUD de horarios, controlar cumplimiento, dar/quitar amonestaciones y exportar.
 * - administrator / direccion / funcionarios_administrativos: mismos permisos de gestión.
 * - docente: solo lectura de SUS horarios (vista "Mis horarios").
 */
class NH_Roles {

  public static function ensure_roles(): void {
    if (!get_role('secretaria_directiva')) {
      add_role('secretaria_directiva', 'Secretaría Directiva', ['read' => true]);
    }
  }

  public static function manager_role_slugs(): array {
    return [
      'administrator',
      'secretaria_directiva',
      'direccion',
      'funcionarios_administrativos',
      'funcionarios-administrativos',
    ];
  }

  /** Puede gestionar horarios, control y amonestaciones. */
  public static function user_is_manager(?int $user_id = null): bool {
    if (current_user_can('manage_options')) return true;
    if (!is_user_logged_in() && !$user_id) return false;

    $user = $user_id ? get_userdata($user_id) : wp_get_current_user();
    if (!$user || empty($user->roles)) return false;

    $slugs = array_map('strtolower', self::manager_role_slugs());
    foreach ($user->roles as $role_slug) {
      if (in_array(strtolower((string) $role_slug), $slugs, true)) return true;
    }

    // Fallback por nombre visible del rol (tolerante a slugs distintos).
    global $wp_roles;
    if (!$wp_roles) $wp_roles = wp_roles();
    $names = array_map('strtolower', [
      'Secretaría Directiva', 'Secretaria Directiva',
      'Direccion', 'Dirección',
      'Funcionarios Administrativos', 'Administrator',
    ]);
    foreach ($user->roles as $role_slug) {
      $role_obj = $wp_roles->roles[$role_slug] ?? null;
      $role_name = isset($role_obj['name']) ? strtolower((string) $role_obj['name']) : '';
      if ($role_name && in_array($role_name, $names, true)) return true;
    }
    return false;
  }

  public static function user_is_docente(?int $user_id = null): bool {
    $user = $user_id ? get_userdata($user_id) : wp_get_current_user();
    if (!$user || empty($user->roles)) return false;
    foreach ($user->roles as $role_slug) {
      if (strtolower((string) $role_slug) === 'docente') return true;
    }
    return false;
  }

  /** Puede acceder a la app (managers + docentes en modo lectura). */
  public static function user_can_access(?int $user_id = null): bool {
    return self::user_is_manager($user_id) || self::user_is_docente($user_id);
  }

  public static function enforce_access_or_die(): void {
    if (is_admin()) return;
    if (self::user_can_access()) return;

    if (is_user_logged_in()) {
      wp_die('No tenés permisos para acceder a esta sección.', 'Acceso restringido', ['response' => 403]);
    }
    $path = parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?: '/';
    wp_safe_redirect(wp_login_url(home_url($path)));
    exit;
  }
}
