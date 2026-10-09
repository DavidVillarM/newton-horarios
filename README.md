# Newton Horarios

Plugin de WordPress para el registro y control de horarios de docentes de Newton CEU.
Pensado para el usuario compartido de **Secretaría Directiva**, e integrado con el plugin
**Newton OPM (newton-conducta)**: reutiliza sus aulas, materias, cursos y docentes, y usa
el llamado de lista como comprobante de la hora de llegada del docente.

## Qué hace

- **CRUD de horarios previstos**: bloques de un solo día o semanales dentro de un rango
  de fechas (vigencia), con aula, materia, docente previsto, curso, color y observación.
- **Grilla semanal** tipo cartel de avisos, filtrable por aula, con colores por materia.
- **Control de cumplimiento**: el botón "Verificar con llamado de lista (OPM)" cruza cada
  clase prevista con `wp_conducta_asistencias` (fecha + aula + franja horaria) y calcula:
  - hora de llegada (hora en que el docente tomó lista),
  - minutos de retraso,
  - si hay **llamado de lista OPM** vinculado a ese bloque (**Coincide OPM**),
  - estado según la política de tolerancia.
- **Política de tolerancia** (configurable): llegada hasta 10 min = puntual; entre 10 y
  20 min = tolerancia (admitida hasta 3 veces por mes, la siguiente genera amonestación);
  más de 20 min = amonestación directa. Las amonestaciones automáticas quedan registradas.
- **Edición manual**: Secretaría puede corregir cualquier control (estado, docente real,
  hora de llegada, observación) y dar o anular amonestaciones manualmente.
- **Exportación a Excel**: una hoja por aula con la grilla coloreada (como el cartel de
  avisos) más una hoja "Detalle" con fecha, aula, materia, docente previsto/real,
  coincidencia, hora de llegada, retraso y estado.
- **Vista del docente**: los usuarios con rol `docente` ven sus próximas clases.

## Instalación

1. Copiar la carpeta `newton-horarios` a `wp-content/plugins/`.
2. Dentro de la carpeta del plugin, instalar la dependencia de Excel:

   ```bash
   composer install --no-dev
   ```

   Si no se puede correr composer en el servidor, el plugin intenta usar el
   PhpSpreadsheet que ya incluye el plugin Newton OPM (`newton-conducta/vendor`).
3. Activar el plugin en WordPress. Al activarse crea las tablas
   `wp_horarios_bloques`, `wp_horarios_control`, `wp_horarios_amonestaciones`
   y el rol **Secretaría Directiva** (`secretaria_directiva`).
4. Crear una página con slug `horarios` y el shortcode:

   ```
   [newton_horarios_app]
   ```

5. Asignar el rol **Secretaría Directiva** al usuario compartido de secretaría.

## Permisos

| Rol | Acceso |
| --- | --- |
| `secretaria_directiva` (= admin en este módulo), `direccion`, `funcionarios_administrativos`, `administrator` | Gestión completa: horarios, control, amonestaciones, configuración, export |
| `docente` | Solo lectura de sus propios horarios |

## API REST (namespace `horarios/v1`)

- `GET /catalogos` — aulas, materias, cursos, docentes y configuración.
- `GET /bloques?desde&hasta[&aula_id][&docente_id]` — ocurrencias expandidas con su control.
- `POST /bloques` · `PUT /bloques/{id}` · `DELETE /bloques/{id}`
- `POST /control/verificar` `{fecha}` o `{desde, hasta}` — cruce con el OPM.
- `PUT /control/{bloque_id}/{fecha}` — corrección manual.
- `GET|POST /amonestaciones` · `DELETE /amonestaciones/{id}`
- `GET|PUT /config` — política de tolerancia.
- `GET /export?desde&hasta[&aula_id]` — descarga el .xlsx.

## Tablas

- `wp_horarios_bloques`: horario previsto. `tipo='unico'` usa `fecha`; `tipo='semanal'`
  usa `dia_semana` (1=lunes..7=domingo) y se repite entre `vigencia_desde` y `vigencia_hasta`.
- `wp_horarios_control`: una fila por clase controlada (`bloque_id` + `fecha`), con
  docente previsto/real, hora de llegada, minutos de retraso, estado y fuente (`opm`/`manual`).
  Los controles con fuente `manual` no se pisan al re-verificar.
- `wp_horarios_amonestaciones`: amonestaciones automáticas (`origen='auto'`, vinculadas
  al control) y manuales, anulables (soft delete con `activo=0`).
