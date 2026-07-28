<?php
if (!defined('ABSPATH')) exit;

/**
 * API REST del módulo Horarios. Namespace: horarios/v1
 *
 * Gestión (Secretaría Directiva):
 *   GET    /catalogos                         grupos (aulas OPM), aulas físicas, materias, cursos, docentes, config
 *   GET    /bloques?desde&hasta[&aula_id][&curso_id][&aula_fisica_id][&docente_id][&materia_id]
 *   POST   /bloques                           crear bloque (único, semanal o rango con varios días)
 *   PUT    /bloques/{id}                      editar bloque
 *   DELETE /bloques/{id}                      desactivar bloque
 *   POST   /bloques/eliminar                  desactivar varios {ids:[…]}
 *   GET/POST /aulas-fisicas                   catálogo de salones
 *   PUT/DELETE /aulas-fisicas/{id}
 *   POST   /control/verificar                 cruza con el OPM (hora de lista; llegada/salida manual)
 *   PUT    /control/{bloque_id}/{fecha}       edición manual del control de una ocurrencia
 *   GET    /amonestaciones?docente_id&materia_id&aula_id&desde&hasta
 *   POST   /amonestaciones                    amonestación manual
 *   DELETE /amonestaciones/{id}               anular amonestación
 *   GET/POST /limpieza                        turnos de limpieza
 *   PUT/DELETE /limpieza/{id}
 *   GET    /config | PUT /config              política de tolerancia
 *   GET    /export?desde&hasta                Excel (ver NH_Export)
 *   POST   /import                            Excel mismo formato de exportación
 *
 * Docente:
 *   GET    /mis-horarios?desde&hasta
 */
class NH_Rest {

  const NS = 'horarios/v1';

  public static function can_manage(): bool {
    return NH_Roles::user_is_manager();
  }

  public static function can_access(): bool {
    return NH_Roles::user_can_access();
  }

  private static function ok($data, int $status = 200) {
    return new WP_REST_Response($data, $status);
  }

  private static function err(string $message, int $status = 400) {
    return new WP_Error('nh_error', $message, ['status' => $status]);
  }

  private static function t_bloques(): string { global $wpdb; return $wpdb->prefix . 'horarios_bloques'; }
  private static function t_control(): string { global $wpdb; return $wpdb->prefix . 'horarios_control'; }
  private static function t_amonest(): string { global $wpdb; return $wpdb->prefix . 'horarios_amonestaciones'; }
  private static function t_limpieza(): string { global $wpdb; return $wpdb->prefix . 'horarios_limpieza'; }
  private static function t_aulas_fisicas(): string { return NH_DB::t_aulas_fisicas(); }

  public static function register_routes(): void {
    register_rest_route(self::NS, '/catalogos', [
      'methods' => 'GET',
      'callback' => [__CLASS__, 'get_catalogos'],
      'permission_callback' => [__CLASS__, 'can_access'],
    ]);

    register_rest_route(self::NS, '/aulas-fisicas', [
      [
        'methods' => 'GET',
        'callback' => [__CLASS__, 'list_aulas_fisicas'],
        'permission_callback' => [__CLASS__, 'can_access'],
      ],
      [
        'methods' => 'POST',
        'callback' => [__CLASS__, 'create_aula_fisica'],
        'permission_callback' => [__CLASS__, 'can_manage'],
      ],
    ]);

    register_rest_route(self::NS, '/aulas-fisicas/(?P<id>\d+)', [
      [
        'methods' => 'PUT',
        'callback' => [__CLASS__, 'update_aula_fisica'],
        'permission_callback' => [__CLASS__, 'can_manage'],
      ],
      [
        'methods' => 'DELETE',
        'callback' => [__CLASS__, 'delete_aula_fisica'],
        'permission_callback' => [__CLASS__, 'can_manage'],
      ],
    ]);

    register_rest_route(self::NS, '/bloques', [
      [
        'methods' => 'GET',
        'callback' => [__CLASS__, 'list_bloques'],
        'permission_callback' => [__CLASS__, 'can_manage'],
      ],
      [
        'methods' => 'POST',
        'callback' => [__CLASS__, 'create_bloque'],
        'permission_callback' => [__CLASS__, 'can_manage'],
      ],
    ]);

    register_rest_route(self::NS, '/bloques/(?P<id>\d+)', [
      [
        'methods' => 'PUT',
        'callback' => [__CLASS__, 'update_bloque'],
        'permission_callback' => [__CLASS__, 'can_manage'],
      ],
      [
        'methods' => 'DELETE',
        'callback' => [__CLASS__, 'delete_bloque'],
        'permission_callback' => [__CLASS__, 'can_manage'],
      ],
    ]);

    register_rest_route(self::NS, '/bloques/eliminar', [
      'methods' => 'POST',
      'callback' => [__CLASS__, 'delete_bloques'],
      'permission_callback' => [__CLASS__, 'can_manage'],
    ]);

    register_rest_route(self::NS, '/control/verificar', [
      'methods' => 'POST',
      'callback' => [__CLASS__, 'verificar_control'],
      'permission_callback' => [__CLASS__, 'can_manage'],
    ]);

    register_rest_route(self::NS, '/control/(?P<bloque_id>\d+)/(?P<fecha>[\d-]+)', [
      'methods' => 'PUT',
      'callback' => [__CLASS__, 'update_control'],
      'permission_callback' => [__CLASS__, 'can_manage'],
    ]);

    register_rest_route(self::NS, '/amonestaciones', [
      [
        'methods' => 'GET',
        'callback' => [__CLASS__, 'list_amonestaciones'],
        'permission_callback' => [__CLASS__, 'can_manage'],
      ],
      [
        'methods' => 'POST',
        'callback' => [__CLASS__, 'create_amonestacion'],
        'permission_callback' => [__CLASS__, 'can_manage'],
      ],
    ]);

    register_rest_route(self::NS, '/amonestaciones/(?P<id>\d+)', [
      'methods' => 'DELETE',
      'callback' => [__CLASS__, 'anular_amonestacion'],
      'permission_callback' => [__CLASS__, 'can_manage'],
    ]);

    register_rest_route(self::NS, '/config', [
      [
        'methods' => 'GET',
        'callback' => function () { return self::ok(NH_DB::get_config()); },
        'permission_callback' => [__CLASS__, 'can_manage'],
      ],
      [
        'methods' => 'PUT',
        'callback' => [__CLASS__, 'update_config'],
        'permission_callback' => [__CLASS__, 'can_manage'],
      ],
    ]);

    register_rest_route(self::NS, '/export', [
      'methods' => 'GET',
      'callback' => ['NH_Export', 'handle'],
      'permission_callback' => [__CLASS__, 'can_manage'],
    ]);

    register_rest_route(self::NS, '/import', [
      'methods' => 'POST',
      'callback' => ['NH_Import', 'handle'],
      'permission_callback' => [__CLASS__, 'can_manage'],
    ]);

    register_rest_route(self::NS, '/limpieza', [
      [
        'methods' => 'GET',
        'callback' => [__CLASS__, 'list_limpieza'],
        'permission_callback' => [__CLASS__, 'can_manage'],
      ],
      [
        'methods' => 'POST',
        'callback' => [__CLASS__, 'create_limpieza'],
        'permission_callback' => [__CLASS__, 'can_manage'],
      ],
    ]);

    register_rest_route(self::NS, '/limpieza/(?P<id>\d+)', [
      [
        'methods' => 'PUT',
        'callback' => [__CLASS__, 'update_limpieza'],
        'permission_callback' => [__CLASS__, 'can_manage'],
      ],
      [
        'methods' => 'DELETE',
        'callback' => [__CLASS__, 'delete_limpieza'],
        'permission_callback' => [__CLASS__, 'can_manage'],
      ],
    ]);

    register_rest_route(self::NS, '/mis-horarios', [
      'methods' => 'GET',
      'callback' => [__CLASS__, 'mis_horarios'],
      'permission_callback' => [__CLASS__, 'can_access'],
    ]);
  }

  // ---------------------------------------------------------------- catálogos

  public static function get_catalogos(WP_REST_Request $req) {
    return self::ok([
      'opm_disponible' => NH_OPM::opm_disponible(),
      'aulas'    => NH_OPM::get_aulas(), // grupos OPM (legacy key)
      'grupos'   => NH_OPM::get_aulas(),
      'aulas_fisicas' => NH_DB::get_aulas_fisicas(),
      'materias' => NH_OPM::get_materias(),
      'cursos'   => NH_OPM::get_cursos(),
      'docentes' => NH_OPM::get_docentes(),
      'materia_docentes' => NH_OPM::get_mapa_materia_docentes(),
      'config'   => NH_DB::get_config(),
      'es_manager' => NH_Roles::user_is_manager(),
    ]);
  }

  // ----------------------------------------------------------- aulas físicas

  public static function list_aulas_fisicas() {
    return self::ok(['items' => NH_DB::get_aulas_fisicas()]);
  }

  public static function create_aula_fisica(WP_REST_Request $req) {
    global $wpdb;
    $nombre = sanitize_text_field((string) $req->get_param('nombre'));
    if ($nombre === '') return self::err('Indicá el nombre del aula física.');
    $t = self::t_aulas_fisicas();
    $existente = $wpdb->get_row($wpdb->prepare(
      "SELECT id, activo FROM $t WHERE nombre = %s LIMIT 1",
      $nombre
    ), ARRAY_A);
    if ($existente) {
      if ((int) $existente['activo'] === 1) {
        return self::ok(['id' => (int) $existente['id'], 'nombre' => $nombre, 'ya_existia' => true]);
      }
      $wpdb->update($t, ['activo' => 1], ['id' => (int) $existente['id']]);
      return self::ok(['id' => (int) $existente['id'], 'nombre' => $nombre], 201);
    }
    $wpdb->insert($t, [
      'nombre' => $nombre,
      'activo' => 1,
      'creado_por' => get_current_user_id(),
    ]);
    if (!$wpdb->insert_id) return self::err('No se pudo guardar el aula física.', 500);
    return self::ok(['id' => (int) $wpdb->insert_id, 'nombre' => $nombre], 201);
  }

  public static function update_aula_fisica(WP_REST_Request $req) {
    global $wpdb;
    $id = (int) $req['id'];
    $nombre = sanitize_text_field((string) $req->get_param('nombre'));
    if ($nombre === '') return self::err('Indicá el nombre del aula física.');
    $t = self::t_aulas_fisicas();
    $existe = $wpdb->get_var($wpdb->prepare("SELECT id FROM $t WHERE id = %d AND activo = 1", $id));
    if (!$existe) return self::err('Aula física no encontrada.', 404);
    $wpdb->update($t, ['nombre' => $nombre], ['id' => $id]);
    return self::ok(['updated' => true, 'id' => $id, 'nombre' => $nombre]);
  }

  public static function delete_aula_fisica(WP_REST_Request $req) {
    global $wpdb;
    $id = (int) $req['id'];
    $wpdb->update(self::t_aulas_fisicas(), ['activo' => 0], ['id' => $id]);
    return self::ok(['deleted' => true]);
  }

  // ------------------------------------------------------------------ bloques

  private static function validar_fecha(?string $v): ?string {
    if (!$v) return null;
    $d = DateTime::createFromFormat('Y-m-d', $v);
    return ($d && $d->format('Y-m-d') === $v) ? $v : null;
  }

  private static function validar_hora(?string $v): ?string {
    if (!$v) return null;
    if (preg_match('/^(\d{2}):(\d{2})(:(\d{2}))?$/', $v, $m)) {
      $h = (int) $m[1]; $mi = (int) $m[2];
      if ($h < 24 && $mi < 60) return sprintf('%02d:%02d:%02d', $h, $mi, (int) ($m[4] ?? 0));
    }
    return null;
  }

  private static function naturalezas_validas(): array {
    return ['clase', 'examen', 'recreo', 'limpieza', 'almuerzo'];
  }

  private static function titulo_por_naturaleza(string $nat): string {
    return [
      'examen' => 'EXAMEN',
      'recreo' => 'RECREO',
      'limpieza' => 'LIMPIEZA',
      'almuerzo' => 'ALMUERZO',
    ][$nat] ?? '';
  }

  private static function color_por_naturaleza(string $nat): ?string {
    return [
      'examen' => '#7030a0',
      'recreo' => '#00b0f0',
      'limpieza' => '#6b7280',
      'almuerzo' => '#ed7d31',
    ][$nat] ?? null;
  }

  /** @return int[] */
  private static function parse_ids_param($raw): array {
    if (is_string($raw)) {
      $decoded = json_decode($raw, true);
      $raw = is_array($decoded) ? $decoded : preg_split('/\s*,\s*/', $raw);
    }
    if (!is_array($raw)) return [];
    return array_values(array_unique(array_filter(array_map('intval', $raw), fn($id) => $id > 0)));
  }

  private static function sanitize_bloque(WP_REST_Request $req): array|WP_Error {
    $tipo = in_array($req->get_param('tipo'), ['unico', 'semanal'], true) ? $req->get_param('tipo') : 'semanal';
    $naturaleza = (string) $req->get_param('naturaleza');
    if (!in_array($naturaleza, self::naturalezas_validas(), true)) $naturaleza = 'clase';

    $hora_inicio = self::validar_hora((string) $req->get_param('hora_inicio'));
    $hora_fin    = self::validar_hora((string) $req->get_param('hora_fin'));
    if (!$hora_inicio || !$hora_fin || $hora_fin <= $hora_inicio) {
      return self::err('Horas inválidas: hora_inicio y hora_fin son obligatorias y fin debe ser mayor a inicio.');
    }

    $aula_id = ((int) $req->get_param('aula_id')) ?: null; // grupo OPM
    $aula_fisica_id = ((int) $req->get_param('aula_fisica_id')) ?: null;
    if (!$aula_fisica_id) {
      $afs = self::parse_ids_param($req->get_param('aula_fisica_ids'));
      $json = $req->get_json_params();
      if (!$afs && is_array($json) && isset($json['aula_fisica_ids'])) {
        $afs = self::parse_ids_param($json['aula_fisica_ids']);
      }
      if ($afs) $aula_fisica_id = $afs[0];
    }
    $curso_id = ((int) $req->get_param('curso_id')) ?: null;
    $materia_id = ((int) $req->get_param('materia_id')) ?: null;
    $docente_user_id = ((int) $req->get_param('docente_user_id')) ?: null;
    $encargado_nombre = sanitize_text_field((string) $req->get_param('encargado_nombre')) ?: null;
    $encargado_user_id = ((int) $req->get_param('encargado_user_id')) ?: null;
    $titulo = sanitize_text_field((string) $req->get_param('titulo')) ?: null;
    $color = sanitize_text_field((string) $req->get_param('color')) ?: null;

    $es_especial = in_array($naturaleza, ['recreo', 'almuerzo'], true);
    $es_limpieza = $naturaleza === 'limpieza';

    if ($es_especial) {
      // Recreo / almuerzo: solo días, aulas físicas, horas; curso/grupo opcionales.
      $materia_id = null;
      $docente_user_id = null;
      $encargado_nombre = null;
      $encargado_user_id = null;
      if (!$titulo) $titulo = self::titulo_por_naturaleza($naturaleza);
      if (!$color) $color = self::color_por_naturaleza($naturaleza);
      if (!$aula_fisica_id) {
        return self::err('Indicá al menos un aula física para recreo/almuerzo.');
      }
    } elseif ($es_limpieza) {
      if (!$aula_fisica_id) return self::err('Indicá el aula física de limpieza.');
      if (!$encargado_nombre && !$encargado_user_id) {
        return self::err('Indicá el funcionario encargado de la limpieza.');
      }
      $materia_id = null;
      $docente_user_id = $encargado_user_id ?: $docente_user_id;
      if (!$titulo) $titulo = self::titulo_por_naturaleza('limpieza');
      if (!$color) $color = self::color_por_naturaleza('limpieza');
    } else {
      // Clase / examen: curso, grupo y aula física.
      if (!$aula_id) return self::err('El grupo es obligatorio.');
      if (!$aula_fisica_id) return self::err('El aula física es obligatoria.');
      if ($naturaleza === 'examen' && !$titulo && !$materia_id) {
        $titulo = self::titulo_por_naturaleza('examen');
      }
      if ($naturaleza === 'examen' && !$color) $color = self::color_por_naturaleza('examen');
    }

    $data = [
      'tipo'              => $tipo,
      'naturaleza'        => $naturaleza,
      'hora_inicio'       => $hora_inicio,
      'hora_fin'          => $hora_fin,
      'aula_id'           => $aula_id,
      'aula_fisica_id'    => $aula_fisica_id,
      'materia_id'        => $materia_id,
      'docente_user_id'   => $docente_user_id,
      'encargado_nombre'  => $encargado_nombre,
      'encargado_user_id' => $encargado_user_id,
      'curso_id'          => $curso_id,
      'titulo'            => $titulo,
      'color'             => $color,
      'observacion'       => sanitize_textarea_field((string) $req->get_param('observacion')) ?: null,
    ];

    if ($tipo === 'unico') {
      $fecha = self::validar_fecha((string) $req->get_param('fecha'));
      if (!$fecha) return self::err('Para un horario de un solo día indicá la fecha (Y-m-d).');
      $data['fecha'] = $fecha;
      $data['dia_semana'] = null;
      $data['vigencia_desde'] = null;
      $data['vigencia_hasta'] = null;
    } else {
      $desde = self::validar_fecha((string) $req->get_param('vigencia_desde'));
      $hasta = self::validar_fecha((string) $req->get_param('vigencia_hasta'));
      if (!$desde || !$hasta || $hasta < $desde) {
        return self::err('Para un horario semanal indicá vigencia_desde y vigencia_hasta válidas.');
      }
      $data['fecha'] = null;
      $data['vigencia_desde'] = $desde;
      $data['vigencia_hasta'] = $hasta;
    }

    return $data;
  }

  /**
   * Crea uno o varios bloques.
   * tipo 'unico': una fecha. tipo 'semanal': acepta `dias_semana` como array [1..7]
   * y crea un bloque por día dentro de la vigencia (rango de fechas).
   * Acepta `aula_fisica_ids` (array) para crear un bloque por cada aula física.
   */
  public static function create_bloque(WP_REST_Request $req) {
    global $wpdb;
    $data = self::sanitize_bloque($req);
    if (is_wp_error($data)) return $data;

    $json = $req->get_json_params();
    $aulas_fisicas = self::parse_ids_param($req->get_param('aula_fisica_ids'));
    if (!$aulas_fisicas && is_array($json) && isset($json['aula_fisica_ids'])) {
      $aulas_fisicas = self::parse_ids_param($json['aula_fisica_ids']);
    }
    if (!$aulas_fisicas && !empty($data['aula_fisica_id'])) {
      $aulas_fisicas = [(int) $data['aula_fisica_id']];
    }
    if (!$aulas_fisicas) {
      // Recreo/almuerzo/limpieza/clase ya validaron aula_fisica_id en sanitize.
      if (empty($data['aula_fisica_id'])) return self::err('Indicá al menos un aula física.');
      $aulas_fisicas = [(int) $data['aula_fisica_id']];
    }

    $data['creado_por'] = get_current_user_id();
    $ids = [];

    if ($data['tipo'] === 'unico') {
      foreach ($aulas_fisicas as $af_id) {
        $row = $data;
        $row['aula_fisica_id'] = $af_id;
        $wpdb->insert(self::t_bloques(), $row);
        if ($wpdb->insert_id) $ids[] = (int) $wpdb->insert_id;
      }
      if (!$ids) return self::err('No se pudo guardar el bloque.', 500);
    } else {
      $dias = $req->get_param('dias_semana');
      if (!is_array($dias) && is_array($json) && isset($json['dias_semana'])) {
        $dias = $json['dias_semana'];
      }
      if (is_string($dias)) {
        $decoded = json_decode($dias, true);
        $dias = is_array($decoded) ? $decoded : preg_split('/\s*,\s*/', $dias);
      }
      $dias = is_array($dias) ? array_values(array_unique(array_map('intval', $dias))) : [];
      $dias = array_values(array_filter($dias, fn($d) => $d >= 1 && $d <= 7));
      if (!$dias) return self::err('Indicá al menos un día de la semana (1=lunes .. 7=domingo).');

      // Aviso temprano: días que no caen ni una vez en la vigencia.
      $cursor = new DateTime($data['vigencia_desde']);
      $tope = new DateTime($data['vigencia_hasta']);
      $presentes = [];
      $guard = 0;
      while ($cursor <= $tope && $guard < 400) {
        $presentes[(int) $cursor->format('N')] = true;
        if (count($presentes) >= 7) break;
        $cursor->modify('+1 day');
        $guard++;
      }
      $fuera = array_values(array_filter($dias, fn($d) => empty($presentes[$d])));
      if ($fuera) {
        $nombres = [1=>'lunes',2=>'martes',3=>'miércoles',4=>'jueves',5=>'viernes',6=>'sábado',7=>'domingo'];
        $lista = implode(', ', array_map(fn($d) => $nombres[$d] ?? $d, $fuera));
        return self::err(
          "Estos días no caen dentro de la vigencia ($lista). Ampliá “Se repite hasta” o desmarcá esos días."
        );
      }

      $esperados = count($dias) * count($aulas_fisicas);
      foreach ($dias as $dia) {
        foreach ($aulas_fisicas as $af_id) {
          $row = $data;
          $row['dia_semana'] = $dia;
          $row['aula_fisica_id'] = $af_id;
          $ok = $wpdb->insert(self::t_bloques(), $row);
          if ($ok) $ids[] = (int) $wpdb->insert_id;
        }
      }
      if (!$ids) return self::err('No se pudo guardar ningún bloque.', 500);
      if (count($ids) < $esperados) {
        return self::err('Solo se guardaron ' . count($ids) . ' de ' . $esperados . ' bloques. Revisá e intentá de nuevo.', 500);
      }
    }

    return self::ok(['ids' => $ids], 201);
  }

  public static function update_bloque(WP_REST_Request $req) {
    global $wpdb;
    $id = (int) $req['id'];
    $existe = $wpdb->get_row($wpdb->prepare('SELECT id FROM ' . self::t_bloques() . ' WHERE id = %d AND activo = 1', $id));
    if (!$existe) return self::err('Bloque no encontrado.', 404);

    $data = self::sanitize_bloque($req);
    if (is_wp_error($data)) return $data;

    if ($data['tipo'] === 'semanal') {
      $dia = (int) $req->get_param('dia_semana');
      if ($dia < 1 || $dia > 7) return self::err('Indicá el día de la semana (1=lunes .. 7=domingo).');
      $data['dia_semana'] = $dia;
    }

    $data['modificado_por'] = get_current_user_id();
    $wpdb->update(self::t_bloques(), $data, ['id' => $id]);
    return self::ok(['updated' => true]);
  }

  public static function delete_bloque(WP_REST_Request $req) {
    global $wpdb;
    $id = (int) $req['id'];
    $wpdb->update(self::t_bloques(), ['activo' => 0, 'modificado_por' => get_current_user_id()], ['id' => $id]);
    return self::ok(['deleted' => true]);
  }

  /** Desactiva varios bloques de una vez. Body: { ids: number[] }. */
  public static function delete_bloques(WP_REST_Request $req) {
    global $wpdb;
    $json = $req->get_json_params();
    $ids = $req->get_param('ids');
    if (!is_array($ids) && is_array($json) && isset($json['ids'])) $ids = $json['ids'];
    $ids = is_array($ids) ? array_values(array_unique(array_map('intval', $ids))) : [];
    $ids = array_values(array_filter($ids, fn($id) => $id > 0));
    if (!$ids) return self::err('Indicá al menos un horario para eliminar.');

    $uid = get_current_user_id();
    $placeholders = implode(',', array_fill(0, count($ids), '%d'));
    $sql = 'UPDATE ' . self::t_bloques() . " SET activo = 0, modificado_por = %d WHERE id IN ($placeholders) AND activo = 1";
    $wpdb->query($wpdb->prepare($sql, $uid, ...$ids));

    return self::ok(['deleted' => count($ids), 'ids' => $ids]);
  }

  // -------------------------------------------------- expansión de ocurrencias

  /**
   * Expande los bloques activos a ocurrencias concretas (una por fecha) dentro de un rango.
   * @return array[] cada item: bloque + 'fecha' concreta
   */
  public static function expandir_ocurrencias(
    string $desde,
    string $hasta,
    ?int $aula_id = null,
    ?int $docente_id = null,
    ?int $materia_id = null,
    ?int $curso_id = null,
    ?int $aula_fisica_id = null
  ): array {
    global $wpdb;
    $t = self::t_bloques();

    $where = 'activo = 1';
    $params = [];
    if ($aula_id) { $where .= ' AND aula_id = %d'; $params[] = $aula_id; }
    if ($docente_id) { $where .= ' AND docente_user_id = %d'; $params[] = $docente_id; }
    if ($materia_id) { $where .= ' AND materia_id = %d'; $params[] = $materia_id; }
    if ($aula_fisica_id) { $where .= ' AND aula_fisica_id = %d'; $params[] = $aula_fisica_id; }
    if ($curso_id) {
      $grupo_ids = [];
      foreach (NH_OPM::get_aulas() as $a) {
        if ((int) ($a['curso_id'] ?? 0) === $curso_id) $grupo_ids[] = (int) $a['id'];
      }
      if ($grupo_ids) {
        $ph = implode(',', array_fill(0, count($grupo_ids), '%d'));
        $where .= " AND (curso_id = %d OR aula_id IN ($ph))";
        $params[] = $curso_id;
        array_push($params, ...$grupo_ids);
      } else {
        $where .= ' AND curso_id = %d';
        $params[] = $curso_id;
      }
    }

    $sql = "SELECT * FROM $t WHERE $where";
    $bloques = $params ? $wpdb->get_results($wpdb->prepare($sql, ...$params), ARRAY_A) : $wpdb->get_results($sql, ARRAY_A);

    $out = [];
    $ini = new DateTime($desde);
    $fin = new DateTime($hasta);

    foreach ($bloques as $b) {
      if ($b['tipo'] === 'unico') {
        if ($b['fecha'] >= $desde && $b['fecha'] <= $hasta) {
          $b['fecha_ocurrencia'] = $b['fecha'];
          $out[] = $b;
        }
        continue;
      }
      // semanal dentro de vigencia
      $vd = max($desde, (string) $b['vigencia_desde']);
      $vh = min($hasta, (string) $b['vigencia_hasta']);
      if ($vd > $vh) continue;
      $cursor = new DateTime($vd);
      $tope = new DateTime($vh);
      while ($cursor <= $tope) {
        if ((int) $cursor->format('N') === (int) $b['dia_semana']) {
          $row = $b;
          $row['fecha_ocurrencia'] = $cursor->format('Y-m-d');
          $out[] = $row;
          $cursor->modify('+7 days');
        } else {
          $cursor->modify('+1 day');
        }
      }
    }

    usort($out, function ($a, $z) {
      return [$a['fecha_ocurrencia'], $a['hora_inicio'], $a['aula_id'] ?? 0, $a['aula_fisica_id'] ?? 0]
        <=> [$z['fecha_ocurrencia'], $z['hora_inicio'], $z['aula_id'] ?? 0, $z['aula_fisica_id'] ?? 0];
    });
    return $out;
  }

  /** Adjunta el control (si existe) a cada ocurrencia. */
  private static function adjuntar_control(array $ocurrencias, string $desde, string $hasta): array {
    global $wpdb;
    if (!$ocurrencias) return [];

    $rows = $wpdb->get_results($wpdb->prepare(
      'SELECT * FROM ' . self::t_control() . ' WHERE fecha BETWEEN %s AND %s',
      $desde, $hasta
    ), ARRAY_A);

    $mapa = [];
    foreach ($rows as $c) {
      $mapa[$c['bloque_id'] . '|' . $c['fecha']] = $c;
    }

    $docentes = [];
    foreach ($ocurrencias as &$o) {
      $o['control'] = $mapa[$o['id'] . '|' . $o['fecha_ocurrencia']] ?? null;
      foreach (['docente_user_id', 'encargado_user_id'] as $k) {
        if (!empty($o[$k])) $docentes[(int) $o[$k]] = true;
      }
      if ($o['control'] && $o['control']['docente_real_id']) {
        $docentes[(int) $o['control']['docente_real_id']] = true;
      }
    }
    unset($o);

    // nombres de docentes para el front
    $nombres = [];
    foreach (array_keys($docentes) as $uid) {
      $u = get_userdata($uid);
      if ($u) $nombres[$uid] = $u->display_name;
    }

    $mapaGrupos = [];
    foreach (NH_OPM::get_aulas() as $a) $mapaGrupos[(int) $a['id']] = $a['nombre'];
    $mapaAF = [];
    foreach (NH_DB::get_aulas_fisicas() as $a) $mapaAF[(int) $a['id']] = $a['nombre'];
    $mapaCursos = [];
    foreach (NH_OPM::get_cursos() as $c) $mapaCursos[(int) $c['id']] = $c['nombre'];

    foreach ($ocurrencias as &$o) {
      $o['docente_nombre'] = $o['docente_user_id'] ? ($nombres[(int) $o['docente_user_id']] ?? null) : null;
      $o['encargado_display'] = !empty($o['encargado_user_id'])
        ? ($nombres[(int) $o['encargado_user_id']] ?? null)
        : ($o['encargado_nombre'] ?? null);
      if (!$o['encargado_display'] && !empty($o['encargado_nombre'])) {
        $o['encargado_display'] = $o['encargado_nombre'];
      }
      $o['grupo_nombre'] = !empty($o['aula_id']) ? ($mapaGrupos[(int) $o['aula_id']] ?? null) : null;
      $o['aula_nombre'] = $o['grupo_nombre']; // compat
      $o['aula_fisica_nombre'] = !empty($o['aula_fisica_id']) ? ($mapaAF[(int) $o['aula_fisica_id']] ?? null) : null;
      $o['curso_nombre'] = !empty($o['curso_id']) ? ($mapaCursos[(int) $o['curso_id']] ?? null) : null;
      if ($o['control'] && $o['control']['docente_real_id']) {
        $o['control']['docente_real_nombre'] = $nombres[(int) $o['control']['docente_real_id']] ?? null;
      }
    }
    unset($o);

    return $ocurrencias;
  }

  public static function list_bloques(WP_REST_Request $req) {
    $desde = self::validar_fecha((string) $req->get_param('desde'));
    $hasta = self::validar_fecha((string) $req->get_param('hasta'));
    if (!$desde || !$hasta || $hasta < $desde) return self::err('Indicá desde y hasta (Y-m-d).');

    $aula_id = ((int) $req->get_param('aula_id')) ?: null;
    $docente_id = ((int) $req->get_param('docente_id')) ?: null;
    $materia_id = ((int) $req->get_param('materia_id')) ?: null;
    $curso_id = ((int) $req->get_param('curso_id')) ?: null;
    $aula_fisica_id = ((int) $req->get_param('aula_fisica_id')) ?: null;

    $ocurrencias = self::expandir_ocurrencias($desde, $hasta, $aula_id, $docente_id, $materia_id, $curso_id, $aula_fisica_id);
    $ocurrencias = self::adjuntar_control($ocurrencias, $desde, $hasta);

    return self::ok(['items' => $ocurrencias]);
  }

  public static function mis_horarios(WP_REST_Request $req) {
    $desde = self::validar_fecha((string) $req->get_param('desde')) ?: current_time('Y-m-d');
    $hasta = self::validar_fecha((string) $req->get_param('hasta')) ?: $desde;

    $uid = get_current_user_id();
    $ocurrencias = self::expandir_ocurrencias($desde, $hasta, null, $uid);
    $ocurrencias = self::adjuntar_control($ocurrencias, $desde, $hasta);
    return self::ok(['items' => $ocurrencias]);
  }

  // ------------------------------------------------------------------ control

  /**
   * Cruza las ocurrencias con los llamados de lista del OPM.
   * Guarda la hora del llamado de lista (no la usa como llegada).
   * Llegada, salida y retraso se cargan/calculan de forma manual.
   * No pisa controles editados manualmente (fuente = 'manual').
   */
  public static function verificar_control(WP_REST_Request $req) {
    global $wpdb;

    $fecha = self::validar_fecha((string) $req->get_param('fecha'));
    $desde = self::validar_fecha((string) $req->get_param('desde')) ?: $fecha;
    $hasta = self::validar_fecha((string) $req->get_param('hasta')) ?: $fecha;
    if (!$desde || !$hasta) return self::err('Indicá fecha, o desde y hasta.');

    if (!NH_OPM::opm_disponible()) return self::err('No se encontraron las tablas del OPM.', 500);

    $cfg = NH_DB::get_config();
    $ocurrencias = self::expandir_ocurrencias($desde, $hasta);
    $resultados = ['procesados' => 0, 'con_lista' => 0, 'con_llegada' => 0, 'amonestaciones_nuevas' => 0];

    foreach ($ocurrencias as $o) {
      $f = $o['fecha_ocurrencia'];
      $naturaleza = (string) ($o['naturaleza'] ?? 'clase');
      // Recreo, almuerzo y limpieza no pasan por control de asistencia docente.
      if (in_array($naturaleza, ['recreo', 'almuerzo', 'limpieza'], true)) continue;

      $existente = $wpdb->get_row($wpdb->prepare(
        'SELECT * FROM ' . self::t_control() . ' WHERE bloque_id = %d AND fecha = %s',
        (int) $o['id'], $f
      ), ARRAY_A);
      if ($existente && $existente['fuente'] === 'manual') continue; // respetar edición manual

      $lista = null;
      if (!empty($o['aula_id'])) {
        $lista = NH_OPM::buscar_lista(
          $f, $o['hora_inicio'], $o['hora_fin'],
          (int) $o['aula_id'],
          $o['docente_user_id'] ? (int) $o['docente_user_id'] : null,
          $cfg['ventana_llegada_min']
        );
      }

      $control = [
        'bloque_id'           => (int) $o['id'],
        'fecha'               => $f,
        'docente_previsto_id' => $o['docente_user_id'] ? (int) $o['docente_user_id'] : null,
        'fuente'              => 'opm',
        'modificado_por'      => get_current_user_id(),
      ];

      // Conservar llegada/salida ya cargadas en un control OPM previo.
      $hora_llegada = $existente['hora_llegada'] ?? null;
      $hora_salida  = $existente['hora_salida'] ?? null;

      if ($lista) {
        $control['docente_real_id']   = $lista['docente_id'];
        $control['aula_real_id']      = $lista['aula_id'];
        $control['hora_lista_opm']    = $lista['hora_lista'];
        $control['asistencia_opm_id'] = $lista['asistencia_id'];
        $control['coincide_previsto'] = ($control['docente_previsto_id'] && $lista['docente_id'] === $control['docente_previsto_id']) ? 1 : 0;
        $resultados['con_lista']++;
        $resultados['con_llegada']++; // compat con UI anterior
      } else {
        $control['hora_lista_opm'] = null;
        $control['asistencia_opm_id'] = null;
      }

      if ($hora_llegada) {
        $control['hora_llegada'] = $hora_llegada;
        $retraso = max(0, (int) round((strtotime("$f $hora_llegada") - strtotime("$f {$o['hora_inicio']}")) / 60));
        $control['minutos_retraso'] = $retraso;
        $doc_estado = (int) ($control['docente_real_id'] ?? $existente['docente_real_id'] ?? $o['docente_user_id'] ?? 0);
        $excluir = $existente ? (int) $existente['id'] : 0;
        $control['estado'] = $doc_estado
          ? self::calcular_estado($retraso, $doc_estado, $f, $cfg, $excluir)
          : 'pendiente';
      } elseif ($lista) {
        // Hay llamado de lista pero aún no se cargó la llegada manual.
        $control['hora_llegada'] = null;
        $control['minutos_retraso'] = null;
        $control['estado'] = 'pendiente';
      } else {
        $ya_paso = strtotime("$f {$o['hora_fin']}") < current_time('timestamp');
        $control['estado'] = $ya_paso ? 'ausente' : 'pendiente';
        $control['hora_llegada'] = null;
        $control['minutos_retraso'] = null;
      }

      if ($hora_salida) $control['hora_salida'] = $hora_salida;

      if ($existente) {
        $wpdb->update(self::t_control(), $control, ['id' => (int) $existente['id']]);
        $control_id = (int) $existente['id'];
      } else {
        $wpdb->insert(self::t_control(), $control);
        $control_id = (int) $wpdb->insert_id;
      }

      if (($control['estado'] ?? '') === 'amonestacion' && !empty($control['docente_real_id'])) {
        if (self::crear_amonestacion_auto((int) $control['docente_real_id'], $f, $control_id, (int) ($control['minutos_retraso'] ?? 0))) {
          $resultados['amonestaciones_nuevas']++;
        }
      }
      $resultados['procesados']++;
    }

    return self::ok($resultados);
  }

  /**
   * Política de tolerancia:
   *  - retraso <= tolerancia_min: puntual (tolerancia sin falta). NO descuenta cupo.
   *  - tolerancia_min < retraso <= amonestacion_min: tolerancia (consume 1 del cupo);
   *    si el docente ya agotó max_tolerancias del período → amonestación.
   *  - retraso > amonestacion_min: amonestación directa.
   */
  public static function calcular_estado(int $retraso, int $docente_id, string $fecha, array $cfg, int $excluir_control_id = 0): string {
    // Dentro de la tolerancia sin falta: puntual, sin tocar el contador.
    if ($retraso <= $cfg['tolerancia_min']) return 'puntual';
    if ($retraso > $cfg['amonestacion_min']) return 'amonestacion';

    $usadas = self::contar_tolerancias($docente_id, $fecha, $cfg['periodo_tolerancias'], $excluir_control_id);
    return ($usadas >= $cfg['max_tolerancias']) ? 'amonestacion' : 'tolerancia';
  }

  /**
   * Tolerancias ya registradas para el docente en el período que contiene a $fecha.
   * Excluye el propio control cuando se re-verifica (para no contarse a sí mismo).
   */
  private static function contar_tolerancias(int $docente_id, string $fecha, string $periodo, int $excluir_control_id = 0): int {
    global $wpdb;
    $t = self::t_control();

    if ($periodo === 'semana') {
      $d = new DateTime($fecha);
      $desde = (clone $d)->modify('monday this week')->format('Y-m-d');
      $hasta = (clone $d)->modify('sunday this week')->format('Y-m-d');
    } elseif ($periodo === 'total') {
      $desde = '1970-01-01';
      $hasta = '2999-12-31';
    } else { // mes
      $desde = substr($fecha, 0, 7) . '-01';
      $hasta = date('Y-m-t', strtotime($desde));
    }

    return (int) $wpdb->get_var($wpdb->prepare(
      "SELECT COUNT(*) FROM $t
       WHERE docente_real_id = %d AND estado = 'tolerancia'
         AND fecha BETWEEN %s AND %s AND id <> %d",
      $docente_id, $desde, $hasta, $excluir_control_id
    ));
  }

  /** Crea la amonestación automática si no existe ya una para ese control. */
  private static function crear_amonestacion_auto(int $docente_id, string $fecha, int $control_id, int $retraso): bool {
    global $wpdb;
    $t = self::t_amonest();
    $ya = $wpdb->get_var($wpdb->prepare("SELECT id FROM $t WHERE control_id = %d AND activo = 1", $control_id));
    if ($ya) return false;
    $wpdb->insert($t, [
      'docente_user_id' => $docente_id,
      'fecha'           => $fecha,
      'control_id'      => $control_id,
      'motivo'          => "Llegada tardía de $retraso minutos.",
      'origen'          => 'auto',
      'creado_por'      => get_current_user_id(),
    ]);
    return (bool) $wpdb->insert_id;
  }

  /** Edición manual del control (estado, docente real, llegada, salida, observación). */
  public static function update_control(WP_REST_Request $req) {
    global $wpdb;
    $bloque_id = (int) $req['bloque_id'];
    $fecha = self::validar_fecha((string) $req['fecha']);
    if (!$fecha) return self::err('Fecha inválida.');

    $bloque = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::t_bloques() . ' WHERE id = %d', $bloque_id), ARRAY_A);
    if (!$bloque) return self::err('Bloque no encontrado.', 404);

    $estados = ['pendiente', 'puntual', 'tolerancia', 'tardanza', 'amonestacion', 'ausente', 'cancelado'];
    $estado = (string) $req->get_param('estado');
    if ($estado && !in_array($estado, $estados, true)) return self::err('Estado inválido.');

    $cfg = NH_DB::get_config();
    $data = [
      'bloque_id'           => $bloque_id,
      'fecha'               => $fecha,
      'docente_previsto_id' => $bloque['docente_user_id'] ? (int) $bloque['docente_user_id'] : null,
      'fuente'              => 'manual',
      'modificado_por'      => get_current_user_id(),
    ];

    $docente_real = (int) $req->get_param('docente_real_id');
    if ($docente_real) {
      $data['docente_real_id'] = $docente_real;
      $data['coincide_previsto'] = ($data['docente_previsto_id'] && $docente_real === $data['docente_previsto_id']) ? 1 : 0;
    }

    $aula_real = (int) $req->get_param('aula_real_id');
    if ($aula_real) $data['aula_real_id'] = $aula_real;

    $hora = self::validar_hora((string) $req->get_param('hora_llegada'));
    $retraso = null;
    if ($hora) {
      $data['hora_llegada'] = $hora;
      $retraso = max(0, (int) round((strtotime("$fecha $hora") - strtotime("$fecha {$bloque['hora_inicio']}")) / 60));
      $data['minutos_retraso'] = $retraso; // siempre figura, aunque el estado sea puntual/tolerancia
    } elseif ($req->get_param('hora_llegada') === '' || $req->get_param('hora_llegada') === null) {
      // permitir limpiar
      if ($req->has_param('hora_llegada')) {
        $data['hora_llegada'] = null;
        $data['minutos_retraso'] = null;
      }
    }

    $hora_salida = self::validar_hora((string) $req->get_param('hora_salida'));
    if ($hora_salida) {
      $data['hora_salida'] = $hora_salida;
    } elseif ($req->has_param('hora_salida') && ($req->get_param('hora_salida') === '' || $req->get_param('hora_salida') === null)) {
      $data['hora_salida'] = null;
    }

    // Si no eligieron estado pero hay llegada, calcular según política (el retraso igual se guarda).
    if (!$estado && $retraso !== null && $docente_real) {
      $existente_id = (int) ($wpdb->get_var($wpdb->prepare(
        'SELECT id FROM ' . self::t_control() . ' WHERE bloque_id = %d AND fecha = %s',
        $bloque_id, $fecha
      )) ?: 0);
      $estado = self::calcular_estado($retraso, $docente_real, $fecha, $cfg, $existente_id);
    }

    // Tolerancia sin falta: si llegó dentro del margen, nunca consume cupo (ni aunque elijan "tolerancia").
    if ($retraso !== null && $retraso <= $cfg['tolerancia_min']
        && in_array($estado, ['tolerancia', 'tardanza', 'amonestacion'], true)) {
      $estado = 'puntual';
    }

    if ($estado) $data['estado'] = $estado;

    if ($req->get_param('observacion') !== null) {
      $data['observacion'] = sanitize_textarea_field((string) $req->get_param('observacion'));
    }

    $existente = $wpdb->get_var($wpdb->prepare(
      'SELECT id FROM ' . self::t_control() . ' WHERE bloque_id = %d AND fecha = %s',
      $bloque_id, $fecha
    ));

    if ($existente) {
      // Conservar hora_lista_opm del cruce OPM previo.
      $wpdb->update(self::t_control(), $data, ['id' => (int) $existente]);
      $control_id = (int) $existente;
    } else {
      $wpdb->insert(self::t_control(), $data);
      $control_id = (int) $wpdb->insert_id;
    }

    if ($estado === 'amonestacion') {
      $docente = $docente_real ?: (int) ($bloque['docente_user_id'] ?? 0);
      if ($docente) self::crear_amonestacion_auto($docente, $fecha, $control_id, (int) ($data['minutos_retraso'] ?? 0));
    }

    return self::ok(['control_id' => $control_id]);
  }

  // ---------------------------------------------------------- amonestaciones

  public static function list_amonestaciones(WP_REST_Request $req) {
    global $wpdb;
    $t = self::t_amonest();
    $t_ctl = self::t_control();
    $t_blo = self::t_bloques();

    $where = 'a.activo = 1';
    $params = [];
    $docente = (int) $req->get_param('docente_id');
    if ($docente) { $where .= ' AND a.docente_user_id = %d'; $params[] = $docente; }
    $desde = self::validar_fecha((string) $req->get_param('desde'));
    $hasta = self::validar_fecha((string) $req->get_param('hasta'));
    if ($desde) { $where .= ' AND a.fecha >= %s'; $params[] = $desde; }
    if ($hasta) { $where .= ' AND a.fecha <= %s'; $params[] = $hasta; }
    $materia_id = (int) $req->get_param('materia_id');
    if ($materia_id) { $where .= ' AND b.materia_id = %d'; $params[] = $materia_id; }
    $aula_id = (int) $req->get_param('aula_id');
    if ($aula_id) { $where .= ' AND b.aula_id = %d'; $params[] = $aula_id; }

    $sql = "SELECT a.*,
              b.hora_inicio AS bloque_hora_inicio,
              b.hora_fin AS bloque_hora_fin,
              b.materia_id AS bloque_materia_id,
              b.aula_id AS bloque_aula_id,
              b.titulo AS bloque_titulo,
              c.minutos_retraso AS control_retraso
            FROM $t a
            LEFT JOIN $t_ctl c ON c.id = a.control_id
            LEFT JOIN $t_blo b ON b.id = c.bloque_id
            WHERE $where
            ORDER BY a.fecha DESC, a.id DESC
            LIMIT 500";
    $rows = $params ? $wpdb->get_results($wpdb->prepare($sql, ...$params), ARRAY_A) : $wpdb->get_results($sql, ARRAY_A);

    $aulas = [];
    foreach (NH_OPM::get_aulas() as $a) $aulas[(int) $a['id']] = $a['nombre'];
    $materias = [];
    foreach (NH_OPM::get_materias() as $m) $materias[(int) $m['id']] = $m['nombre'];

    foreach ($rows as &$r) {
      $u = get_userdata((int) $r['docente_user_id']);
      $r['docente_nombre'] = $u ? $u->display_name : null;
      $r['horario'] = (!empty($r['bloque_hora_inicio']) && !empty($r['bloque_hora_fin']))
        ? substr($r['bloque_hora_inicio'], 0, 5) . ' a ' . substr($r['bloque_hora_fin'], 0, 5)
        : null;
      $mid = (int) ($r['bloque_materia_id'] ?? 0);
      $r['materia_nombre'] = $mid ? ($materias[$mid] ?? null) : ($r['bloque_titulo'] ?? null);
      $aid = (int) ($r['bloque_aula_id'] ?? 0);
      $r['aula_nombre'] = $aid ? ($aulas[$aid] ?? null) : null;
      $r['materia_id'] = $mid ?: null;
      $r['aula_id'] = $aid ?: null;
    }
    unset($r);

    return self::ok(['items' => $rows ?: []]);
  }

  public static function create_amonestacion(WP_REST_Request $req) {
    global $wpdb;
    $docente = (int) $req->get_param('docente_user_id');
    $fecha = self::validar_fecha((string) $req->get_param('fecha'));
    if (!$docente || !$fecha) return self::err('Indicá docente_user_id y fecha.');

    $control_id = ((int) $req->get_param('control_id')) ?: null;
    $bloque_id = ((int) $req->get_param('bloque_id')) ?: null;

    // Si pasan bloque_id + fecha, vincular/crear control para conservar el horario.
    if (!$control_id && $bloque_id) {
      $control_id = (int) ($wpdb->get_var($wpdb->prepare(
        'SELECT id FROM ' . self::t_control() . ' WHERE bloque_id = %d AND fecha = %s',
        $bloque_id, $fecha
      )) ?: 0);
      if (!$control_id) {
        $bloque = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::t_bloques() . ' WHERE id = %d', $bloque_id), ARRAY_A);
        if ($bloque) {
          $wpdb->insert(self::t_control(), [
            'bloque_id'           => $bloque_id,
            'fecha'               => $fecha,
            'docente_previsto_id' => $bloque['docente_user_id'] ? (int) $bloque['docente_user_id'] : null,
            'docente_real_id'     => $docente,
            'estado'              => 'amonestacion',
            'fuente'              => 'manual',
            'modificado_por'      => get_current_user_id(),
          ]);
          $control_id = (int) $wpdb->insert_id ?: null;
        }
      }
    }

    $wpdb->insert(self::t_amonest(), [
      'docente_user_id' => $docente,
      'fecha'           => $fecha,
      'control_id'      => $control_id,
      'motivo'          => sanitize_textarea_field((string) $req->get_param('motivo')) ?: null,
      'origen'          => 'manual',
      'creado_por'      => get_current_user_id(),
    ]);
    if (!$wpdb->insert_id) return self::err('No se pudo guardar.', 500);
    return self::ok(['id' => (int) $wpdb->insert_id], 201);
  }

  public static function anular_amonestacion(WP_REST_Request $req) {
    global $wpdb;
    $wpdb->update(self::t_amonest(), ['activo' => 0, 'anulado_por' => get_current_user_id()], ['id' => (int) $req['id']]);
    return self::ok(['deleted' => true]);
  }

  // -------------------------------------------------------------- limpieza

  private static function sanitize_limpieza(WP_REST_Request $req): array|WP_Error {
    $tipo = in_array($req->get_param('tipo'), ['unico', 'semanal'], true) ? $req->get_param('tipo') : 'semanal';
    $hora_inicio = self::validar_hora((string) $req->get_param('hora_inicio'));
    $hora_fin    = self::validar_hora((string) $req->get_param('hora_fin'));
    if (!$hora_inicio || !$hora_fin || $hora_fin <= $hora_inicio) {
      return self::err('Horas inválidas.');
    }
    $aula_id = (int) $req->get_param('aula_id');
    if ($aula_id <= 0) return self::err('El aula es obligatoria.');

    $data = [
      'tipo'              => $tipo,
      'hora_inicio'       => $hora_inicio,
      'hora_fin'          => $hora_fin,
      'aula_id'           => $aula_id,
      'encargado_nombre'  => sanitize_text_field((string) $req->get_param('encargado_nombre')) ?: null,
      'encargado_user_id' => ((int) $req->get_param('encargado_user_id')) ?: null,
      'observacion'       => sanitize_textarea_field((string) $req->get_param('observacion')) ?: null,
    ];
    if (!$data['encargado_nombre'] && !$data['encargado_user_id']) {
      return self::err('Indicá el encargado (nombre o usuario).');
    }

    if ($tipo === 'unico') {
      $fecha = self::validar_fecha((string) $req->get_param('fecha'));
      if (!$fecha) return self::err('Indicá la fecha.');
      $data['fecha'] = $fecha;
      $data['dia_semana'] = null;
      $data['vigencia_desde'] = null;
      $data['vigencia_hasta'] = null;
    } else {
      $desde = self::validar_fecha((string) $req->get_param('vigencia_desde'));
      $hasta = self::validar_fecha((string) $req->get_param('vigencia_hasta'));
      if (!$desde || !$hasta || $hasta < $desde) return self::err('Indicá vigencia_desde y vigencia_hasta.');
      $data['fecha'] = null;
      $data['vigencia_desde'] = $desde;
      $data['vigencia_hasta'] = $hasta;
    }
    return $data;
  }

  public static function expandir_limpieza(string $desde, string $hasta, ?int $aula_id = null): array {
    global $wpdb;
    $t = self::t_limpieza();
    $where = 'activo = 1';
    $params = [];
    if ($aula_id) { $where .= ' AND aula_id = %d'; $params[] = $aula_id; }
    $sql = "SELECT * FROM $t WHERE $where";
    $rows = $params ? $wpdb->get_results($wpdb->prepare($sql, ...$params), ARRAY_A) : $wpdb->get_results($sql, ARRAY_A);

    $out = [];
    foreach ($rows ?: [] as $b) {
      if ($b['tipo'] === 'unico') {
        if ($b['fecha'] >= $desde && $b['fecha'] <= $hasta) {
          $b['fecha_ocurrencia'] = $b['fecha'];
          $out[] = $b;
        }
        continue;
      }
      $vd = max($desde, (string) $b['vigencia_desde']);
      $vh = min($hasta, (string) $b['vigencia_hasta']);
      if ($vd > $vh) continue;
      $cursor = new DateTime($vd);
      $tope = new DateTime($vh);
      while ($cursor <= $tope) {
        if ((int) $cursor->format('N') === (int) $b['dia_semana']) {
          $row = $b;
          $row['fecha_ocurrencia'] = $cursor->format('Y-m-d');
          $out[] = $row;
          $cursor->modify('+7 days');
        } else {
          $cursor->modify('+1 day');
        }
      }
    }
    usort($out, fn($a, $z) => [$a['fecha_ocurrencia'], $a['hora_inicio'], $a['aula_id']] <=> [$z['fecha_ocurrencia'], $z['hora_inicio'], $z['aula_id']]);
    return $out;
  }

  public static function list_limpieza(WP_REST_Request $req) {
    $desde = self::validar_fecha((string) $req->get_param('desde'));
    $hasta = self::validar_fecha((string) $req->get_param('hasta'));
    if (!$desde || !$hasta || $hasta < $desde) return self::err('Indicá desde y hasta.');
    $aula_id = ((int) $req->get_param('aula_id')) ?: null;
    $items = self::expandir_limpieza($desde, $hasta, $aula_id);

    $aulas = [];
    foreach (NH_OPM::get_aulas() as $a) $aulas[(int) $a['id']] = $a['nombre'];
    foreach ($items as &$it) {
      $it['aula_nombre'] = $aulas[(int) $it['aula_id']] ?? null;
      if (!empty($it['encargado_user_id'])) {
        $u = get_userdata((int) $it['encargado_user_id']);
        if ($u) $it['encargado_display'] = $u->display_name;
      }
      if (empty($it['encargado_display'])) $it['encargado_display'] = $it['encargado_nombre'] ?? null;
    }
    unset($it);
    return self::ok(['items' => $items]);
  }

  public static function create_limpieza(WP_REST_Request $req) {
    global $wpdb;
    $data = self::sanitize_limpieza($req);
    if (is_wp_error($data)) return $data;
    $data['creado_por'] = get_current_user_id();
    $ids = [];

    if ($data['tipo'] === 'unico') {
      $wpdb->insert(self::t_limpieza(), $data);
      if (!$wpdb->insert_id) return self::err('No se pudo guardar.', 500);
      $ids[] = (int) $wpdb->insert_id;
    } else {
      $json = $req->get_json_params();
      $dias = $req->get_param('dias_semana');
      if (!is_array($dias) && is_array($json) && isset($json['dias_semana'])) $dias = $json['dias_semana'];
      $dias = is_array($dias) ? array_values(array_unique(array_map('intval', $dias))) : [];
      $dias = array_values(array_filter($dias, fn($d) => $d >= 1 && $d <= 7));
      if (!$dias) return self::err('Indicá al menos un día de la semana.');
      foreach ($dias as $dia) {
        $row = $data;
        $row['dia_semana'] = $dia;
        if ($wpdb->insert(self::t_limpieza(), $row)) $ids[] = (int) $wpdb->insert_id;
      }
      if (!$ids) return self::err('No se pudo guardar.', 500);
    }
    return self::ok(['ids' => $ids], 201);
  }

  public static function update_limpieza(WP_REST_Request $req) {
    global $wpdb;
    $id = (int) $req['id'];
    $existe = $wpdb->get_var($wpdb->prepare('SELECT id FROM ' . self::t_limpieza() . ' WHERE id = %d AND activo = 1', $id));
    if (!$existe) return self::err('Turno no encontrado.', 404);
    $data = self::sanitize_limpieza($req);
    if (is_wp_error($data)) return $data;
    if ($data['tipo'] === 'semanal') {
      $dia = (int) $req->get_param('dia_semana');
      if ($dia < 1 || $dia > 7) return self::err('Indicá el día de la semana.');
      $data['dia_semana'] = $dia;
    }
    $data['modificado_por'] = get_current_user_id();
    $wpdb->update(self::t_limpieza(), $data, ['id' => $id]);
    return self::ok(['updated' => true]);
  }

  public static function delete_limpieza(WP_REST_Request $req) {
    global $wpdb;
    $wpdb->update(self::t_limpieza(), ['activo' => 0, 'modificado_por' => get_current_user_id()], ['id' => (int) $req['id']]);
    return self::ok(['deleted' => true]);
  }

  // ------------------------------------------------------------------- config

  public static function update_config(WP_REST_Request $req) {
    $map = [
      'tolerancia_min'      => 'nh_tolerancia_min',
      'amonestacion_min'    => 'nh_amonestacion_min',
      'max_tolerancias'     => 'nh_max_tolerancias',
      'ventana_llegada_min' => 'nh_ventana_llegada_min',
    ];
    foreach ($map as $param => $option) {
      $v = $req->get_param($param);
      if ($v !== null && is_numeric($v) && (int) $v >= 0) update_option($option, (int) $v);
    }
    $periodo = (string) $req->get_param('periodo_tolerancias');
    if (in_array($periodo, ['mes', 'semana', 'total'], true)) {
      update_option('nh_periodo_tolerancias', $periodo);
    }
    return self::ok(NH_DB::get_config());
  }
}
