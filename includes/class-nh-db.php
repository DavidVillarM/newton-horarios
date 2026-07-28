<?php
if (!defined('ABSPATH')) exit;

/**
 * Esquema de base de datos del módulo de Horarios.
 *
 * Tablas propias (prefijo horarios_):
 *  - horarios_bloques:        horario previsto (único por fecha, o semanal dentro de una vigencia).
 *  - horarios_control:        control de cumplimiento de cada ocurrencia (bloque + fecha).
 *  - horarios_amonestaciones: amonestaciones de docentes (automáticas o manuales).
 *  - horarios_limpieza:       turnos de limpieza legacy (también se crean como bloques).
 *  - horarios_aulas_fisicas:  salones / aulas físicas del colegio.
 *
 * Se integra con las tablas del plugin Newton OPM (conducta_aulas = grupos, conducta_materias,
 * conducta_cursos, conducta_materia_docentes, conducta_asistencias) sin modificarlas.
 */
class NH_DB {

  public static function schema_version(): string {
    return '1.2.0';
  }

  public static function maybe_upgrade(): void {
    $stored = (string) get_option('nh_schema_version', '0.0.0');
    if (version_compare($stored, self::schema_version(), '>=')) return;
    self::ensure_schema();
    update_option('nh_schema_version', self::schema_version(), false);
  }

  public static function activate(): void {
    self::ensure_schema();
    self::ensure_default_options();
    update_option('nh_schema_version', self::schema_version());
  }

  public static function ensure_schema(): void {
    global $wpdb;
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    $charset = $wpdb->get_charset_collate();

    $t_blo = $wpdb->prefix . 'horarios_bloques';
    $t_ctl = $wpdb->prefix . 'horarios_control';
    $t_amo = $wpdb->prefix . 'horarios_amonestaciones';
    $t_lim = $wpdb->prefix . 'horarios_limpieza';
    $t_af  = $wpdb->prefix . 'horarios_aulas_fisicas';

    // 0) Aulas físicas (salones).
    $sql = "CREATE TABLE $t_af (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      nombre VARCHAR(191) NOT NULL,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      creado_por BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      modified_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY activo (activo),
      KEY nombre (nombre)
    ) $charset;";
    dbDelta($sql);

    // 1) Bloques de horario previsto.
    //    tipo 'unico'   => usa `fecha` (un día concreto).
    //    tipo 'semanal' => usa `dia_semana` (1=lunes..7=domingo) y se repite
    //                      entre vigencia_desde y vigencia_hasta (rango de fechas).
    //    aula_id        => grupo OPM (conducta_aulas); nullable si aplica a todos.
    //    aula_fisica_id => salón físico.
    //    naturaleza     => clase | examen | recreo | limpieza | almuerzo
    $sql = "CREATE TABLE $t_blo (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      tipo VARCHAR(10) NOT NULL DEFAULT 'semanal',
      naturaleza VARCHAR(20) NOT NULL DEFAULT 'clase',
      fecha DATE NULL,
      dia_semana TINYINT UNSIGNED NULL,
      vigencia_desde DATE NULL,
      vigencia_hasta DATE NULL,
      hora_inicio TIME NOT NULL,
      hora_fin TIME NOT NULL,
      aula_id BIGINT UNSIGNED NULL,
      aula_fisica_id BIGINT UNSIGNED NULL,
      materia_id BIGINT UNSIGNED NULL,
      docente_user_id BIGINT UNSIGNED NULL,
      encargado_nombre VARCHAR(191) NULL,
      encargado_user_id BIGINT UNSIGNED NULL,
      curso_id BIGINT UNSIGNED NULL,
      titulo VARCHAR(191) NULL,
      color VARCHAR(9) NULL,
      observacion TEXT NULL,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      creado_por BIGINT UNSIGNED NOT NULL,
      modificado_por BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      modified_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY tipo (tipo),
      KEY naturaleza (naturaleza),
      KEY fecha (fecha),
      KEY dia_semana (dia_semana),
      KEY vigencia_desde (vigencia_desde),
      KEY vigencia_hasta (vigencia_hasta),
      KEY aula_id (aula_id),
      KEY aula_fisica_id (aula_fisica_id),
      KEY materia_id (materia_id),
      KEY docente_user_id (docente_user_id),
      KEY curso_id (curso_id),
      KEY activo (activo)
    ) $charset;";
    dbDelta($sql);

    // 2) Control de cumplimiento por ocurrencia (bloque + fecha concreta).
    //    hora_lista_opm: hora del llamado de lista en el OPM (no es la llegada).
    //    hora_llegada / hora_salida: se cargan manualmente.
    //    estado: pendiente | puntual | tolerancia | tardanza | amonestacion | ausente | cancelado
    //    fuente: opm (llamado de lista) | manual (secretaría)
    $sql = "CREATE TABLE $t_ctl (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      bloque_id BIGINT UNSIGNED NOT NULL,
      fecha DATE NOT NULL,
      docente_previsto_id BIGINT UNSIGNED NULL,
      docente_real_id BIGINT UNSIGNED NULL,
      aula_real_id BIGINT UNSIGNED NULL,
      estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
      hora_llegada TIME NULL,
      hora_lista_opm TIME NULL,
      hora_salida TIME NULL,
      minutos_retraso INT NULL,
      fuente VARCHAR(10) NULL,
      asistencia_opm_id BIGINT UNSIGNED NULL,
      coincide_previsto TINYINT(1) NULL,
      observacion TEXT NULL,
      modificado_por BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      modified_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY bloque_fecha (bloque_id, fecha),
      KEY fecha (fecha),
      KEY estado (estado),
      KEY docente_previsto_id (docente_previsto_id),
      KEY docente_real_id (docente_real_id),
      KEY asistencia_opm_id (asistencia_opm_id)
    ) $charset;";
    dbDelta($sql);

    // 3) Amonestaciones (origen: auto = generada por el control, manual = cargada por secretaría).
    $sql = "CREATE TABLE $t_amo (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      docente_user_id BIGINT UNSIGNED NOT NULL,
      fecha DATE NOT NULL,
      control_id BIGINT UNSIGNED NULL,
      motivo TEXT NULL,
      origen VARCHAR(10) NOT NULL DEFAULT 'manual',
      activo TINYINT(1) NOT NULL DEFAULT 1,
      creado_por BIGINT UNSIGNED NOT NULL,
      anulado_por BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      modified_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY docente_user_id (docente_user_id),
      KEY fecha (fecha),
      KEY control_id (control_id),
      KEY origen (origen),
      KEY activo (activo)
    ) $charset;";
    dbDelta($sql);

    // 4) Turnos de limpieza con encargados.
    $sql = "CREATE TABLE $t_lim (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      tipo VARCHAR(10) NOT NULL DEFAULT 'semanal',
      fecha DATE NULL,
      dia_semana TINYINT UNSIGNED NULL,
      vigencia_desde DATE NULL,
      vigencia_hasta DATE NULL,
      hora_inicio TIME NOT NULL,
      hora_fin TIME NOT NULL,
      aula_id BIGINT UNSIGNED NOT NULL,
      encargado_nombre VARCHAR(191) NULL,
      encargado_user_id BIGINT UNSIGNED NULL,
      observacion TEXT NULL,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      creado_por BIGINT UNSIGNED NOT NULL,
      modificado_por BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      modified_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY tipo (tipo),
      KEY fecha (fecha),
      KEY dia_semana (dia_semana),
      KEY aula_id (aula_id),
      KEY encargado_user_id (encargado_user_id),
      KEY activo (activo)
    ) $charset;";
    dbDelta($sql);

    self::ensure_extra_columns();
  }

  /** Columnas nuevas en instalaciones ya existentes (dbDelta a veces no las agrega). */
  private static function ensure_extra_columns(): void {
    global $wpdb;
    $t_ctl = $wpdb->prefix . 'horarios_control';
    $t_blo = $wpdb->prefix . 'horarios_bloques';

    $cols_ctl = $wpdb->get_col("SHOW COLUMNS FROM `$t_ctl`", 0);
    if (is_array($cols_ctl)) {
      if (!in_array('hora_lista_opm', $cols_ctl, true)) {
        $wpdb->query("ALTER TABLE `$t_ctl` ADD COLUMN hora_lista_opm TIME NULL AFTER hora_llegada");
      }
      if (!in_array('hora_salida', $cols_ctl, true)) {
        $wpdb->query("ALTER TABLE `$t_ctl` ADD COLUMN hora_salida TIME NULL AFTER hora_lista_opm");
      }
    }

    // Migración: en controles OPM previos, la “llegada” era en realidad la hora de lista.
    $wpdb->query(
      "UPDATE `$t_ctl`
       SET hora_lista_opm = hora_llegada,
           hora_llegada = NULL,
           minutos_retraso = NULL,
           estado = IF(estado IN ('puntual','tolerancia','tardanza','amonestacion'), 'pendiente', estado)
       WHERE fuente = 'opm'
         AND hora_lista_opm IS NULL
         AND hora_llegada IS NOT NULL"
    );

    $cols_blo = $wpdb->get_col("SHOW COLUMNS FROM `$t_blo`", 0);
    if (!is_array($cols_blo)) return;

    if (!in_array('naturaleza', $cols_blo, true)) {
      $wpdb->query("ALTER TABLE `$t_blo` ADD COLUMN naturaleza VARCHAR(20) NOT NULL DEFAULT 'clase' AFTER tipo");
    }
    if (!in_array('aula_fisica_id', $cols_blo, true)) {
      $wpdb->query("ALTER TABLE `$t_blo` ADD COLUMN aula_fisica_id BIGINT UNSIGNED NULL AFTER aula_id");
    }
    if (!in_array('encargado_nombre', $cols_blo, true)) {
      $wpdb->query("ALTER TABLE `$t_blo` ADD COLUMN encargado_nombre VARCHAR(191) NULL AFTER docente_user_id");
    }
    if (!in_array('encargado_user_id', $cols_blo, true)) {
      $wpdb->query("ALTER TABLE `$t_blo` ADD COLUMN encargado_user_id BIGINT UNSIGNED NULL AFTER encargado_nombre");
    }

    // Grupo (aula_id OPM) puede ser NULL cuando el bloque aplica a todos (recreo/almuerzo).
    $aula_col = $wpdb->get_row("SHOW COLUMNS FROM `$t_blo` LIKE 'aula_id'", ARRAY_A);
    if ($aula_col && strtoupper((string) ($aula_col['Null'] ?? '')) === 'NO') {
      $wpdb->query("ALTER TABLE `$t_blo` MODIFY COLUMN aula_id BIGINT UNSIGNED NULL");
    }
  }

  /** Valores por defecto de la política de tolerancia. */
  public static function ensure_default_options(): void {
    // llegada tarde <= tolerancia_min: puntual (tolerancia sin falta; NO descuenta cupo)
    add_option('nh_tolerancia_min', 10);
    add_option('nh_amonestacion_min', 20);     // llegada tarde > 20 min: amonestación directa
    add_option('nh_max_tolerancias', 3);       // tolerancias admitidas por período; la siguiente amonesta
    add_option('nh_periodo_tolerancias', 'mes'); // mes | semana | total
    add_option('nh_ventana_llegada_min', 60);  // minutos antes de hora_inicio en que se acepta el llamado de lista
  }

  public static function t_aulas_fisicas(): string {
    global $wpdb;
    return $wpdb->prefix . 'horarios_aulas_fisicas';
  }

  public static function get_aulas_fisicas(): array {
    global $wpdb;
    $t = self::t_aulas_fisicas();
    $rows = $wpdb->get_results("SELECT id, nombre FROM $t WHERE activo = 1 ORDER BY nombre ASC", ARRAY_A);
    return $rows ?: [];
  }

  public static function get_config(): array {
    return [
      'tolerancia_min'      => (int) get_option('nh_tolerancia_min', 10),
      'amonestacion_min'    => (int) get_option('nh_amonestacion_min', 20),
      'max_tolerancias'     => (int) get_option('nh_max_tolerancias', 3),
      'periodo_tolerancias' => (string) get_option('nh_periodo_tolerancias', 'mes'),
      'ventana_llegada_min' => (int) get_option('nh_ventana_llegada_min', 60),
    ];
  }
}
