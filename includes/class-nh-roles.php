<?php
if (!defined('ABSPATH')) exit;

/**
 * Roles y permisos del módulo Horarios.
 *
 * En este módulo, Secretaría Directiva tiene los mismos derechos que un
 * administrador (CRUD horarios, control, amonestaciones, config, import/export).
 * También: direccion y funcionarios_administrativos.
 * Docente: solo lectura de SUS horarios ("Mis horarios").
 */
class NH_Roles {

  public const CAP_MANAGE = 'manage_newton_horarios';

  public static function init(): void {
    add_filter('user_has_cap', [__CLASS__, 'filter_user_has_cap'], 10, 4);
    add_action('plugins_loaded', [__CLASS__, 'ensure_roles'], 20);
  }

  /**
   * Otorga manage_newton_horarios en caliente a Secretaría / managers,
   * aunque el rol en BD no tenga la cap guardada.
   */
  public static function filter_user_has_cap($allcaps, $caps, $args, $user) {
    if (!is_array($allcaps)) $allcaps = [];

    $wp_user = null;
    if ($user instanceof WP_User) {
      $wp_user = $user;
    } elseif (is_numeric($user)) {
      $wp_user = get_userdata((int) $user);
    }
    if (!$wp_user) return $allcaps;

    if (self::user_has_manager_role($wp_user)) {
      $allcaps[self::CAP_MANAGE] = true;
    }
    return $allcaps;
  }

  public static function ensure_roles(): void {
    $caps_secretaria = [
      'read' => true,
      self::CAP_MANAGE => true,
    ];

    $role = get_role('secretaria_directiva');
    if (!$role) {
      add_role('secretaria_directiva', 'Secretaría Directiva', $caps_secretaria);
    } else {
      foreach ($caps_secretaria as $cap => $grant) {
        if ($grant && !$role->has_cap($cap)) $role->add_cap($cap);
      }
      // Nombre visible uniforme.
      global $wp_roles;
      if (!$wp_roles) $wp_roles = wp_roles();
      if (isset($wp_roles->roles['secretaria_directiva'])) {
        $wp_roles->roles['secretaria_directiva']['name'] = 'Secretaría Directiva';
        $wp_roles->role_names['secretaria_directiva'] = 'Secretaría Directiva';
      }
    }

    // Capacidad explícita en todos los roles managers conocidos.
    foreach (self::manager_role_slugs() as $slug) {
      $r = get_role($slug);
      if ($r && !$r->has_cap(self::CAP_MANAGE)) {
        $r->add_cap(self::CAP_MANAGE);
      }
    }

    // Roles con nombre/slug equivalente (creados por otros plugins).
    global $wp_roles;
    if (!$wp_roles) $wp_roles = wp_roles();
    foreach ($wp_roles->roles as $slug => $info) {
      if (self::slug_or_name_is_manager((string) $slug, (string) ($info['name'] ?? ''))) {
        $r = get_role($slug);
        if ($r && !$r->has_cap(self::CAP_MANAGE)) {
          $r->add_cap(self::CAP_MANAGE);
        }
      }
    }
  }

  public static function manager_role_slugs(): array {
    return [
      'administrator',
      'secretaria_directiva',
      'secretaria-directiva',
      'secretariadirectiva',
      'direccion',
      'dirección',
      'funcionarios_administrativos',
      'funcionarios-administrativos',
      'funcionario_administrativo',
      'funcionarios_administrativo',
    ];
  }

  /** Normaliza slug/nombre para comparar sin tildes ni separadores. */
  private static function norm(string $s): string {
    $s = strtolower($s);
    if (function_exists('remove_accents')) {
      $s = remove_accents($s);
    } else {
      $s = strtr($s, [
        'á'=>'a','é'=>'e','í'=>'i','ó'=>'o','ú'=>'u','ñ'=>'n',
        'ä'=>'a','ë'=>'e','ï'=>'i','ö'=>'o','ü'=>'u',
      ]);
    }
    return preg_replace('/[^a-z0-9]+/', '', $s) ?: '';
  }

  private static function slug_or_name_is_manager(string $slug, string $name = ''): bool {
    $nSlug = self::norm($slug);
    $nName = self::norm($name);

    foreach (self::manager_role_slugs() as $known) {
      if ($nSlug === self::norm($known)) return true;
    }

    $needles = [
      'secretariadirectiva',
      'funcionariosadministrativos',
      'funcionarioadministrativo',
      'direccion',
      'administrator',
      'administrador',
    ];
    foreach ($needles as $needle) {
      if ($nName === $needle || $nSlug === $needle) return true;
      if ($nName !== '' && strpos($nName, $needle) !== false) return true;
      if ($nSlug !== '' && strpos($nSlug, $needle) !== false) return true;
    }

    if ($nName !== '' && strpos($nName, 'secretaria') !== false) return true;
    if ($nName !== '' && strpos($nName, 'funcionario') !== false && strpos($nName, 'admin') !== false) return true;
    if ($nSlug !== '' && strpos($nSlug, 'secretaria') !== false) return true;
    if ($nSlug !== '' && strpos($nSlug, 'funcionario') !== false && strpos($nSlug, 'admin') !== false) return true;

    return false;
  }

  /** Solo por roles (sin consultar caps; evita recursión con user_has_cap). */
  public static function user_has_manager_role($user): bool {
    if (!$user || empty($user->roles)) return false;

    global $wp_roles;
    if (!$wp_roles) $wp_roles = wp_roles();

    foreach ((array) $user->roles as $role_slug) {
      $role_obj = $wp_roles->roles[$role_slug] ?? null;
      $role_name = isset($role_obj['name']) ? (string) $role_obj['name'] : '';
      if (self::slug_or_name_is_manager((string) $role_slug, $role_name)) return true;
    }
    return false;
  }

  /**
   * Gestión completa del módulo (= administrador en Horarios).
   * Secretaría Directiva y demás managers tienen los mismos derechos.
   */
  public static function user_is_manager(?int $user_id = null): bool {
    if ($user_id) {
      $user = get_userdata($user_id);
      if (!$user) return false;
      if (user_can($user_id, 'manage_options')) return true;
      return self::user_has_manager_role($user);
    }

    if (!is_user_logged_in()) return false;
    if (current_user_can('manage_options')) return true;
    return self::user_has_manager_role(wp_get_current_user());
  }

  public static function user_is_docente(?int $user_id = null): bool {
    $user = $user_id ? get_userdata($user_id) : wp_get_current_user();
    if (!$user || empty($user->roles)) return false;
    foreach ($user->roles as $role_slug) {
      $n = self::norm((string) $role_slug);
      if ($n === 'docente' || $n === 'teacher') return true;
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
