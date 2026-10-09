<?php
if (!defined('ABSPATH')) exit;

use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\Shared\Date as ExcelDate;
use PhpOffice\PhpSpreadsheet\RichText\RichText;

/**
 * Importación de Excel:
 *  1) Registro mensual de asistencias (FECHA, DOCENTE PREVISTO/PRESENTE, horario, aula, grupo,
 *     entrada/salida, observaciones) → bloques del mes + Control.
 *  2) Grilla exportada desde Horarios (una hoja por aula).
 *  3) Cartel de horario (MEDICINA — GRUPO L, días en columnas, "Prof. …" + horario).
 *     El Excel se previsualiza; la confirmación entra por confirmar_cartel().
 *     Las fotos del mismo cartel se leen en el navegador y confirman por el mismo endpoint.
 */
class NH_Import {

  private const DIAS = [
    'LUNES' => 1, 'MARTES' => 2, 'MIÉRCOLES' => 3, 'MIERCOLES' => 3,
    'JUEVES' => 4, 'VIERNES' => 5, 'SÁBADO' => 6, 'SABADO' => 6, 'DOMINGO' => 7,
  ];

  private const DIAS_ABREV = [
    'lun' => 1, 'lunes' => 1,
    'mar' => 2, 'martes' => 2,
    'mie' => 3, 'mié' => 3, 'miercoles' => 3, 'miércoles' => 3,
    'jue' => 4, 'jueves' => 4,
    'vie' => 5, 'vier' => 5, 'viernes' => 5,
    'sab' => 6, 'sáb' => 6, 'sabado' => 6, 'sábado' => 6,
    'dom' => 7, 'domingo' => 7,
  ];

  private const MESES = [
    'enero' => 1, 'febrero' => 2, 'marzo' => 3, 'abril' => 4,
    'mayo' => 5, 'junio' => 6, 'julio' => 7, 'agosto' => 8,
    'septiembre' => 9, 'setiembre' => 9, 'octubre' => 10,
    'noviembre' => 11, 'diciembre' => 12,
  ];

  /** Letra de la planilla → nombre griego del grupo OPM. */
  private const LETRA_GRUPO = [
    'a' => 'alpha', 'alfa' => 'alpha', 'alpha' => 'alpha',
    'b' => 'beta', 'beta' => 'beta',
    'g' => 'gamma', 'gamma' => 'gamma',
    'd' => 'delta', 'delta' => 'delta',
    'e' => 'epsilon', 'epsilon' => 'epsilon',
    'z' => 'zeta', 'zeta' => 'zeta',
    'h' => 'eta', 'eta' => 'eta',
    't' => 'theta', 'theta' => 'theta',
    'i' => 'iota', 'iota' => 'iota',
    'k' => 'kappa', 'kappa' => 'kappa',
    'l' => 'lambda', 'lambda' => 'lambda',
    'm' => 'mu', 'mu' => 'mu',
    'n' => 'nu', 'nu' => 'nu',
    'x' => 'xi', 'xi' => 'xi',
    'o' => 'omicron', 'omicron' => 'omicron',
    'p' => 'pi', 'pi' => 'pi',
    'r' => 'rho', 'rho' => 'rho',
    's' => 'sigma', 'sigma' => 'sigma',
    'y' => 'upsilon', 'upsilon' => 'upsilon',
    'f' => 'phi', 'phi' => 'phi',
    'c' => 'chi', 'chi' => 'chi', 'cna' => 'cna',
    'q' => 'psi', 'psi' => 'psi',
    'w' => 'omega', 'omega' => 'omega',
  ];

  private static function cargar_phpspreadsheet(): bool {
    if (class_exists(IOFactory::class)) return true;
    $candidatos = [NH_PATH . 'vendor/autoload.php'];
    if (defined('WP_PLUGIN_DIR')) {
      foreach (glob(WP_PLUGIN_DIR . '/*/vendor/autoload.php') ?: [] as $auto) {
        $candidatos[] = $auto;
      }
    }
    foreach ($candidatos as $auto) {
      if (!file_exists($auto)) continue;
      require_once $auto;
      if (class_exists(IOFactory::class)) return true;
    }
    return class_exists(IOFactory::class);
  }

  /**
   * POST /horarios/v1/import — multipart:
   *   file, vigencia_desde, vigencia_hasta (grilla exportada),
   *   importar_control (registro de asistencias, default 1).
   */
  public static function handle(WP_REST_Request $req) {
    if (!self::cargar_phpspreadsheet()) {
      return new WP_Error('nh_error', 'PhpSpreadsheet no está disponible.', ['status' => 500]);
    }

    $files = $req->get_file_params();
    $file = $files['file'] ?? null;
    if (!$file || empty($file['tmp_name']) || !is_uploaded_file($file['tmp_name'])) {
      return new WP_Error('nh_error', 'Subí un archivo Excel (.xlsx).', ['status' => 400]);
    }
    $ext = strtolower(pathinfo((string) ($file['name'] ?? ''), PATHINFO_EXTENSION));
    if ($ext && $ext !== 'xlsx' && $ext !== 'xls') {
      return new WP_Error('nh_error', 'El archivo debe ser .xlsx o .xls.', ['status' => 400]);
    }

    try {
      $spreadsheet = IOFactory::load($file['tmp_name']);
    } catch (Throwable $e) {
      return new WP_Error('nh_error', 'No se pudo leer el Excel: ' . $e->getMessage(), ['status' => 400]);
    }

    foreach ($spreadsheet->getAllSheets() as $sheet) {
      if (self::es_hoja_cartel($sheet)) {
        return self::preview_cartel($spreadsheet);
      }
    }

    foreach ($spreadsheet->getAllSheets() as $sheet) {
      if (self::es_hoja_asistencia($sheet)) {
        return self::handle_asistencia($req, $spreadsheet, (string) ($file['name'] ?? ''));
      }
    }

    return self::handle_grilla($req, $spreadsheet);
  }

  /**
   * POST /horarios/v1/import/cartel — JSON con los bloques ya revisados en pantalla.
   */
  public static function confirmar_cartel(WP_REST_Request $req) {
    $json = $req->get_json_params();
    if (!is_array($json)) $json = [];
    $desde = self::fecha_ymd((string) ($json['vigencia_desde'] ?? $req->get_param('vigencia_desde')));
    $hasta = self::fecha_ymd((string) ($json['vigencia_hasta'] ?? $req->get_param('vigencia_hasta')));
    if (!$desde || !$hasta || $hasta < $desde) {
      return new WP_Error('nh_error', 'Indicá vigencia desde y hasta válidas.', ['status' => 400]);
    }
    $bloques = $json['bloques'] ?? $req->get_param('bloques');
    if (!is_array($bloques) || !$bloques) {
      return new WP_Error('nh_error', 'No hay bloques para crear.', ['status' => 400]);
    }
    if (count($bloques) > 500) {
      return new WP_Error('nh_error', 'Demasiados bloques en una sola importación.', ['status' => 400]);
    }

    global $wpdb;
    $t = $wpdb->prefix . 'horarios_bloques';
    $uid = get_current_user_id();
    $creados = 0;
    $reusados = 0;
    $omitidos = 0;
    $avisos = [];

    $wpdb->query('START TRANSACTION');
    try {
      foreach ($bloques as $i => $b) {
        if (!is_array($b)) { $omitidos++; continue; }
        $row = self::fila_cartel($b, $desde, $hasta, $uid, $avisos, $i);
        if (!$row) { $omitidos++; continue; }
        self::buscar_o_crear_bloque($t, $row, $creados, $reusados);
      }
      $wpdb->query('COMMIT');
    } catch (Throwable $e) {
      $wpdb->query('ROLLBACK');
      return new WP_Error('nh_error', 'Error al crear el horario: ' . $e->getMessage(), ['status' => 500]);
    }

    return new WP_REST_Response([
      'formato'  => 'cartel',
      'creados'  => $creados,
      'reusados' => $reusados,
      'omitidos' => $omitidos,
      'avisos'   => array_values(array_unique($avisos)),
      'desde'    => $desde,
      'hasta'    => $hasta,
    ], 200);
  }

  // ------------------------------------------------ registro mensual de asistencias

  private static function es_hoja_asistencia($sheet): bool {
    $titulo = self::norm((string) $sheet->getTitle());
    $a1 = self::norm(self::celda_texto($sheet, 'A1'));
    if (str_contains($a1, 'registro mensual') || str_contains($a1, 'asistencias')) return true;
    if (str_contains($titulo, 'asistencia')) return true;

    $headers = [];
    for ($c = 1; $c <= 12; $c++) {
      $headers[] = self::norm(self::celda_texto($sheet, Coordinate::stringFromColumnIndex($c) . '2'));
    }
    $join = implode(' ', $headers);
    return str_contains($join, 'docente previsto')
      && (str_contains($join, 'horario establecido') || str_contains($join, 'entrada'));
  }

  private static function handle_asistencia(WP_REST_Request $req, $spreadsheet, string $archivo = '') {
    $importar_control = !in_array(strtolower((string) $req->get_param('importar_control')), ['0', 'false', 'no'], true);

    $ctx = self::catalogos_import();
    $avisos = [];
    $filas = [];

    foreach ($spreadsheet->getAllSheets() as $sheet) {
      if (!self::es_hoja_asistencia($sheet)) continue;
      $periodo = self::periodo_de_hoja($sheet, $archivo);
      if (empty($periodo['mes_ok'])) {
        $avisos[] = 'La hoja “' . $sheet->getTitle() . '” no indica el mes. Renombrá la pestaña (por ejemplo “Septiembre 2026”) o incluí el mes en el nombre del archivo.';
        continue;
      }
      $cols = self::mapear_columnas_asistencia($sheet);
      if (empty($cols['fecha']) || empty($cols['horario'])) {
        $avisos[] = 'La hoja “' . $sheet->getTitle() . '” no tiene columnas FECHA / HORARIO ESTABLECIDO.';
        continue;
      }
      $maxRow = (int) $sheet->getHighestRow();
      $fecha_arrastre = null;
      for ($r = 3; $r <= $maxRow; $r++) {
        $raw = [];
        foreach ($cols as $k => $cidx) {
          $raw[$k] = $cidx ? self::celda_valor($sheet, Coordinate::stringFromColumnIndex($cidx) . $r) : null;
        }
        $vacia = true;
        foreach (['fecha', 'previsto', 'presente', 'horario', 'aula', 'grupo'] as $k) {
          if (self::texto($raw[$k] ?? null) !== '') { $vacia = false; break; }
        }
        if ($vacia) continue;

        $fecha = self::parse_fecha_asistencia($raw['fecha'] ?? null, $periodo['anio'], $periodo['mes']);
        if ($fecha) $fecha_arrastre = $fecha;
        elseif ($fecha_arrastre) $fecha = $fecha_arrastre;
        if (!$fecha) {
          $avisos[] = "Fila $r: no se pudo leer la fecha.";
          continue;
        }

        $horario = self::parse_horario_establecido($raw['horario'] ?? null);
        if (!$horario) {
          $avisos[] = "Fila $r ({$fecha}): horario establecido inválido.";
          continue;
        }

        $filas[] = [
          'fecha'       => $fecha,
          'dia_semana'  => (int) (new DateTime($fecha))->format('N'),
          'hora_inicio' => $horario['hora_inicio'],
          'hora_fin'    => $horario['hora_fin'],
          'previsto'    => self::texto($raw['previsto'] ?? null),
          'presente'    => self::texto($raw['presente'] ?? null),
          'aula'        => self::texto($raw['aula'] ?? null),
          'grupo'       => self::texto($raw['grupo'] ?? null),
          'entrada'     => self::parse_hora_celda($raw['entrada'] ?? null),
          'salida'      => self::parse_hora_celda($raw['salida'] ?? null),
          'observacion' => self::texto($raw['observacion'] ?? null),
          'fila'        => $r,
          'hoja'        => (string) $sheet->getTitle(),
        ];
      }
    }

    if (!$filas) {
      $msg = 'No se encontraron clases en el registro de asistencias.';
      if ($avisos) $msg .= ' ' . implode(' ', array_slice(array_values(array_unique($avisos)), 0, 3));
      return new WP_Error('nh_error', $msg, ['status' => 400]);
    }

    usort($filas, static function ($a, $b) {
      return [$a['fecha'], $a['hora_inicio'], $a['aula'], $a['grupo']]
        <=> [$b['fecha'], $b['hora_inicio'], $b['aula'], $b['grupo']];
    });

    $ctx['mapeo'] = self::parse_mapeo($req);
    $pendientes = self::nombres_pendientes_mapeo($filas, $ctx);
    if ($pendientes) {
      return new WP_REST_Response([
        'pendiente_mapeo'    => true,
        'formato'            => 'asistencia',
        'nombres_sin_match'  => $pendientes,
      ], 200);
    }

    global $wpdb;
    $t_blo = $wpdb->prefix . 'horarios_bloques';
    $t_ctl = $wpdb->prefix . 'horarios_control';
    $uid = get_current_user_id();
    $cfg = NH_DB::get_config();

    $creados = 0;
    $reusados = 0;
    $controles = 0;
    $omitidos = 0;
    $amonestaciones = 0;

    $wpdb->query('START TRANSACTION');
    try {
    foreach ($filas as $idx => $f) {
      $resuelto = self::resolver_fila($f, $ctx, $avisos);
      if (!$resuelto) {
        $omitidos++;
        continue;
      }
      $filas[$idx]['_r'] = $resuelto;
    }

    $fechas_res = [];
    foreach ($filas as $f) {
      if (!empty($f['_r'])) $fechas_res[] = $f['fecha'];
    }
    sort($fechas_res);
    $existentes = $fechas_res
      ? self::bloques_vigentes($t_blo, $fechas_res[0], $fechas_res[count($fechas_res) - 1])
      : [];

    // Primero el horario que ya está creado (aunque la vigencia sea más amplia que el mes).
    $bloque_por_fila = [];
    $ya_contados = [];
    foreach ($filas as $idx => $f) {
      if (empty($f['_r'])) continue;
      $hallado = self::elegir_bloque_existente($existentes, $f, $f['_r']);
      if (!$hallado) continue;
      $bloque_por_fila[$idx] = $hallado;
      $bid_hallado = (int) $hallado['id'];
      if (!isset($ya_contados[$bid_hallado])) {
        $ya_contados[$bid_hallado] = true;
        $reusados++;
      }
    }

    $grupos_bloques = [];
    foreach ($filas as $idx => $f) {
      if (empty($f['_r']) || !empty($bloque_por_fila[$idx])) continue;
      $k = $f['_r']['clave_semanal'];
      if (!isset($grupos_bloques[$k])) $grupos_bloques[$k] = [];
      $grupos_bloques[$k][] = $idx;
    }

    foreach ($grupos_bloques as $idxs) {
      $fechas = [];
      foreach ($idxs as $idx) $fechas[$filas[$idx]['fecha']] = true;
      $fechas_ord = array_keys($fechas);
      sort($fechas_ord);
      $plantilla = $filas[$idxs[0]]['_r'];

      if (count($fechas_ord) >= 2 && self::serie_semanal_completa($fechas_ord)) {
          $bid = self::buscar_o_crear_bloque($t_blo, [
            'tipo'            => 'semanal',
            'naturaleza'      => $plantilla['naturaleza'],
            'dia_semana'      => $filas[$idxs[0]]['dia_semana'],
            'vigencia_desde'  => $fechas_ord[0],
            'vigencia_hasta'  => $fechas_ord[count($fechas_ord) - 1],
            'hora_inicio'     => $filas[$idxs[0]]['hora_inicio'],
            'hora_fin'        => $filas[$idxs[0]]['hora_fin'],
            'aula_id'         => $plantilla['aula_id'],
            'aula_fisica_id'  => $plantilla['aula_fisica_id'],
            'materia_id'      => null,
            'docente_user_id' => $plantilla['docente_previsto_id'],
            'docente_nombre'  => $plantilla['docente_previsto_nombre'],
            'curso_id'        => $plantilla['curso_id'],
            'titulo'          => $plantilla['titulo'],
            'color'           => $plantilla['color'],
            'creado_por'      => $uid,
          ], $creados, $reusados);
        $nuevo = [
          'id'               => $bid,
          'docente_user_id'  => $plantilla['docente_previsto_id'],
          'hora_inicio'      => $filas[$idxs[0]]['hora_inicio'],
          'hora_fin'         => $filas[$idxs[0]]['hora_fin'],
        ];
        foreach ($idxs as $idx) $bloque_por_fila[$idx] = $nuevo;
      } else {
        foreach ($idxs as $idx) {
          $f = $filas[$idx];
          $r = $f['_r'];
          $bid = self::buscar_o_crear_bloque($t_blo, [
            'tipo'            => 'unico',
            'naturaleza'      => $r['naturaleza'],
            'fecha'           => $f['fecha'],
            'hora_inicio'     => $f['hora_inicio'],
            'hora_fin'        => $f['hora_fin'],
            'aula_id'         => $r['aula_id'],
            'aula_fisica_id'  => $r['aula_fisica_id'],
            'materia_id'      => null,
            'docente_user_id' => $r['docente_previsto_id'],
            'docente_nombre'  => $r['docente_previsto_nombre'],
            'curso_id'        => $r['curso_id'],
            'titulo'          => $r['titulo'],
            'color'           => $r['color'],
            'creado_por'      => $uid,
          ], $creados, $reusados);
          $bloque_por_fila[$idx] = [
            'id'              => $bid,
            'docente_user_id' => $r['docente_previsto_id'],
            'hora_inicio'     => $f['hora_inicio'],
            'hora_fin'        => $f['hora_fin'],
          ];
        }
      }
    }

    if ($importar_control) {
      $vistos_ctl = [];
      foreach ($filas as $idx => $f) {
        if (empty($f['_r']) || empty($bloque_por_fila[$idx]['id'])) continue;
        $r = $f['_r'];
        $bloque = $bloque_por_fila[$idx];
        $bid = (int) $bloque['id'];
        if ($bid <= 0) continue;
        $ck = $bid . '|' . $f['fecha'];
        if (isset($vistos_ctl[$ck])) { $omitidos++; continue; }
        $vistos_ctl[$ck] = true;

        $estado_pack = self::estado_control($f, $r, $cfg);
        $previsto_id = !empty($bloque['docente_user_id'])
          ? (int) $bloque['docente_user_id']
          : ($r['docente_previsto_id'] ?: null);
        $row_ctl = [
          'bloque_id'           => $bid,
          'fecha'               => $f['fecha'],
          'docente_previsto_id' => $previsto_id,
          'docente_real_id'     => $r['docente_real_id'],
          'docente_real_nombre' => $r['docente_real_nombre'],
          'aula_real_id'        => $r['aula_id'],
          'estado'              => $estado_pack['estado'],
          'hora_llegada'        => $f['entrada'],
          'hora_salida'         => $f['salida'],
          'minutos_retraso'     => $estado_pack['retraso'],
          'fuente'              => 'manual',
          'coincide_previsto'   => 0,
          'observacion'         => $f['observacion'] !== '' ? $f['observacion'] : null,
          'modificado_por'      => $uid,
        ];

        $existente = $wpdb->get_row($wpdb->prepare(
          "SELECT id, asistencia_opm_id, hora_lista_opm FROM $t_ctl WHERE bloque_id = %d AND fecha = %s",
          $bid, $f['fecha']
        ), ARRAY_A);
        if ($existente && (!empty($existente['asistencia_opm_id']) || !empty($existente['hora_lista_opm']))) {
          $row_ctl['coincide_previsto'] = 1;
        }
        if ($existente) {
          $wpdb->update($t_ctl, $row_ctl, ['id' => (int) $existente['id']]);
          $control_id = (int) $existente['id'];
        } else {
          $wpdb->insert($t_ctl, $row_ctl);
          $control_id = (int) $wpdb->insert_id;
        }
        if ($control_id) $controles++;

        if ($estado_pack['estado'] === 'amonestacion' && !empty($r['docente_real_id']) && $control_id) {
          if (self::crear_amonestacion_auto((int) $r['docente_real_id'], $f['fecha'], $control_id, (int) ($estado_pack['retraso'] ?? 0))) {
            $amonestaciones++;
          }
        }
      }
    }

    $wpdb->query('COMMIT');
    } catch (Throwable $e) {
      $wpdb->query('ROLLBACK');
      return new WP_Error('nh_error', 'Error al importar: ' . $e->getMessage(), ['status' => 500]);
    }

    $fechas_imp = array_column($filas, 'fecha');
    sort($fechas_imp);

    return new WP_REST_Response([
      'formato'         => 'asistencia',
      'creados'         => $creados,
      'reusados'        => $reusados,
      'controles'       => $controles,
      'omitidos'        => $omitidos,
      'amonestaciones'  => $amonestaciones,
      'avisos'          => array_values(array_unique($avisos)),
      'desde'           => $fechas_imp ? $fechas_imp[0] : null,
      'hasta'           => $fechas_imp ? $fechas_imp[count($fechas_imp) - 1] : null,
    ], 200);
  }

  /**
   * Mes y año del registro. La pestaña manda; si no trae mes, se mira A1 y el nombre del archivo.
   * No se usa el mes de hoy: “Septie 2026” es septiembre, no octubre.
   *
   * @return array{anio:int,mes:int,mes_ok:bool}
   */
  private static function periodo_de_hoja($sheet, string $archivo = ''): array {
    $titulo = (string) $sheet->getTitle();
    $a1 = self::celda_texto($sheet, 'A1');
    $anio = (int) current_time('Y');
    if (preg_match('/(20\d{2})/u', $titulo . ' ' . $a1 . ' ' . $archivo, $m)) {
      $anio = (int) $m[1];
    }
    $mes = null;
    foreach ([$titulo, $a1, $archivo] as $fuente) {
      $mes = self::mes_en_texto($fuente);
      if ($mes !== null) break;
    }
    return ['anio' => $anio, 'mes' => $mes ?? 0, 'mes_ok' => $mes !== null];
  }

  /** Mes nombrado completo o abreviado (“Septie”, “Sep”, “Octubr”). */
  private static function mes_en_texto(string $txt): ?int {
    $norm = self::norm(str_replace(['_', '-', '.'], ' ', $txt));
    if ($norm === '') return null;
    foreach (self::MESES as $nombre => $n) {
      if (preg_match('/\b' . preg_quote($nombre, '/') . '\b/u', $norm)) {
        return $n;
      }
    }
    if (!preg_match_all('/\b\p{L}{3,}\b/u', $norm, $tokens)) return null;
    foreach ($tokens[0] as $token) {
      $hits = [];
      foreach (self::MESES as $nombre => $n) {
        if (str_starts_with($nombre, $token)) $hits[$n] = true;
      }
      if (count($hits) === 1) return (int) array_key_first($hits);
    }
    return null;
  }

  /** @return array<string,int> */
  private static function mapear_columnas_asistencia($sheet): array {
    $alias = [
      'fecha'       => ['fecha'],
      'previsto'    => ['docente previsto', 'previsto', 'profesor previsto'],
      'presente'    => ['docente presente', 'presente', 'profesor presente', 'docente que dicto', 'docente que dictó'],
      'horario'     => ['horario establecido', 'horario', 'hora estipulada'],
      'aula'        => ['aula', 'aula fisica', 'aula física', 'salon', 'salón'],
      'grupo'       => ['grupo'],
      'entrada'     => ['entrada', 'hora entrada', 'ingreso'],
      'salida'      => ['salida', 'hora salida', 'egreso'],
      'observacion' => ['observaciones', 'observacion', 'observación', 'obs'],
    ];
    $maxCol = Coordinate::columnIndexFromString($sheet->getHighestColumn());
    $out = ['fecha' => 0, 'previsto' => 0, 'presente' => 0, 'horario' => 0, 'aula' => 0, 'grupo' => 0, 'entrada' => 0, 'salida' => 0, 'observacion' => 0];
    for ($c = 1; $c <= min($maxCol, 16); $c++) {
      $h = self::norm(self::celda_texto($sheet, Coordinate::stringFromColumnIndex($c) . '2'));
      if ($h === '') continue;
      foreach ($alias as $key => $nombres) {
        if ($out[$key]) continue;
        foreach ($nombres as $n) {
          if ($h === $n || str_contains($h, $n)) {
            $out[$key] = $c;
            break 2;
          }
        }
      }
    }
    return $out;
  }

  /**
   * @param array $f
   * @param array $ctx
   * @param string[] $avisos
   * @return array|null
   */
  private static function resolver_fila(array $f, array $ctx, array &$avisos): ?array {
    $obs = self::norm($f['observacion']);
    $grupo_txt = $f['grupo'];
    $aula_txt = $f['aula'];
    $previsto_txt = $f['previsto'];
    $presente_txt = $f['presente'];

    $es_examen = self::es_marcador_examen($previsto_txt);
    $es_sala_test = self::es_todos($grupo_txt) || str_contains($obs, 'sala de test') || str_contains($obs, 'sala test');
    $es_virtual = self::es_virtual($aula_txt) || self::es_virtual($grupo_txt) || str_contains($obs, 'virtual');

    $aula_fisica_nombre = $aula_txt;
    if ($aula_fisica_nombre === '' && $es_virtual) $aula_fisica_nombre = 'VIRTUAL';
    if (self::es_virtual($aula_fisica_nombre)) $aula_fisica_nombre = 'VIRTUAL';

    $aula_fisica_id = self::ensure_aula_fisica($aula_fisica_nombre, $ctx['aulas_fisicas']);
    if (!$aula_fisica_id) {
      $avisos[] = "{$f['fecha']} {$f['hora_inicio']}: aula física no encontrada (“{$aula_txt}”).";
      return null;
    }

    $aula_id = null;
    $curso_id = $ctx['curso_cea'] ?? null;
    if ($es_sala_test || self::es_todos($grupo_txt) || self::es_virtual($grupo_txt)) {
      $aula_id = null;
    } elseif ($grupo_txt !== '') {
      $g = self::resolver_grupo($grupo_txt, $ctx['grupos']);
      if (!$g) {
        $avisos[] = "{$f['fecha']}: grupo no encontrado (“{$grupo_txt}”).";
        return null;
      }
      $aula_id = $g['id'];
      if (!empty($g['curso_id'])) $curso_id = $g['curso_id'];
    }

    $naturaleza = $es_examen ? 'examen' : 'clase';
    $titulo = null;
    $color = null;
    if ($es_examen) {
      $titulo = 'EXAMEN';
      $color = '#7030a0';
    } elseif ($es_sala_test) {
      $titulo = 'Sala Test';
      $color = '#0d9488';
    }

    $previsto = ['id' => null, 'nombre' => null];
    if ($es_examen) {
      $previsto = ['id' => null, 'nombre' => 'Examen'];
    } elseif ($previsto_txt !== '' && !self::es_marcador_ausente($previsto_txt)) {
      $previsto = self::aplicar_mapeo_docente($previsto_txt, $ctx);
    }

    if (!$es_examen && !empty($previsto['id'])) {
      $color = NH_DB::color_de_docente((int) $previsto['id']) ?: $color;
    }

    $real = ['id' => null, 'nombre' => null];
    if ($presente_txt !== '' && !self::es_marcador_ausente($presente_txt) && !self::es_marcador_examen($presente_txt)) {
      $real = self::aplicar_mapeo_docente($presente_txt, $ctx);
    }

    $clave = implode('|', [
      $f['dia_semana'],
      $f['hora_inicio'],
      $f['hora_fin'],
      (int) $aula_fisica_id,
      (int) ($aula_id ?: 0),
      (int) ($previsto['id'] ?: 0),
      self::norm((string) ($previsto['nombre'] ?: $previsto_txt)),
      $naturaleza,
      $titulo ?: '',
    ]);

    return [
      'aula_id'                  => $aula_id,
      'aula_fisica_id'           => $aula_fisica_id,
      'curso_id'                 => $curso_id,
      'naturaleza'               => $naturaleza,
      'titulo'                   => $titulo,
      'color'                    => $color,
      'docente_previsto_id'      => $previsto['id'],
      'docente_previsto_nombre'  => $previsto['nombre'] ?: ($previsto_txt !== '' ? $previsto_txt : null),
      'docente_real_id'          => $real['id'],
      'docente_real_nombre'      => $real['nombre'] ?: ($presente_txt !== '' && !self::es_marcador_ausente($presente_txt) ? $presente_txt : null),
      'clave_semanal'            => $clave,
      'es_examen'                => $es_examen,
      'es_sala_test'             => $es_sala_test,
    ];
  }

  /** @return array{estado:string,retraso:?int} */
  private static function estado_control(array $f, array $r, array $cfg): array {
    $ausente = self::es_marcador_ausente($f['presente'])
      || ($f['presente'] === '' && !$f['entrada'] && !$f['salida']);

    if ($ausente && !$f['entrada']) {
      return ['estado' => 'ausente', 'retraso' => null];
    }

    if (!$f['entrada']) {
      return ['estado' => 'pendiente', 'retraso' => null];
    }

    $retraso = NH_Rest::minutos_retraso_de_llegada($f['fecha'], $f['hora_inicio'], $f['hora_fin'], $f['entrada']);
    if ($retraso === null) {
      return ['estado' => 'puntual', 'retraso' => null];
    }
    $doc = (int) ($r['docente_real_id'] ?: $r['docente_previsto_id'] ?: 0);
    $estado = $doc ? NH_Rest::calcular_estado($retraso, $doc, $f['fecha'], $cfg, 0) : 'puntual';
    if ($retraso <= (int) $cfg['tolerancia_min'] && in_array($estado, ['tolerancia', 'tardanza', 'amonestacion'], true)) {
      $estado = 'puntual';
    }
    return ['estado' => $estado, 'retraso' => $retraso];
  }

  private static function crear_amonestacion_auto(int $docente_id, string $fecha, int $control_id, int $retraso): bool {
    global $wpdb;
    $t = $wpdb->prefix . 'horarios_amonestaciones';
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

  private static function buscar_o_crear_bloque(string $t, array $row, int &$creados, int &$reusados): int {
    global $wpdb;
    $id = self::buscar_bloque_existente($t, $row);
    if ($id) {
      $reusados++;
      return $id;
    }
    $wpdb->insert($t, $row);
    $id = (int) $wpdb->insert_id;
    if ($id) $creados++;
    return $id;
  }

  private static function buscar_bloque_existente(string $t, array $row): int {
    global $wpdb;
    $sql = "SELECT id FROM $t WHERE activo = 1 AND tipo = %s AND naturaleza = %s
            AND hora_inicio = %s AND hora_fin = %s AND aula_fisica_id = %d";
    $params = [$row['tipo'], $row['naturaleza'], $row['hora_inicio'], $row['hora_fin'], (int) $row['aula_fisica_id']];

    if (!empty($row['aula_id'])) {
      $sql .= ' AND aula_id = %d';
      $params[] = (int) $row['aula_id'];
    } else {
      $sql .= ' AND aula_id IS NULL';
    }
    if (!empty($row['docente_user_id'])) {
      $sql .= ' AND docente_user_id = %d';
      $params[] = (int) $row['docente_user_id'];
    } else {
      $sql .= ' AND docente_user_id IS NULL';
    }
    $doc_nom = trim((string) ($row['docente_nombre'] ?? ''));
    if ($doc_nom !== '') {
      $sql .= ' AND docente_nombre = %s';
      $params[] = $doc_nom;
    } else {
      $sql .= ' AND (docente_nombre IS NULL OR docente_nombre = \'\')';
    }
    if (!empty($row['titulo'])) {
      $sql .= ' AND titulo = %s';
      $params[] = $row['titulo'];
    } else {
      $sql .= ' AND (titulo IS NULL OR titulo = \'\')';
    }

    if ($row['tipo'] === 'unico') {
      $sql .= ' AND fecha = %s';
      $params[] = $row['fecha'];
    } else {
      $sql .= ' AND dia_semana = %d AND vigencia_desde = %s AND vigencia_hasta = %s';
      $params[] = (int) $row['dia_semana'];
      $params[] = $row['vigencia_desde'];
      $params[] = $row['vigencia_hasta'];
    }
    $sql .= ' LIMIT 1';
    return (int) $wpdb->get_var($wpdb->prepare($sql, ...$params));
  }

  /**
   * Horarios activos que pueden caer en el rango del reporte.
   * @return array<int,array<string,mixed>>
   */
  private static function bloques_vigentes(string $t, string $desde, string $hasta): array {
    global $wpdb;
    $rows = $wpdb->get_results($wpdb->prepare(
      "SELECT id, tipo, fecha, dia_semana, vigencia_desde, vigencia_hasta,
              hora_inicio, hora_fin, aula_id, aula_fisica_id, docente_user_id, fechas_excluidas
       FROM $t
       WHERE activo = 1
         AND (
           (tipo = 'unico' AND fecha BETWEEN %s AND %s)
           OR (tipo = 'semanal' AND vigencia_desde <= %s AND vigencia_hasta >= %s)
         )",
      $desde, $hasta, $hasta, $desde
    ), ARRAY_A);
    if (!$rows) return [];
    foreach ($rows as &$b) {
      $b['id'] = (int) $b['id'];
      $b['dia_semana'] = (int) ($b['dia_semana'] ?? 0);
      $b['aula_id'] = $b['aula_id'] !== null && $b['aula_id'] !== '' ? (int) $b['aula_id'] : null;
      $b['aula_fisica_id'] = $b['aula_fisica_id'] !== null && $b['aula_fisica_id'] !== '' ? (int) $b['aula_fisica_id'] : null;
      $b['docente_user_id'] = $b['docente_user_id'] !== null && $b['docente_user_id'] !== '' ? (int) $b['docente_user_id'] : null;
      $b['hora_inicio'] = self::normalizar_hora($b['hora_inicio']);
      $b['hora_fin'] = self::normalizar_hora($b['hora_fin']);
      $excl = json_decode((string) ($b['fechas_excluidas'] ?? ''), true);
      $set = [];
      if (is_array($excl)) {
        foreach ($excl as $f) {
          $f = substr((string) $f, 0, 10);
          if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $f)) $set[$f] = true;
        }
      }
      $b['_excl'] = $set;
    }
    unset($b);
    return $rows;
  }

  /**
   * El horario ya creado para esa fecha, hora y grupo.
   * Si no hay grupo, alcanza con una sola clase en esa aula a esa hora.
   * @return array<string,mixed>|null
   */
  private static function elegir_bloque_existente(array $bloques, array $f, array $r): ?array {
    $fecha = (string) $f['fecha'];
    $dia = (int) $f['dia_semana'];
    $ini = self::normalizar_hora($f['hora_inicio']);
    $fin = self::normalizar_hora($f['hora_fin']);
    $aula_id = !empty($r['aula_id']) ? (int) $r['aula_id'] : null;
    $fisica = !empty($r['aula_fisica_id']) ? (int) $r['aula_fisica_id'] : null;
    $doc = !empty($r['docente_previsto_id']) ? (int) $r['docente_previsto_id'] : null;

    $cands = [];
    foreach ($bloques as $b) {
      if ($b['hora_inicio'] !== $ini || $b['hora_fin'] !== $fin) continue;
      if (!self::bloque_cubre_fecha($b, $fecha, $dia)) continue;
      $cands[] = $b;
    }
    if (!$cands) return null;

    $por_grupo = [];
    foreach ($cands as $b) {
      $ba = $b['aula_id'] ?: null;
      if ($ba === $aula_id) $por_grupo[] = $b;
    }
    $pool = $por_grupo;
    if (!$pool && $fisica) {
      $por_sala = [];
      foreach ($cands as $b) {
        if ((int) ($b['aula_fisica_id'] ?? 0) === $fisica) $por_sala[] = $b;
      }
      if (count($por_sala) === 1) $pool = $por_sala;
    }
    if (!$pool) return null;

    usort($pool, static function ($a, $b) use ($fisica, $doc) {
      $sa = self::puntaje_bloque_import($a, $fisica, $doc);
      $sb = self::puntaje_bloque_import($b, $fisica, $doc);
      if ($sa !== $sb) return $sb <=> $sa;
      return $a['id'] <=> $b['id'];
    });
    return $pool[0];
  }

  private static function puntaje_bloque_import(array $b, ?int $fisica, ?int $doc): int {
    $s = 0;
    if ($fisica && (int) ($b['aula_fisica_id'] ?? 0) === $fisica) $s += 4;
    if ($doc && (int) ($b['docente_user_id'] ?? 0) === $doc) $s += 2;
    if (($b['tipo'] ?? '') === 'semanal') {
      $vd = substr((string) ($b['vigencia_desde'] ?? ''), 0, 10);
      $vh = substr((string) ($b['vigencia_hasta'] ?? ''), 0, 10);
      if ($vd !== '' && $vh !== '' && (strtotime($vh) - strtotime($vd)) > 45 * 86400) $s += 1;
    }
    return $s;
  }

  private static function bloque_cubre_fecha(array $b, string $fecha, int $dia): bool {
    if (!empty($b['_excl'][$fecha])) return false;
    if (($b['tipo'] ?? '') === 'unico') {
      return substr((string) ($b['fecha'] ?? ''), 0, 10) === $fecha;
    }
    if ((int) ($b['dia_semana'] ?? 0) !== $dia) return false;
    $vd = substr((string) ($b['vigencia_desde'] ?? ''), 0, 10);
    $vh = substr((string) ($b['vigencia_hasta'] ?? ''), 0, 10);
    return $vd !== '' && $vh !== '' && $fecha >= $vd && $fecha <= $vh;
  }

  private static function normalizar_hora($h): string {
    $s = trim((string) $h);
    if (preg_match('/^(\d{1,2}):(\d{2})(?::(\d{2}))?/', $s, $m)) {
      return sprintf('%02d:%02d:%02d', (int) $m[1], (int) $m[2], (int) ($m[3] ?? 0));
    }
    return substr($s, 0, 8);
  }

  /** True si hay una ocurrencia cada 7 días entre la primera y la última fecha. */
  private static function serie_semanal_completa(array $fechas): bool {
    $fechas = array_values(array_unique($fechas));
    sort($fechas);
    if (count($fechas) < 2) return false;
    $ini = new DateTime($fechas[0]);
    $fin = new DateTime($fechas[count($fechas) - 1]);
    $set = array_fill_keys($fechas, true);
    $cur = clone $ini;
    while ($cur <= $fin) {
      if (empty($set[$cur->format('Y-m-d')])) return false;
      $cur->modify('+7 days');
    }
    return true;
  }

  // ------------------------------------------------ catálogos / matching

  private static function catalogos_import(): array {
    $grupos = [];
    foreach (NH_OPM::get_aulas() as $a) {
      $grupos[] = [
        'id'       => (int) $a['id'],
        'nombre'   => (string) $a['nombre'],
        'raw'      => (string) ($a['nombre_raw'] ?? $a['nombre']),
        'curso_id' => !empty($a['curso_id']) ? (int) $a['curso_id'] : null,
        'norm'     => self::norm(NH_OPM::nombre_grupo_visible((string) ($a['nombre_raw'] ?? $a['nombre']))),
      ];
    }

    $aulas_fisicas = [];
    foreach (NH_DB::get_aulas_fisicas() as $a) {
      $aulas_fisicas[self::norm((string) $a['nombre'])] = (int) $a['id'];
    }

    $docentes = [];
    $seen = [];
    foreach (array_merge(NH_OPM::get_docentes(), NH_OPM::get_usuarios_staff()) as $d) {
      $id = (int) $d['id'];
      if ($id <= 0 || isset($seen[$id])) continue;
      $seen[$id] = true;
      $docentes[] = [
        'id'     => $id,
        'nombre' => (string) $d['nombre'],
        'norm'   => self::norm((string) $d['nombre']),
        'toks'   => self::tokens_nombre((string) $d['nombre']),
      ];
    }

    $curso_cea = null;
    foreach (NH_OPM::get_cursos() as $c) {
      if (preg_match('/cea/i', (string) ($c['nombre'] ?? ''))) {
        $curso_cea = (int) $c['id'];
        break;
      }
    }

    return [
      'grupos'        => $grupos,
      'aulas_fisicas' => $aulas_fisicas,
      'docentes'      => $docentes,
      'curso_cea'     => $curso_cea,
    ];
  }

  private static function ensure_aula_fisica(string $nombre, array &$cache): ?int {
    $nombre = trim($nombre);
    if ($nombre === '') return null;
    if (self::es_virtual($nombre)) $nombre = 'VIRTUAL';
    $key = self::norm($nombre);
    if (isset($cache[$key])) return $cache[$key];

    global $wpdb;
    $t = NH_DB::t_aulas_fisicas();
    $row = $wpdb->get_row($wpdb->prepare(
      "SELECT id, activo FROM $t WHERE LOWER(nombre) = %s LIMIT 1",
      mb_strtolower($nombre)
    ), ARRAY_A);
    if ($row) {
      if ((int) $row['activo'] !== 1) {
        $wpdb->update($t, ['activo' => 1], ['id' => (int) $row['id']]);
      }
      $cache[$key] = (int) $row['id'];
      return $cache[$key];
    }
    $wpdb->insert($t, [
      'nombre'     => $nombre,
      'activo'     => 1,
      'creado_por' => get_current_user_id(),
    ]);
    if (!$wpdb->insert_id) return null;
    $cache[$key] = (int) $wpdb->insert_id;
    return $cache[$key];
  }

  /** @return array{id:int,curso_id:?int}|null */
  private static function resolver_grupo(string $txt, array $grupos): ?array {
    $n = self::norm($txt);
    if ($n === '') return null;
    $target = self::LETRA_GRUPO[$n] ?? $n;

    $exactos = [];
    $parciales = [];
    foreach ($grupos as $g) {
      $vis = $g['norm'];
      if ($vis === $n || $vis === $target) {
        $exactos[] = $g;
        continue;
      }
      if ($target !== '' && (str_starts_with($vis, $target) || str_contains($vis, $target))) {
        $parciales[] = $g;
      }
    }
    if (count($exactos) === 1) {
      return ['id' => $exactos[0]['id'], 'curso_id' => $exactos[0]['curso_id']];
    }
    if (count($exactos) > 1) {
      usort($exactos, static fn($a, $b) => strlen($a['norm']) <=> strlen($b['norm']));
      return ['id' => $exactos[0]['id'], 'curso_id' => $exactos[0]['curso_id']];
    }
    if (count($parciales) === 1) {
      return ['id' => $parciales[0]['id'], 'curso_id' => $parciales[0]['curso_id']];
    }
    return null;
  }

  private static function resolver_docente(string $txt, array $docentes): ?int {
    $n = self::norm($txt);
    if ($n === '' || self::es_marcador_ausente($txt) || self::es_marcador_examen($txt)) return null;
    $toks = self::tokens_nombre($txt);
    $mejor = null;
    $mejor_score = 0;
    foreach ($docentes as $d) {
      $score = 0;
      if ($d['norm'] === $n) $score = 100;
      elseif ($d['norm'] !== '' && ($n === $d['norm'] || str_contains($d['norm'], $n) || str_contains($n, $d['norm']))) {
        $score = 85;
      } else {
        $dt = $d['toks'];
        if ($toks && $dt && !array_diff($toks, $dt)) $score = 80;
        elseif ($toks && $dt && isset($toks[0], $dt[0]) && $toks[0] === $dt[0]) {
          $ql = $toks[count($toks) - 1];
          $cl = $dt[count($dt) - 1];
          if ($ql === $cl) $score = 75;
          elseif (strlen($ql) === 1 && str_starts_with($cl, $ql)) $score = 72;
          elseif (strlen($cl) === 1 && str_starts_with($ql, $cl)) $score = 72;
        }
      }
      if ($score > $mejor_score) {
        $mejor_score = $score;
        $mejor = $d['id'];
      }
    }
    return $mejor_score >= 100 ? $mejor : null;
  }

  /**
   * Coincidencia laxa solo para sugerir en el mapeo (no se aplica sola).
   * @return array{id:int,nombre:string}|null
   */
  private static function sugerir_docente(string $txt, array $docentes): ?array {
    $n = self::norm($txt);
    if ($n === '') return null;
    $toks = self::tokens_nombre($txt);
    $mejor = null;
    $mejor_score = 0;
    foreach ($docentes as $d) {
      $score = 0;
      if ($d['norm'] === $n) $score = 100;
      elseif ($d['norm'] !== '' && (str_contains($d['norm'], $n) || str_contains($n, $d['norm']))) $score = 80;
      else {
        $dt = $d['toks'];
        if ($toks && $dt && !array_diff($toks, $dt)) $score = 75;
        $ql = $toks ? $toks[count($toks) - 1] : '';
        if ($ql !== '' && strlen($ql) >= 4 && in_array($ql, $dt, true)) $score = max($score, 65);
        if ($toks && $dt && isset($toks[0], $dt[0])) {
          $a = $toks[0]; $b = $dt[0];
          if ($a === $b) $score = max($score, 60);
          elseif (strlen($a) >= 3 && (str_starts_with($b, $a) || str_starts_with($a, $b))) $score = max($score, 58);
        }
      }
      if ($score > $mejor_score) {
        $mejor_score = $score;
        $mejor = $d;
      }
    }
    if ($mejor_score < 58 || !$mejor) return null;
    return ['id' => (int) $mejor['id'], 'nombre' => (string) $mejor['nombre']];
  }

  /** @return array{id:?int,nombre:?string} */
  private static function aplicar_mapeo_docente(string $txt, array $ctx): array {
    $n = self::norm($txt);
    if ($n === '') return ['id' => null, 'nombre' => null];
    $map = $ctx['mapeo'][$n] ?? null;
    if (is_array($map)) {
      $uid = (int) ($map['user_id'] ?? 0);
      $nom = trim((string) ($map['nombre'] ?? $txt)) ?: $txt;
      if ($uid > 0) {
        foreach ($ctx['docentes'] as $d) {
          if ((int) $d['id'] === $uid) {
            $nom = (string) $d['nombre'];
            break;
          }
        }
        return ['id' => $uid, 'nombre' => $nom];
      }
      return ['id' => null, 'nombre' => $nom];
    }
    $id = self::resolver_docente($txt, $ctx['docentes']);
    if ($id) {
      $nom = $txt;
      foreach ($ctx['docentes'] as $d) {
        if ((int) $d['id'] === $id) { $nom = (string) $d['nombre']; break; }
      }
      return ['id' => $id, 'nombre' => $nom];
    }
    return ['id' => null, 'nombre' => $txt];
  }

  /** @return array<string,array{user_id:int,nombre:string,usar_nombre:bool}> */
  private static function parse_mapeo(WP_REST_Request $req): array {
    $raw = $req->get_param('mapeo_docentes');
    if (is_string($raw)) {
      $decoded = json_decode($raw, true);
      $raw = is_array($decoded) ? $decoded : [];
    }
    if (!is_array($raw)) return [];
    $out = [];
    foreach ($raw as $nombre => $m) {
      $key = self::norm((string) $nombre);
      if ($key === '') continue;
      if (!is_array($m)) {
        $uid = (int) $m;
        $out[$key] = ['user_id' => $uid, 'nombre' => (string) $nombre, 'usar_nombre' => $uid <= 0];
        continue;
      }
      $uid = (int) ($m['user_id'] ?? 0);
      $out[$key] = [
        'user_id'     => $uid,
        'nombre'      => trim((string) ($m['nombre'] ?? $nombre)) ?: (string) $nombre,
        'usar_nombre' => !empty($m['usar_nombre']) || $uid <= 0,
      ];
    }
    return $out;
  }

  /**
   * Nombres del Excel sin match exacto y sin mapeo confirmado.
   * @return array<int,array{nombre:string,sugerido_id:?int,sugerido_nombre:?string}>
   */
  private static function nombres_pendientes_mapeo(array $filas, array $ctx): array {
    $unicos = [];
    foreach ($filas as $f) {
      foreach (['previsto', 'presente'] as $k) {
        $nom = trim((string) ($f[$k] ?? ''));
        if ($nom === '' || self::es_marcador_examen($nom) || self::es_marcador_ausente($nom)) continue;
        $unicos[self::norm($nom)] = $nom;
      }
    }
    $pendientes = [];
    foreach ($unicos as $norm => $original) {
      if (self::resolver_docente($original, $ctx['docentes'])) continue;
      $map = $ctx['mapeo'][$norm] ?? null;
      if (is_array($map) && (!empty($map['user_id']) || !empty($map['usar_nombre']))) continue;
      $sug = self::sugerir_docente($original, $ctx['docentes']);
      $pendientes[] = [
        'nombre'           => $original,
        'sugerido_id'      => $sug['id'] ?? null,
        'sugerido_nombre'  => $sug['nombre'] ?? null,
      ];
    }
    usort($pendientes, static fn($a, $b) => strcasecmp($a['nombre'], $b['nombre']));
    return $pendientes;
  }

  private static function tokens_nombre(string $s): array {
    $n = self::norm($s);
    $n = preg_replace('/^(prof|profesor|profe|lic|dra|dr|mg|ing)\.?\s+/u', '', $n) ?: $n;
    $parts = preg_split('/\s+/', $n) ?: [];
    return array_values(array_filter($parts, static fn($p) => $p !== '' && $p !== 'de' && $p !== 'del'));
  }

  private static function es_todos(string $s): bool {
    $n = self::norm($s);
    return in_array($n, ['todos', 'todo', 'todas', 'all', 'todos los grupos', 'todas los grupos'], true)
      || str_starts_with($n, 'todos ');
  }

  private static function es_virtual(string $s): bool {
    return self::norm($s) === 'virtual';
  }

  private static function es_marcador_examen(string $s): bool {
    $n = self::norm($s);
    return $n === 'examen' || str_starts_with($n, 'examen ');
  }

  private static function es_marcador_ausente(string $s): bool {
    $n = self::norm($s);
    return in_array($n, ['ausente', 'ausentes', 'falto', 'faltó', 'no asistio', 'no asistió', 'no vino', '-'], true);
  }

  // ------------------------------------------------ parsers

  private static function parse_fecha_asistencia($raw, int $anio, int $mes): ?string {
    if ($raw === null || $raw === '') return null;
    if ($raw instanceof DateTimeInterface) {
      $day = (int) $raw->format('j');
      $raw_mes = (int) $raw->format('n');
      $raw_anio = (int) $raw->format('Y');
      // "Mar-4" lo guarda Excel como 4 de marzo: usar el mes de la hoja.
      if ($raw_mes !== $mes) {
        if (checkdate($mes, $day, $anio)) {
          return sprintf('%04d-%02d-%02d', $anio, $mes, $day);
        }
        return null;
      }
      if ($raw_anio > 2000) {
        return $raw->format('Y-m-d');
      }
      if (checkdate($mes, $day, $anio)) {
        return sprintf('%04d-%02d-%02d', $anio, $mes, $day);
      }
      return null;
    }
    if (is_numeric($raw) && (float) $raw > 20000 && (float) $raw < 80000) {
      try {
        $dt = ExcelDate::excelToDateTimeObject((float) $raw);
        return self::parse_fecha_asistencia($dt, $anio, $mes);
      } catch (Throwable $e) {
        // seguir como texto
      }
    }
    $s = self::texto($raw);
    if ($s === '') return null;
    if (preg_match('/^(20\d{2})-(\d{2})-(\d{2})/', $s, $m)) {
      return self::parse_fecha_asistencia(new DateTime($m[0]), $anio, $mes);
    }
    if (preg_match('/^(lun|mar|mie|mié|jue|vie|vier|sab|sáb|dom)[a-záéíóú]*\s*-?\s*(\d{1,2})$/ui', $s, $m)) {
      $day = (int) $m[2];
      if (checkdate($mes, $day, $anio)) {
        return sprintf('%04d-%02d-%02d', $anio, $mes, $day);
      }
    }
    return null;
  }

  /** @return array{hora_inicio:string,hora_fin:string}|null */
  private static function parse_horario_establecido($raw): ?array {
    $s = self::texto($raw);
    if ($s === '') return null;
    if (preg_match('/(\d{1,2})[:h\.](\d{2})\s*(?:a|al|-|–|—)\s*(\d{1,2})[:h\.](\d{2})/ui', $s, $m)) {
      $ini = sprintf('%02d:%02d:00', (int) $m[1], (int) $m[2]);
      $fin = sprintf('%02d:%02d:00', (int) $m[3], (int) $m[4]);
      if ($fin > $ini) return ['hora_inicio' => $ini, 'hora_fin' => $fin];
    }
    return null;
  }

  private static function parse_hora_celda($raw): ?string {
    if ($raw === null || $raw === '') return null;
    if ($raw instanceof DateTimeInterface) {
      return $raw->format('H:i:s');
    }
    $s = self::texto($raw);
    if ($s === '') return null;
    $n = self::norm($s);
    if (in_array($n, ['no hay registro', 'sin registro', 'n/a', '#value!', '#ref!', '#n/a'], true)) return null;
    if (is_numeric($raw) && (float) $raw >= 0 && (float) $raw < 1.5) {
      try {
        $dt = ExcelDate::excelToDateTimeObject((float) $raw);
        return $dt->format('H:i:s');
      } catch (Throwable $e) {
        // texto
      }
    }
    if (preg_match('/^(\d{1,2})[:h\.](\d{2})(?::(\d{2}))?/', $s, $m)) {
      $h = (int) $m[1];
      $mi = (int) $m[2];
      $se = (int) ($m[3] ?? 0);
      if ($h < 24 && $mi < 60) return sprintf('%02d:%02d:%02d', $h, $mi, $se);
    }
    return null;
  }

  private static function celda_valor($sheet, string $coord) {
    $cell = $sheet->getCell($coord);
    $val = $cell->getValue();
    if ($val instanceof RichText) $val = $val->getPlainText();
    if (is_numeric($val) && ExcelDate::isDateTime($cell)) {
      try {
        return ExcelDate::excelToDateTimeObject((float) $val);
      } catch (Throwable $e) {
        return $val;
      }
    }
    return $val;
  }

  private static function celda_texto($sheet, string $coord): string {
    return self::texto(self::celda_valor($sheet, $coord));
  }

  private static function texto($v): string {
    if ($v === null) return '';
    if ($v instanceof DateTimeInterface) return $v->format('Y-m-d H:i:s');
    if (is_bool($v)) return $v ? '1' : '';
    $s = trim((string) $v);
    if ($s === '' || str_starts_with($s, '#')) return $s === '' ? '' : $s;
    return $s;
  }

  // ------------------------------------------------ grilla exportada (formato original)

  private static function handle_grilla(WP_REST_Request $req, $spreadsheet) {
    $desde = (string) $req->get_param('vigencia_desde');
    $hasta = (string) $req->get_param('vigencia_hasta');
    $d = DateTime::createFromFormat('Y-m-d', $desde);
    $h = DateTime::createFromFormat('Y-m-d', $hasta);
    if (!$d || $d->format('Y-m-d') !== $desde || !$h || $h->format('Y-m-d') !== $hasta || $hasta < $desde) {
      return new WP_Error('nh_error', 'Indicá vigencia_desde y vigencia_hasta válidas (Y-m-d).', ['status' => 400]);
    }

    $aulas = [];
    foreach (NH_OPM::get_aulas() as $a) {
      $aulas[self::norm((string) $a['nombre'])] = (int) $a['id'];
    }
    $materias = [];
    foreach (NH_OPM::get_materias() as $m) {
      $materias[self::norm((string) $m['nombre'])] = (int) $m['id'];
    }
    $docentes = [];
    foreach (NH_OPM::get_docentes() as $doc) {
      $docentes[self::norm((string) $doc['nombre'])] = (int) $doc['id'];
    }

    global $wpdb;
    $t = $wpdb->prefix . 'horarios_bloques';
    $uid = get_current_user_id();
    $creados = 0;
    $omitidos = 0;
    $avisos = [];
    $vistos = [];

    foreach ($spreadsheet->getAllSheets() as $sheet) {
      $titulo = trim((string) $sheet->getTitle());
      if (self::norm($titulo) === 'detalle') continue;

      $aula_nombre = trim((string) $sheet->getCell('A1')->getValue());
      if ($aula_nombre === '') $aula_nombre = $titulo;
      $aula_id = $aulas[self::norm($aula_nombre)] ?? null;
      if (!$aula_id) {
        $avisos[] = "Aula no encontrada: “{$aula_nombre}” (hoja “{$titulo}”).";
        continue;
      }

      $dias_cols = [];
      $maxCol = Coordinate::columnIndexFromString($sheet->getHighestColumn());
      for ($c = 2; $c <= $maxCol; $c++) {
        $header = self::norm((string) $sheet->getCell(Coordinate::stringFromColumnIndex($c) . '2')->getValue());
        $header = str_replace(['Á', 'É', 'Í', 'Ó', 'Ú'], ['A', 'E', 'I', 'O', 'U'], mb_strtoupper($header));
        foreach (self::DIAS as $nombre => $n) {
          $nkey = str_replace(['Á', 'É', 'Í', 'Ó', 'Ú'], ['A', 'E', 'I', 'O', 'U'], $nombre);
          if ($header === $nkey || str_contains($header, $nkey)) {
            $dias_cols[$c] = $n;
            break;
          }
        }
      }
      if (!$dias_cols) {
        $avisos[] = "Sin columnas de días en hoja “{$titulo}”.";
        continue;
      }

      $maxRow = (int) $sheet->getHighestRow();
      for ($r = 3; $r <= $maxRow; $r++) {
        foreach ($dias_cols as $colIdx => $dia) {
          $raw = (string) $sheet->getCell(Coordinate::stringFromColumnIndex($colIdx) . $r)->getValue();
          if (trim($raw) === '') continue;

          foreach (preg_split('/\n\s*---\s*\n/', $raw) as $bloque_txt) {
            $parsed = self::parse_celda($bloque_txt);
            if (!$parsed) continue;

            $materia_id = null;
            $titulo_bloque = null;
            if ($parsed['materia'] !== '') {
              $materia_id = $materias[self::norm($parsed['materia'])] ?? null;
              if (!$materia_id) $titulo_bloque = $parsed['materia'];
            }

            $docente_id = null;
            if ($parsed['docente'] !== '') {
              $docente_id = $docentes[self::norm($parsed['docente'])] ?? null;
              if (!$docente_id) {
                $avisos[] = "Docente no encontrado: “{$parsed['docente']}” ({$aula_nombre}).";
              }
            }

            $clave = implode('|', [$aula_id, $dia, $parsed['hora_inicio'], $parsed['hora_fin'], $materia_id ?: $titulo_bloque, $docente_id ?: 0]);
            if (isset($vistos[$clave])) { $omitidos++; continue; }
            $vistos[$clave] = true;

            if (self::buscar_duplicado($t, $aula_id, $dia, $parsed['hora_inicio'], $parsed['hora_fin'], $desde, $hasta, $materia_id, $docente_id, $titulo_bloque)) {
              $omitidos++;
              continue;
            }

            $row = [
              'tipo'            => 'semanal',
              'dia_semana'      => $dia,
              'vigencia_desde'  => $desde,
              'vigencia_hasta'  => $hasta,
              'hora_inicio'     => $parsed['hora_inicio'],
              'hora_fin'        => $parsed['hora_fin'],
              'aula_id'         => $aula_id,
              'materia_id'      => $materia_id,
              'docente_user_id' => $docente_id,
              'titulo'          => $titulo_bloque,
              'color'           => $docente_id ? NH_DB::color_de_docente((int) $docente_id) : null,
              'creado_por'      => $uid,
            ];
            if ($wpdb->insert($t, $row)) $creados++;
          }
        }
      }
    }

    return new WP_REST_Response([
      'formato'  => 'grilla',
      'creados'  => $creados,
      'omitidos' => $omitidos,
      'avisos'   => array_values(array_unique($avisos)),
    ], 200);
  }

  private static function buscar_duplicado(
    string $t, int $aula_id, int $dia, string $ini, string $fin,
    string $desde, string $hasta, ?int $materia_id, ?int $docente_id, ?string $titulo
  ): bool {
    global $wpdb;
    $sql = "SELECT id FROM $t WHERE activo = 1 AND tipo = 'semanal' AND aula_id = %d AND dia_semana = %d
            AND hora_inicio = %s AND hora_fin = %s AND vigencia_desde = %s AND vigencia_hasta = %s";
    $params = [$aula_id, $dia, $ini, $fin, $desde, $hasta];
    if ($materia_id) { $sql .= ' AND materia_id = %d'; $params[] = $materia_id; }
    else { $sql .= ' AND materia_id IS NULL'; }
    if ($docente_id) { $sql .= ' AND docente_user_id = %d'; $params[] = $docente_id; }
    else { $sql .= ' AND docente_user_id IS NULL'; }
    if ($titulo) { $sql .= ' AND titulo = %s'; $params[] = $titulo; }
    return (bool) $wpdb->get_var($wpdb->prepare($sql, ...$params));
  }

  /** @return array{hora_inicio:string,hora_fin:string,materia:string,docente:string}|null */
  private static function parse_celda(string $txt): ?array {
    $lines = array_values(array_filter(array_map('trim', preg_split('/\r\n|\r|\n/', $txt)), fn($l) => $l !== ''));
    if (!$lines) return null;

    $hora_inicio = null;
    $hora_fin = null;
    $resto = $lines;

    if (preg_match('/^(\d{1,2}:\d{2})\s*a\s*(\d{1,2}:\d{2})$/u', $lines[0], $m)) {
      $hora_inicio = self::norm_hora($m[1]);
      $hora_fin = self::norm_hora($m[2]);
      array_shift($resto);
    } else {
      return null;
    }
    if (!$hora_inicio || !$hora_fin || $hora_fin <= $hora_inicio) return null;

    $materia = $resto[0] ?? '';
    $docente = $resto[1] ?? '';
    return [
      'hora_inicio' => $hora_inicio,
      'hora_fin'    => $hora_fin,
      'materia'     => $materia,
      'docente'     => $docente,
    ];
  }

  // ------------------------------------------------ cartel (grupo en el título, Prof. + horario)

  private static function fecha_ymd(string $s): ?string {
    $d = DateTime::createFromFormat('Y-m-d', $s);
    return ($d && $d->format('Y-m-d') === $s) ? $s : null;
  }

  private static function es_hoja_cartel($sheet): bool {
    if (self::es_hoja_asistencia($sheet)) return false;
    $maxR = min(45, (int) $sheet->getHighestRow());
    $maxC = min(12, Coordinate::columnIndexFromString($sheet->getHighestColumn()));
    $dias = 0;
    $profs = 0;
    $horas = 0;
    $grupo = false;
    for ($r = 1; $r <= $maxR; $r++) {
      for ($c = 1; $c <= $maxC; $c++) {
        $raw = self::celda_texto($sheet, Coordinate::stringFromColumnIndex($c) . $r);
        $t = self::norm($raw);
        if ($t === '') continue;
        foreach (self::DIAS as $nombre => $n) {
          $nk = self::norm($nombre);
          if ($t === $nk || str_contains($t, $nk)) { $dias++; break; }
        }
        if (preg_match('/\bprof(esor|e)?\b/u', $t)) $profs++;
        if (preg_match('/\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/u', $raw)) $horas++;
        if (preg_match('/\bgrupo\s*[a-z]\b/u', $t)) $grupo = true;
      }
    }
    return $dias >= 3 && $profs >= 3 && $horas >= 3 && $grupo;
  }

  private static function preview_cartel($spreadsheet) {
    $carteles = [];
    foreach ($spreadsheet->getAllSheets() as $sheet) {
      if (!self::es_hoja_cartel($sheet)) continue;
      $cartel = self::parse_hoja_cartel($sheet);
      if ($cartel && !empty($cartel['bloques'])) $carteles[] = $cartel;
    }
    if (!$carteles) {
      return new WP_Error('nh_error', 'El cartel no tiene clases legibles.', ['status' => 400]);
    }
    return new WP_REST_Response([
      'formato'  => 'cartel',
      'preview'  => true,
      'carteles' => $carteles,
    ], 200);
  }

  /** @return array{nombre:string,curso_texto:string,grupo_letra:string,bloques:array}|null */
  private static function parse_hoja_cartel($sheet): ?array {
    $maxR = min(80, (int) $sheet->getHighestRow());
    $maxC = min(12, Coordinate::columnIndexFromString($sheet->getHighestColumn()));
    $header = 0;
    $mejor = 0;
    $diasCols = [];
    for ($r = 1; $r <= min(12, $maxR); $r++) {
      $cols = [];
      for ($c = 1; $c <= $maxC; $c++) {
        $t = self::norm(self::celda_texto($sheet, Coordinate::stringFromColumnIndex($c) . $r));
        if ($t === '') continue;
        foreach (self::DIAS as $nombre => $n) {
          $nk = self::norm($nombre);
          if ($t === $nk || ($t !== '' && str_contains($t, $nk) && strlen($t) <= strlen($nk) + 2)) {
            $cols[$c] = $n;
            break;
          }
        }
      }
      if (count($cols) > $mejor) {
        $mejor = count($cols);
        $header = $r;
        $diasCols = $cols;
      }
    }
    if ($header < 1 || !$diasCols) return null;

    $titulo = '';
    for ($r = 1; $r < $header; $r++) {
      for ($c = 1; $c <= $maxC; $c++) {
        $txt = trim(self::celda_texto($sheet, Coordinate::stringFromColumnIndex($c) . $r));
        if ($txt !== '') $titulo .= ' ' . $txt;
      }
    }
    $titulo = trim($titulo . ' ' . $sheet->getTitle());
    $grupo = '';
    if (preg_match('/grupo\s*([a-z])/iu', self::norm($titulo), $m)) $grupo = strtoupper($m[1]);
    $curso = '';
    if (preg_match('/^(.+?)\s+grupo\b/iu', $titulo, $m)) {
      $curso = trim(preg_replace('/[^A-Za-zÁÉÍÓÚáéíóúÑñÜü\s]/u', ' ', $m[1]) ?: '');
      $curso = trim(preg_replace('/\s+/', ' ', $curso) ?: '');
    }

    $vistos = self::mapa_celdas_merge($sheet);
    $bloques = [];
    foreach ($diasCols as $col => $dia) {
      $items = [];
      for ($r = $header + 1; $r <= $maxR; $r++) {
        $coord = Coordinate::stringFromColumnIndex($col) . $r;
        if (isset($vistos[$coord]) && $vistos[$coord] === false) continue;
        $txt = self::celda_texto($sheet, $coord);
        if (trim($txt) === '') continue;
        $parsed = self::parse_texto_cartel($txt);
        if ($parsed) $items[] = $parsed;
      }
      $items = self::inferir_especiales_cartel($items);
      foreach ($items as $it) {
        if ($it['tipo'] === 'libre' || empty($it['hora_inicio']) || empty($it['hora_fin'])) continue;
        $bloques[] = [
          'dia_semana'    => $dia,
          'hora_inicio'   => substr($it['hora_inicio'], 0, 5),
          'hora_fin'      => substr($it['hora_fin'], 0, 5),
          'naturaleza'    => $it['tipo'] === 'clase' ? 'clase' : $it['tipo'],
          'docente_texto' => $it['docente'],
          'materia_texto' => $it['materia'],
        ];
      }
    }

    return [
      'nombre'       => (string) $sheet->getTitle(),
      'curso_texto'  => $curso,
      'grupo_letra'  => $grupo,
      'dias'         => array_values($diasCols),
      'bloques'      => $bloques,
    ];
  }

  /** @return array<string,bool> coord => true si es la celda maestra (o suelta); false si hay que saltearla. */
  private static function mapa_celdas_merge($sheet): array {
    $map = [];
    foreach ($sheet->getMergeCells() as $range) {
      $bounds = Coordinate::rangeBoundaries($range);
      $c1 = (int) $bounds[0][0]; $r1 = (int) $bounds[0][1];
      $c2 = (int) $bounds[1][0]; $r2 = (int) $bounds[1][1];
      for ($c = $c1; $c <= $c2; $c++) {
        for ($r = $r1; $r <= $r2; $r++) {
          $map[Coordinate::stringFromColumnIndex($c) . $r] = ($c === $c1 && $r === $r1);
        }
      }
    }
    return $map;
  }

  /** @return array{tipo:string,hora_inicio:?string,hora_fin:?string,minutos:?int,docente:string,materia:string}|null */
  private static function parse_texto_cartel(string $txt): ?array {
    $lines = array_values(array_filter(array_map('trim', preg_split('/\r\n|\r|\n/', $txt) ?: []), fn($l) => $l !== ''));
    if (!$lines) return null;
    $joined = implode(' ', $lines);
    $n = self::norm($joined);
    $tieneProf = (bool) preg_match('/\bprof(esor|e)?\b/u', $n);
    if (preg_match('/\blibre\b/u', $n) && !$tieneProf) {
      return ['tipo' => 'libre', 'hora_inicio' => null, 'hora_fin' => null, 'minutos' => null, 'docente' => '', 'materia' => ''];
    }
    $rango = self::parse_rango_cartel($joined);
    if (preg_match('/\breceso\b/u', $n) && !$tieneProf) {
      $mins = null;
      if (preg_match('/receso\s*(\d{1,3})/u', $n, $m)) $mins = (int) $m[1];
      return ['tipo' => 'recreo', 'hora_inicio' => $rango['ini'] ?? null, 'hora_fin' => $rango['fin'] ?? null, 'minutos' => $mins, 'docente' => '', 'materia' => ''];
    }
    if (preg_match('/\balmuerzo\b/u', $n) && !$tieneProf) {
      return ['tipo' => 'almuerzo', 'hora_inicio' => $rango['ini'] ?? null, 'hora_fin' => $rango['fin'] ?? null, 'minutos' => null, 'docente' => '', 'materia' => ''];
    }
    if (!$rango) return null;
    $resto = [];
    foreach ($lines as $l) {
      if (!self::parse_rango_cartel($l)) $resto[] = $l;
    }
    $prof = '';
    $materia = '';
    $profIdx = null;
    foreach ($resto as $i => $l) {
      if (preg_match('/^prof(?:esor|e)?\.?\s+/iu', $l)) { $profIdx = $i; break; }
    }
    if ($profIdx !== null) {
      $prof = trim((string) preg_replace('/^prof(?:esor|e)?\.?\s+/iu', '', $resto[$profIdx]));
      $extras = $resto;
      array_splice($extras, $profIdx, 1);
      $materia = trim(implode(' ', $extras));
    } elseif ($resto) {
      $prof = trim((string) preg_replace('/^prof(?:esor|e)?\.?\s+/iu', '', $resto[0]));
      $materia = trim(implode(' ', array_slice($resto, 1)));
    }
    if (mb_strlen($prof) < 2) return null;
    return ['tipo' => 'clase', 'hora_inicio' => $rango['ini'], 'hora_fin' => $rango['fin'], 'minutos' => null, 'docente' => $prof, 'materia' => $materia];
  }

  /** @return array{ini:string,fin:string}|null HH:MM */
  private static function parse_rango_cartel(string $s): ?array {
    if (!preg_match('/(\d{1,2})\s*[:.]\s*(\d{2})\s*[-–—=a]\s*(\d{1,2})\s*[:.]\s*(\d{2})/iu', $s, $m)) return null;
    $h1 = (int) $m[1]; $mi1 = (int) $m[2]; $h2 = (int) $m[3]; $mi2 = (int) $m[4];
    if ($h1 > 23 || $h2 > 23 || $mi1 > 59 || $mi2 > 59) return null;
    $ini = sprintf('%02d:%02d', $h1, $mi1);
    $fin = sprintf('%02d:%02d', $h2, $mi2);
    if ($fin <= $ini) return null;
    return ['ini' => $ini, 'fin' => $fin];
  }

  private static function inferir_especiales_cartel(array $items): array {
    foreach ($items as $i => $it) {
      if ($it['tipo'] === 'libre' || $it['tipo'] === 'clase' || !empty($it['hora_inicio'])) continue;
      $prev = null;
      $next = null;
      for ($j = $i - 1; $j >= 0; $j--) {
        if (!empty($items[$j]['hora_fin'])) { $prev = $items[$j]; break; }
      }
      for ($j = $i + 1; $j < count($items); $j++) {
        if (!empty($items[$j]['hora_inicio'])) { $next = $items[$j]; break; }
      }
      if ($prev && $next && $next['hora_inicio'] > $prev['hora_fin']) {
        $items[$i]['hora_inicio'] = $prev['hora_fin'];
        $items[$i]['hora_fin'] = $next['hora_inicio'];
        continue;
      }
      if ($it['tipo'] === 'recreo' && !empty($it['minutos']) && $prev) {
        $fin = self::sumar_minutos($prev['hora_fin'], (int) $it['minutos']);
        if ($fin && $fin > $prev['hora_fin']) {
          $items[$i]['hora_inicio'] = $prev['hora_fin'];
          $items[$i]['hora_fin'] = $fin;
        }
      }
    }
    return $items;
  }

  private static function sumar_minutos(string $hhmm, int $mins): ?string {
    if (!preg_match('/^(\d{2}):(\d{2})/', $hhmm, $m)) return null;
    $t = ((int) $m[1]) * 60 + (int) $m[2] + $mins;
    if ($t < 0 || $t >= 24 * 60) return null;
    return sprintf('%02d:%02d', intdiv($t, 60), $t % 60);
  }

  /** @param string[] $avisos */
  private static function fila_cartel(array $b, string $desde, string $hasta, int $uid, array &$avisos, int $i): ?array {
    $nat = (string) ($b['naturaleza'] ?? 'clase');
    if (!in_array($nat, ['clase', 'recreo', 'almuerzo'], true)) {
      $avisos[] = 'Bloque ' . ($i + 1) . ': tipo no válido.';
      return null;
    }
    $dia = (int) ($b['dia_semana'] ?? 0);
    if ($dia < 1 || $dia > 7) {
      $avisos[] = 'Bloque ' . ($i + 1) . ': día inválido.';
      return null;
    }
    $ini = self::norm_hora_flexible((string) ($b['hora_inicio'] ?? ''));
    $fin = self::norm_hora_flexible((string) ($b['hora_fin'] ?? ''));
    if (!$ini || !$fin || $fin <= $ini) {
      $avisos[] = 'Bloque ' . ($i + 1) . ': horario inválido.';
      return null;
    }
    $af = (int) ($b['aula_fisica_id'] ?? 0);
    if ($af <= 0) {
      $nomAf = strtoupper(trim((string) ($b['aula_fisica_nombre'] ?? '')));
      if ($nomAf !== '' && preg_match('/^[A-Z0-9]{1,12}$/', $nomAf)) {
        $cacheAf = [];
        $af = (int) self::ensure_aula_fisica($nomAf, $cacheAf);
      }
    }
    if ($af <= 0) {
      $avisos[] = 'Falta el aula física.';
      return null;
    }
    $aula = (int) ($b['aula_id'] ?? 0) ?: null;
    if ($nat === 'clase' && !$aula) {
      $avisos[] = 'Una clase no tiene grupo.';
      return null;
    }
    $docenteId = (int) ($b['docente_user_id'] ?? 0) ?: null;
    $docenteNombre = sanitize_text_field((string) ($b['docente_nombre'] ?? '')) ?: null;
    if ($docenteId) {
      $u = get_userdata($docenteId);
      if ($u) $docenteNombre = (string) $u->display_name;
      else $docenteId = null;
    }
    $materiaId = (int) ($b['materia_id'] ?? 0) ?: null;
    $titulo = sanitize_text_field((string) ($b['titulo'] ?? '')) ?: null;
    $cursoId = (int) ($b['curso_id'] ?? 0) ?: null;
    $color = null;
    if ($nat === 'clase') {
      if ($docenteId) $color = NH_DB::color_de_docente($docenteId);
    } elseif ($nat === 'recreo') {
      $titulo = $titulo ?: 'RECREO';
      $color = '#00b0f0';
      $docenteId = null;
      $docenteNombre = null;
      $materiaId = null;
    } else {
      $titulo = $titulo ?: 'ALMUERZO';
      $color = '#ed7d31';
      $docenteId = null;
      $docenteNombre = null;
      $materiaId = null;
    }
    if ($materiaId) $titulo = null;

    return [
      'tipo'            => 'semanal',
      'naturaleza'      => $nat,
      'dia_semana'      => $dia,
      'vigencia_desde'  => $desde,
      'vigencia_hasta'  => $hasta,
      'hora_inicio'     => $ini,
      'hora_fin'        => $fin,
      'aula_id'         => $aula,
      'aula_fisica_id'  => $af,
      'materia_id'      => $materiaId,
      'docente_user_id' => $docenteId,
      'docente_nombre'  => $nat === 'clase' ? $docenteNombre : null,
      'curso_id'        => $cursoId,
      'titulo'          => $titulo,
      'color'           => $color,
      'creado_por'      => $uid,
    ];
  }

  private static function norm_hora_flexible(string $h): ?string {
    $h = trim($h);
    if (preg_match('/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/', $h, $m)) {
      $hh = (int) $m[1];
      $mm = (int) $m[2];
      if ($hh > 23 || $mm > 59) return null;
      return sprintf('%02d:%02d:00', $hh, $mm);
    }
    return null;
  }

  private static function norm_hora(string $h): string {
    if (preg_match('/^(\d{1,2}):(\d{2})$/', $h, $m)) {
      return sprintf('%02d:%02d:00', (int) $m[1], (int) $m[2]);
    }
    return $h;
  }

  private static function norm(string $s): string {
    $s = mb_strtolower(trim($s));
    $s = str_replace(
      ['á', 'é', 'í', 'ó', 'ú', 'ü', 'ñ'],
      ['a', 'e', 'i', 'o', 'u', 'u', 'n'],
      $s
    );
    return preg_replace('/\s+/', ' ', $s) ?: '';
  }
}
