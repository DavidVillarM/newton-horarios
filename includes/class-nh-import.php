<?php
if (!defined('ABSPATH')) exit;

use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;

/**
 * Importación de horario desde Excel (.xlsx) con el mismo formato de exportación
 * (hojas-grilla por aula: fila 1 = nombre aula, fila 2 = HORARIO | LUNES…, celdas con
 * "HH:MM a HH:MM\nMateria\nDocente").
 */
class NH_Import {

  private const DIAS = [
    'LUNES' => 1, 'MARTES' => 2, 'MIÉRCOLES' => 3, 'MIERCOLES' => 3,
    'JUEVES' => 4, 'VIERNES' => 5, 'SÁBADO' => 6, 'SABADO' => 6, 'DOMINGO' => 7,
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

  /** POST /horarios/v1/import — multipart: file, vigencia_desde, vigencia_hasta. */
  public static function handle(WP_REST_Request $req) {
    if (!self::cargar_phpspreadsheet()) {
      return new WP_Error('nh_error', 'PhpSpreadsheet no está disponible.', ['status' => 500]);
    }

    $desde = (string) $req->get_param('vigencia_desde');
    $hasta = (string) $req->get_param('vigencia_hasta');
    $d = DateTime::createFromFormat('Y-m-d', $desde);
    $h = DateTime::createFromFormat('Y-m-d', $hasta);
    if (!$d || $d->format('Y-m-d') !== $desde || !$h || $h->format('Y-m-d') !== $hasta || $hasta < $desde) {
      return new WP_Error('nh_error', 'Indicá vigencia_desde y vigencia_hasta válidas (Y-m-d).', ['status' => 400]);
    }

    $files = $req->get_file_params();
    $file = $files['file'] ?? null;
    if (!$file || empty($file['tmp_name']) || !is_uploaded_file($file['tmp_name'])) {
      return new WP_Error('nh_error', 'Subí un archivo Excel (.xlsx) exportado desde Horarios.', ['status' => 400]);
    }
    $ext = strtolower(pathinfo((string) ($file['name'] ?? ''), PATHINFO_EXTENSION));
    if ($ext && $ext !== 'xlsx' && $ext !== 'xls') {
      return new WP_Error('nh_error', 'El archivo debe ser .xlsx (mismo formato de exportación).', ['status' => 400]);
    }

    try {
      $spreadsheet = IOFactory::load($file['tmp_name']);
    } catch (Throwable $e) {
      return new WP_Error('nh_error', 'No se pudo leer el Excel: ' . $e->getMessage(), ['status' => 400]);
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
    foreach (NH_OPM::get_docentes() as $d) {
      $docentes[self::norm((string) $d['nombre'])] = (int) $d['id'];
    }

    global $wpdb;
    $t = $wpdb->prefix . 'horarios_bloques';
    $uid = get_current_user_id();
    $creados = 0;
    $omitidos = 0;
    $avisos = [];
    $vistos = []; // evitar duplicados dentro del mismo archivo

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
              'creado_por'      => $uid,
            ];
            if ($wpdb->insert($t, $row)) $creados++;
          }
        }
      }
    }

    return new WP_REST_Response([
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
      // franja solo en columna A; la celda puede traer solo materia/docente — no soportado sin horas
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
