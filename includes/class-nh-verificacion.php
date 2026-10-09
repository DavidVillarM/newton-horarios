<?php
if (!defined('ABSPATH')) exit;

/**
 * Verificación de horarios (VH): reporte semanal/mensual de horario proyectado
 * vs registro real de ingreso-salida, observaciones numeradas y llamado de lista.
 */
class NH_Verificacion {

  private const DIAS_CORTOS = [1 => 'Lun', 2 => 'Mar', 3 => 'Mié', 4 => 'Jue', 5 => 'Vie', 6 => 'Sáb', 7 => 'Dom'];
  private const MESES_CORTOS = [1 => 'Ene', 2 => 'Feb', 3 => 'Mar', 4 => 'Abr', 5 => 'May', 6 => 'Jun', 7 => 'Jul', 8 => 'Ago', 9 => 'Sep', 10 => 'Oct', 11 => 'Nov', 12 => 'Dic'];
  private const MESES_LARGOS = [1 => 'Enero', 2 => 'Febrero', 3 => 'Marzo', 4 => 'Abril', 5 => 'Mayo', 6 => 'Junio', 7 => 'Julio', 8 => 'Agosto', 9 => 'Septiembre', 10 => 'Octubre', 11 => 'Noviembre', 12 => 'Diciembre'];
  private const ESTADOS_ABIERTOS = ['reportado', 'pagado'];

  public static function t(): string {
    return NH_DB::t_verificaciones();
  }

  public static function estados(): array {
    return [
      'borrador'  => 'Borrador',
      'enviado'   => 'Enviado a Dirección',
      'reportado' => 'Reportado',
      'pagado'    => 'Pagado',
    ];
  }

  public static function esta_cerrada(array $row): bool {
    return in_array((string) ($row['estado'] ?? ''), self::ESTADOS_ABIERTOS, true);
  }

  // ----------------------------------------------------------------- catálogos

  private static function mapa_grupos(): array {
    $out = [];
    foreach (NH_OPM::get_aulas() as $a) {
      $out[(int) $a['id']] = $a;
    }
    return $out;
  }

  private static function mapa_cursos(): array {
    $out = [];
    foreach (NH_OPM::get_cursos() as $c) {
      $out[(int) $c['id']] = (string) $c['nombre'];
    }
    return $out;
  }

  private static function mapa_materias(): array {
    $out = [];
    foreach (NH_OPM::get_materias() as $m) {
      $out[(int) $m['id']] = (string) $m['nombre'];
    }
    return $out;
  }

  private static function mapa_aulas_fisicas(): array {
    $out = [];
    foreach (NH_DB::get_aulas_fisicas() as $a) {
      $out[(int) $a['id']] = (string) $a['nombre'];
    }
    return $out;
  }

  private static function nombre_usuario(?int $uid): ?string {
    $uid = (int) $uid;
    if ($uid <= 0) return null;
    $u = get_userdata($uid);
    return $u ? (string) $u->display_name : null;
  }

  private static function hhmm(?string $t): string {
    return $t ? substr((string) $t, 0, 5) : '';
  }

  private static function minutos(?string $t): ?int {
    if (!$t) return null;
    if (!preg_match('/^(\d{1,2}):(\d{2})/', $t, $m)) return null;
    return ((int) $m[1]) * 60 + (int) $m[2];
  }

  private static function fmt_dmy(string $iso): string {
    $d = DateTime::createFromFormat('Y-m-d', $iso);
    return $d ? $d->format('d-m') : $iso;
  }

  public static function periodo_texto(string $desde, string $hasta): string {
    $d = DateTime::createFromFormat('Y-m-d', $desde);
    $h = DateTime::createFromFormat('Y-m-d', $hasta);
    if (!$d) return $desde;
    $mes = (int) $d->format('n');
    $anio = (int) $d->format('Y');
    if ($h && ($d->format('Y-m') === $h->format('Y-m'))) {
      return self::MESES_LARGOS[$mes] . ' de ' . $anio;
    }
    if ($h && (int) $h->format('Y') === $anio) {
      return self::MESES_CORTOS[$mes] . '–' . self::MESES_CORTOS[(int) $h->format('n')] . ' de ' . $anio;
    }
    if ($h) {
      return self::fmt_dmy($desde) . ' al ' . self::fmt_dmy($hasta) . ' de ' . $h->format('Y');
    }
    return self::MESES_LARGOS[$mes] . ' de ' . $anio;
  }

  public static function rango_mes(int $anio, int $mes): array {
    $desde = sprintf('%04d-%02d-01', $anio, $mes);
    $hasta = date('Y-m-t', strtotime($desde));
    return [$desde, $hasta];
  }

  // ----------------------------------------------------------- construcción

  /**
   * Lista docentes (o grupos) con clases en el período, para elegir sobre quién armar el VH.
   */
  public static function resumen_actores(string $desde, string $hasta, string $ambito = 'docente', ?int $curso_id = null): array {
    $oc = NH_Rest::expandir_ocurrencias($desde, $hasta, null, null, null, $curso_id);
    $oc = array_values(array_filter($oc, static function ($o) {
      return !in_array((string) ($o['naturaleza'] ?? 'clase'), ['recreo', 'almuerzo', 'limpieza'], true);
    }));
    $oc = self::enriquecer($oc, $desde, $hasta);

    $mapa = [];
    foreach ($oc as $o) {
      if ($ambito === 'grupo') {
        $id = (int) ($o['aula_id'] ?? 0);
        if ($id <= 0) continue;
        if (!isset($mapa[$id])) {
          $mapa[$id] = [
            'id' => $id,
            'nombre' => $o['grupo_nombre'] ?: ('Grupo #' . $id),
            'clases' => 0,
            'sin_registro' => 0,
            'no_dictadas' => 0,
            'con_observacion' => 0,
          ];
        }
        $key = $id;
      } else {
        $id = (int) ($o['docente_user_id'] ?? 0);
        if ($id <= 0) continue;
        if (!isset($mapa[$id])) {
          $mapa[$id] = [
            'id' => $id,
            'nombre' => $o['docente_nombre'] ?: ('Docente #' . $id),
            'clases' => 0,
            'sin_registro' => 0,
            'no_dictadas' => 0,
            'con_observacion' => 0,
          ];
        }
        $key = $id;
      }
      $mapa[$key]['clases']++;
      $flags = self::flags_fila($o);
      if ($flags['sin_registro']) $mapa[$key]['sin_registro']++;
      if ($flags['no_dictada']) $mapa[$key]['no_dictadas']++;
      if ($flags['tiene_obs']) $mapa[$key]['con_observacion']++;
    }

    $items = array_values($mapa);
    usort($items, static fn($a, $b) => strcasecmp($a['nombre'], $b['nombre']));
    return $items;
  }

  /**
   * Arma el reporte VH (datos vivos) para un docente o un grupo, entre dos fechas.
   */
  public static function construir(array $args): array {
    $desde = (string) ($args['desde'] ?? '');
    $hasta = (string) ($args['hasta'] ?? '');
    $ambito = in_array(($args['ambito'] ?? 'docente'), ['docente', 'grupo'], true) ? $args['ambito'] : 'docente';
    $docente_id = (int) ($args['docente_user_id'] ?? 0) ?: null;
    $aula_id = (int) ($args['aula_id'] ?? 0) ?: null;
    $curso_id = (int) ($args['curso_id'] ?? 0) ?: null;
    $empresa = trim((string) ($args['empresa'] ?? '')) ?: (string) (NH_DB::get_config()['empresa'] ?? 'Newton');

    if ($ambito === 'docente' && !$docente_id) {
      return ['error' => 'Indicá el docente para armar la verificación.'];
    }
    if ($ambito === 'grupo' && !$aula_id) {
      return ['error' => 'Indicá el grupo para armar la verificación.'];
    }

    $oc = NH_Rest::expandir_ocurrencias(
      $desde,
      $hasta,
      $ambito === 'grupo' ? $aula_id : null,
      $ambito === 'docente' ? $docente_id : null,
      null,
      $curso_id
    );
    $oc = array_values(array_filter($oc, static function ($o) {
      return !in_array((string) ($o['naturaleza'] ?? 'clase'), ['recreo', 'almuerzo', 'limpieza'], true);
    }));
    $oc = self::enriquecer($oc, $desde, $hasta);

    $cursos_set = [];
    $grupos_set = [];
    foreach ($oc as $o) {
      if (!empty($o['curso_nombre'])) $cursos_set[$o['curso_nombre']] = true;
      if (!empty($o['grupo_nombre'])) $grupos_set[$o['grupo_nombre']] = true;
    }
    $cursos = array_keys($cursos_set);
    sort($cursos, SORT_NATURAL | SORT_FLAG_CASE);
    $grupos = array_keys($grupos_set);
    sort($grupos, SORT_NATURAL | SORT_FLAG_CASE);

    $curso_label = $cursos ? implode(' · ', $cursos) : '';
    if ($curso_id && empty($curso_label)) {
      $curso_label = self::mapa_cursos()[$curso_id] ?? '';
    }
    $curso_empresa = trim(($curso_label ? $curso_label . ' · ' : '') . $empresa, ' ·');

    $docente_nombre = $docente_id ? self::nombre_usuario($docente_id) : null;
    $grupo_nombre = null;
    if ($aula_id) {
      $g = self::mapa_grupos()[$aula_id] ?? null;
      $grupo_nombre = $g['nombre'] ?? null;
    }

    $semanas = self::agrupar_semanas($oc, $desde, $hasta);
    $resumen = self::resumen_de_filas($oc);

    $uid = get_current_user_id();
    $elaborado = self::nombre_usuario($uid);

    $anio = (int) substr($desde, 0, 4);
    $mes = (int) substr($desde, 5, 2);

    return [
      'ambito' => $ambito,
      'docente_user_id' => $docente_id,
      'docente_nombre' => $docente_nombre,
      'aula_id' => $aula_id,
      'grupo_nombre' => $grupo_nombre,
      'curso_id' => $curso_id,
      'curso_nombre' => $curso_label,
      'cursos' => $cursos,
      'grupos' => $grupos,
      'empresa' => $empresa,
      'curso_empresa' => $curso_empresa,
      'desde' => $desde,
      'hasta' => $hasta,
      'anio' => $anio,
      'mes' => $mes,
      'periodo' => self::periodo_texto($desde, $hasta),
      'repetir_curso' => count($cursos) > 1,
      'elaborado_por' => $uid ?: null,
      'elaborado_nombre' => $elaborado,
      'semanas' => $semanas,
      'resumen' => $resumen,
    ];
  }

  /** Adjunta control, nombres y curso resuelto desde el grupo. */
  public static function enriquecer(array $ocurrencias, string $desde, string $hasta): array {
    global $wpdb;
    if (!$ocurrencias) return [];

    $rows = $wpdb->get_results($wpdb->prepare(
      'SELECT * FROM ' . $wpdb->prefix . 'horarios_control WHERE fecha BETWEEN %s AND %s',
      $desde, $hasta
    ), ARRAY_A);
    $mapa = [];
    foreach ($rows ?: [] as $c) {
      $mapa[$c['bloque_id'] . '|' . $c['fecha']] = $c;
    }

    $grupos = self::mapa_grupos();
    $cursos = self::mapa_cursos();
    $materias = self::mapa_materias();
    $aulas_f = self::mapa_aulas_fisicas();
    $nombres = [];

    $nom = static function ($uid) use (&$nombres) {
      $uid = (int) $uid;
      if ($uid <= 0) return null;
      if (!array_key_exists($uid, $nombres)) {
        $u = get_userdata($uid);
        $nombres[$uid] = $u ? (string) $u->display_name : null;
      }
      return $nombres[$uid];
    };

    foreach ($ocurrencias as &$o) {
      $o['control'] = $mapa[$o['id'] . '|' . $o['fecha_ocurrencia']] ?? null;
      $o['docente_nombre'] = $nom($o['docente_user_id'] ?? 0);
      $gid = (int) ($o['aula_id'] ?? 0);
      $grupo = $gid ? ($grupos[$gid] ?? null) : null;
      $o['grupo_nombre'] = $grupo['nombre'] ?? ($o['grupo_nombre'] ?? null);

      $cid = (int) ($o['curso_id'] ?? 0);
      if (!$cid && $grupo) $cid = (int) ($grupo['curso_id'] ?? 0);
      $o['curso_id_resuelto'] = $cid ?: null;
      $o['curso_nombre'] = $cid ? ($cursos[$cid] ?? null) : ($o['curso_nombre'] ?? null);

      $o['aula_fisica_nombre'] = !empty($o['aula_fisica_id'])
        ? ($aulas_f[(int) $o['aula_fisica_id']] ?? null)
        : ($o['aula_fisica_nombre'] ?? null);

      $mid = (int) ($o['materia_id'] ?? 0);
      $o['materia_nombre'] = $mid ? ($materias[$mid] ?? null) : (string) ($o['titulo'] ?? '');

      if ($o['control'] && !empty($o['control']['docente_real_id'])) {
        $o['control']['docente_real_nombre'] = $nom($o['control']['docente_real_id']);
      }
    }
    unset($o);

    return $ocurrencias;
  }

  private static function flags_fila(array $o): array {
    $c = $o['control'] ?? null;
    $fecha = (string) $o['fecha_ocurrencia'];
    $hora_ini = (string) $o['hora_inicio'];
    $hora_fin = (string) $o['hora_fin'];
    $ya_paso = strtotime("$fecha $hora_fin") < current_time('timestamp');

    $llegada = $c['hora_llegada'] ?? null;
    $salida = $c['hora_salida'] ?? null;
    $estado = $c['estado'] ?? null;
    $llamo = $c && (
      !empty($c['asistencia_opm_id']) || !empty($c['hora_lista_opm']) || (int) ($c['coincide_previsto'] ?? 0) === 1
    );
    $obs = trim((string) ($c['observacion'] ?? ''));

    $min_ini = self::minutos($hora_ini);
    $min_fin = self::minutos($hora_fin);
    $min_lleg = self::minutos($llegada);
    $min_sal = self::minutos($salida);
    $retraso = 0;
    if ($min_lleg !== null && $min_ini !== null) {
      if ($min_fin !== null && $min_lleg >= $min_fin) {
        $retraso = 0;
      } else {
        $retraso = max(0, $min_lleg - $min_ini);
      }
    }
    $retiro = ($min_sal !== null && $min_fin !== null) ? max(0, $min_fin - $min_sal) : 0;

    $previsto = (int) ($o['docente_user_id'] ?? 0);
    $real = (int) ($c['docente_real_id'] ?? 0);
    $suplente = $previsto && $real && $previsto !== $real;

    $sin_registro = !$llegada && !$salida;
    $no_dictada = in_array($estado, ['ausente', 'cancelado'], true)
      || ($ya_paso && $sin_registro);

    $proyectados = ($min_ini !== null && $min_fin !== null) ? max(0, $min_fin - $min_ini) : 0;
    $reales = ($min_lleg !== null && $min_sal !== null) ? max(0, $min_sal - $min_lleg) : 0;
    $faltan = $no_dictada ? $proyectados : max(0, $proyectados - $reales);

    // Solo cuenta lo escrito en el control. Sin ese texto, la fila no tiene observación.
    $tiene_obs = $obs !== '';

    return compact(
      'llegada', 'salida', 'estado', 'llamo', 'obs', 'retraso', 'retiro',
      'suplente', 'sin_registro', 'no_dictada', 'proyectados', 'reales', 'faltan',
      'tiene_obs', 'ya_paso', 'previsto', 'real'
    );
  }

  private static function agrupar_semanas(array $oc, string $desde, string $hasta): array {
    $buckets = [];
    foreach ($oc as $o) {
      $d = new DateTime($o['fecha_ocurrencia']);
      $iso_anio = (int) $d->format('o');
      $iso_sem = (int) $d->format('W');
      $key = sprintf('%04d-%02d', $iso_anio, $iso_sem);
      if (!isset($buckets[$key])) $buckets[$key] = ['anio' => $iso_anio, 'nro' => $iso_sem, 'items' => []];
      $buckets[$key]['items'][] = $o;
    }
    ksort($buckets);

    $out = [];
    foreach ($buckets as $b) {
      $lunes = (new DateTime())->setISODate($b['anio'], $b['nro'], 1);
      $domingo = (new DateTime())->setISODate($b['anio'], $b['nro'], 7);
      $ini_rep = new DateTime($desde);
      $fin_rep = new DateTime($hasta);
      $ini = $lunes > $ini_rep ? $lunes : $ini_rep;
      $fin = $domingo < $fin_rep ? $domingo : $fin_rep;

      // Semana lectiva: lunes a sábado, salvo que haya domingo con clase.
      $tiene_domingo = false;
      foreach ($b['items'] as $it) {
        if ((int) (new DateTime($it['fecha_ocurrencia']))->format('N') === 7) {
          $tiene_domingo = true;
          break;
        }
      }
      $fin_lectivo = (clone $lunes)->modify($tiene_domingo ? '+6 days' : '+5 days');
      if ($fin_lectivo < $fin) $fin = $fin_lectivo;
      if ($fin < $ini) $fin = $ini;

      $obs_nro = 0;
      $filas = [];
      $observaciones = [];
      foreach ($b['items'] as $o) {
        $fila = self::fila_reporte($o, $obs_nro);
        if (!empty($fila['obs_nro'])) {
          $observaciones[] = [
            'nro' => (int) $fila['obs_nro'],
            'fecha' => $fila['fecha'],
            'dia' => $fila['dia_corto'],
            'curso' => $fila['curso'],
            'grupo' => $fila['grupo'],
            'horario' => $fila['horario_proyectado'],
            'texto' => $fila['obs_texto'],
          ];
        }
        $filas[] = $fila;
      }

      $out[] = [
        'nro' => $b['nro'],
        'anio' => $b['anio'],
        'desde' => $ini->format('Y-m-d'),
        'hasta' => $fin->format('Y-m-d'),
        'titulo' => 'SEMANA ' . $b['nro'] . ' · del ' . $ini->format('d-m') . ' al ' . $fin->format('d-m'),
        'filas' => $filas,
        'observaciones' => $observaciones,
      ];
    }
    return $out;
  }

  private static function fila_reporte(array $o, int &$obs_nro): array {
    $f = self::flags_fila($o);
    $c = $o['control'] ?? null;
    $d = new DateTime($o['fecha_ocurrencia']);
    $n = (int) $d->format('N');
    $mes = (int) $d->format('n');

    $registro = 'Sin registro';
    if ($f['llegada'] || $f['salida']) {
      $a = $f['llegada'] ? self::hhmm($f['llegada']) : '—';
      $b = $f['salida'] ? self::hhmm($f['salida']) : '—';
      $registro = $a . ' a ' . $b;
    }

    $obs_n = null;
    $obs_texto = null;
    if ($f['tiene_obs']) {
      $obs_nro++;
      $obs_n = $obs_nro;
      $obs_texto = self::texto_observacion($o, $f, $obs_n, $d);
    }

    $llamo_txt = $f['llamo']
      ? ('SÍ' . (!empty($c['hora_lista_opm']) ? ' ' . self::hhmm($c['hora_lista_opm']) : ''))
      : 'NO';

    return [
      'bloque_id' => (int) $o['id'],
      'fecha' => $o['fecha_ocurrencia'],
      'dia_corto' => (self::DIAS_CORTOS[$n] ?? '') . ' ' . $d->format('d'),
      'mes_corto' => self::MESES_CORTOS[$mes] ?? '',
      'curso' => $o['curso_nombre'] ?: '',
      'grupo' => $o['grupo_nombre'] ?: '',
      'materia' => $o['materia_nombre'] ?: '',
      'aula_fisica' => $o['aula_fisica_nombre'] ?: '',
      'horario_proyectado' => self::hhmm($o['hora_inicio']) . ' a ' . self::hhmm($o['hora_fin']),
      'registro_real' => $registro,
      'obs_nro' => $obs_n,
      'obs_texto' => $obs_texto,
      'llamo_lista' => $f['llamo'],
      'llamo_lista_txt' => $llamo_txt,
      'hora_lista' => $c && !empty($c['hora_lista_opm']) ? self::hhmm($c['hora_lista_opm']) : '',
      'estado' => $f['estado'] ?: 'pendiente',
      'sin_registro' => $f['sin_registro'],
      'no_dictada' => $f['no_dictada'],
      'minutos_proyectados' => $f['proyectados'],
      'minutos_reales' => $f['reales'],
      'minutos_faltantes' => $f['faltan'],
      'minutos_retraso' => $f['retraso'],
      'minutos_retiro' => $f['retiro'],
    ];
  }

  private static function texto_observacion(array $o, array $f, int $nro, DateTime $d): string {
    $n = (int) $d->format('N');
    $dia = (self::DIAS_CORTOS[$n] ?? '') . ' ' . $d->format('d');
    $curso = $o['curso_nombre'] ?: '';
    $grupo = $o['grupo_nombre'] ?: '';
    $quien = trim(($curso ? $curso . ' · ' : '') . ($grupo ? 'Grupo ' . $grupo : ''), ' ·');
    $horario = self::hhmm($o['hora_inicio']) . ' a ' . self::hhmm($o['hora_fin']);

    $prefijo = "Obs. {$nro} — {$dia}";
    if ($quien !== '') $prefijo .= " — {$quien}";
    return $prefijo . " ({$horario}). " . $f['obs'];
  }

  private static function resumen_de_filas(array $oc): array {
    $previstas = count($oc);
    $dictadas = 0;
    $sin = 0;
    $no = 0;
    $min_p = 0;
    $min_r = 0;
    $min_f = 0;
    foreach ($oc as $o) {
      $f = self::flags_fila($o);
      $min_p += $f['proyectados'];
      $min_r += $f['reales'];
      $min_f += $f['faltan'];
      if ($f['sin_registro']) $sin++;
      if ($f['no_dictada']) $no++;
      if (!$f['no_dictada'] && !$f['sin_registro']) $dictadas++;
    }
    return [
      'clases_previstas' => $previstas,
      'clases_dictadas' => $dictadas,
      'clases_sin_registro' => $sin,
      'clases_no_dictadas' => $no,
      'minutos_proyectados' => $min_p,
      'minutos_reales' => $min_r,
      'minutos_no_dictados' => $min_f,
      'horas_proyectadas' => round($min_p / 60, 2),
      'horas_reales' => round($min_r / 60, 2),
      'horas_no_dictadas' => round($min_f / 60, 2),
    ];
  }

  /** Métricas de una ocurrencia (horario previsto vs registro real). */
  public static function metricas_ocurrencia(array $o): array {
    return self::flags_fila($o);
  }

  /** Totales de un conjunto de ocurrencias. */
  public static function resumen_ocurrencias(array $oc): array {
    return self::resumen_de_filas($oc);
  }

  // ---------------------------------------------------------------- persistencia

  public static function serializar_fila(array $row, bool $con_datos = true): array {
    $datos = null;
    if (!empty($row['datos'])) {
      $decoded = json_decode((string) $row['datos'], true);
      $datos = is_array($decoded) ? $decoded : null;
    }
    $d = is_array($datos) ? $datos : [];
    $docente_id = (int) ($row['docente_user_id'] ?? 0);
    $aula_id = (int) ($row['aula_id'] ?? 0);
    $out = [
      'id' => (int) $row['id'],
      'ambito' => $row['ambito'],
      'docente_user_id' => $docente_id ?: null,
      'docente_nombre' => $d['docente_nombre'] ?? self::nombre_usuario($docente_id),
      'aula_id' => $aula_id ?: null,
      'grupo_nombre' => $d['grupo_nombre'] ?? null,
      'curso_id' => ((int) ($row['curso_id'] ?? 0)) ?: null,
      'empresa' => $row['empresa'],
      'desde' => $row['desde'],
      'hasta' => $row['hasta'],
      'anio' => isset($row['anio']) ? (int) $row['anio'] : null,
      'mes' => isset($row['mes']) ? (int) $row['mes'] : null,
      'periodo' => $d['periodo'] ?? self::periodo_texto($row['desde'], $row['hasta']),
      'estado' => $row['estado'],
      'estado_label' => self::estados()[$row['estado']] ?? $row['estado'],
      'cerrada' => self::esta_cerrada($row),
      'elaborado_por' => ((int) ($row['elaborado_por'] ?? 0)) ?: null,
      'elaborado_nombre' => $row['elaborado_nombre'],
      'revisado_el' => $row['revisado_el'],
      'enviado_el' => $row['enviado_el'],
      'reportado_el' => $row['reportado_el'],
      'pagado_el' => $row['pagado_el'],
      'comentario_secretaria' => $row['comentario_secretaria'],
      'comentario_docente' => $row['comentario_docente'],
      'comentario_docente_el' => $row['comentario_docente_el'],
      'created_at' => $row['created_at'] ?? null,
    ];
    if ($con_datos) {
      $out['reporte'] = $datos;
      $out['resumen'] = $d['resumen'] ?? null;
      $out['curso_empresa'] = $d['curso_empresa'] ?? null;
    } else {
      $out['resumen'] = $d['resumen'] ?? null;
    }
    return $out;
  }

  public static function get(int $id): ?array {
    global $wpdb;
    $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::t() . ' WHERE id = %d AND activo = 1', $id), ARRAY_A);
    return $row ?: null;
  }

  public static function listar(array $filtros = []): array {
    global $wpdb;
    $t = self::t();
    $where = 'activo = 1';
    $params = [];
    if (!empty($filtros['docente_user_id'])) {
      $where .= ' AND docente_user_id = %d';
      $params[] = (int) $filtros['docente_user_id'];
    }
    if (!empty($filtros['aula_id'])) {
      $where .= ' AND aula_id = %d';
      $params[] = (int) $filtros['aula_id'];
    }
    if (!empty($filtros['curso_id'])) {
      $where .= ' AND curso_id = %d';
      $params[] = (int) $filtros['curso_id'];
    }
    if (!empty($filtros['estado'])) {
      $where .= ' AND estado = %s';
      $params[] = (string) $filtros['estado'];
    }
    if (!empty($filtros['desde'])) {
      $where .= ' AND hasta >= %s';
      $params[] = $filtros['desde'];
    }
    if (!empty($filtros['hasta'])) {
      $where .= ' AND desde <= %s';
      $params[] = $filtros['hasta'];
    }
    $sql = "SELECT * FROM $t WHERE $where ORDER BY desde DESC, id DESC LIMIT 200";
    $rows = $params ? $wpdb->get_results($wpdb->prepare($sql, ...$params), ARRAY_A) : $wpdb->get_results($sql, ARRAY_A);
    $out = [];
    foreach ($rows ?: [] as $r) {
      $out[] = self::serializar_fila($r, false);
    }
    return $out;
  }

  public static function crear(array $args): array|WP_Error {
    global $wpdb;
    $reporte = self::construir($args);
    if (!empty($reporte['error'])) {
      return new WP_Error('nh_error', $reporte['error'], ['status' => 400]);
    }
    $uid = get_current_user_id();
    $user = wp_get_current_user();
    $nombre = $user && $user->display_name ? $user->display_name : self::nombre_usuario($uid);
    $row = [
      'ambito' => $reporte['ambito'],
      'docente_user_id' => $reporte['docente_user_id'],
      'aula_id' => $reporte['aula_id'],
      'curso_id' => $reporte['curso_id'],
      'empresa' => $reporte['empresa'],
      'desde' => $reporte['desde'],
      'hasta' => $reporte['hasta'],
      'anio' => $reporte['anio'],
      'mes' => $reporte['mes'],
      'estado' => 'borrador',
      'elaborado_por' => $uid ?: null,
      'elaborado_nombre' => $nombre,
      'comentario_secretaria' => sanitize_textarea_field((string) ($args['comentario_secretaria'] ?? '')) ?: null,
      'datos' => wp_json_encode($reporte, JSON_UNESCAPED_UNICODE),
      'creado_por' => $uid ?: null,
    ];
    $wpdb->insert(self::t(), $row);
    if (!$wpdb->insert_id) {
      return new WP_Error('nh_error', 'No se pudo guardar la verificación.', ['status' => 500]);
    }
    return self::serializar_fila(self::get((int) $wpdb->insert_id), true);
  }

  public static function refrescar(int $id): array|WP_Error {
    $row = self::get($id);
    if (!$row) return new WP_Error('nh_error', 'Verificación no encontrada.', ['status' => 404]);
    if (self::esta_cerrada($row)) {
      return new WP_Error('nh_error', 'Esta verificación ya fue reportada o pagada y no se puede actualizar.', ['status' => 409]);
    }
    $reporte = self::construir([
      'ambito' => $row['ambito'],
      'docente_user_id' => $row['docente_user_id'],
      'aula_id' => $row['aula_id'],
      'curso_id' => $row['curso_id'],
      'empresa' => $row['empresa'],
      'desde' => $row['desde'],
      'hasta' => $row['hasta'],
    ]);
    if (!empty($reporte['error'])) {
      return new WP_Error('nh_error', $reporte['error'], ['status' => 400]);
    }
    global $wpdb;
    $wpdb->update(self::t(), [
      'datos' => wp_json_encode($reporte, JSON_UNESCAPED_UNICODE),
      'modificado_por' => get_current_user_id(),
    ], ['id' => $id]);
    return self::serializar_fila(self::get($id), true);
  }

  public static function actualizar_meta(int $id, array $patch): array|WP_Error {
    $row = self::get($id);
    if (!$row) return new WP_Error('nh_error', 'Verificación no encontrada.', ['status' => 404]);

    $data = ['modificado_por' => get_current_user_id()];
    $cerrada = self::esta_cerrada($row);

    foreach (['revisado_el', 'enviado_el', 'reportado_el', 'pagado_el'] as $k) {
      if (array_key_exists($k, $patch)) {
        $v = $patch[$k];
        $data[$k] = ($v === '' || $v === null) ? null : $v;
      }
    }
    if (array_key_exists('comentario_secretaria', $patch) && !$cerrada) {
      $data['comentario_secretaria'] = sanitize_textarea_field((string) $patch['comentario_secretaria']) ?: null;
    }
    if (array_key_exists('empresa', $patch) && !$cerrada) {
      $emp = sanitize_text_field((string) $patch['empresa']);
      if ($emp !== '') $data['empresa'] = $emp;
    }
    if (!empty($patch['estado'])) {
      $nuevo = (string) $patch['estado'];
      if (!isset(self::estados()[$nuevo])) {
        return new WP_Error('nh_error', 'Estado inválido.', ['status' => 400]);
      }
      if ($cerrada && $nuevo !== $row['estado'] && !in_array($nuevo, ['reportado', 'pagado'], true)) {
        return new WP_Error('nh_error', 'No se puede volver atrás una verificación ya reportada o pagada.', ['status' => 409]);
      }
      $data['estado'] = $nuevo;
      $hoy = current_time('Y-m-d');
      if ($nuevo === 'enviado' && empty($data['enviado_el']) && empty($row['enviado_el'])) $data['enviado_el'] = $hoy;
      if ($nuevo === 'reportado' && empty($data['reportado_el']) && empty($row['reportado_el'])) $data['reportado_el'] = $hoy;
      if ($nuevo === 'pagado' && empty($data['pagado_el']) && empty($row['pagado_el'])) $data['pagado_el'] = $hoy;
    }

    global $wpdb;
    $wpdb->update(self::t(), $data, ['id' => $id]);
    return self::serializar_fila(self::get($id), true);
  }

  public static function comentario_docente(int $id, string $texto, int $user_id): array|WP_Error {
    $row = self::get($id);
    if (!$row) return new WP_Error('nh_error', 'Verificación no encontrada.', ['status' => 404]);
    $docente = (int) ($row['docente_user_id'] ?? 0);
    $es_manager = NH_Roles::user_is_manager($user_id);
    if (!$es_manager && (!$docente || $docente !== $user_id)) {
      return new WP_Error('nh_error', 'Solo el docente de este reporte puede comentarlo.', ['status' => 403]);
    }
    global $wpdb;
    $wpdb->update(self::t(), [
      'comentario_docente' => sanitize_textarea_field($texto) ?: null,
      'comentario_docente_el' => current_time('mysql'),
      'modificado_por' => $user_id,
    ], ['id' => $id]);
    return self::serializar_fila(self::get($id), true);
  }
}
