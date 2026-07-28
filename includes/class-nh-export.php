<?php
if (!defined('ABSPATH')) exit;

use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use PhpOffice\PhpSpreadsheet\Style\Alignment;
use PhpOffice\PhpSpreadsheet\Style\Border;
use PhpOffice\PhpSpreadsheet\Style\Fill;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;

/**
 * Exportación del horario a Excel (.xlsx).
 *
 * - Una hoja "grilla" por aula, con el formato del cartel de avisos:
 *   filas = franjas horarias, columnas = días, celdas coloreadas con materia y docente.
 * - Una hoja "Detalle" con una fila por clase: fecha, aula, materia, docente previsto,
 *   docente real, hora de llegada, retraso, estado y si coincidió con lo previsto.
 *
 * Usa PhpSpreadsheet: primero el vendor propio del plugin y, si no está,
 * el vendor del plugin Newton OPM (newton-conducta) que ya lo incluye.
 */
class NH_Export {

  private const DIAS = [1 => 'LUNES', 2 => 'MARTES', 3 => 'MIÉRCOLES', 4 => 'JUEVES', 5 => 'VIERNES', 6 => 'SÁBADO', 7 => 'DOMINGO'];

  private const ESTADOS = [
    'pendiente'    => 'Pendiente',
    'puntual'      => 'Puntual',
    'tolerancia'   => 'Tolerancia',
    'tardanza'     => 'Tardanza',
    'amonestacion' => 'Amonestación',
    'ausente'      => 'Ausente',
    'cancelado'    => 'Cancelado',
  ];

  /** Paleta para materias sin color definido (ARGB). */
  private const PALETA = ['FFFFFF00', 'FF0000FF', 'FF00B0F0', 'FF00B050', 'FFFF0000', 'FF7030A0', 'FFED7D31', 'FFC00000', 'FF833C00', 'FFFF66CC', 'FF808000', 'FF4472C4'];

  private static function cargar_phpspreadsheet(): bool {
    if (class_exists(Spreadsheet::class)) return true;

    $candidatos = [NH_PATH . 'vendor/autoload.php'];
    if (defined('WP_PLUGIN_DIR')) {
      foreach (glob(WP_PLUGIN_DIR . '/*/vendor/autoload.php') ?: [] as $auto) {
        $candidatos[] = $auto;
      }
    }
    foreach ($candidatos as $auto) {
      if (!file_exists($auto)) continue;
      require_once $auto;
      if (class_exists(Spreadsheet::class)) return true;
    }
    return class_exists(Spreadsheet::class);
  }

  /** GET /horarios/v1/export?desde&hasta[&aula_id] — responde el .xlsx directamente. */
  public static function handle(WP_REST_Request $req) {
    $desde = (string) $req->get_param('desde');
    $hasta = (string) $req->get_param('hasta');
    if (!$desde || !$hasta) {
      return new WP_Error('nh_error', 'Indicá desde y hasta (Y-m-d).', ['status' => 400]);
    }
    if (!self::cargar_phpspreadsheet()) {
      return new WP_Error('nh_error', 'PhpSpreadsheet no está disponible. Instalá las dependencias con composer.', ['status' => 500]);
    }

    $aula_id = ((int) $req->get_param('aula_id')) ?: null;

    $ocurrencias = NH_Rest::expandir_ocurrencias($desde, $hasta, $aula_id);
    $ocurrencias = self::con_datos($ocurrencias, $desde, $hasta);

    $spreadsheet = new Spreadsheet();
    $spreadsheet->removeSheetByIndex(0);

    self::hojas_grilla($spreadsheet, $ocurrencias);
    self::hoja_detalle($spreadsheet, $ocurrencias);

    if ($spreadsheet->getSheetCount() === 0) {
      $spreadsheet->createSheet()->setTitle('Sin datos');
    }
    $spreadsheet->setActiveSheetIndex(0);

    $filename = "horarios_{$desde}_{$hasta}.xlsx";
    if (ob_get_length()) ob_end_clean();
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Cache-Control: no-cache');

    $writer = new Xlsx($spreadsheet);
    $writer->save('php://output');
    exit;
  }

  /** Enriquece ocurrencias con nombres de aula/materia/docente y su control. */
  private static function con_datos(array $ocurrencias, string $desde, string $hasta): array {
    global $wpdb;

    $aulas = [];
    foreach (NH_OPM::get_aulas() as $a) $aulas[(int) $a['id']] = $a['nombre'];
    $materias = [];
    foreach (NH_OPM::get_materias() as $m) $materias[(int) $m['id']] = $m['nombre'];

    $t_ctl = $wpdb->prefix . 'horarios_control';
    $controles = $wpdb->get_results($wpdb->prepare(
      "SELECT * FROM $t_ctl WHERE fecha BETWEEN %s AND %s", $desde, $hasta
    ), ARRAY_A);
    $mapa_ctl = [];
    foreach ($controles as $c) $mapa_ctl[$c['bloque_id'] . '|' . $c['fecha']] = $c;

    $cache_users = [];
    $nombre_user = function ($uid) use (&$cache_users) {
      $uid = (int) $uid;
      if (!$uid) return '';
      if (!isset($cache_users[$uid])) {
        $u = get_userdata($uid);
        $cache_users[$uid] = $u ? $u->display_name : "Usuario #$uid";
      }
      return $cache_users[$uid];
    };

    foreach ($ocurrencias as &$o) {
      $o['aula_nombre'] = $aulas[(int) $o['aula_id']] ?? ('Aula #' . $o['aula_id']);
      $o['materia_nombre'] = $o['materia_id'] ? ($materias[(int) $o['materia_id']] ?? '') : ((string) ($o['titulo'] ?? ''));
      $o['docente_nombre'] = $nombre_user($o['docente_user_id']);
      $o['control'] = $mapa_ctl[$o['id'] . '|' . $o['fecha_ocurrencia']] ?? null;
      if ($o['control']) {
        $o['control']['docente_real_nombre'] = $nombre_user($o['control']['docente_real_id']);
        $o['control']['aula_real_nombre'] = $o['control']['aula_real_id'] ? ($aulas[(int) $o['control']['aula_real_id']] ?? '') : '';
      }
    }
    unset($o);
    return $ocurrencias;
  }

  // ------------------------------------------------------------------ grilla

  /** Una hoja por aula con la grilla semanal coloreada. */
  private static function hojas_grilla(Spreadsheet $spreadsheet, array $ocurrencias): void {
    $por_aula = [];
    foreach ($ocurrencias as $o) {
      $por_aula[$o['aula_nombre']][] = $o;
    }
    ksort($por_aula);

    foreach ($por_aula as $aula => $items) {
      $titulo = mb_substr(preg_replace('/[\\\\\/\?\*\[\]:]+/', ' ', $aula), 0, 31);
      $sheet = $spreadsheet->createSheet();
      $sheet->setTitle($titulo !== '' ? $titulo : 'Aula');

      // días presentes (orden lunes..domingo) y franjas horarias distintas
      $dias = [];
      $franjas = [];
      foreach ($items as $o) {
        $n = (int) (new DateTime($o['fecha_ocurrencia']))->format('N');
        $dias[$n] = true;
        $franjas[substr($o['hora_inicio'], 0, 5) . ' a ' . substr($o['hora_fin'], 0, 5)] = $o['hora_inicio'];
      }
      ksort($dias);
      asort($franjas);
      $dias = array_keys($dias);
      $franjas = array_keys($franjas);

      // celda por franja+día: puede haber varias semanas → juntar contenidos únicos
      $celdas = [];
      foreach ($items as $o) {
        $n = (int) (new DateTime($o['fecha_ocurrencia']))->format('N');
        $franja = substr($o['hora_inicio'], 0, 5) . ' a ' . substr($o['hora_fin'], 0, 5);
        $texto = trim($franja . "\n" . $o['materia_nombre'] . ($o['docente_nombre'] ? "\n" . $o['docente_nombre'] : ''));
        $celdas[$franja][$n]['textos'][$texto] = true;
        $celdas[$franja][$n]['color'] = $o['color'] ?: self::color_de((string) ($o['materia_nombre'] ?: $o['titulo']));
      }

      // encabezado
      $sheet->setCellValue('A1', mb_strtoupper($aula));
      $lastCol = Coordinate::stringFromColumnIndex(count($dias) + 1);
      $sheet->mergeCells("A1:{$lastCol}1");
      self::estilo_header($sheet, "A1:{$lastCol}1", 'FF4472C4', 'FFFFFFFF');

      $sheet->setCellValue('A2', 'HORARIO');
      self::estilo_header($sheet, 'A2:A2', 'FF808080', 'FFFFFFFF');
      foreach ($dias as $i => $n) {
        $col = Coordinate::stringFromColumnIndex($i + 2);
        $sheet->setCellValue($col . '2', self::DIAS[$n]);
        self::estilo_header($sheet, "{$col}2:{$col}2", 'FF808080', 'FFFFFFFF');
      }

      // cuerpo
      $fila = 3;
      foreach ($franjas as $franja) {
        $sheet->setCellValue('A' . $fila, $franja);
        self::estilo_header($sheet, "A{$fila}:A{$fila}", 'FFD9D9D9', 'FF000000');
        foreach ($dias as $i => $n) {
          $col = Coordinate::stringFromColumnIndex($i + 2);
          $celda = $celdas[$franja][$n] ?? null;
          if ($celda) {
            $sheet->setCellValue($col . $fila, implode("\n---\n", array_keys($celda['textos'])));
            $style = $sheet->getStyle($col . $fila);
            $style->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setARGB(self::argb($celda['color']));
            $style->getFont()->setBold(true)->getColor()->setARGB(self::contraste($celda['color']));
          }
          $sheet->getStyle($col . $fila)->getAlignment()
            ->setHorizontal(Alignment::HORIZONTAL_CENTER)
            ->setVertical(Alignment::VERTICAL_CENTER)
            ->setWrapText(true);
        }
        $sheet->getRowDimension($fila)->setRowHeight(52);
        $fila++;
      }

      $sheet->getColumnDimension('A')->setWidth(16);
      for ($i = 0; $i < count($dias); $i++) {
        $sheet->getColumnDimension(Coordinate::stringFromColumnIndex($i + 2))->setWidth(26);
      }
      $sheet->getStyle('A1:' . $lastCol . ($fila - 1))->getBorders()
        ->getAllBorders()->setBorderStyle(Border::BORDER_THIN);
    }
  }

  // ----------------------------------------------------------------- detalle

  /** Hoja "Detalle": una fila por clase con el cumplimiento. */
  private static function hoja_detalle(Spreadsheet $spreadsheet, array $ocurrencias): void {
    $sheet = $spreadsheet->createSheet();
    $sheet->setTitle('Detalle');

    $headers = ['Fecha', 'Día', 'Inicio', 'Fin', 'Aula', 'Materia', 'Docente previsto', 'Docente real', 'Coincide previsto', 'Hora llegada', 'Hora lista OPM', 'Hora salida', 'Retraso (min)', 'Estado', 'Fuente', 'Observación'];
    foreach ($headers as $i => $h) {
      $col = Coordinate::stringFromColumnIndex($i + 1);
      $sheet->setCellValue($col . '1', $h);
    }
    $lastCol = Coordinate::stringFromColumnIndex(count($headers));
    self::estilo_header($sheet, "A1:{$lastCol}1", 'FF4472C4', 'FFFFFFFF');

    $fila = 2;
    foreach ($ocurrencias as $o) {
      $c = $o['control'];
      $n = (int) (new DateTime($o['fecha_ocurrencia']))->format('N');
      $coincide = '';
      if ($c && $c['coincide_previsto'] !== null) {
        $coincide = ((int) $c['coincide_previsto'] === 1) ? 'SÍ' : 'NO';
      }
      $valores = [
        $o['fecha_ocurrencia'],
        ucfirst(mb_strtolower(self::DIAS[$n])),
        substr($o['hora_inicio'], 0, 5),
        substr($o['hora_fin'], 0, 5),
        $o['aula_nombre'],
        $o['materia_nombre'],
        $o['docente_nombre'],
        $c ? ($c['docente_real_nombre'] ?? '') : '',
        $coincide,
        $c && $c['hora_llegada'] ? substr($c['hora_llegada'], 0, 5) : '',
        $c && !empty($c['hora_lista_opm']) ? substr($c['hora_lista_opm'], 0, 5) : '',
        $c && !empty($c['hora_salida']) ? substr($c['hora_salida'], 0, 5) : '',
        $c && $c['minutos_retraso'] !== null && $c['minutos_retraso'] !== '' ? (int) $c['minutos_retraso'] : '',
        $c ? (self::ESTADOS[$c['estado']] ?? $c['estado']) : 'Sin control',
        $c ? strtoupper((string) $c['fuente']) : '',
        $c ? (string) ($c['observacion'] ?? '') : '',
      ];
      foreach ($valores as $i => $v) {
        $sheet->setCellValue(Coordinate::stringFromColumnIndex($i + 1) . $fila, $v);
      }

      // resaltar estado
      if ($c) {
        $colorEstado = [
          'puntual'      => 'FFC6EFCE',
          'tolerancia'   => 'FFFFEB9C',
          'tardanza'     => 'FFFFC7CE',
          'amonestacion' => 'FFFF0000',
          'ausente'      => 'FFD9D9D9',
        ][$c['estado']] ?? null;
        if ($colorEstado) {
          $sheet->getStyle('N' . $fila)->getFill()->setFillType(Fill::FILL_SOLID)
            ->getStartColor()->setARGB($colorEstado);
        }
      }
      $fila++;
    }

    foreach (range(1, count($headers)) as $i) {
      $sheet->getColumnDimension(Coordinate::stringFromColumnIndex($i))->setAutoSize(true);
    }
    $sheet->setAutoFilter("A1:{$lastCol}1");
    $sheet->freezePane('A2');
  }

  // ------------------------------------------------------------------ estilos

  private static function estilo_header($sheet, string $rango, string $fondo, string $texto): void {
    $style = $sheet->getStyle($rango);
    $style->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setARGB($fondo);
    $style->getFont()->setBold(true)->getColor()->setARGB($texto);
    $style->getAlignment()->setHorizontal(Alignment::HORIZONTAL_CENTER)->setVertical(Alignment::VERTICAL_CENTER);
  }

  /** Color determinístico por nombre de materia. */
  private static function color_de(string $clave): string {
    if ($clave === '') return 'FFD9D9D9';
    $idx = abs(crc32(mb_strtolower($clave))) % count(self::PALETA);
    return self::PALETA[$idx];
  }

  /** Normaliza '#RRGGBB' / 'RRGGBB' / 'AARRGGBB' a ARGB. */
  private static function argb(string $color): string {
    $c = strtoupper(ltrim($color, '#'));
    if (strlen($c) === 6) return 'FF' . $c;
    if (strlen($c) === 8) return $c;
    return 'FFD9D9D9';
  }

  /** Blanco o negro según luminosidad del fondo. */
  private static function contraste(string $color): string {
    $c = self::argb($color);
    $r = hexdec(substr($c, 2, 2));
    $g = hexdec(substr($c, 4, 2));
    $b = hexdec(substr($c, 6, 2));
    $lum = (0.299 * $r + 0.587 * $g + 0.114 * $b) / 255;
    return $lum > 0.6 ? 'FF000000' : 'FFFFFFFF';
  }
}
