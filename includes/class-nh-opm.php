<?php
if (!defined('ABSPATH')) exit;

/**
 * Integración de solo lectura con el plugin Newton OPM (newton-conducta).
 * Catálogos: aulas, materias, cursos y docentes.
 * Comprobante de llegada: el llamado de lista (wp_conducta_asistencias.created_at).
 */
class NH_OPM {

  /** @var array<string, int[]>|null */
  private static $mapa_materia_docentes = null;

  /** @var string|null Nombre real de la tabla de grupos OPM (conducta_grupos o legado conducta_aulas). */
  private static $tabla_grupos = null;

  public static function tabla(string $nombre): string {
    if ($nombre === 'aulas' || $nombre === 'grupos') {
      return self::tabla_grupos();
    }
    global $wpdb;
    return $wpdb->prefix . 'conducta_' . $nombre;
  }

  /**
   * El OPM renombró conducta_aulas → conducta_grupos. Usamos la misma resolución
   * para que el catálogo de grupos no quede vacío.
   */
  public static function tabla_grupos(): string {
    if (self::$tabla_grupos !== null) {
      return self::$tabla_grupos;
    }
    if (class_exists('NC_DB') && method_exists('NC_DB', 'table_grupos')) {
      self::$tabla_grupos = NC_DB::table_grupos();
      return self::$tabla_grupos;
    }
    global $wpdb;
    $nueva = $wpdb->prefix . 'conducta_grupos';
    $vieja = $wpdb->prefix . 'conducta_aulas';
    self::$tabla_grupos = self::tabla_existe($nueva) ? $nueva : $vieja;
    return self::$tabla_grupos;
  }

  private static function tabla_existe(string $nombre): bool {
    global $wpdb;
    return (bool) $wpdb->get_var($wpdb->prepare(
      "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s",
      $nombre
    ));
  }

  public static function opm_disponible(): bool {
    global $wpdb;
    $t = self::tabla('asistencias');
    return (bool) $wpdb->get_var($wpdb->prepare(
      "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s",
      $t
    ));
  }

  /**
   * Códigos de aula física pura en OPM (salones). No son grupos académicos.
   * Los grupos reales pueden llamarse "Kappa" o "K -> Kappa".
   */
  private static function codigos_aula_fisica(): array {
    return ['K', 'L', 'M', 'N', 'X', 'P', 'Z', 'S', 'VIRTUAL'];
  }

  /** Etiqueta de grupo: "K -> Kappa" → "Kappa". */
  public static function nombre_grupo_visible(?string $nombre): string {
    $s = trim((string) $nombre);
    if ($s === '') return '';
    if (strpos($s, '->') !== false) {
      $parts = explode('->', $s, 2);
      $right = trim($parts[1] ?? '');
      if ($right !== '') return $right;
    }
    // "(K) Kappa" → "Kappa"
    $s = preg_replace('/^\(\s*[A-Za-z0-9]+\s*\)\s*/', '', $s);
    return trim((string) $s);
  }

  private static function es_aula_fisica_pura(?string $nombre): bool {
    $s = trim((string) $nombre);
    if ($s === '' || strpos($s, '->') !== false) return false;
    return in_array(strtoupper($s), self::codigos_aula_fisica(), true);
  }

  /** Subgrupos viejos tipo "INGE UNI B" — ya no se usan en horarios. */
  public static function es_grupo_inge_obsoleto(?string $nombre): bool {
    $n = self::nombre_grupo_visible($nombre);
    return (bool) preg_match('/\binge\s*uni\b/i', $n);
  }

  /** Letras griegas de grupos CEA (Mu, Lambda, Nu, Zeta…). */
  public static function es_grupo_griego(?string $nombre): bool {
    $n = self::nombre_grupo_visible($nombre);
    return (bool) preg_match(
      '/(^|[^a-z])(alpha|alfa|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega)([^a-z]|$)/i',
      $n
    );
  }

  /** Grupos académicos actuales del CEA: griegos + CNA. */
  public static function es_grupo_cea(?string $nombre): bool {
    $n = self::nombre_grupo_visible($nombre);
    if ($n === '' || self::es_grupo_inge_obsoleto($n)) return false;
    if (self::es_grupo_griego($n)) return true;
    return (bool) preg_match('/\bcna\b/i', $n);
  }

  public static function curso_es_cea(int $curso_id): bool {
    if ($curso_id <= 0) return false;
    foreach (self::get_cursos() as $c) {
      if ((int) ($c['id'] ?? 0) === $curso_id) {
        return (bool) preg_match('/cea/i', (string) ($c['nombre'] ?? ''));
      }
    }
    return false;
  }

  /**
   * IDs de grupos OPM que corresponden a un curso (misma regla que el front).
   * CEA → grupos griegos/CNA; otros → curso_id exacto. Sin INGE UNI.
   *
   * @return int[]
   */
  public static function ids_grupos_de_curso(int $curso_id): array {
    if ($curso_id <= 0) return [];
    $cea = self::curso_es_cea($curso_id);
    $ids = [];
    foreach (self::get_aulas() as $a) {
      $nombre = (string) ($a['nombre'] ?? '');
      if (self::es_grupo_inge_obsoleto($nombre)) continue;
      if ($cea) {
        // CEA: letras griegas/CNA, o cualquier grupo OPM ligado a ese curso (sin INGE).
        if (self::es_grupo_cea($nombre) || (int) ($a['curso_id'] ?? 0) === $curso_id) {
          $ids[] = (int) $a['id'];
        }
        continue;
      }
      $cid = (int) ($a['curso_id'] ?? 0);
      if ($cid === $curso_id) {
        $ids[] = (int) $a['id'];
      }
    }
    return array_values(array_unique(array_filter($ids)));
  }

  /**
   * Grupos académicos OPM (conducta_grupos / legado conducta_aulas),
   * excluyendo salones físicos puros e INGE UNI obsoletos.
   */
  public static function get_aulas(): array {
    global $wpdb;
    $t = self::tabla_grupos();
    $rows = $wpdb->get_results("SELECT id, nombre, curso_id, turno FROM $t WHERE activo = 1 ORDER BY nombre ASC", ARRAY_A);
    if (!$rows) return [];

    $out = [];
    foreach ($rows as $r) {
      $raw = (string) ($r['nombre'] ?? '');
      if (self::es_aula_fisica_pura($raw)) continue;
      if (self::es_grupo_inge_obsoleto($raw)) continue;
      $r['nombre_raw'] = $raw;
      $r['nombre'] = self::nombre_grupo_visible($raw);
      $out[] = $r;
    }
    usort($out, static function ($a, $b) {
      return strcasecmp((string) $a['nombre'], (string) $b['nombre']);
    });
    return $out;
  }

  public static function get_materias(): array {
    global $wpdb;
    $t = self::tabla('materias');
    $rows = $wpdb->get_results("SELECT id, nombre FROM $t WHERE activo = 1 ORDER BY nombre ASC", ARRAY_A);
    return $rows ?: [];
  }

  public static function get_cursos(): array {
    global $wpdb;
    $t = self::tabla('cursos');
    $rows = $wpdb->get_results("SELECT id, nombre FROM $t WHERE activo = 1 ORDER BY nombre ASC", ARRAY_A);
    return $rows ?: [];
  }

  /**
   * Docentes para asignar horarios: rol `docente`/`teacher` más cualquiera
   * vinculado a una materia en el OPM (p. ej. un administrador que también dicta).
   */
  public static function get_docentes(): array {
    $seen = [];
    $out = [];
    $add = static function ($user) use (&$seen, &$out) {
      if (!$user) return;
      $uid = (int) $user->ID;
      if ($uid <= 0 || isset($seen[$uid])) return;
      $seen[$uid] = true;
      $out[] = ['id' => $uid, 'nombre' => (string) $user->display_name];
    };

    $role_slugs = [];
    foreach (['docente', 'teacher'] as $slug) {
      if (get_role($slug)) $role_slugs[] = $slug;
    }
    if ($role_slugs) {
      $users = get_users([
        'role__in' => $role_slugs,
        'orderby'  => 'display_name',
        'order'    => 'ASC',
        'number'   => 2000,
      ]);
      foreach ($users as $u) {
        $add($u);
      }
    }

    foreach (self::get_mapa_materia_docentes() as $ids) {
      foreach ($ids as $uid) {
        $uid = (int) $uid;
        if ($uid <= 0 || isset($seen[$uid])) continue;
        $add(get_userdata($uid));
      }
    }

    usort($out, static function ($a, $b) {
      return strcasecmp((string) $a['nombre'], (string) $b['nombre']);
    });
    return $out;
  }

  /**
   * Usuarios operativos para control manual: cualquier rol distinto de suscriptor
   * (docentes, secretaría, funcionarios, dirección, administradores, etc.).
   */
  public static function get_usuarios_staff(): array {
    $exclude = [
      'subscriber',
      'customer',
      'pending',
      'bbp_participant',
      'bbp_spectator',
      'bbp_blocked',
    ];
    $users = get_users([
      'orderby' => 'display_name',
      'order'   => 'ASC',
      'number'  => 2000,
      'fields'  => ['ID', 'display_name'],
    ]);
    $out = [];
    $seen = [];
    foreach ($users as $u) {
      $uid = (int) $u->ID;
      if (isset($seen[$uid])) continue;
      $wp_user = get_userdata($uid);
      if (!$wp_user || empty($wp_user->roles)) continue;
      $tiene_rol_util = false;
      foreach ($wp_user->roles as $role_slug) {
        if (!in_array(strtolower((string) $role_slug), $exclude, true)) {
          $tiene_rol_util = true;
          break;
        }
      }
      if (!$tiene_rol_util) continue;
      $seen[$uid] = true;
      $out[] = ['id' => $uid, 'nombre' => (string) $wp_user->display_name];
    }
    usort($out, static function ($a, $b) {
      return strcasecmp((string) $a['nombre'], (string) $b['nombre']);
    });
    return $out;
  }

  /** Materias asignadas a un docente en el OPM (conducta_materia_docentes). */
  public static function get_materias_de_docente(int $user_id): array {
    global $wpdb;
    $t_md = self::tabla('materia_docentes');
    $t_m  = self::tabla('materias');
    $rows = $wpdb->get_results($wpdb->prepare(
      "SELECT m.id, m.nombre FROM $t_md md
       INNER JOIN $t_m m ON m.id = md.materia_id
       WHERE md.user_id = %d AND md.activo = 1 AND m.activo = 1
       ORDER BY m.nombre ASC",
      $user_id
    ), ARRAY_A);
    return $rows ?: [];
  }

  /**
   * Mapa materia_id → [user_id, ...] de docentes activos que enseñan cada materia.
   * Claves como string para JSON estable en el front.
   *
   * @return array<string, int[]>
   */
  public static function get_mapa_materia_docentes(): array {
    if (self::$mapa_materia_docentes !== null) return self::$mapa_materia_docentes;

    global $wpdb;
    $t_md = self::tabla('materia_docentes');
    $t_m  = self::tabla('materias');

    // Si la tabla de relación no existe (OPM ausente), devolver vacío.
    $existe = (bool) $wpdb->get_var($wpdb->prepare(
      "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s",
      $t_md
    ));
    if (!$existe) {
      self::$mapa_materia_docentes = [];
      return [];
    }

    $rows = $wpdb->get_results(
      "SELECT md.materia_id, md.user_id
       FROM $t_md md
       INNER JOIN $t_m m ON m.id = md.materia_id
       WHERE md.activo = 1 AND m.activo = 1
       ORDER BY md.materia_id ASC, md.user_id ASC",
      ARRAY_A
    );
    $mapa = [];
    foreach ($rows ?: [] as $r) {
      $mid = (string) (int) $r['materia_id'];
      if (!isset($mapa[$mid])) $mapa[$mid] = [];
      $mapa[$mid][] = (int) $r['user_id'];
    }
    self::$mapa_materia_docentes = $mapa;
    return $mapa;
  }

  /**
   * Busca el llamado de lista del OPM para un bloque en una fecha.
   *
   * No determina el horario de llegada del docente: solo registra cuándo se tomó lista.
   * Criterio: asistencias de esa fecha en la misma aula/grupo, entre
   * (hora_inicio - ventana) y hora_fin. Se prefiere la del docente previsto;
   * si no hay, la más temprana.
   *
   * "Docente que dio la clase" = columna OPM «Registró» (creado_por), no el
   * docente encargado/titular de la lista.
   *
   * @return array|null {asistencia_id, docente_id, registrado_por_id, docente_encargado_id, aula_id, materia_id, hora_lista 'H:i:s'}
   */
  public static function buscar_lista(string $fecha, string $hora_inicio, string $hora_fin, int $aula_id, ?int $docente_previsto_id, int $ventana_min = 60): ?array {
    global $wpdb;
    $t = self::tabla('asistencias');

    $desde = gmdate('H:i:s', max(0, strtotime("1970-01-01 $hora_inicio UTC") - $ventana_min * 60));
    $hasta = $hora_fin;

    $rows = $wpdb->get_results($wpdb->prepare(
      "SELECT id, materia_id, grupo_id, aula_id, docente_encargado_id, creado_por, created_at
       FROM $t
       WHERE activo = 1 AND fecha = %s
         AND (grupo_id = %d OR aula_id = %d)
         AND TIME(created_at) BETWEEN %s AND %s
       ORDER BY created_at ASC",
      $fecha, $aula_id, $aula_id, $desde, $hasta
    ), ARRAY_A);

    if (!$rows) return null;

    $elegida = null;
    if ($docente_previsto_id) {
      foreach ($rows as $r) {
        $registro = (int) ($r['creado_por'] ?? 0);
        $encargado = (int) ($r['docente_encargado_id'] ?? 0);
        // Preferir lista donde el previsto aparece como quien registró o como encargado.
        if ($registro === (int) $docente_previsto_id || $encargado === (int) $docente_previsto_id) {
          $elegida = $r;
          break;
        }
      }
    }
    if (!$elegida) $elegida = $rows[0];

    // «Registró» (creado_por) = quien dio la clase / tomó lista.
    $registrado_por = (int) ($elegida['creado_por'] ?? 0);
    $encargado = (int) ($elegida['docente_encargado_id'] ?? 0);

    return [
      'asistencia_id'         => (int) $elegida['id'],
      'docente_id'            => $registrado_por ?: $encargado,
      'registrado_por_id'     => $registrado_por,
      'docente_encargado_id'  => $encargado,
      'aula_id'               => (int) ($elegida['grupo_id'] ?: $elegida['aula_id']),
      'materia_id'            => (int) $elegida['materia_id'],
      'hora_lista'            => substr((string) $elegida['created_at'], 11, 8),
    ];
  }

  /** @deprecated Usar buscar_lista(). */
  public static function buscar_llegada(string $fecha, string $hora_inicio, string $hora_fin, int $aula_id, ?int $docente_previsto_id, int $ventana_min = 60): ?array {
    $r = self::buscar_lista($fecha, $hora_inicio, $hora_fin, $aula_id, $docente_previsto_id, $ventana_min);
    if ($r) $r['hora_llegada'] = $r['hora_lista'];
    return $r;
  }
}
