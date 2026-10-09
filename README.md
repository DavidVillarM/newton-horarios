# Newton Horarios

Plugin de WordPress (v1.5.0) para el registro y control de horarios de docentes de Newton CEU.
Pensado para **Secretaría Directiva**, e integrado con el plugin **Newton OPM (newton-conducta)**:
reutiliza sus grupos, materias, cursos y docentes, y usa el llamado de lista como comprobante
de que la clase se dictó. La llegada y la salida se cargan a mano.

## Qué hace

- **Horario semanal**: grilla tipo cartel, filtrable por grupo, salón y materia. Cada color
  corresponde a un docente (se asigna en Configuración; si no hay color propio, se usa uno
  estable de la paleta).
- **Bloques previstos**: de un solo día o semanales dentro de un rango de vigencia. Cada bloque
  tiene grupo OPM, salón físico, materia, docente, curso y observación. Una fecha se puede
  excluir de un bloque semanal sin borrar el resto de las semanas.
- **Tipos de bloque**: clase, examen, recreo, almuerzo y limpieza. Recreo, almuerzo y limpieza
  no entran en la verificación de horarios.
- **Salones físicos**: catálogo propio (`horarios_aulas_fisicas`), distinto de los grupos del OPM.
  Al activar o actualizar el esquema se crea el salón **VIRTUAL** para clases remotas.
- **Control de cumplimiento**: el botón "Verificar con llamado de lista (OPM)" cruza cada clase
  prevista con `wp_conducta_asistencias` (fecha + grupo + franja horaria) y calcula:
  - hora del llamado de lista (`hora_lista_opm`; no es la llegada),
  - minutos de retraso a partir de la hora de llegada cargada a mano,
  - si hay **llamado de lista OPM** vinculado a ese bloque (**Coincide OPM**),
  - estado según la política de tolerancia.
- **Política de tolerancia** (configurable): llegada hasta 10 min = puntual (no descuenta cupo);
  entre 10 y 20 min = tolerancia (hasta 3 por mes; la siguiente genera amonestación);
  más de 20 min = amonestación directa. El período puede ser mes, semana o total.
  Las amonestaciones automáticas quedan registradas.
- **Edición manual**: Secretaría puede corregir cualquier control (estado, docente real,
  hora de llegada, hora de salida, observación) y dar o anular amonestaciones.
  Los controles con fuente `manual` no se pisan al re-verificar.
- **Importación**:
  - registro mensual de asistencias (Excel),
  - grilla exportada desde este mismo módulo,
  - cartel de horario (foto o Excel, como el de Medicina). El grupo y el curso salen del
    título. Se puede subir varias imágenes juntas y revisar la lectura antes de crear bloques.
- **Verificación de horarios (VH)**: reporte semanal o mensual del horario proyectado contra
  el registro real de ingreso y salida, con observaciones y llamado de lista. Ámbito por
  docente o por grupo. Estados: borrador, enviado a Dirección, reportado y pagado. Al
  reportar o pagar el reporte queda congelado. El docente puede dejar un comentario.
- **Exportación a Excel**: una hoja por salón con la grilla coloreada más una hoja "Detalle"
  con fecha, aula, materia, docente previsto/real, coincidencia, hora de llegada, retraso y estado.
- **Vista del docente**: los usuarios con rol `docente` ven sus próximas clases y su verificación.

## Instalación

1. Copiar la carpeta `newton-horarios` a `wp-content/plugins/`.
2. Dentro de la carpeta del plugin, instalar la dependencia de Excel:

   ```bash
   composer install --no-dev
   ```

   Si no se puede correr composer en el servidor, el plugin intenta usar el
   PhpSpreadsheet que ya incluye el plugin Newton OPM (`newton-conducta/vendor`).
3. Activar el plugin en WordPress. Al activarse crea las tablas, el salón VIRTUAL
   y el rol **Secretaría Directiva** (`secretaria_directiva`). En cada carga también
   actualiza el esquema si hace falta (`nh_schema_version`).
4. Crear una página con slug `horarios` y el shortcode:

   ```
   [newton_horarios_app]
   ```

   Esa página y las respuestas REST de `horarios/v1` se sirven sin caché
   (LiteSpeed / `DONOTCACHEPAGE`), para que el nonce y el rol no queden de otro usuario.

5. Asignar el rol **Secretaría Directiva** al usuario compartido de secretaría.

## Permisos

La capacidad del módulo es `manage_newton_horarios`. Secretaría Directiva la tiene
en caliente, aunque el rol en la base no la tenga guardada. Cualquier rol cuyo nombre
o slug coincida con secretaría, dirección o funcionarios administrativos también la recibe.

| Rol | Acceso |
| --- | --- |
| `secretaria_directiva`, `direccion`, `funcionarios_administrativos`, `administrator` | Gestión completa: horarios, control, verificación, amonestaciones, importación, configuración y export |
| `docente` | Solo lectura de sus horarios y comentario en su verificación |

## API REST (namespace `horarios/v1`)

- `GET /catalogos` — grupos, materias, cursos, docentes, salones, colores y configuración.
- `GET|POST /aulas-fisicas` · `PUT|DELETE /aulas-fisicas/{id}`
- `GET /bloques?desde&hasta[&aula_id][&docente_id]` — ocurrencias expandidas con su control.
- `POST /bloques` · `PUT /bloques/{id}` · `DELETE /bloques/{id}`
- `POST /bloques/actualizar` · `POST /bloques/eliminar` — edición y borrado en lote.
- `GET /bloques/{id}/similares` — otros bloques del mismo grupo, hora, salón y día.
- `POST /control/verificar` `{fecha}` o `{desde, hasta}` — cruce con el OPM.
- `PUT /control/{bloque_id}/{fecha}` — corrección manual.
- `GET|POST /amonestaciones` · `DELETE /amonestaciones/{id}`
- `GET|PUT /config` — tolerancia, empresa y colores de docentes.
- `GET /export?desde&hasta[&aula_id]` — descarga el .xlsx.
- `POST /import` — Excel de asistencias, grilla o cartel (devuelve vista previa del cartel).
- `POST /import/cartel` — confirma la lectura revisada y crea los bloques.
- `GET|POST /limpieza` · `PUT|DELETE /limpieza/{id}` — turnos de limpieza (también viven como bloques).
- `GET /mis-horarios` — clases del docente que consulta.
- `GET|POST /verificaciones` · `GET /verificaciones/preview` · `GET /verificaciones/actores`
- `GET|PUT /verificaciones/{id}` · `POST /verificaciones/{id}/refrescar`
- `PUT /verificaciones/{id}/comentario-docente`

## Tablas

- `wp_horarios_bloques`: horario previsto. `tipo='unico'` usa `fecha`; `tipo='semanal'`
  usa `dia_semana` (1=lunes..7=domingo) y se repite entre `vigencia_desde` y `vigencia_hasta`.
  `aula_id` es el grupo del OPM; `aula_fisica_id` es el salón. `naturaleza` es
  `clase`, `examen`, `recreo`, `limpieza` o `almuerzo`. `fechas_excluidas` es un JSON
  de fechas `Y-m-d` que no se muestran.
- `wp_horarios_aulas_fisicas`: salones. Incluye el salón VIRTUAL.
- `wp_horarios_control`: una fila por clase controlada (`bloque_id` + `fecha`), con
  docente previsto/real, hora de llegada, hora de salida, hora del llamado de lista,
  minutos de retraso, estado y fuente (`opm`/`manual`).
  Estados: `pendiente`, `puntual`, `tolerancia`, `tardanza`, `amonestacion`, `ausente`, `cancelado`.
- `wp_horarios_amonestaciones`: amonestaciones automáticas (`origen='auto'`, vinculadas
  al control) y manuales, anulables (soft delete con `activo=0`).
- `wp_horarios_limpieza`: turnos de limpieza anteriores; los nuevos se crean también como bloques.
- `wp_horarios_verificaciones`: reportes VH por docente o grupo. `datos` guarda el detalle
  congelado al pasar a reportado o pagado. Estados: `borrador`, `enviado`, `reportado`, `pagado`.
