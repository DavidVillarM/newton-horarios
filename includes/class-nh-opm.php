<?php
if (!defined('ABSPATH')) exit;

/**
 * Integración de solo lectura con el plugin Newton OPM (newton-conducta).
 * Catálogos: aulas, materias, cursos y docentes.
 * Comprobante de llegada: el llamado de lista (wp_conducta_asistencias.created_at).
 */
class NH_OPM {

  public static function tabla(string $nombre): string {
    global $wpdb;
    return $wpdb->prefix . 'conducta_' . $nombre;
  }

  public static function opm_disponible(): bool {
    global $wpdb;
    $t = self::tabla('asistencias');
    return (bool) $wpdb->get_var($wpdb->prepare(
      "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s",
      $t
    ));
  }

  public static function get_aulas(): array {
    global $wpdb;
    $t = self::tabla('aulas');
    $rows = $wpdb->get_results("SELECT id, nombre, curso_id, turno FROM $t WHERE activo = 1 ORDER BY nombre ASC", ARRAY_A);
    return $rows ?: [];
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

  /** Docentes = usuarios WP con rol `docente` (mismo criterio que el OPM). */
  public static function get_docentes(): array {
    $users = get_users(['role' => 'docente', 'orderby' => 'display_name', 'order' => 'ASC', 'number' => 1000]);
    $out = [];
    foreach ($users as $u) {
      $out[] = ['id' => (int) $u->ID, 'nombre' => (string) $u->display_name];
    }
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
    global $wpdb;
    $t_md = self::tabla('materia_docentes');
    $t_m  = self::tabla('materias');

    // Si la tabla de relación no existe (OPM ausente), devolver vacío.
    $existe = (bool) $wpdb->get_var($wpdb->prepare(
      "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s",
      $t_md
    ));
    if (!$existe) return [];

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
   * @return array|null {asistencia_id, docente_id, aula_id, materia_id, hora_lista 'H:i:s'}
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
        $doc = (int) ($r['docente_encargado_id'] ?: $r['creado_por']);
        if ($doc === (int) $docente_previsto_id) { $elegida = $r; break; }
      }
    }
    if (!$elegida) $elegida = $rows[0];

    return [
      'asistencia_id' => (int) $elegida['id'],
      'docente_id'    => (int) ($elegida['docente_encargado_id'] ?: $elegida['creado_por']),
      'aula_id'       => (int) ($elegida['grupo_id'] ?: $elegida['aula_id']),
      'materia_id'    => (int) $elegida['materia_id'],
      'hora_lista'    => substr((string) $elegida['created_at'], 11, 8),
    ];
  }

  /** @deprecated Usar buscar_lista(). */
  public static function buscar_llegada(string $fecha, string $hora_inicio, string $hora_fin, int $aula_id, ?int $docente_previsto_id, int $ventana_min = 60): ?array {
    $r = self::buscar_lista($fecha, $hora_inicio, $hora_fin, $aula_id, $docente_previsto_id, $ventana_min);
    if ($r) $r['hora_llegada'] = $r['hora_lista'];
    return $r;
  }
}
