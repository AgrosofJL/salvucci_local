/**
 * ModuloCampos: Ecosistema Territorial y Gestión de Plantaciones Activas
 * AgroSoft J&L - "Apple Soft Studio" Edition / Tipografía Roboto
 * Mode: Local-First (Engine SQLite IPC) + "No me quites nada" + Max(registro)+1 + sincronizado = 0
 *
 * Jerarquía territorial (cada nivel en su propia tabla):
 *   ESTABLECIMIENTO  -> tabla `establecimientos`
 *   CAMPO / SECTOR   -> tabla `campos`
 *   CUADRO / LOTE    -> tabla `cuadros`
 *   SIEMBRA          -> tabla `inventario_plantacion`
 */
const ModuloCampos = {
    rawDataCuadros: [],      // Registros de la tabla campos
    listaCuadros: [],        // Registros de la tabla maestra cuadros
    listaEstablecimientos: [], // Registros de la tabla establecimientos
    inventarioActivo: [],
    inventarioHistorial: [],
    listaCultivos: [],
    seleccionActual: { establecimiento: null, campo: null, lotes: [] },
    filtroCultivoActivo: null,
    filtroVariedadActiva: null,
    filtroEstablecimientoCultivoTab: '',
    buscadorCultivoTexto: '',
    buscadorEstTexto: '',
    buscadorCampoTexto: '',
    buscadorLoteTexto: '',
    modalTipoActual: null,
    datosEdicionActual: null,
    vistaInventarioActual: 'ACTIVOS',
    solapaPrincipalActual: 'TERRITORIO', // TERRITORIO | CULTIVOS_ACTIVOS

    // Helper IPC para ejecutar SQL en la base SQLite local
    m_ejecutarSqlLocal: async function(sql, params = []) {
        if (window.apiLocal && window.apiLocal.query) {
            return await window.apiLocal.query({ sql, params });
        }
        if (window.electronAPI && window.electronAPI.invoke) {
            return await window.electronAPI.invoke('local-db-query', { sql, params });
        }
        throw new Error("No se encontró el puente IPC con la base de datos local.");
    },

    // Consulta tolerante: si la tabla no existe devuelve lista vacía en vez de romper la pantalla
    m_consultaSegura: async function(sql, params = []) {
        try {
            const res = await this.m_ejecutarSqlLocal(sql, params);
            if (res && res.error) throw new Error(res.error);
            return (res && res.data) || [];
        } catch (e) {
            console.warn("⚠️ Consulta local omitida:", sql, e.message);
            return [];
        }
    },

    // Garantiza la tabla `establecimientos` aunque bases.js todavía no haya sido actualizado
    m_asegurarEsquemaTerritorial: async function() {
        try {
            await this.m_ejecutarSqlLocal(`
                CREATE TABLE IF NOT EXISTS establecimientos (
                    id INTEGER,
                    reg_local TEXT PRIMARY KEY,
                    establecimiento TEXT NOT NULL,
                    razon_social TEXT,
                    cuit TEXT,
                    localidad TEXT,
                    provincia TEXT,
                    domicilio TEXT,
                    responsable TEXT,
                    telefono TEXT,
                    observaciones TEXT,
                    sincronizado INTEGER DEFAULT 0
                )`);
        } catch (e) { /* El puente puede no admitir DDL: bases.js la crea igual */ }
    },

    // ------------------------------------------------------------------
    // Helpers de texto seguro
    // ------------------------------------------------------------------
    m_esc: function(v) {
        return (v === null || v === undefined ? '' : String(v))
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
    // Argumento JS seguro para usar dentro de onclick="..."
    m_js: function(v) {
        return this.m_esc(JSON.stringify(v === null || v === undefined ? '' : String(v)));
    },
    m_norm: function(v) {
        return (v || '').toString().trim().toUpperCase();
    },
    m_fmtHas: function(n) {
        return (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    },

    // Normalizador numérico compatible con "1.0", "1", "Lote 1", "01"
    m_normalizarLoteNumero: function(val) {
        if (val === null || val === undefined) return '';
        const str = val.toString().trim().toUpperCase().replace(/^(LOTE|CUADRO|L)\s*[-_:]?\s*/i, '');
        const num = parseFloat(str);
        return !isNaN(num) ? num.toString() : str;
    },

    // Comparador flexible con soporte para multi-selección de lotes
    m_coincideLote: function(item, est, campo, lotesFiltro) {
        if (!item) return false;

        const limpiar = (val) => (val || '').toString().trim().toUpperCase();

        // 1. Establecimiento
        const estOk = !est || limpiar(item.establecimiento) === limpiar(est);

        // 2. Campo o Sector
        const campoOk = !campo ||
            limpiar(item.campo) === limpiar(campo) ||
            limpiar(item.sector) === limpiar(campo);

        // 3. Lote (Soporta individual, array múltiple o TODOS si está vacío)
        let loteOk = true;
        if (lotesFiltro && Array.isArray(lotesFiltro) && lotesFiltro.length > 0) {
            const lotesNormalizados = lotesFiltro.map(l => this.m_normalizarLoteNumero(l));
            const partesLoteItem = (item.lote || '').toString().split(',').map(s => this.m_normalizarLoteNumero(s));

            loteOk = partesLoteItem.some(p => lotesNormalizados.includes(p)) ||
                     lotesNormalizados.includes(this.m_normalizarLoteNumero(item.lote));
        } else if (lotesFiltro && typeof lotesFiltro === 'string' && lotesFiltro !== '' && lotesFiltro !== 'TODOS') {
            const loteBuscadoNorm = this.m_normalizarLoteNumero(lotesFiltro);
            const partesLoteItem = (item.lote || '').toString().split(',').map(s => this.m_normalizarLoteNumero(s));
            loteOk = partesLoteItem.includes(loteBuscadoNorm) || this.m_normalizarLoteNumero(item.lote) === loteBuscadoNorm;
        }

        // 4. Cultivo (si está activo el filtro de la Solapa 2)
        let cultivoOk = true;
        if (this.filtroCultivoActivo && this.solapaPrincipalActual === 'CULTIVOS_ACTIVOS') {
            cultivoOk = limpiar(item.cultivo) === limpiar(this.filtroCultivoActivo);
        }

        return estOk && campoOk && loteOk && cultivoOk;
    },

    // ------------------------------------------------------------------
    // MODELO TERRITORIAL: fusiona las 4 fuentes sin perder nada
    // ------------------------------------------------------------------

    // Lista de establecimientos: tabla propia + los que aparecen en campos, cuadros e inventario
    m_listarEstablecimientos: function() {
        const mapa = new Map();
        const agregar = (nombre, registro = null) => {
            if (!nombre || !nombre.toString().trim()) return;
            const n = this.m_norm(nombre);
            if (!mapa.has(n)) mapa.set(n, { nombre: nombre.toString().trim(), registro: null });
            if (registro && !mapa.get(n).registro) mapa.get(n).registro = registro;
        };
        this.listaEstablecimientos.forEach(e => agregar(e.establecimiento, e));
        this.rawDataCuadros.forEach(c => agregar(c.establecimiento));
        this.listaCuadros.forEach(c => agregar(c.establecimiento));
        [...this.inventarioActivo, ...this.inventarioHistorial].forEach(i => agregar(i.establecimiento));

        return Array.from(mapa.values()).map(e => {
            const campos = this.m_listarCamposDe(e.nombre);
            return {
                ...e,
                sup: campos.reduce((a, c) => a + c.sup, 0),
                camposCount: campos.length,
                cuadrosCount: campos.reduce((a, c) => a + c.cuadrosCount, 0),
                hasSembradas: this.inventarioActivo
                    .filter(i => this.m_norm(i.establecimiento) === this.m_norm(e.nombre))
                    .reduce((a, i) => a + (parseFloat(i.sup) || 0), 0)
            };
        }).sort((a, b) => a.nombre.localeCompare(b.nombre));
    },

    // Campos de un establecimiento: tabla campos + los que aparecen en cuadros e inventario
    m_listarCamposDe: function(est) {
        if (!est) return [];
        const estN = this.m_norm(est);
        const mapa = new Map();
        const agregar = (nombre, registro = null) => {
            if (!nombre || !nombre.toString().trim()) return;
            const n = this.m_norm(nombre);
            if (!mapa.has(n)) mapa.set(n, { nombre: nombre.toString().trim(), registros: [] });
            if (registro) mapa.get(n).registros.push(registro);
        };
        this.rawDataCuadros.filter(c => this.m_norm(c.establecimiento) === estN).forEach(c => agregar(c.campo, c));
        this.listaCuadros.filter(c => this.m_norm(c.establecimiento) === estN).forEach(c => agregar(c.campo));
        [...this.inventarioActivo, ...this.inventarioHistorial]
            .filter(i => this.m_norm(i.establecimiento) === estN)
            .forEach(i => agregar(i.campo || i.sector));

        return Array.from(mapa.values()).map(c => {
            const cuadros = this.m_obtenerCuadrosDelCampo(est, c.nombre);
            const supCuadros = cuadros.reduce((a, q) => a + (Number(q.sup) || 0), 0);
            // Fila "cabecera" del campo (sin lote). Las filas con lote son del formato anterior.
            const cabecera = c.registros.find(r => !r.lote) || null;
            const registro = cabecera || c.registros[0] || null;
            const supDeclarada = cabecera ? (parseFloat(cabecera.sup_total) || 0) : 0;
            const hasSembradas = this.inventarioActivo
                .filter(i => this.m_coincideLote(i, est, c.nombre, []))
                .reduce((a, i) => a + (parseFloat(i.sup) || 0), 0);
            return {
                nombre: c.nombre,
                registro,
                cabecera,
                registros: c.registros,
                sup: supCuadros > 0 ? supCuadros : supDeclarada,
                supDeclarada,
                cuadrosCount: cuadros.length,
                hasSembradas
            };
        }).sort((a, b) => a.nombre.localeCompare(b.nombre));
    },

    // Fusión de lotes desde 'cuadros', 'campos' (legado) e 'inventario_plantacion'
    m_obtenerCuadrosDelCampo: function(est, campo) {
        if (!campo) return [];
        const norm = (v) => (v || '').toString().trim().toUpperCase();
        const estNorm = norm(est);
        const campoNorm = norm(campo);

        const mapaLotes = new Map();

        // 1. Tabla maestra 'cuadros' (fuente oficial)
        if (this.listaCuadros && this.listaCuadros.length > 0) {
            this.listaCuadros.filter(c =>
                norm(c.campo) === campoNorm &&
                (!c.establecimiento || !estNorm || norm(c.establecimiento) === estNorm)
            ).forEach(c => {
                const lNorm = this.m_normalizarLoteNumero(c.lote);
                if (lNorm) {
                    mapaLotes.set(lNorm, {
                        lote: lNorm,
                        nombre_lote: c.nombre_lote || `Cuadro ${lNorm}`,
                        sup: parseFloat(c.sup) || 0,
                        reg_local: c.reg_local,
                        registro: c,
                        origen: 'cuadros'
                    });
                }
            });
        }

        // 2. Legado: filas de 'campos' que traían un lote cargado
        if (this.rawDataCuadros && this.rawDataCuadros.length > 0) {
            this.rawDataCuadros.filter(c => norm(c.establecimiento) === estNorm && norm(c.campo) === campoNorm && c.lote).forEach(c => {
                const lNorm = this.m_normalizarLoteNumero(c.lote);
                if (lNorm && !mapaLotes.has(lNorm)) {
                    mapaLotes.set(lNorm, {
                        lote: lNorm,
                        nombre_lote: c.nombre_lote || `Lote ${lNorm}`,
                        sup: parseFloat(c.sup_total || c.sup) || 0,
                        reg_local: c.reg_local || c.id || lNorm,
                        registro: c,
                        origen: 'campos'
                    });
                }
            });
        }

        // 3. Lotes que sólo existen por tener siembras en 'inventario_plantacion'
        const todosInventarios = [...(this.inventarioActivo || []), ...(this.inventarioHistorial || [])];
        todosInventarios.forEach(inv => {
            const invEst = norm(inv.establecimiento);
            const invCampo = norm(inv.campo || inv.sector);
            if (invEst === estNorm && invCampo === campoNorm) {
                const lNorm = this.m_normalizarLoteNumero(inv.lote);
                if (lNorm) {
                    if (!mapaLotes.has(lNorm)) {
                        mapaLotes.set(lNorm, {
                            lote: lNorm,
                            nombre_lote: `Lote ${lNorm}`,
                            sup: parseFloat(inv.sup) || 0,
                            reg_local: inv.reg_local || lNorm,
                            registro: null,
                            origen: 'inventario'
                        });
                    } else {
                        const actual = mapaLotes.get(lNorm);
                        if (actual.sup === 0 && parseFloat(inv.sup) > 0) {
                            actual.sup = parseFloat(inv.sup);
                        }
                    }
                }
            }
        });

        return Array.from(mapaLotes.values()).sort((a, b) => {
            const numA = parseFloat(a.lote);
            const numB = parseFloat(b.lote);
            if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
            return a.lote.localeCompare(b.lote);
        });
    },

    m_obtenerResumenCultivosActivos: function(estFiltro = null) {
        const resumen = {};
        let lista = this.inventarioActivo;

        if (estFiltro) {
            const normEst = estFiltro.toString().trim().toUpperCase();
            lista = lista.filter(i => (i.establecimiento || '').toString().trim().toUpperCase() === normEst);
        }

        lista.forEach(i => {
            const c = (i.cultivo || 'SIN ESPECIFICAR').trim().toUpperCase();
            if (!resumen[c]) {
                resumen[c] = { cultivo: c, sup: 0, cantidad: 0, variedades: new Set() };
            }
            resumen[c].sup += (parseFloat(i.sup) || 0);
            resumen[c].cantidad += 1;
            if (i.variedad) resumen[c].variedades.add(i.variedad.trim().toUpperCase());
        });
        return Object.values(resumen).sort((a, b) => b.sup - a.sup);
    },

    m_notificarApple: function(mensaje, tipo = 'exito') {
        if (tipo === 'error') {
            if (window.ComponentesUI && window.ComponentesUI.notifica) {
                return window.ComponentesUI.notifica("⚠️ " + mensaje);
            }
            return alert(mensaje);
        }

        const viejaAlerta = document.getElementById('apple-toast-premium');
        if (viejaAlerta) viejaAlerta.remove();

        const toastHTML = `
            <div id="apple-toast-premium" style="position: fixed; top: 30px; left: 50%; transform: translateX(-50%); background: #FFFFFF; border: 1px solid #E0DCD4; border-radius: 16px; padding: 14px 24px; display: flex; align-items: center; gap: 14px; color: #1D1D1F; font-family: 'Roboto', sans-serif; font-size: 0.88rem; font-weight: 600; box-shadow: 0 6px 14px rgba(20,26,36,0.12); z-index: 100000;">
                <div style="background: rgba(30,107,76,0.1); border: 1px solid #1E6B4C; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #1E6B4C; font-weight: 900;">✓</div>
                <div style="letter-spacing: 0.2px;">${this.m_esc(mensaje)}</div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', toastHTML);

        setTimeout(() => {
            const elemento = document.getElementById('apple-toast-premium');
            if (elemento) {
                elemento.style.transition = "all 0.4s ease";
                elemento.style.opacity = "0";
                elemento.style.transform = "translate(-50%, -20px) scale(0.95)";
                setTimeout(() => elemento.remove(), 400);
            }
        }, 3500);
    },

    m_renderFilasInventario: function(datos, esHistorial = false) {
        if (!datos || datos.length === 0) {
            const mensajeVacio = esHistorial
                ? 'No hay siembras cerradas en el historial para los cuadros seleccionados.'
                : 'No se encontraron siembras activas en los cuadros seleccionados.';
            return `<tr><td colspan="5" class="celda-vacia">${mensajeVacio}</td></tr>`;
        }

        return datos.map(inv => `
            <tr>
                <td>
                    <strong style="color:var(--color-plant-dark); font-size:0.84rem;">🌱 ${this.m_esc((inv.cultivo || '').toUpperCase())}</strong>
                    <div style="font-size:0.7rem; color:var(--color-text-secondary); margin-top:2px;">Var. ${this.m_esc(inv.variedad || 'General')} · <b>Lote ${this.m_esc(inv.lote)}</b></div>
                </td>
                <td style="text-align:right; font-weight:800; color:#1FA958;">${this.m_fmtHas(inv.sup)} Has</td>
                <td style="font-size:0.75rem; color:var(--color-text-secondary);">${this.m_esc(inv.fecha_siembra || inv.fecha_cosecha || '-')}</td>
                <td style="font-size:0.75rem; color:#C62828;">${esHistorial ? this.m_esc(inv.fecha_cierre || '-') : '-'}</td>
                <td style="text-align:center;">
                    <div style="display:inline-flex; gap:6px;">
                        ${esHistorial ? `
                            <button onclick="ModuloCampos.m_reabrirRegistro(${this.m_js(inv.reg_local)})" class="btn-accion-plant" title="Reactivar">↺ Reactivar</button>
                        ` : `
                            <button onclick="ModuloCampos.m_verDetalle(${this.m_js(inv.reg_local)})" class="btn-accion-plant" title="Editar">✏️</button>
                            <button onclick="ModuloCampos.m_abrirModalBaja(${this.m_js(inv.reg_local)})" class="btn-accion-plant" style="color:#C62828; border-color:rgba(198,40,40,0.25);" title="Baja / Cierre">📦 Cerrar</button>
                        `}
                    </div>
                </td>
            </tr>
        `).join('');
    },

    m_inicializar: async function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (visor && !document.getElementById('subseccion-territorio-contenedor')) {
            visor.innerHTML = '<div class="loader-apple" style="font-family: \'Roboto\', sans-serif; text-align: center; padding: 40px; color: #1E6B4C; font-weight: 500; letter-spacing: 0.3px;">Cargando Ecosistema Territorial desde Base Local...</div>';
        }

        try {
            await this.m_asegurarEsquemaTerritorial();

            const [resCampos, resCuadros, resInventario, resVariedades, resEsts] = await Promise.all([
                this.m_ejecutarSqlLocal(`SELECT * FROM campos ORDER BY establecimiento ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM cuadros ORDER BY lote ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM inventario_plantacion`),
                this.m_ejecutarSqlLocal(`SELECT * FROM cultivos_variedades`),
                this.m_consultaSegura(`SELECT * FROM establecimientos ORDER BY establecimiento ASC`)
            ]);

            this.rawDataCuadros = (resCampos.data || []).map(c => ({
                ...c,
                sup: parseFloat(c.sup_total || c.sup) || 0,
                poligono: c.ubicacion || '',
                lote: c.lote ? c.lote.toString().trim() : ''
            }));

            this.listaCuadros = (resCuadros.data || []).map(c => ({
                ...c,
                lote: c.lote ? c.lote.toString() : '1',
                sup: parseFloat(c.sup) || 0,
                nombre_lote: c.nombre_lote || ''
            }));

            this.listaEstablecimientos = resEsts || [];

            const todosLosRegistros = resInventario.data || [];
            this.inventarioActivo = todosLosRegistros.filter(i => (i.estado || 'ACTIVO').trim().toUpperCase() === 'ACTIVO');
            this.inventarioHistorial = todosLosRegistros.filter(i => (i.estado || '').trim().toUpperCase() !== 'ACTIVO');
            this.listaCultivos = resVariedades.data || [];

            // Mantener la selección si sigue existiendo; si no, tomar la primera disponible
            const ests = this.m_listarEstablecimientos().map(e => e.nombre);
            if (!ests.includes(this.seleccionActual.establecimiento)) {
                this.seleccionActual.establecimiento = ests[0] || null;
            }
            const campos = this.m_listarCamposDe(this.seleccionActual.establecimiento).map(c => c.nombre);
            if (!campos.includes(this.seleccionActual.campo)) {
                this.seleccionActual.campo = campos[0] || null;
                this.seleccionActual.lotes = [];
            }

            this.m_dibujarInterfazCompleta();

        } catch (err) {
            console.error("❌ Error en Inicialización Local:", err);
            if (visor) {
                visor.innerHTML = `<div class="error-msg" style="color: #E0342A; padding: 25px; font-family: 'Roboto', sans-serif; background: rgba(224,52,42,0.09); border-radius:12px; border: 1px solid rgba(224,52,42,0.2);">Error de lectura en Base Local: ${this.m_esc(err.message)}</div>`;
            }
        }
    },

    m_cambiarSolapaPrincipal: function(solapa) {
        this.solapaPrincipalActual = solapa;
        if (solapa === 'CULTIVOS_ACTIVOS' && !this.filtroCultivoActivo) {
            const resumen = this.m_obtenerResumenCultivosActivos();
            if (resumen.length > 0) this.filtroCultivoActivo = resumen[0].cultivo;
        }
        this.m_dibujarInterfazCompleta();
    },

    m_htmlKpis: function() {
        const ests = this.m_listarEstablecimientos();
        const totalCampos = ests.reduce((a, e) => a + e.camposCount, 0);
        const totalCuadros = ests.reduce((a, e) => a + e.cuadrosCount, 0);
        const totalHas = ests.reduce((a, e) => a + e.sup, 0);
        const hasSembradas = this.inventarioActivo.reduce((a, c) => a + (parseFloat(c.sup) || 0), 0);
        const ocupacion = totalHas > 0 ? Math.min(100, (hasSembradas / totalHas) * 100) : 0;

        const tile = (icono, label, valor, sub = '') => `
            <div class="kpi-tile">
                <div class="kpi-icono">${icono}</div>
                <div>
                    <div class="kpi-label">${label}</div>
                    <div class="kpi-valor">${valor}</div>
                    ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
                </div>
            </div>`;

        return `
            <div class="kpi-strip">
                ${tile('🏢', 'Establecimientos', ests.length)}
                ${tile('📍', 'Campos', totalCampos)}
                ${tile('▦', 'Cuadros', totalCuadros)}
                ${tile('📐', 'Superficie total', `${this.m_fmtHas(totalHas)} <small>Has</small>`)}
                ${tile('🌱', 'Superficie sembrada', `${this.m_fmtHas(hasSembradas)} <small>Has</small>`)}
                <div class="kpi-tile">
                    <div class="kpi-icono">📊</div>
                    <div style="flex:1;">
                        <div class="kpi-label">Ocupación</div>
                        <div class="kpi-valor">${ocupacion.toFixed(0)}<small>%</small></div>
                        <div class="barra-ocupacion"><span style="width:${ocupacion.toFixed(1)}%;"></span></div>
                    </div>
                </div>
            </div>`;
    },

    m_dibujarInterfazCompleta: function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;

        const totalHasActivas = this.inventarioActivo.reduce((acc, c) => acc + (parseFloat(c.sup) || 0), 0);
        const cantCultivosUnicos = new Set(this.inventarioActivo.map(i => (i.cultivo || '').trim().toUpperCase())).size;
        const estsTotalCount = this.m_listarEstablecimientos().length;

        visor.innerHTML = `
            <style>
                :root {
                    --color-bg: #F5F4F1;
                    --color-surface: #FFFFFF;
                    --color-text: #211C16;
                    --color-text-secondary: #6B6255;
                    --color-border: #E0DCD4;
                    --color-plant: #1E6B4C;
                    --color-plant-dark: #123F2C;
                    --color-plant-soft: rgba(30, 107, 76, 0.10);
                    --color-amber: #E08600;
                    --color-danger: #C62828;
                }

                .salvucci-campos-wrapper {
                    font-family: 'Roboto', -apple-system, sans-serif;
                    background: var(--color-bg);
                    color: var(--color-text);
                    width: 100%;
                    height: calc(100vh - 10px);
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }

                .panel-pro-campos {
                    font-family: 'Roboto', sans-serif;
                    color: #211C16;
                    padding: 8px 16px 12px 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    flex: 1;
                    min-height: 0;
                }

                /* ---------- Barra superior ---------- */
                .topbar-territorial {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    flex-wrap: wrap;
                }
                .topbar-titulo h2 {
                    margin: 0;
                    font-size: 1.15rem;
                    font-weight: 900;
                    color: var(--color-plant-dark);
                    letter-spacing: 0.2px;
                }
                .topbar-titulo p {
                    margin: 1px 0 0;
                    font-size: 0.72rem;
                    color: var(--color-text-secondary);
                }
                .segmentado {
                    display: inline-flex;
                    background: #EAE8E1;
                    border-radius: 10px;
                    padding: 3px;
                    gap: 3px;
                }
                .segmentado button {
                    border: none;
                    background: transparent;
                    padding: 7px 14px;
                    border-radius: 8px;
                    font-family: inherit;
                    font-size: 0.78rem;
                    font-weight: 800;
                    color: var(--color-text-secondary);
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    gap: 7px;
                }
                .segmentado button.active {
                    background: #FFFFFF;
                    color: var(--color-plant-dark);
                    box-shadow: 0 1px 4px rgba(0,0,0,0.08);
                }
                .badge-tab-main {
                    background: var(--color-plant-soft);
                    color: var(--color-plant);
                    padding: 2px 7px;
                    border-radius: 12px;
                    font-size: 0.66rem;
                    font-weight: 800;
                }

                /* ---------- KPIs ---------- */
                .kpi-strip {
                    display: grid;
                    grid-template-columns: repeat(6, minmax(0, 1fr));
                    gap: 10px;
                }
                .kpi-tile {
                    background: #FFFFFF;
                    border: 1px solid var(--color-border);
                    border-radius: 12px;
                    padding: 10px 12px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    min-width: 0;
                }
                .kpi-icono {
                    width: 32px; height: 32px;
                    border-radius: 9px;
                    background: var(--color-plant-soft);
                    color: var(--color-plant);
                    display: flex; align-items: center; justify-content: center;
                    font-size: 0.95rem; flex-shrink: 0;
                }
                .kpi-label {
                    font-size: 0.62rem; font-weight: 800; text-transform: uppercase;
                    color: var(--color-text-secondary); letter-spacing: 0.4px;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .kpi-valor {
                    font-size: 1.12rem; font-weight: 900; color: var(--color-plant-dark);
                    font-variant-numeric: tabular-nums; line-height: 1.2;
                }
                .kpi-valor small { font-size: 0.68rem; font-weight: 700; color: var(--color-text-secondary); margin-left: 2px; }
                .barra-ocupacion {
                    height: 5px; background: #EFEDE7; border-radius: 4px; overflow: hidden; margin-top: 4px;
                }
                .barra-ocupacion span {
                    display: block; height: 100%; background: var(--color-plant); border-radius: 4px;
                }
                .barra-ocupacion.alta span { background: var(--color-amber); }

                @media (max-width: 1250px) {
                    .kpi-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
                }

                /* ---------- Explorador de 3 columnas a pantalla completa ---------- */
                #subseccion-territorio-contenedor {
                    flex: 1;
                    min-height: 0;
                }
                .triple-container-territorio {
                    display: grid;
                    grid-template-columns: 250px 270px minmax(0, 1fr);
                    gap: 12px;
                    height: 100%;
                    min-height: 0;
                }
                @media (max-width: 1200px) {
                    .triple-container-territorio { grid-template-columns: 215px 230px minmax(0, 1fr); }
                }

                .split-container-plant {
                    display: grid;
                    grid-template-columns: 280px minmax(0, 1fr);
                    gap: 12px;
                    height: 100%;
                    min-height: 0;
                }

                .panel-box-plant {
                    background: #FFFFFF;
                    border: 1px solid var(--color-border);
                    border-radius: 14px;
                    padding: 12px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
                    min-height: 0;
                    overflow: hidden;
                }
                .panel-scroll {
                    flex: 1;
                    min-height: 0;
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    padding-right: 2px;
                }
                .panel-scroll-detalle {
                    flex: 1;
                    min-height: 0;
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    padding-right: 4px;
                }
                .panel-cabecera {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 8px;
                }
                .panel-cabecera-titulo {
                    font-size: 0.68rem;
                    font-weight: 800;
                    color: var(--color-plant-dark);
                    text-transform: uppercase;
                    letter-spacing: 0.4px;
                }

                .item-list-selectable {
                    background: #FAFAF8;
                    border: 1px solid var(--color-border);
                    border-radius: 10px;
                    padding: 9px 10px;
                    cursor: pointer;
                    transition: border-color 0.12s ease, background 0.12s ease;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    position: relative;
                }
                .item-list-selectable:hover {
                    border-color: var(--color-plant);
                    background: #FFFFFF;
                }
                .item-list-selectable.active {
                    border-color: var(--color-plant);
                    background: var(--color-plant-soft);
                    box-shadow: inset 4px 0 0 var(--color-plant);
                }
                .item-fila {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 6px;
                }
                .item-nombre {
                    font-size: 0.82rem; font-weight: 800; color: #211C16;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .item-meta { font-size: 0.66rem; color: var(--color-text-secondary); }
                .item-has { font-size: 0.74rem; font-weight: 800; color: var(--color-plant); white-space: nowrap; font-variant-numeric: tabular-nums; }
                .item-acciones { display: none; gap: 2px; }
                .item-list-selectable:hover .item-acciones,
                .item-list-selectable.active .item-acciones { display: inline-flex; }

                .btn-icono {
                    background: transparent;
                    border: 1px solid transparent;
                    border-radius: 6px;
                    color: var(--color-plant);
                    cursor: pointer;
                    font-size: 0.72rem;
                    padding: 2px 5px;
                    line-height: 1;
                }
                .btn-icono:hover { background: #FFFFFF; border-color: var(--color-border); }
                .btn-icono.peligro { color: var(--color-danger); }

                /* ---------- Detalle del campo ---------- */
                .detalle-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    flex-wrap: wrap;
                    gap: 10px;
                    border-bottom: 1px solid var(--color-border);
                    padding-bottom: 10px;
                }
                .breadcrumb {
                    font-size: 0.68rem; font-weight: 700; color: var(--color-text-secondary);
                    text-transform: uppercase; letter-spacing: 0.4px;
                }
                .detalle-header h3 {
                    margin: 2px 0 0; font-size: 1.15rem; font-weight: 900; color: var(--color-plant-dark);
                }
                .chips-info { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
                .chip-info {
                    background: #F5F4F1; border: 1px solid var(--color-border); border-radius: 20px;
                    padding: 3px 9px; font-size: 0.68rem; font-weight: 700; color: var(--color-text-secondary);
                    text-decoration: none;
                }
                a.chip-info:hover { border-color: var(--color-plant); color: var(--color-plant); }

                .grid-cuadros {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(165px, 1fr));
                    gap: 8px;
                }
                .card-cuadro {
                    background: #FFFFFF;
                    border: 1px solid var(--color-border);
                    border-radius: 10px;
                    padding: 9px 10px;
                    cursor: pointer;
                    transition: border-color 0.12s ease, background 0.12s ease, box-shadow 0.12s ease;
                    display: flex;
                    flex-direction: column;
                    gap: 5px;
                    position: relative;
                }
                .card-cuadro:hover { border-color: var(--color-plant); }
                .card-cuadro.selected {
                    background: var(--color-plant-soft);
                    border-color: var(--color-plant);
                    box-shadow: 0 0 0 1px var(--color-plant);
                }
                .card-cuadro.todos { border-style: dashed; }
                .card-cuadro .cc-titulo { font-size: 0.82rem; font-weight: 900; color: var(--color-plant-dark); }
                .card-cuadro .cc-nombre { font-size: 0.66rem; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .card-cuadro .cc-cultivo { font-size: 0.68rem; font-weight: 800; color: #1FA958; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .card-cuadro .cc-cultivo.libre { color: #9AA0A6; font-weight: 600; }
                .tag-origen {
                    font-size: 0.56rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.3px;
                    background: #FFF4E0; color: #9A5B00; border-radius: 4px; padding: 1px 5px;
                }

                .bloque-siembras {
                    background: #FAFAF8;
                    border: 1px solid var(--color-border);
                    border-radius: 12px;
                    padding: 12px;
                }

                .seccion-label {
                    font-size: 0.64rem; font-weight: 800; color: var(--color-text-secondary);
                    text-transform: uppercase; letter-spacing: 0.4px;
                }

                .cards-variedades-grid {
                    display: flex;
                    gap: 8px;
                    overflow-x: auto;
                    padding: 4px 2px 6px 2px;
                    flex-wrap: wrap;
                }
                .card-variedad-item {
                    background: #FFFFFF;
                    border: 1.5px solid var(--color-border);
                    border-radius: 10px;
                    padding: 8px 12px;
                    flex-shrink: 0;
                    min-width: 120px;
                    border-left: 4px solid var(--color-plant);
                    cursor: pointer;
                    transition: border-color 0.12s ease, background 0.12s ease, box-shadow 0.12s ease;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.03);
                }
                .card-variedad-item:hover { border-color: var(--color-plant); }
                .card-variedad-item.selected {
                    background: var(--color-plant-soft);
                    border-color: var(--color-plant);
                    box-shadow: 0 3px 8px rgba(30, 107, 76, 0.18);
                }

                .tabla-cuadros-plant {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 0.82rem;
                }
                .tabla-cuadros-plant th {
                    background: #475569;
                    color: #FFFFFF;
                    font-size: 0.66rem;
                    font-weight: 700;
                    text-transform: uppercase;
                    padding: 8px;
                    text-align: left;
                    letter-spacing: 0.4px;
                    position: sticky;
                    top: 0;
                    z-index: 1;
                }
                .tabla-cuadros-plant td {
                    padding: 7px 8px;
                    border-bottom: 1px solid var(--color-border);
                    color: #211C16;
                }
                .tabla-cuadros-plant tbody tr:hover { background: #F8FAFC; }
                .celda-vacia { text-align:center; padding:20px !important; font-size:0.78rem; font-style:italic; color:#9AA0A6 !important; }

                .btn-accion-plant {
                    background: var(--color-plant-soft);
                    border: 1px solid rgba(30,107,76,0.25);
                    color: var(--color-plant);
                    padding: 4px 8px;
                    border-radius: 6px;
                    font-size: 0.7rem;
                    font-weight: 700;
                    cursor: pointer;
                    transition: background 0.15s;
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    font-family: inherit;
                }
                .btn-accion-plant:hover { background: rgba(30,107,76,0.2); }

                .input-filtro-box {
                    width: 100%;
                    padding: 7px 10px;
                    border-radius: 8px;
                    border: 1px solid var(--color-border);
                    font-size: 0.78rem;
                    outline: none;
                    background: #F8FAFC;
                    box-sizing: border-box;
                    font-family: inherit;
                }
                .input-filtro-box:focus { border-color: var(--color-plant); background: #FFFFFF; }

                .btn-nuevo-box {
                    background: var(--color-plant);
                    color: #FFFFFF;
                    border: none;
                    padding: 6px 11px;
                    border-radius: 7px;
                    font-size: 0.72rem;
                    font-weight: 800;
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    white-space: nowrap;
                    font-family: inherit;
                }
                .btn-nuevo-box:hover { background: var(--color-plant-dark); }

                .btn-exportar-apple {
                    background: #FFFFFF;
                    color: #123F2C;
                    border: 1px solid var(--color-border);
                    padding: 6px 12px;
                    border-radius: 7px;
                    font-size: 0.72rem;
                    font-weight: 800;
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    transition: border-color 0.15s;
                    white-space: nowrap;
                    font-family: inherit;
                }
                .btn-exportar-apple:hover { border-color: var(--color-plant); }

                .opcion-exportar-card {
                    border: 1.5px solid var(--color-border);
                    border-radius: 10px;
                    padding: 12px;
                    cursor: pointer;
                    transition: all 0.15s ease;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    background: #FFFFFF;
                }
                .opcion-exportar-card:hover { border-color: var(--color-plant); background: #F8FAFC; }
                .opcion-exportar-card.active {
                    border-color: var(--color-plant);
                    background: var(--color-plant-soft);
                    border-left: 4px solid var(--color-plant);
                }

                .estado-vacio {
                    text-align:center; padding:24px 14px; font-size:0.76rem; color:#9AA0A6; font-style:italic;
                }
                .estado-vacio .btn-nuevo-box { margin-top: 10px; font-style: normal; }

                /* ---------- Panel lateral (altas / ediciones) ---------- */
                #modal-agrosoft-campos {
                    display: none;
                    position: fixed; inset: 0;
                    background: rgba(20,26,36,0.42);
                    z-index: 99999;
                    justify-content: flex-end;
                    align-items: stretch;
                }
                .drawer-campos {
                    background: #FFFFFF;
                    width: min(560px, 94vw);
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                    box-shadow: -12px 0 30px rgba(0,0,0,0.16);
                    animation: drawerEntrada 0.2s ease-out;
                    font-family: 'Roboto', sans-serif;
                    color: #211C16;
                }
                @keyframes drawerEntrada {
                    from { transform: translateX(40px); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                .drawer-header {
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 18px 22px; border-bottom: 1px solid var(--color-border);
                    border-top: 4px solid var(--color-plant);
                }
                .drawer-header h3 { margin: 0; font-size: 1.05rem; font-weight: 900; color: var(--color-plant-dark); letter-spacing: 0.2px; }
                .drawer-body { flex: 1; overflow-y: auto; padding: 18px 22px; }
                .drawer-footer {
                    display: flex; justify-content: flex-end; gap: 10px;
                    padding: 14px 22px; border-top: 1px solid var(--color-border); background: #FAFAF8;
                }

                .form-seccion { margin-bottom: 18px; }
                .form-seccion-titulo {
                    font-size: 0.66rem; font-weight: 900; color: var(--color-plant); text-transform: uppercase;
                    letter-spacing: 0.5px; margin-bottom: 10px; display: flex; align-items: center; gap: 8px;
                }
                .form-seccion-titulo::after { content: ''; flex: 1; height: 1px; background: var(--color-border); }
                .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
                .form-grid .full { grid-column: 1 / -1; }
                .campo-form label {
                    display: block; font-size: 0.64rem; color: var(--color-text-secondary);
                    text-transform: uppercase; font-weight: 800; margin-bottom: 4px; letter-spacing: 0.3px;
                }
                .campo-form label .req { color: var(--color-danger); }
                .campo-form input, .campo-form select, .campo-form textarea {
                    width: 100%; padding: 9px 11px; border-radius: 8px; border: 1px solid var(--color-border);
                    font-size: 0.86rem; box-sizing: border-box; font-family: inherit; background: #FFFFFF; outline: none;
                }
                .campo-form input:focus, .campo-form select:focus, .campo-form textarea:focus {
                    border-color: var(--color-plant); box-shadow: 0 0 0 3px var(--color-plant-soft);
                }
                .campo-form input[readonly] { background: #F5F4F1; color: var(--color-text-secondary); }
                .campo-form .ayuda { font-size: 0.66rem; color: #9AA0A6; margin-top: 3px; }
                .aviso-form {
                    background: var(--color-plant-soft); border-left: 4px solid var(--color-plant);
                    padding: 10px 12px; border-radius: 8px; font-size: 0.78rem; margin-bottom: 16px; line-height: 1.45;
                }
                .aviso-form.ambar { background: #FFF8E1; border-left-color: #FBC02D; }
                .btn-drawer-sec {
                    background:#FFFFFF; color:#211C16; border:1px solid var(--color-border);
                    padding:9px 16px; border-radius:8px; font-weight:800; cursor:pointer; font-family: inherit; font-size: 0.78rem;
                }
                .btn-drawer-pri {
                    background:var(--color-plant); color:#FFF; padding:9px 22px; border:none;
                    border-radius:8px; font-weight:800; cursor:pointer; font-family: inherit; font-size: 0.78rem;
                }
                .btn-drawer-pri:hover { background: var(--color-plant-dark); }
                .btn-drawer-peligro {
                    background:#FFFFFF; color: var(--color-danger); border:1px solid rgba(198,40,40,0.35);
                    padding:9px 16px; border-radius:8px; font-weight:800; cursor:pointer; font-family: inherit; font-size: 0.78rem;
                    margin-right: auto;
                }
            </style>

            <div class="salvucci-campos-wrapper">
                <div class="panel-pro-campos">
                    ${window.ComponentesUI ? ComponentesUI.botonVolverHTML('PARAMETROS') : ''}

                    <div class="topbar-territorial">
                        <div class="topbar-titulo">
                            <h2>Ecosistema Territorial</h2>
                            <p>Establecimientos › Campos › Cuadros › Siembras</p>
                        </div>
                        <div class="segmentado">
                            <button class="${this.solapaPrincipalActual === 'TERRITORIO' ? 'active' : ''}" onclick="ModuloCampos.m_cambiarSolapaPrincipal('TERRITORIO')">
                                <i data-lucide="map" style="width:14px; height:14px;"></i>
                                <span>Explorador territorial</span>
                                <span class="badge-tab-main">${estsTotalCount} Est.</span>
                            </button>
                            <button class="${this.solapaPrincipalActual === 'CULTIVOS_ACTIVOS' ? 'active' : ''}" onclick="ModuloCampos.m_cambiarSolapaPrincipal('CULTIVOS_ACTIVOS')">
                                <i data-lucide="sprout" style="width:14px; height:14px;"></i>
                                <span>Cultivos activos</span>
                                <span class="badge-tab-main">${cantCultivosUnicos} Cult. · ${this.m_fmtHas(totalHasActivas)} Has</span>
                            </button>
                        </div>
                    </div>

                    <div id="kpi-territorial-contenedor">${this.m_htmlKpis()}</div>

                    <div id="subseccion-territorio-contenedor">
                        ${this.solapaPrincipalActual === 'TERRITORIO' ? this.m_htmlTabExploradorTerritorial() : this.m_htmlTabCultivosActivos()}
                    </div>
                </div>
            </div>

            <!-- PANEL LATERAL (ALTAS Y EDICIONES) -->
            <div id="modal-agrosoft-campos" onclick="if(event.target===this) ModuloCampos.m_cerrarModal()">
                <div class="drawer-campos">
                    <div class="drawer-header">
                        <h3 id="modal-titulo-campos">NUEVO REGISTRO</h3>
                        <span onclick="ModuloCampos.m_cerrarModal()" style="cursor:pointer; opacity:0.6; font-size:1.5rem; font-weight:bold; color:#211C16;">&times;</span>
                    </div>
                    <div id="modal-formulario-campos" class="drawer-body"></div>
                    <div id="modal-footer-campos" class="drawer-footer">
                        <button id="btn-eliminar-campos" class="btn-drawer-peligro" style="display:none;" onclick="ModuloCampos.m_eliminarTerritorial()">🗑 ELIMINAR</button>
                        <button class="btn-drawer-sec" onclick="ModuloCampos.m_cerrarModal()">CANCELAR</button>
                        <button id="btn-guardar-campos" class="btn-drawer-pri" onclick="ModuloCampos.m_guardarRegistro()">GUARDAR</button>
                    </div>
                </div>
            </div>

            <!-- MODAL DE EXPORTACIÓN (EXCEL / PDF) -->
            <div id="modal-exportar-territorio" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(20,26,36,0.55); backdrop-filter:blur(4px); z-index:999999; justify-content:center; align-items:center;">
                <!-- Contenido inyectado dinámicamente -->
            </div>
        `;

        if (this.solapaPrincipalActual === 'TERRITORIO') {
            this.m_actualizarPanelDetalleColumna3();
        }

        if (!this._escListener) {
            this._escListener = (ev) => { if (ev.key === 'Escape') this.m_cerrarModal(); };
            document.addEventListener('keydown', this._escListener);
        }

        if (window.lucide) lucide.createIcons();
    },

    // ------------------------------------------------------------------
    // COLUMNA 1: ESTABLECIMIENTOS
    // ------------------------------------------------------------------
    m_htmlListaEstablecimientos: function() {
        let estData = this.m_listarEstablecimientos();
        if (this.buscadorEstTexto) {
            const t = this.buscadorEstTexto.toLowerCase();
            estData = estData.filter(e => e.nombre.toLowerCase().includes(t));
        }
        const estSel = this.seleccionActual.establecimiento;

        if (estData.length === 0) {
            return `<div class="estado-vacio">${this.buscadorEstTexto ? 'Sin coincidencias.' : 'Todavía no hay establecimientos.'}
                ${this.buscadorEstTexto ? '' : `<div><button class="btn-nuevo-box" onclick="ModuloCampos.m_abrirModal('ESTABLECIMIENTO')">+ Crear el primero</button></div>`}</div>`;
        }

        return estData.map(e => {
            const esActivo = estSel === e.nombre;
            const ocup = e.sup > 0 ? Math.min(100, (e.hasSembradas / e.sup) * 100) : 0;
            const loc = e.registro && e.registro.localidad ? ` · ${this.m_esc(e.registro.localidad)}` : '';
            return `
                <div class="item-list-selectable ${esActivo ? 'active' : ''}" onclick="ModuloCampos.m_seleccionarEstablecimiento(${this.m_js(e.nombre)})">
                    <div class="item-fila">
                        <span class="item-nombre" title="${this.m_esc(e.nombre)}">🏢 ${this.m_esc(e.nombre)}</span>
                        <span class="item-acciones">
                            <button class="btn-icono" title="Editar establecimiento" onclick="event.stopPropagation(); ModuloCampos.m_editarEstablecimiento(${this.m_js(e.nombre)})">✏️</button>
                        </span>
                    </div>
                    <div class="item-fila">
                        <span class="item-meta">${e.camposCount} campo(s) · ${e.cuadrosCount} cuadro(s)${loc}</span>
                        <span class="item-has">${this.m_fmtHas(e.sup)} Has</span>
                    </div>
                    <div class="barra-ocupacion ${ocup > 90 ? 'alta' : ''}" title="${ocup.toFixed(0)}% sembrado"><span style="width:${ocup.toFixed(1)}%;"></span></div>
                </div>`;
        }).join('');
    },

    // ------------------------------------------------------------------
    // COLUMNA 2: CAMPOS
    // ------------------------------------------------------------------
    m_htmlListaCampos: function() {
        const estSel = this.seleccionActual.establecimiento;
        if (!estSel) return '<div class="estado-vacio">Seleccione un establecimiento.</div>';

        let camposData = this.m_listarCamposDe(estSel);
        if (this.buscadorCampoTexto) {
            const tc = this.buscadorCampoTexto.toLowerCase();
            camposData = camposData.filter(c => c.nombre.toLowerCase().includes(tc));
        }
        const campoSel = this.seleccionActual.campo;

        if (camposData.length === 0) {
            return `<div class="estado-vacio">${this.buscadorCampoTexto ? 'Sin coincidencias.' : 'Este establecimiento no tiene campos.'}
                ${this.buscadorCampoTexto ? '' : `<div><button class="btn-nuevo-box" onclick="ModuloCampos.m_abrirModal('CAMPO')">+ Agregar campo</button></div>`}</div>`;
        }

        return camposData.map(c => {
            const esActivo = campoSel === c.nombre;
            const ocup = c.sup > 0 ? Math.min(100, (c.hasSembradas / c.sup) * 100) : 0;
            return `
                <div class="item-list-selectable ${esActivo ? 'active' : ''}" onclick="ModuloCampos.m_seleccionarCampo(${this.m_js(estSel)}, ${this.m_js(c.nombre)})">
                    <div class="item-fila">
                        <span class="item-nombre" title="${this.m_esc(c.nombre)}">📍 ${this.m_esc(c.nombre)}</span>
                        <span class="item-acciones">
                            <button class="btn-icono" title="Editar campo" onclick="event.stopPropagation(); ModuloCampos.m_editarCampoSector(${this.m_js(estSel)}, ${this.m_js(c.nombre)})">✏️</button>
                        </span>
                    </div>
                    <div class="item-fila">
                        <span class="item-meta">${c.cuadrosCount} cuadro(s) · ${this.m_fmtHas(c.hasSembradas)} sembr.</span>
                        <span class="item-has">${this.m_fmtHas(c.sup)} Has</span>
                    </div>
                    <div class="barra-ocupacion ${ocup > 90 ? 'alta' : ''}" title="${ocup.toFixed(0)}% sembrado"><span style="width:${ocup.toFixed(1)}%;"></span></div>
                </div>`;
        }).join('');
    },

    // ------------------------------------------------------------------
    // COLUMNA 3: DETALLE DEL CAMPO + CUADROS + SIEMBRAS
    // ------------------------------------------------------------------
    m_actualizarPanelDetalleColumna3: function() {
        const col3 = document.getElementById('panel-columna-detalle-cuadros');
        if (!col3) return;

        const estSel = this.seleccionActual.establecimiento;
        const campoSel = this.seleccionActual.campo;

        if (!estSel || !campoSel) {
            col3.innerHTML = `
                <div class="estado-vacio" style="margin:auto;">
                    <div style="font-size:2rem; margin-bottom:6px;">🗺️</div>
                    ${!estSel ? 'Creá o seleccioná un establecimiento para comenzar.' : 'Seleccioná un campo para ver sus cuadros y siembras.'}
                    <div>
                        ${!estSel
                            ? `<button class="btn-nuevo-box" onclick="ModuloCampos.m_abrirModal('ESTABLECIMIENTO')">+ Nuevo establecimiento</button>`
                            : `<button class="btn-nuevo-box" onclick="ModuloCampos.m_abrirModal('CAMPO')">+ Nuevo campo</button>`}
                    </div>
                </div>`;
            return;
        }

        const lotesDataCompleta = this.m_obtenerCuadrosDelCampo(estSel, campoSel);
        let lotesData = lotesDataCompleta;
        if (this.buscadorLoteTexto) {
            const t = this.buscadorLoteTexto.toLowerCase();
            lotesData = lotesData.filter(l => l.lote.toLowerCase().includes(t) || (l.nombre_lote || '').toLowerCase().includes(t));
        }
        const lotesSeleccionadosActivos = this.seleccionActual.lotes || [];
        const esTodosSeleccionados = lotesSeleccionadosActivos.length === 0;

        const activosCampo = this.inventarioActivo.filter(i => this.m_coincideLote(i, estSel, campoSel, lotesSeleccionadosActivos));
        const historialCampo = this.inventarioHistorial.filter(i => this.m_coincideLote(i, estSel, campoSel, lotesSeleccionadosActivos));

        const infoCampo = this.m_listarCamposDe(estSel).find(c => c.nombre === campoSel) || { sup: 0, registro: null, hasSembradas: 0 };
        const reg = infoCampo.registro || {};
        const totalHasCampo = infoCampo.sup;
        const hasSembradasCampo = infoCampo.hasSembradas;
        const hasLibres = Math.max(0, totalHasCampo - hasSembradasCampo);
        const ubic = (reg.ubicacion || '').toString().trim();
        const ubicUrl = /^https?:\/\//i.test(ubic) ? ubic : (ubic ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ubic)}` : '');

        col3.innerHTML = `
            <div class="detalle-header">
                <div style="min-width:0;">
                    <div class="breadcrumb">🏢 ${this.m_esc(estSel)} › 📍 Campo</div>
                    <h3>${this.m_esc(campoSel)}</h3>
                    <div class="chips-info">
                        <span class="chip-info">📐 ${this.m_fmtHas(totalHasCampo)} Has</span>
                        <span class="chip-info" style="color:#1FA958;">🌱 ${this.m_fmtHas(hasSembradasCampo)} sembradas</span>
                        <span class="chip-info">◻︎ ${this.m_fmtHas(hasLibres)} libres</span>
                        ${reg.localidad ? `<span class="chip-info">📌 ${this.m_esc(reg.localidad)}${reg.provincia ? ', ' + this.m_esc(reg.provincia) : ''}</span>` : ''}
                        ${ubicUrl ? `<a class="chip-info" href="${this.m_esc(ubicUrl)}" target="_blank" rel="noopener">🧭 Ver ubicación</a>` : ''}
                    </div>
                </div>
                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                    <button class="btn-exportar-apple" onclick="ModuloCampos.m_editarCampoSector(${this.m_js(estSel)}, ${this.m_js(campoSel)})">✏️ Editar campo</button>
                    <button class="btn-exportar-apple" onclick="ModuloCampos.m_abrirModalExportar()" title="Exportar datos territoriales">📤 Exportar</button>
                    <button class="btn-nuevo-box" onclick="ModuloCampos.m_abrirModal('CUADRO')">+ Nuevo cuadro</button>
                </div>
            </div>

            <div class="panel-scroll-detalle">
                <div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; gap:8px;">
                        <span class="seccion-label">Cuadros del campo · tocá para seleccionar uno o varios</span>
                        <input type="text" id="input-buscador-lote" placeholder="🔍 Buscar cuadro..." value="${this.m_esc(this.buscadorLoteTexto)}" oninput="ModuloCampos.m_filtrarBuscadorLote(this.value)" class="input-filtro-box" style="width:170px;">
                    </div>

                    ${lotesDataCompleta.length === 0 ? `
                        <div class="estado-vacio" style="border:1px dashed var(--color-border); border-radius:10px;">
                            Este campo todavía no tiene cuadros cargados.
                            <div><button class="btn-nuevo-box" onclick="ModuloCampos.m_abrirModal('CUADRO')">+ Crear primer cuadro</button></div>
                        </div>
                    ` : `
                        <div class="grid-cuadros">
                            <div class="card-cuadro todos ${esTodosSeleccionados ? 'selected' : ''}" onclick="ModuloCampos.m_seleccionarTodosLotes()">
                                <div class="cc-titulo">🌟 Todos (${lotesDataCompleta.length})</div>
                                <div class="cc-nombre">Vista consolidada del campo</div>
                                <div class="item-fila">
                                    <span class="item-meta">${this.m_fmtHas(totalHasCampo)} Has</span>
                                    <span class="item-meta" style="font-weight:800; color:#1FA958;">${this.inventarioActivo.filter(i => this.m_coincideLote(i, estSel, campoSel, [])).length} act.</span>
                                </div>
                            </div>
                            ${lotesData.map(l => {
                                const lNorm = this.m_normalizarLoteNumero(l.lote);
                                const esSeleccionado = lotesSeleccionadosActivos.includes(lNorm);
                                const siembrasLote = this.inventarioActivo.filter(i => this.m_coincideLote(i, estSel, campoSel, l.lote));
                                const supSembrada = siembrasLote.reduce((a, i) => a + (parseFloat(i.sup) || 0), 0);
                                const ocup = l.sup > 0 ? Math.min(100, (supSembrada / l.sup) * 100) : (supSembrada > 0 ? 100 : 0);
                                const cultivos = [...new Set(siembrasLote.map(i => (i.cultivo || '').toUpperCase()).filter(Boolean))];
                                return `
                                    <div class="card-cuadro ${esSeleccionado ? 'selected' : ''}" onclick="ModuloCampos.m_toggleLoteMulti(${this.m_js(l.lote)})">
                                        <div class="item-fila">
                                            <span class="cc-titulo">Lote ${this.m_esc(l.lote)}</span>
                                            <span style="display:inline-flex; align-items:center; gap:4px;">
                                                ${l.origen !== 'cuadros' ? `<span class="tag-origen" title="Este lote no está en la tabla cuadros. Editalo para registrarlo.">sin ficha</span>` : ''}
                                                <button class="btn-icono" title="Editar cuadro" onclick="event.stopPropagation(); ModuloCampos.m_editarLote(${this.m_js(l.lote)});">✏️</button>
                                            </span>
                                        </div>
                                        <div class="cc-nombre" title="${this.m_esc(l.nombre_lote)}">${this.m_esc(l.nombre_lote)}</div>
                                        <div class="cc-cultivo ${cultivos.length ? '' : 'libre'}">${cultivos.length ? '🌱 ' + this.m_esc(cultivos.join(' · ')) : 'Libre'}</div>
                                        <div class="barra-ocupacion ${ocup > 90 ? 'alta' : ''}"><span style="width:${ocup.toFixed(1)}%;"></span></div>
                                        <div class="item-fila">
                                            <span class="item-meta">${this.m_fmtHas(supSembrada)} / ${this.m_fmtHas(l.sup)} Has</span>
                                            <span class="item-meta" style="font-weight:800; color:${siembrasLote.length > 0 ? '#1FA958' : '#9AA0A6'};">${siembrasLote.length} act.</span>
                                        </div>
                                    </div>`;
                            }).join('')}
                        </div>
                        ${lotesData.length === 0 ? '<div class="estado-vacio">Ningún cuadro coincide con la búsqueda.</div>' : ''}
                    `}
                </div>

                <div class="bloque-siembras">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; gap:8px; flex-wrap:wrap;">
                        <strong style="font-size:0.9rem; color:var(--color-plant-dark);">
                            ${esTodosSeleccionados ? `Siembras de todos los cuadros de ${this.m_esc(campoSel)}` : `Siembras · Lote(s) ${this.m_esc(lotesSeleccionadosActivos.join(', '))}`}
                        </strong>
                        <div style="display:flex; gap:6px; align-items:center;">
                            <div class="tabs-archivero-campos" style="display:flex; gap:6px;">
                                <button type="button" class="btn-accion-plant" style="${this.vistaInventarioActual === 'ACTIVOS' ? 'background:var(--color-plant); color:#FFF;' : ''}" onclick="ModuloCampos.m_cambiarVistaInventario('ACTIVOS')">
                                    ACTIVAS (${activosCampo.length})
                                </button>
                                <button type="button" class="btn-accion-plant" style="${this.vistaInventarioActual === 'HISTORIAL' ? 'background:var(--color-plant); color:#FFF;' : ''}" onclick="ModuloCampos.m_cambiarVistaInventario('HISTORIAL')">
                                    HISTORIAL (${historialCampo.length})
                                </button>
                            </div>
                            <button onclick="ModuloCampos.m_abrirModal('INVENTARIO')" class="btn-nuevo-box" ${lotesDataCompleta.length === 0 ? 'disabled style="opacity:0.5; cursor:not-allowed;" title="Primero cargá un cuadro"' : ''}>
                                🌱 Nueva siembra
                            </button>
                        </div>
                    </div>

                    <div style="overflow-x:auto; border-radius:8px; border:1px solid var(--color-border); background:#FFFFFF;">
                        <table class="tabla-cuadros-plant">
                            <thead>
                                <tr>
                                    <th>Cultivo & Variedad</th>
                                    <th style="text-align:right;">Superficie</th>
                                    <th>F. Siembra</th>
                                    <th>F. Cierre</th>
                                    <th style="text-align:center;">Acciones</th>
                                </tr>
                            </thead>
                            <tbody id="tbody-inventario">
                                ${this.m_renderFilasInventario(this.vistaInventarioActual === 'HISTORIAL' ? historialCampo : activosCampo, this.vistaInventarioActual === 'HISTORIAL')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    },

    m_htmlTabExploradorTerritorial: function() {
        return `
            <div class="triple-container-territorio">
                <div class="panel-box-plant" id="panel-columna-establecimientos">
                    <div class="panel-cabecera">
                        <span class="panel-cabecera-titulo">🏢 Establecimientos</span>
                        <button class="btn-nuevo-box" onclick="ModuloCampos.m_abrirModal('ESTABLECIMIENTO')" title="Nuevo establecimiento">+ Nuevo</button>
                    </div>
                    <input type="text" id="input-buscador-est" placeholder="🔍 Buscar establecimiento..." value="${this.m_esc(this.buscadorEstTexto)}" oninput="ModuloCampos.m_filtrarBuscadorEst(this.value)" class="input-filtro-box">
                    <div class="panel-scroll" id="lista-establecimientos">
                        ${this.m_htmlListaEstablecimientos()}
                    </div>
                </div>

                <div class="panel-box-plant" id="panel-columna-campos">
                    <div class="panel-cabecera">
                        <span class="panel-cabecera-titulo">📍 Campos</span>
                        <button class="btn-nuevo-box" onclick="ModuloCampos.m_abrirModal('CAMPO')" title="Nuevo campo" ${this.seleccionActual.establecimiento ? '' : 'disabled style="opacity:0.5; cursor:not-allowed;"'}>+ Nuevo</button>
                    </div>
                    <input type="text" id="input-buscador-campo" placeholder="🔍 Buscar campo..." value="${this.m_esc(this.buscadorCampoTexto)}" oninput="ModuloCampos.m_filtrarBuscadorCampo(this.value)" class="input-filtro-box">
                    <div class="panel-scroll" id="lista-campos">
                        ${this.m_htmlListaCampos()}
                    </div>
                </div>

                <div class="panel-box-plant" id="panel-columna-detalle-cuadros">
                    <!-- Dinámico -->
                </div>
            </div>
        `;
    },

    m_htmlTabCultivosActivos: function() {
        const resumenCultivos = this.m_obtenerResumenCultivosActivos();
        const cultivoSeleccionado = this.filtroCultivoActivo || (resumenCultivos[0] ? resumenCultivos[0].cultivo : null);

        let siembrasDelCultivo = this.inventarioActivo;
        if (cultivoSeleccionado && cultivoSeleccionado !== 'TODOS') {
            siembrasDelCultivo = siembrasDelCultivo.filter(i => (i.cultivo || '').trim().toUpperCase() === cultivoSeleccionado.trim().toUpperCase());
        }

        const variedadesDelCultivo = [...new Set(siembrasDelCultivo.map(i => (i.variedad || 'GENERAL').trim().toUpperCase()))];

        if (this.filtroVariedadActiva) {
            siembrasDelCultivo = siembrasDelCultivo.filter(i => (i.variedad || 'GENERAL').trim().toUpperCase() === this.filtroVariedadActiva.trim().toUpperCase());
        }

        if (this.filtroEstablecimientoCultivoTab) {
            siembrasDelCultivo = siembrasDelCultivo.filter(i => (i.establecimiento || '').trim().toUpperCase() === this.filtroEstablecimientoCultivoTab.trim().toUpperCase());
        }

        if (this.buscadorCultivoTexto) {
            const txt = this.buscadorCultivoTexto.toLowerCase();
            siembrasDelCultivo = siembrasDelCultivo.filter(i =>
                (i.campo || '').toLowerCase().includes(txt) ||
                (i.establecimiento || '').toLowerCase().includes(txt) ||
                (i.lote || '').toString().toLowerCase().includes(txt) ||
                (i.variedad || '').toLowerCase().includes(txt)
            );
        }

        const totalHasCultivoSel = siembrasDelCultivo.reduce((acc, c) => acc + (parseFloat(c.sup) || 0), 0);
        const estsDisponibles = [...new Set(this.inventarioActivo.map(i => i.establecimiento).filter(Boolean))].sort();

        return `
            <div class="split-container-plant">
                <div class="panel-box-plant">
                    <div class="panel-cabecera-titulo">Cultivos en producción (${resumenCultivos.length})</div>

                    <div class="panel-scroll">
                        <div class="item-list-selectable ${!this.filtroCultivoActivo || this.filtroCultivoActivo === 'TODOS' ? 'active' : ''}" onclick="ModuloCampos.m_seleccionarCultivoTab('TODOS')">
                            <div class="item-fila">
                                <span class="item-nombre">🌍 Todos los cultivos</span>
                                <span class="item-has">${this.m_fmtHas(this.inventarioActivo.reduce((a,c)=>a+(parseFloat(c.sup)||0),0))} Has</span>
                            </div>
                            <div class="item-meta">Consolidado global</div>
                        </div>

                        ${resumenCultivos.map(c => {
                            const esActivo = cultivoSeleccionado === c.cultivo && this.filtroCultivoActivo !== 'TODOS' && this.filtroCultivoActivo;
                            return `
                                <div class="item-list-selectable ${esActivo ? 'active' : ''}" onclick="ModuloCampos.m_seleccionarCultivoTab(${this.m_js(c.cultivo)})">
                                    <div class="item-fila">
                                        <span class="item-nombre">🌱 ${this.m_esc(c.cultivo)}</span>
                                        <span class="item-has">${this.m_fmtHas(c.sup)} Has</span>
                                    </div>
                                    <div class="item-meta">${c.cantidad} lote(s) · ${c.variedades.size} var.</div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>

                <div class="panel-box-plant">
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; border-bottom:1px solid var(--color-border); padding-bottom:10px;">
                        <div>
                            <h3 style="margin:0; font-size:1.12rem; font-weight:900; color:var(--color-plant-dark);">
                                🌱 ${cultivoSeleccionado === 'TODOS' || !cultivoSeleccionado || !this.filtroCultivoActivo ? 'Todos los cultivos activos' : this.m_esc(cultivoSeleccionado)}
                            </h3>
                            <p style="margin:2px 0 0 0; font-size:0.75rem; color:var(--color-text-secondary);">
                                ${siembrasDelCultivo.length} cuadro(s) implantados · <strong>${this.m_fmtHas(totalHasCultivoSel)} hectáreas</strong>
                            </p>
                        </div>

                        <div style="display:flex; gap:8px; align-items:center;">
                            <input type="text" id="input-buscador-cultivo" placeholder="🔍 Buscar lote, campo..." value="${this.m_esc(this.buscadorCultivoTexto)}" oninput="ModuloCampos.m_filtrarTextoCultivoTab(this.value)" class="input-filtro-box" style="width:200px;">
                            <select onchange="ModuloCampos.m_filtrarEstablecimientoCultivoTab(this.value)" class="input-filtro-box" style="width:auto; background:#FFFFFF; font-weight:700; cursor:pointer;">
                                <option value="">🏢 Todos los establecimientos</option>
                                ${estsDisponibles.map(e => `<option value="${this.m_esc(e)}" ${this.filtroEstablecimientoCultivoTab === e ? 'selected' : ''}>${this.m_esc(e)}</option>`).join('')}
                            </select>
                        </div>
                    </div>

                    <div class="panel-scroll-detalle">
                        ${variedadesDelCultivo.length > 1 ? `
                            <div>
                                <div class="seccion-label" style="margin-bottom:4px;">Filtrar por variedad</div>
                                <div class="cards-variedades-grid">
                                    <div class="card-variedad-item ${!this.filtroVariedadActiva ? 'selected' : ''}" onclick="ModuloCampos.m_seleccionarVariedadTab('')">
                                        <div style="font-size:0.78rem; font-weight:800; color:var(--color-plant-dark);">TODAS LAS VARIEDADES</div>
                                        <div style="font-size:0.68rem; color:var(--color-text-secondary);">${siembrasDelCultivo.length} lotes</div>
                                    </div>
                                    ${variedadesDelCultivo.map(v => {
                                        const esSel = this.filtroVariedadActiva === v;
                                        const itemsVar = siembrasDelCultivo.filter(i => (i.variedad || 'GENERAL').trim().toUpperCase() === v);
                                        const hasVar = itemsVar.reduce((a,c)=>a+(parseFloat(c.sup)||0),0);
                                        return `
                                            <div class="card-variedad-item ${esSel ? 'selected' : ''}" onclick="ModuloCampos.m_seleccionarVariedadTab(${this.m_js(v)})">
                                                <div style="font-size:0.8rem; font-weight:800; color:var(--color-plant-dark);">🧬 ${this.m_esc(v)}</div>
                                                <div style="font-size:0.68rem; color:var(--color-text-secondary);">${this.m_fmtHas(hasVar)} Has · ${itemsVar.length} lote(s)</div>
                                            </div>
                                        `;
                                    }).join('')}
                                </div>
                            </div>
                        ` : ''}

                        <div style="overflow-x:auto; border-radius:10px; border:1px solid var(--color-border);">
                            <table class="tabla-cuadros-plant">
                                <thead>
                                    <tr>
                                        <th>Establecimiento</th>
                                        <th>Campo / Sector</th>
                                        <th>Lote / Cuadro</th>
                                        <th>Cultivo</th>
                                        <th>Variedad</th>
                                        <th style="text-align:right;">Superficie</th>
                                        <th>F. Siembra</th>
                                        <th style="text-align:center;">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${siembrasDelCultivo.map(i => `
                                        <tr>
                                            <td><strong>${this.m_esc((i.establecimiento || '-').toUpperCase())}</strong></td>
                                            <td>${this.m_esc(i.campo || i.sector || '-')}</td>
                                            <td><span style="background:var(--color-plant-soft); color:var(--color-plant-dark); padding:2px 8px; border-radius:6px; font-weight:800; font-size:0.72rem;">Lote ${this.m_esc(i.lote)}</span></td>
                                            <td style="font-weight:700;">${this.m_esc((i.cultivo || '-').toUpperCase())}</td>
                                            <td>${this.m_esc(i.variedad || 'General')}</td>
                                            <td style="text-align:right; font-weight:800; color:#1FA958;">${this.m_fmtHas(i.sup)} Has</td>
                                            <td style="font-size:0.75rem; color:var(--color-text-secondary);">${this.m_esc(i.fecha_siembra || i.fecha_cosecha || '-')}</td>
                                            <td style="text-align:center;">
                                                <div style="display:inline-flex; gap:6px;">
                                                    <button class="btn-accion-plant" onclick="ModuloCampos.m_irALoteDesdeCultivos(${this.m_js(i.establecimiento)}, ${this.m_js(i.campo || i.sector || '')}, ${this.m_js(i.lote)})" title="Ver en explorador territorial">🗺️ Ver lote</button>
                                                    <button class="btn-accion-plant" onclick="ModuloCampos.m_verDetalle(${this.m_js(i.reg_local)})" title="Editar siembra">✏️</button>
                                                </div>
                                            </td>
                                        </tr>
                                    `).join('')}
                                    ${siembrasDelCultivo.length === 0 ? '<tr><td colspan="8" class="celda-vacia">No hay lotes que coincidan con los filtros seleccionados.</td></tr>' : ''}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    m_seleccionarTodosLotes: function() {
        this.seleccionActual.lotes = [];
        this.m_actualizarPanelDetalleColumna3();
    },

    m_toggleLoteMulti: function(lote) {
        const lNorm = this.m_normalizarLoteNumero(lote);
        let lotesActuales = [...(this.seleccionActual.lotes || [])];

        if (lotesActuales.includes(lNorm)) {
            lotesActuales = lotesActuales.filter(l => l !== lNorm);
        } else {
            lotesActuales.push(lNorm);
        }

        this.seleccionActual.lotes = lotesActuales;
        this.m_actualizarPanelDetalleColumna3();
    },

    // Re-dibuja solo las listas (mantiene el foco del buscador)
    m_refrescarListas: function() {
        const le = document.getElementById('lista-establecimientos');
        const lc = document.getElementById('lista-campos');
        if (!le || !lc) return this.m_dibujarInterfazCompleta();
        le.innerHTML = this.m_htmlListaEstablecimientos();
        lc.innerHTML = this.m_htmlListaCampos();
        const btnCampo = document.querySelector('#panel-columna-campos .btn-nuevo-box');
        if (btnCampo) {
            btnCampo.disabled = !this.seleccionActual.establecimiento;
            btnCampo.style.opacity = this.seleccionActual.establecimiento ? '1' : '0.5';
            btnCampo.style.cursor = this.seleccionActual.establecimiento ? 'pointer' : 'not-allowed';
        }
    },

    m_seleccionarEstablecimiento: function(est) {
        this.seleccionActual.establecimiento = est;
        const campos = this.m_listarCamposDe(est);
        this.seleccionActual.campo = campos.length > 0 ? campos[0].nombre : null;
        this.seleccionActual.lotes = [];
        this.buscadorCampoTexto = '';
        const inp = document.getElementById('input-buscador-campo');
        if (inp) inp.value = '';
        this.m_refrescarListas();
        this.m_actualizarPanelDetalleColumna3();
    },

    m_seleccionarCampo: function(est, campo) {
        this.seleccionActual.establecimiento = est;
        this.seleccionActual.campo = campo;
        this.seleccionActual.lotes = [];
        this.buscadorLoteTexto = '';
        this.m_refrescarListas();
        this.m_actualizarPanelDetalleColumna3();
    },

    m_filtrarBuscadorEst: function(txt) {
        this.buscadorEstTexto = txt || '';
        const le = document.getElementById('lista-establecimientos');
        if (le) le.innerHTML = this.m_htmlListaEstablecimientos();
    },

    m_filtrarBuscadorCampo: function(txt) {
        this.buscadorCampoTexto = txt || '';
        const lc = document.getElementById('lista-campos');
        if (lc) lc.innerHTML = this.m_htmlListaCampos();
    },

    m_filtrarBuscadorLote: function(txt) {
        this.buscadorLoteTexto = txt || '';
        this.m_actualizarPanelDetalleColumna3();
        const inp = document.getElementById('input-buscador-lote');
        if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    },

    m_seleccionarCultivoTab: function(cultivo) {
        this.filtroCultivoActivo = cultivo === 'TODOS' ? null : cultivo;
        this.filtroVariedadActiva = null;
        this.m_dibujarInterfazCompleta();
    },

    m_seleccionarVariedadTab: function(variedad) {
        this.filtroVariedadActiva = variedad || null;
        this.m_dibujarInterfazCompleta();
    },

    m_filtrarEstablecimientoCultivoTab: function(est) {
        this.filtroEstablecimientoCultivoTab = est || '';
        this.m_dibujarInterfazCompleta();
    },

    m_filtrarTextoCultivoTab: function(txt) {
        this.buscadorCultivoTexto = txt || '';
        this.m_dibujarInterfazCompleta();
        const inp = document.getElementById('input-buscador-cultivo');
        if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    },

    m_irALoteDesdeCultivos: function(est, campo, lote) {
        this.solapaPrincipalActual = 'TERRITORIO';
        this.seleccionActual = { establecimiento: est, campo: campo, lotes: [this.m_normalizarLoteNumero(lote)] };
        this.filtroCultivoActivo = null;
        this.m_dibujarInterfazCompleta();
    },

    m_cambiarVistaInventario: function(vista) {
        this.vistaInventarioActual = vista;
        const activosCampo = (this.seleccionActual.establecimiento && this.seleccionActual.campo)
            ? this.inventarioActivo.filter(i => this.m_coincideLote(i, this.seleccionActual.establecimiento, this.seleccionActual.campo, this.seleccionActual.lotes))
            : [];
        const historialCampo = (this.seleccionActual.establecimiento && this.seleccionActual.campo)
            ? this.inventarioHistorial.filter(i => this.m_coincideLote(i, this.seleccionActual.establecimiento, this.seleccionActual.campo, this.seleccionActual.lotes))
            : [];

        const tbody = document.getElementById('tbody-inventario');
        if (tbody) {
            tbody.innerHTML = this.m_renderFilasInventario(vista === 'HISTORIAL' ? historialCampo : activosCampo, vista === 'HISTORIAL');
        }

        document.querySelectorAll('.tabs-archivero-campos button').forEach((btn, idx) => {
            const activo = (idx === 0 && vista === 'ACTIVOS') || (idx === 1 && vista === 'HISTORIAL');
            btn.style.background = activo ? 'var(--color-plant)' : '';
            btn.style.color = activo ? '#FFF' : '';
        });
    },

    configExportacionActual: { 
        estSeleccionado: '', 
        camposSeleccionados: [], 
        formato: 'EXCEL' 
    },

    m_abrirModalExportar: function() {
        const ests = this.m_listarEstablecimientos().map(e => e.nombre);
        const estInicial = this.seleccionActual.establecimiento || (ests.length > 0 ? ests[0] : '');

        this.configExportacionActual = {
            estSeleccionado: estInicial,
            camposSeleccionados: [],
            formato: 'EXCEL'
        };

        const modal = document.getElementById('modal-exportar-territorio');
        if (modal) {
            modal.style.display = 'flex';
            this.m_renderContenidoModalExportar();
        }
    },

    m_cerrarModalExportar: function() {
        const modal = document.getElementById('modal-exportar-territorio');
        if (modal) modal.style.display = 'none';
    },

    m_cambiarEstablecimientoExport: function(nuevoEst) {
        this.configExportacionActual.estSeleccionado = nuevoEst;
        this.configExportacionActual.camposSeleccionados = [];
        this.m_renderContenidoModalExportar();
    },

    m_toggleCampoExport: function(nombreCampo) {
        let campos = [...this.configExportacionActual.camposSeleccionados];
        const idx = campos.indexOf(nombreCampo);
        if (idx > -1) {
            campos.splice(idx, 1);
        } else {
            campos.push(nombreCampo);
        }
        this.configExportacionActual.camposSeleccionados = campos;
        this.m_renderContenidoModalExportar();
    },

    m_toggleTodosCamposExport: function(seleccionarTodos) {
        const est = this.configExportacionActual.estSeleccionado;
        const todos = this.m_listarCamposDe(est).map(c => c.nombre);
        this.configExportacionActual.camposSeleccionados = seleccionarTodos ? todos : [];
        this.m_renderContenidoModalExportar();
    },

    m_setFormatoExport: function(formato) {
        this.configExportacionActual.formato = formato;
        document.getElementById('opt-formato-excel')?.classList.toggle('active', formato === 'EXCEL');
        document.getElementById('opt-formato-pdf')?.classList.toggle('active', formato === 'PDF');
    },

    m_renderContenidoModalExportar: function() {
        const ests = this.m_listarEstablecimientos().map(e => e.nombre);
        const estActual = this.configExportacionActual.estSeleccionado;
        const camposDisponibles = this.m_listarCamposDe(estActual).map(c => c.nombre);
        const seleccionados = this.configExportacionActual.camposSeleccionados;
        const esTodos = seleccionados.length === 0 || seleccionados.length === camposDisponibles.length;

        const container = document.getElementById('modal-exportar-territorio');
        if (!container) return;

        container.innerHTML = `
            <div style="background:#FFFFFF; border:1px solid var(--color-border); border-radius:16px; padding:24px; width:92%; max-width:520px; box-shadow:0 20px 40px rgba(0,0,0,0.18); font-family:'Roboto', sans-serif;">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1.5px solid var(--color-border); padding-bottom:12px; margin-bottom:16px;">
                    <div>
                        <h3 style="margin:0; font-size:1.15rem; font-weight:900; color:var(--color-plant-dark);">📤 CENTRO DE EXPORTACIÓN</h3>
                        <p style="margin:2px 0 0; font-size:0.75rem; color:var(--color-text-secondary);">Selecciona establecimiento, campos y formato</p>
                    </div>
                    <span onclick="ModuloCampos.m_cerrarModalExportar()" style="cursor:pointer; font-size:1.4rem; font-weight:bold; color:#6B6255;">&times;</span>
                </div>

                <div style="margin-bottom:14px;">
                    <label style="font-size:0.68rem; font-weight:800; color:var(--color-plant-dark); text-transform:uppercase; display:block; margin-bottom:6px;">1. Establecimiento</label>
                    <select onchange="ModuloCampos.m_cambiarEstablecimientoExport(this.value)" style="width:100%; padding:9px 12px; border-radius:8px; border:1.5px solid var(--color-border); font-size:0.85rem; font-weight:700; color:#211C16; background:#FFFFFF; outline:none; cursor:pointer;">
                        ${ests.map(e => `<option value="${e}" ${e === estActual ? 'selected' : ''}>🏢 ${e}</option>`).join('')}
                    </select>
                </div>

                <div style="margin-bottom:14px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <label style="font-size:0.68rem; font-weight:800; color:var(--color-plant-dark); text-transform:uppercase;">
                            2. Campos a Incluir (${seleccionados.length === 0 ? 'TODOS' : seleccionados.length + ' selecc.'})
                        </label>
                        <div style="display:flex; gap:6px;">
                            <button type="button" onclick="ModuloCampos.m_toggleTodosCamposExport(true)" style="background:transparent; border:none; color:var(--color-plant); font-size:0.68rem; font-weight:800; cursor:pointer;">Seleccionar todos</button>
                            <span style="color:var(--color-border);">|</span>
                            <button type="button" onclick="ModuloCampos.m_toggleTodosCamposExport(false)" style="background:transparent; border:none; color:#C62828; font-size:0.68rem; font-weight:800; cursor:pointer;">Limpiar</button>
                        </div>
                    </div>

                    <div style="display:flex; flex-wrap:wrap; gap:8px; max-height:130px; overflow-y:auto; padding:6px; border:1px solid var(--color-border); border-radius:8px; background:#F8FAFC;">
                        ${camposDisponibles.map(c => {
                            const estaSel = esTodos || seleccionados.includes(c);
                            return `
                                <div onclick="ModuloCampos.m_toggleCampoExport('${c.replace(/'/g, "\\'")}')" 
                                     style="padding:6px 12px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:6px; transition:all 0.15s ease; ${estaSel ? 'background:var(--color-plant-soft); border:1.5px solid var(--color-plant); color:var(--color-plant-dark);' : 'background:#FFFFFF; border:1.5px solid var(--color-border); color:#6B6255;'}">
                                    <span>${estaSel ? '✓' : '+'}</span>
                                    <span>📍 ${c}</span>
                                </div>
                            `;
                        }).join('')}
                        ${camposDisponibles.length === 0 ? '<div style="font-size:0.75rem; color:#9AA0A6; font-style:italic; padding:6px;">Sin campos registrados en este establecimiento.</div>' : ''}
                    </div>
                </div>

                <div style="margin-bottom:18px;">
                    <label style="font-size:0.68rem; font-weight:800; color:var(--color-plant-dark); text-transform:uppercase; display:block; margin-bottom:8px;">3. Formato de Salida</label>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                        <div class="opcion-exportar-card ${this.configExportacionActual.formato === 'EXCEL' ? 'active' : ''}" id="opt-formato-excel" onclick="ModuloCampos.m_setFormatoExport('EXCEL')">
                            <div style="font-size:1.4rem;">📊</div>
                            <div>
                                <strong style="font-size:0.84rem; color:#1FA958;">EXCEL</strong>
                                <div style="font-size:0.68rem; color:var(--color-text-secondary);">Planilla .XLSX profesional</div>
                            </div>
                        </div>
                        <div class="opcion-exportar-card ${this.configExportacionActual.formato === 'PDF' ? 'active' : ''}" id="opt-formato-pdf" onclick="ModuloCampos.m_setFormatoExport('PDF')">
                            <div style="font-size:1.4rem;">📑</div>
                            <div>
                                <strong style="font-size:0.84rem; color:#E0342A;">PDF</strong>
                                <div style="font-size:0.68rem; color:var(--color-text-secondary);">Reporte visual para imprimir</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--color-border); padding-top:14px;">
                    <button onclick="ModuloCampos.m_cerrarModalExportar()" style="background:#F0F2F5; color:#211C16; border:1px solid var(--color-border); padding:8px 16px; border-radius:8px; font-weight:700; cursor:pointer;">CANCELAR</button>
                    <button onclick="ModuloCampos.m_ejecutarExportacionConsolidada()" style="background:var(--color-plant); color:#FFFFFF; border:none; padding:8px 24px; border-radius:8px; font-weight:800; cursor:pointer;">
                        GENERAR REPORTE
                    </button>
                </div>
            </div>
        `;
    },

    m_ejecutarExportacionConsolidada: function() {
        const { estSeleccionado, camposSeleccionados, formato } = this.configExportacionActual;
        this.m_cerrarModalExportar();

        if (formato === 'EXCEL') {
            this.m_exportarExcelPersonalizado(estSeleccionado, camposSeleccionados);
        } else {
            this.m_exportarPDFPersonalizado(estSeleccionado, camposSeleccionados);
        }
    },

    m_exportarExcelPersonalizado: async function(estSel, camposFiltro = []) {
        if (!estSel) return this.m_notificarApple ? this.m_notificarApple("Seleccione un establecimiento.", "error") : alert("Seleccione un establecimiento.");

        let activos = this.inventarioActivo.filter(i => (i.establecimiento || '').trim().toUpperCase() === estSel.trim().toUpperCase());
        let historial = this.inventarioHistorial.filter(i => (i.establecimiento || '').trim().toUpperCase() === estSel.trim().toUpperCase());

        if (camposFiltro && camposFiltro.length > 0) {
            const setCampos = new Set(camposFiltro.map(c => c.trim().toUpperCase()));
            activos = activos.filter(i => setCampos.has((i.campo || i.sector || '').trim().toUpperCase()));
            historial = historial.filter(i => setCampos.has((i.campo || i.sector || '').trim().toUpperCase()));
        }

        if (activos.length === 0 && historial.length === 0) {
            return this.m_notificarApple ? this.m_notificarApple("No hay datos de siembra para los campos seleccionados.", "error") : alert("No hay datos para exportar.");
        }

        // 1. Detección universal de ExcelJS
        let ExcelJS = null;
        if (typeof window !== 'undefined' && window.ExcelJS) {
            ExcelJS = window.ExcelJS;
        } else if (typeof require === 'function') {
            try { ExcelJS = require('exceljs'); } catch (e) { ExcelJS = null; }
        }

        // Si ExcelJS no está, emitir CSV compatible inmediatamente
        if (!ExcelJS) {
            return this.m_exportarCsvFallback(estSel, camposFiltro, activos, historial);
        }

        const esElectron = typeof require === 'function' && typeof process !== 'undefined';
        const folio = generarFolio('TER');
        const hoyStr = new Date().toISOString().split('T')[0];
        const operario = (typeof operarioName !== 'undefined' ? operarioName : (window.operarioGlobal || 'ADMINISTRADOR')).toUpperCase();

        const columnas = [
            { header: 'CAMPO / SECTOR', key: 'campo', width: 24 },
            { header: 'LOTE', key: 'lote', width: 12, halign: 'center' },
            { header: 'CULTIVO', key: 'cultivo', width: 20 },
            { header: 'VARIEDAD', key: 'variedad', width: 20 },
            { header: 'SUPERFICIE (HAS)', key: 'sup', width: 18, halign: 'right', numero: true, destacada: true },
            { header: 'FECHA SIEMBRA', key: 'fecha_siembra', width: 16, halign: 'center' },
            { header: 'ESTADO', key: 'estado', width: 15, halign: 'center' }
        ];

        const filasActivos = activos.map(i => ({
            campo: (i.campo || i.sector || 'GENERAL').toUpperCase(),
            lote: `Lote ${i.lote || '-'}`,
            cultivo: (i.cultivo || '-').toUpperCase(),
            variedad: i.variedad || 'GENERAL',
            sup: parseFloat(i.sup) || 0,
            fecha_siembra: i.fecha_siembra || i.fecha_cosecha || '-',
            estado: 'ACTIVO'
        }));

        const filasHistorial = historial.map(i => ({
            campo: (i.campo || i.sector || 'GENERAL').toUpperCase(),
            lote: `Lote ${i.lote || '-'}`,
            cultivo: (i.cultivo || '-').toUpperCase(),
            variedad: i.variedad || '-',
            sup: parseFloat(i.sup) || 0,
            fecha_siembra: i.fecha_siembra || '-',
            fecha_cierre: i.fecha_cierre || '-',
            estado: 'INACTIVO'
        }));

        try {
            const wb = new ExcelJS.Workbook();
            wb.creator = 'Salvucci Gestión · AgroSoft J&L';
            wb.created = new Date();

            const ws = wb.addWorksheet('Siembras Activas', {
                views: [{ state: 'frozen', ySplit: 5 }],
                pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
            });

            ws.columns = columnas.map(c => ({ header: c.header, key: c.key, width: c.width }));
            filasActivos.forEach(f => ws.addRow(f));

            ws.spliceRows(1, 0, [], [], [], []);
            const nCols = columnas.length;

            ws.getRow(1).height = 30;
            ws.getRow(2).height = 16;
            ws.getRow(3).height = 15;
            ws.getRow(4).height = 15;

            for (let r = 1; r <= 4; r++) ws.mergeCells(r, 1, r, nCols);

            const cTitulo = ws.getCell(1, 1);
            cTitulo.value = `SALVUCCI GESTIÓN — REPORTE TERRITORIAL (${estSel.toUpperCase()})`;
            cTitulo.font = { bold: true, size: 14, color: { argb: SALVUCCI_CONF.argbDark } };
            cTitulo.alignment = { vertical: 'middle', horizontal: 'left' };

            const cSub = ws.getCell(2, 1);
            cSub.value = `Detalle consolidado de lotes y siembras activas · Campos: ${camposFiltro.length > 0 ? camposFiltro.join(", ") : "TODOS"}`;
            cSub.font = { italic: true, size: 9.5, color: { argb: 'FF556358' } };
            cSub.alignment = { vertical: 'middle', horizontal: 'left' };

            const cEmpresa = ws.getCell(3, 1);
            cEmpresa.value = `${SALVUCCI_CONF.empresaRazon} — ${SALVUCCI_CONF.empresaDomicilio}`;
            cEmpresa.font = { size: 8.5, color: { argb: 'FF556358' } };
            cEmpresa.alignment = { vertical: 'middle', horizontal: 'left' };

            const cMeta = ws.getCell(4, 1);
            cMeta.value = `Folio: ${folio}   ·   Emitido: ${new Date().toLocaleString('es-AR')}   ·   Operador: ${operario}   ·   Lotes Relevados: ${filasActivos.length}`;
            cMeta.font = { bold: true, size: 8.5, color: { argb: SALVUCCI_CONF.argbTema } };
            cMeta.alignment = { vertical: 'middle', horizontal: 'left' };

            const filaHead = ws.getRow(5);
            filaHead.height = 24;
            filaHead.eachCell({ includeEmpty: true }, cell => {
                cell.font = { bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SALVUCCI_CONF.argbTema } };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
                cell.border = { bottom: { style: 'thin', color: { argb: SALVUCCI_CONF.argbDark } } };
            });

            const primeraFila = 6;
            const ultimaFila = primeraFila + filasActivos.length - 1;

            for (let r = primeraFila; r <= ultimaFila; r++) {
                const fila = ws.getRow(r);
                columnas.forEach((c, i) => {
                    const cell = fila.getCell(i + 1);
                    cell.alignment = { vertical: 'middle', horizontal: c.halign || 'left' };
                    cell.font = { size: 9, bold: !!c.destacada };
                    cell.border = {
                        top: { style: 'hair', color: { argb: 'FFE0DCD4' } },
                        bottom: { style: 'hair', color: { argb: 'FFE0DCD4' } }
                    };
                    if (c.numero) cell.numFmt = '#,##0.00';
                    if (c.key === 'estado') {
                        cell.font = { size: 8.5, bold: true, color: { argb: 'FF1E6B4C' } };
                    }
                });
                if ((r - primeraFila) % 2 === 1) {
                    fila.eachCell({ includeEmpty: true }, cell => {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FBF9' } };
                    });
                }
            }

            if (filasActivos.length > 0) {
                const filaTot = ws.getRow(ultimaFila + 2);
                filaTot.height = 20;
                columnas.forEach((c, i) => {
                    const cell = filaTot.getCell(i + 1);
                    if (i === 0) cell.value = 'TOTAL SUPERFICIE ACTIVA';
                    else if (c.numero) {
                        const colLetra = cell.address.replace(/\d+$/, '');
                        cell.value = { formula: `SUM(${colLetra}${primeraFila}:${colLetra}${ultimaFila})` };
                        cell.numFmt = '#,##0.00';
                    }
                    cell.font = { bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SALVUCCI_CONF.argbDark } };
                    cell.alignment = { vertical: 'middle', horizontal: c.halign || 'left' };
                });
            }

            if (filasHistorial.length > 0) {
                const colsHist = [
                    { header: 'CAMPO / SECTOR', key: 'campo', width: 24 },
                    { header: 'LOTE', key: 'lote', width: 12, halign: 'center' },
                    { header: 'CULTIVO', key: 'cultivo', width: 20 },
                    { header: 'VARIEDAD', key: 'variedad', width: 20 },
                    { header: 'SUPERFICIE (HAS)', key: 'sup', width: 18, halign: 'right', numero: true },
                    { header: 'FECHA SIEMBRA', key: 'fecha_siembra', width: 16, halign: 'center' },
                    { header: 'FECHA CIERRE', key: 'fecha_cierre', width: 16, halign: 'center' },
                    { header: 'ESTADO', key: 'estado', width: 15, halign: 'center' }
                ];
                const wsHist = wb.addWorksheet('Historial de Cierres');
                wsHist.columns = colsHist.map(c => ({ header: c.header, key: c.key, width: c.width }));
                filasHistorial.forEach(f => wsHist.addRow(f));

                wsHist.getRow(1).height = 22;
                wsHist.getRow(1).eachCell(cell => {
                    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6B6255' } };
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                });

                for (let r = 2; r <= filasHistorial.length + 1; r++) {
                    const fila = wsHist.getRow(r);
                    colsHist.forEach((c, i) => {
                        const cell = fila.getCell(i + 1);
                        cell.alignment = { vertical: 'middle', horizontal: c.halign || 'left' };
                        if (c.numero) cell.numFmt = '#,##0.00';
                        if (c.key === 'estado') {
                            cell.font = { size: 8.5, bold: true, color: { argb: 'FFC62828' } };
                        }
                    });
                }
            }

            const nombreArchivo = `Salvucci_Territorial_${estSel.replace(/\s+/g, '_')}_${hoyStr}.xlsx`;
            const buffer = await wb.xlsx.writeBuffer();

            if (esElectron) {
                guardarEnDescargas(nombreArchivo, Buffer.from(buffer));
            } else {
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                descargarNativoBlob(blob, nombreArchivo);
            }

            if (this.m_notificarApple) this.m_notificarApple(`✓ Reporte Excel generado: ${nombreArchivo}`, "exito");
            else alert(`Excel generado con éxito: ${nombreArchivo}`);

        } catch (err) {
            console.error("Error generando Excel territorial:", err);
            this.m_exportarCsvFallback(estSel, camposFiltro, activos, historial);
        }
    },

    m_exportarCsvFallback: function(estSel, camposFiltro, activos, historial) {
        const headers = ["ESTABLECIMIENTO", "CAMPO/SECTOR", "LOCALIDAD", "LOTE", "SUPERFICIE (HA)", "CULTIVO", "VARIEDAD", "FECHA SIEMBRA", "FECHA CIERRE", "ESTADO"];
        
        const filaCsv = (i, esHistorial) => [
            `"${i.establecimiento || ''}"`,
            `"${i.campo || i.sector || ''}"`,
            `"${i.localidad || ''}"`,
            i.lote || '',
            i.sup || 0,
            `"${(i.cultivo || '').toUpperCase()}"`,
            `"${i.variedad || ''}"`,
            i.fecha_siembra || i.fecha_cosecha || '',
            esHistorial ? (i.fecha_cierre || '') : '',
            esHistorial ? 'INACTIVO' : 'ACTIVO'
        ].join(";");

        let csvContent = "\uFEFF";
        csvContent += `SALVUCCI GESTION - REPORTE TERRITORIAL\n`;
        csvContent += `ESTABLECIMIENTO: ${estSel.toUpperCase()}\n`;
        csvContent += `CAMPOS: ${camposFiltro.length > 0 ? camposFiltro.join(", ") : "TODOS"}\n\n`;
        csvContent += "SIEMBRAS Y PLANTACIONES ACTIVAS\n";
        csvContent += headers.join(";") + "\n";
        activos.forEach(i => { csvContent += filaCsv(i, false) + "\n"; });

        csvContent += "\nHISTORIAL DE CIERRES\n";
        csvContent += headers.join(";") + "\n";
        historial.forEach(i => { csvContent += filaCsv(i, true) + "\n"; });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const nombreArchivo = `Salvucci_${estSel.replace(/\s+/g, '_')}_${Date.now()}.csv`;
        descargarNativoBlob(blob, nombreArchivo);
        this.m_notificarApple("Planilla generada con éxito.", "exito");
    },

    m_exportarPDFPersonalizado: function(estSel, camposFiltro = []) {
        if (!estSel) return this.m_notificarApple ? this.m_notificarApple("Seleccione un establecimiento.", "error") : alert("Seleccione un establecimiento.");

        let activos = this.inventarioActivo.filter(i => (i.establecimiento || '').trim().toUpperCase() === estSel.trim().toUpperCase());
        let historial = this.inventarioHistorial.filter(i => (i.establecimiento || '').trim().toUpperCase() === estSel.trim().toUpperCase());

        if (camposFiltro && camposFiltro.length > 0) {
            const setCampos = new Set(camposFiltro.map(c => c.trim().toUpperCase()));
            activos = activos.filter(i => setCampos.has((i.campo || i.sector || '').trim().toUpperCase()));
            historial = historial.filter(i => setCampos.has((i.campo || i.sector || '').trim().toUpperCase()));
        }

        if (activos.length === 0 && historial.length === 0) {
            return this.m_notificarApple ? this.m_notificarApple("No hay datos de siembra para exportar.", "error") : alert("No hay datos.");
        }

        const esElectron = typeof require === 'function';
        const folio = generarFolio('TER');
        const hoyStr = new Date().toISOString().split('T')[0];
        const emitido = new Date().toLocaleString('es-AR');
        const operario = (typeof operarioName !== 'undefined' ? operarioName : (window.operarioGlobal || 'ADMINISTRADOR')).toUpperCase();

        const totalHasActivas = activos.reduce((acc, curr) => acc + (parseFloat(curr.sup) || 0), 0);
        const totalHasHistorial = historial.reduce((acc, curr) => acc + (parseFloat(curr.sup) || 0), 0);

        const tieneJsPDF = typeof window.jspdf !== 'undefined' || (esElectron && (() => { try { require('jspdf'); return true; } catch(e) { return false; } })());

        if (tieneJsPDF) {
            try {
                const { jsPDF } = esElectron ? require('jspdf') : window.jspdf;
                if (esElectron) require('jspdf-autotable');

                const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
                const pageW = doc.internal.pageSize.getWidth();
                const pageH = doc.internal.pageSize.getHeight();
                const margen = 12;
                const ALTO_HEADER = 38;
                const ALTO_PIE = 14;
                const logoBase64 = cargarLogoBase64();

                function dibujarEncabezado(data) {
                    const pagina = data && data.pageNumber ? data.pageNumber : 1;

                    doc.setFillColor(SALVUCCI_CONF.rgbTema[0], SALVUCCI_CONF.rgbTema[1], SALVUCCI_CONF.rgbTema[2]);
                    doc.rect(0, 0, pageW, 3, 'F');
                    doc.setFillColor(248, 250, 248);
                    doc.rect(0, 3, pageW, ALTO_HEADER - 3, 'F');

                    if (logoBase64) {
                        try { doc.addImage('data:image/png;base64,' + logoBase64, 'PNG', margen, 6.5, 19, 19); } catch (e) {}
                    } else {
                        doc.setDrawColor(200, 205, 208);
                        doc.setLineWidth(0.3);
                        doc.roundedRect(margen, 6.5, 19, 19, 2, 2, 'D');
                    }

                    const xTexto = margen + 24;
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(13);
                    doc.setTextColor(SALVUCCI_CONF.rgbTemaDark[0], SALVUCCI_CONF.rgbTemaDark[1], SALVUCCI_CONF.rgbTemaDark[2]);
                    doc.text('SALVUCCI GESTIÓN · REPORTE TERRITORIAL', xTexto, 12.5);

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(8);
                    doc.setTextColor(85, 99, 88);
                    doc.text(SALVUCCI_CONF.empresaDomicilio, xTexto, 17);

                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(10.5);
                    doc.setTextColor(SALVUCCI_CONF.rgbTema[0], SALVUCCI_CONF.rgbTema[1], SALVUCCI_CONF.rgbTema[2]);
                    doc.text(`ESTABLECIMIENTO: ${estSel.toUpperCase()}`, xTexto, 24.5);

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(7.5);
                    doc.setTextColor(110, 120, 115);
                    doc.text(`Filtro: ${camposFiltro.length > 0 ? camposFiltro.join(', ') : 'TODOS LOS CAMPOS'}`, xTexto, 29);

                    const anchoCb = 58;
                    const xCb = pageW - margen - anchoCb;
                    dibujarCodigoBarrasPdf(doc, folio, xCb, 6.5, anchoCb, 10);

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(7.2);
                    doc.setTextColor(90, 100, 95);
                    doc.text(`Emitido: ${emitido}`, pageW - margen, 24, { align: 'right' });
                    doc.text(`Operador: ${operario}`, pageW - margen, 28, { align: 'right' });
                    doc.text(`Superficie: ${totalHasActivas.toFixed(1)} Has   ·   Hoja ${pagina}`, pageW - margen, 32, { align: 'right' });

                    doc.setDrawColor(SALVUCCI_CONF.rgbTema[0], SALVUCCI_CONF.rgbTema[1], SALVUCCI_CONF.rgbTema[2]);
                    doc.setLineWidth(0.5);
                    doc.line(margen, ALTO_HEADER - 2, pageW - margen, ALTO_HEADER - 2);
                }

                const columnasPdf = [
                    { header: 'CAMPO / SECTOR', dataKey: 'campo', cellWidth: 44 },
                    { header: 'LOTE', dataKey: 'lote', cellWidth: 22, halign: 'center' },
                    { header: 'CULTIVO', dataKey: 'cultivo', cellWidth: 34 },
                    { header: 'VARIEDAD', dataKey: 'variedad', cellWidth: 30 },
                    { header: 'SUPERFICIE', dataKey: 'sup', cellWidth: 26, halign: 'right' },
                    { header: 'F. SIEMBRA', dataKey: 'fecha_siembra', cellWidth: 30, halign: 'center' }
                ];

                const filasPdf = activos.map(s => ({
                    campo: (s.campo || s.sector || 'GENERAL').toUpperCase(),
                    lote: `Lote ${s.lote || '-'}`,
                    cultivo: (s.cultivo || '-').toUpperCase(),
                    variedad: s.variedad || 'General',
                    sup: `${parseFloat(s.sup || 0).toFixed(1)} Has`,
                    fecha_siembra: s.fecha_siembra || s.fecha_cosecha || '-'
                }));

                doc.autoTable({
                    startY: ALTO_HEADER + 4,
                    margin: { left: margen, right: margen, top: ALTO_HEADER + 4, bottom: ALTO_PIE + 6 },
                    columns: columnasPdf,
                    body: filasPdf,
                    headStyles: {
                        fillColor: SALVUCCI_CONF.rgbTema,
                        textColor: 255,
                        fontSize: 7.8,
                        fontStyle: 'bold',
                        halign: 'center',
                        valign: 'middle'
                    },
                    styles: {
                        fontSize: 7.4,
                        cellPadding: 2,
                        lineColor: [224, 220, 212],
                        lineWidth: 0.12,
                        valign: 'middle'
                    },
                    alternateRowStyles: { fillColor: [248, 250, 248] },
                    columnStyles: {
                        campo: { fontStyle: 'bold', textColor: SALVUCCI_CONF.rgbTemaDark },
                        cultivo: { fontStyle: 'bold', textColor: SALVUCCI_CONF.rgbTema },
                        sup: { fontStyle: 'bold' }
                    },
                    theme: 'grid',
                    didDrawPage: dibujarEncabezado
                });

                let y = ((doc.lastAutoTable && doc.lastAutoTable.finalY) || ALTO_HEADER + 4) + 6;

                if (historial.length > 0) {
                    if (y + 35 > pageH - ALTO_PIE) {
                        doc.addPage();
                        dibujarEncabezado({ pageNumber: doc.internal.getNumberOfPages() });
                        y = ALTO_HEADER + 4;
                    }

                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(8.5);
                    doc.setTextColor(80, 80, 80);
                    doc.text(`HISTORIAL DE CIERRES RECIENTES (${historial.length})`, margen, y + 2);
                    y += 4;

                    const colsHistPdf = [
                        { header: 'CAMPO', dataKey: 'campo', cellWidth: 40 },
                        { header: 'LOTE', dataKey: 'lote', cellWidth: 22, halign: 'center' },
                        { header: 'CULTIVO', dataKey: 'cultivo', cellWidth: 32 },
                        { header: 'VARIEDAD', dataKey: 'variedad', cellWidth: 28 },
                        { header: 'SUPERFICIE', dataKey: 'sup', cellWidth: 24, halign: 'right' },
                        { header: 'F. CIERRE', dataKey: 'fecha_cierre', cellWidth: 40, halign: 'center' }
                    ];

                    const filasHistPdf = historial.map(h => ({
                        campo: (h.campo || h.sector || '-').toUpperCase(),
                        lote: `Lote ${h.lote || '-'}`,
                        cultivo: (h.cultivo || '-').toUpperCase(),
                        variedad: h.variedad || '-',
                        sup: `${parseFloat(h.sup || 0).toFixed(1)} Has`,
                        fecha_cierre: h.fecha_cierre || '-'
                    }));

                    doc.autoTable({
                        startY: y,
                        margin: { left: margen, right: margen, top: ALTO_HEADER + 4, bottom: ALTO_PIE + 6 },
                        columns: colsHistPdf,
                        body: filasHistPdf,
                        headStyles: { fillColor: [110, 110, 115], textColor: 255, fontSize: 7.2, fontStyle: 'bold', halign: 'center' },
                        styles: { fontSize: 7, cellPadding: 1.8, lineColor: [224, 220, 212], lineWidth: 0.1 },
                        columnStyles: { sup: { fontStyle: 'bold' } },
                        theme: 'grid',
                        didDrawPage: dibujarEncabezado
                    });

                    y = (doc.lastAutoTable && doc.lastAutoTable.finalY) + 6;
                }

                const altoBloque = 36;
                if (y + altoBloque > pageH - ALTO_PIE) {
                    doc.addPage();
                    dibujarEncabezado({ pageNumber: doc.internal.getNumberOfPages() });
                    y = ALTO_HEADER + 6;
                }

                const anchoPanel = pageW - margen * 2;
                doc.setFillColor(248, 250, 248);
                doc.setDrawColor(220, 225, 222);
                doc.setLineWidth(0.25);
                doc.roundedRect(margen, y, anchoPanel, 18, 2, 2, 'FD');

                doc.setFont('helvetica', 'bold');
                doc.setFontSize(7.8);
                doc.setTextColor(SALVUCCI_CONF.rgbTema[0], SALVUCCI_CONF.rgbTema[1], SALVUCCI_CONF.rgbTema[2]);
                doc.text('RESUMEN DE COBERTURA TERRITORIAL', margen + 5, y + 5);

                const itemsRes = [
                    { label: 'LOTES ACTIVOS', val: String(activos.length) },
                    { label: 'HAS ACTIVAS', val: `${totalHasActivas.toFixed(1)} Has` },
                    { label: 'LOTES HISTORIAL', val: String(historial.length) },
                    { label: 'HAS HISTORIAL', val: `${totalHasHistorial.toFixed(1)} Has` }
                ];

                const anchoItem = (anchoPanel - 10) / itemsRes.length;
                itemsRes.forEach((it, idx) => {
                    const xi = margen + 5 + anchoItem * idx;
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(6.4);
                    doc.setTextColor(110, 120, 115);
                    doc.text(it.label, xi, y + 10);
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(9.5);
                    doc.setTextColor(SALVUCCI_CONF.rgbTemaDark[0], SALVUCCI_CONF.rgbTemaDark[1], SALVUCCI_CONF.rgbTemaDark[2]);
                    doc.text(it.val, xi, y + 14.8);
                });

                const yFirma = y + 28;
                doc.setDrawColor(120, 130, 125);
                doc.setLineWidth(0.25);
                doc.line(margen + 15, yFirma, margen + 75, yFirma);
                doc.line(pageW - margen - 75, yFirma, pageW - margen - 15, yFirma);

                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7.2);
                doc.setTextColor(90, 100, 95);
                doc.text('Responsable Técnico / Campo', margen + 45, yFirma + 3.8, { align: 'center' });
                doc.text('Auditoría Agropecuaria Central', pageW - margen - 45, yFirma + 3.8, { align: 'center' });

                const totalPaginas = doc.internal.getNumberOfPages();
                for (let i = 1; i <= totalPaginas; i++) {
                    doc.setPage(i);
                    doc.setDrawColor(220, 225, 222);
                    doc.setLineWidth(0.2);
                    doc.line(margen, pageH - 10, pageW - margen, pageH - 10);

                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(7);
                    doc.setTextColor(90, 100, 95);
                    doc.text(SALVUCCI_CONF.pieInstitucional, margen, pageH - 6);

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(6.8);
                    doc.text(`Folio ${folio}   ·   Página ${i} de ${totalPaginas}`, pageW - margen, pageH - 6, { align: 'right' });
                }

                const nombre = `Salvucci_Territorial_${estSel.replace(/\s+/g, '_')}_${hoyStr}.pdf`;
                if (esElectron) {
                    guardarEnDescargas(nombre, Buffer.from(doc.output('arraybuffer')));
                    if (this.m_notificarApple) this.m_notificarApple(`✓ PDF guardado en Descargas: ${nombre}`, "exito");
                    else alert(`PDF guardado en Descargas: ${nombre}`);
                } else {
                    doc.save(nombre);
                }
                return;

            } catch (err) {
                console.warn("Fallo jsPDF en campo, usando visor de impresión:", err);
            }
        }

        // Respaldo Web
        const cbWebBase64 = codigoBarrasPngBase64(folio, 300, 48) || '';
        const ventanaPDF = window.open('', '_blank');
        ventanaPDF.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Reporte Territorial - Salvucci Gestión</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap');
                    @page { size: portrait; margin: 10mm; }
                    body { font-family: 'Roboto', sans-serif; color: #1A211C; padding: 15px; margin: 0; background: #FFFFFF; font-size: 11px; }
                    .header-pdf-premium { border-bottom: 2.5px solid #1E6B4C; padding: 14px 18px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; background: #F8FAF8; border-radius: 8px; border: 1px solid #D2D7D3; }
                    .logo-box { width: 52px; height: 52px; display: flex; align-items: center; justify-content: center; margin-right: 14px; }
                    .logo-box img { width: 100%; height: 100%; object-fit: contain; }
                    .titulos h1 { margin: 0; font-size: 15px; font-weight: 900; color: #123F2C; }
                    .titulos h2 { margin: 2px 0 0 0; font-size: 9.5px; color: #1E6B4C; font-weight: 800; text-transform: uppercase; }
                    .titulos p { margin: 2px 0 0 0; font-size: 8.5px; color: #556358; }
                    .kpi-tile-top { background: #FFFFFF; border: 1px solid #C8E6C9; padding: 6px 14px; border-radius: 6px; text-align: right; }
                    table { width: 100%; border-collapse: collapse; font-size: 9.5px; margin-top: 8px; }
                    th { background: #1E6B4C; color: #FFFFFF; text-align: left; padding: 6px 8px; font-weight: 700; text-transform: uppercase; font-size: 8px; }
                    td { padding: 5px 8px; border-bottom: 1px solid #E2E8F0; }
                    tr:nth-child(even) { background: #FAFBFA; }
                    .pie-pag { margin-top: 18px; border-top: 1px solid #D2D7D3; padding-top: 8px; display: flex; justify-content: space-between; font-size: 8px; color: #556358; }
                </style>
            </head>
            <body>
                <div class="header-pdf-premium">
                    <div style="display:flex; align-items:center;">
                        <div class="logo-box">
                            <img src="logo.png" onerror="this.style.display='none';" />
                        </div>
                        <div class="titulos">
                            <h2>SALVUCCI GESTIÓN · REPORTE TERRITORIAL</h2>
                            <h1>ESTABLECIMIENTO: ${estSel.toUpperCase()}</h1>
                            <p>${SALVUCCI_CONF.empresaDomicilio} · Operador: ${operario}</p>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:16px;">
                        ${cbWebBase64 ? `<img src="${cbWebBase64}" style="height:36px;" />` : ''}
                        <div class="kpi-tile-top">
                            <div style="font-size:8px; color:#556358; font-weight:700; text-transform:uppercase;">Superficie Activa</div>
                            <div style="font-size:14px; font-weight:900; color:#1E6B4C;">${totalHasActivas.toFixed(1)} Has</div>
                            <small style="font-size:8px; color:#556358;">Lotes: ${activos.length}</small>
                        </div>
                    </div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>CAMPO / SECTOR</th>
                            <th style="text-align:center;">LOTE</th>
                            <th>CULTIVO</th>
                            <th>VARIEDAD</th>
                            <th style="text-align:right;">SUPERFICIE</th>
                            <th style="text-align:center;">F. SIEMBRA</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${activos.map(s => `
                            <tr>
                                <td><b>${(s.campo || s.sector || '-').toUpperCase()}</b></td>
                                <td style="text-align:center;">Lote ${s.lote || '-'}</td>
                                <td style="color:#1E6B4C; font-weight:bold;">${(s.cultivo || '-').toUpperCase()}</td>
                                <td>${s.variedad || 'General'}</td>
                                <td style="text-align:right; font-weight:bold;">${parseFloat(s.sup || 0).toFixed(1)} Has</td>
                                <td style="text-align:center;">${s.fecha_siembra || s.fecha_cosecha || '-'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div class="pie-pag">
                    <div>${SALVUCCI_CONF.pieInstitucional}</div>
                    <div>Folio: ${folio} · Emitido: ${emitido}</div>
                </div>

                <script>
                    window.onload = function() { setTimeout(() => { window.print(); window.close(); }, 350); };
                <\/script>
            </body>
            </html>
        `);
        ventanaPDF.document.close();
    },

    m_abrirModalBaja: function(reg_local) {
        this.modalTipoActual = 'BAJA';
        this.bajaRegLocalActual = reg_local;

        document.getElementById('modal-titulo-campos').innerText = "GESTIÓN DE BAJA DE SIEMBRA";
        document.getElementById('modal-footer-campos').style.display = 'none';

        const container = document.getElementById('modal-formulario-campos');
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:14px; font-family:'Roboto', sans-serif;">
                <div style="background:#FFF8E1; border-left:4px solid #FBC02D; padding:12px; border-radius:8px; font-size:0.8rem; color:#211C16;">
                    <strong>TERMINAR:</strong> Pasa el lote a histórico como INACTIVO.<br>
                    <strong>ELIMINAR:</strong> Borrado físico definitivo de la base local.
                </div>
                <div>
                    <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Fecha de Cierre (para opción Terminar)</label>
                    <input type="date" id="f_fecha_cierre" value="${new Date().toISOString().split('T')[0]}" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; border-top:1px solid var(--color-border); padding-top:12px;">
                    <button onclick="ModuloCampos.m_cerrarModal()" style="background:#F0F2F5; color:#211C16; border:none; padding:8px 16px; border-radius:8px; font-weight:700; cursor:pointer;">CANCELAR</button>
                    <div style="display:flex; gap:8px;">
                        <button onclick="ModuloCampos.m_ejecutarEliminacionDefinitiva()" style="background:#C62828; color:#FFF; border:none; padding:8px 16px; border-radius:8px; font-weight:700; cursor:pointer;">ELIMINAR</button>
                        <button onclick="ModuloCampos.m_ejecutarBajaConFecha()" style="background:#F57F17; color:#FFF; border:none; padding:8px 16px; border-radius:8px; font-weight:700; cursor:pointer;">TERMINAR</button>
                    </div>
                </div>
            </div>`;
        document.getElementById('modal-agrosoft-campos').style.display = 'flex';
    },

    m_ejecutarBajaConFecha: async function() {
        const fechaCierre = document.getElementById('f_fecha_cierre').value;
        if (!fechaCierre) {
            this.m_notificarApple("Seleccione una fecha de cierre válida.", "error");
            return;
        }

        try {
            const sql = `UPDATE inventario_plantacion SET estado = 'INACTIVO', fecha_cierre = ?, sincronizado = 0 WHERE reg_local = ?`;
            await this.m_ejecutarSqlLocal(sql, [fechaCierre, this.bajaRegLocalActual]);

            this.m_cerrarModal();
            this.m_notificarApple("Plantación cerrada en base local con éxito.", "exito");
            this.m_inicializar();
        } catch (e) {
            console.error("❌ Error en baja de plantación:", e);
            this.m_notificarApple("Error al procesar la baja local: " + e.message, "error");
        }
    },

    m_reabrirRegistro: async function(reg_local) {
        const confirmar = confirm("¿Reabrir esta siembra/plantación en la base local?");
        if (!confirmar) return;

        try {
            const sql = `UPDATE inventario_plantacion SET estado = 'ACTIVO', fecha_cierre = NULL, sincronizado = 0 WHERE reg_local = ?`;
            await this.m_ejecutarSqlLocal(sql, [reg_local]);

            this.vistaInventarioActual = 'ACTIVOS';
            this.m_notificarApple("Siembra reactivada con éxito.", "exito");
            await this.m_inicializar();
        } catch (e) {
            console.error("❌ Error al reabrir siembra:", e);
            this.m_notificarApple("Error al reabrir: " + e.message, "error");
        }
    },

    m_ejecutarEliminacionDefinitiva: async function() {
        const confirmar = confirm("⚠️ ¿Eliminar definitivamente este registro local? Esta acción no se puede deshacer.");
        if (!confirmar) return;

        try {
            const sql = `DELETE FROM inventario_plantacion WHERE reg_local = ?`;
            await this.m_ejecutarSqlLocal(sql, [this.bajaRegLocalActual]);

            this.m_cerrarModal();
            this.m_notificarApple("Registro eliminado físicamente de la base local.", "exito");
            this.m_inicializar();
        } catch (e) {
            console.error("❌ Error en eliminación:", e);
            this.m_notificarApple("Error al eliminar: " + e.message, "error");
        }
    },

    m_cargarVariedades: function(cultivoSel) {
        const selectVar = document.getElementById('f_variedad');
        if (!selectVar) return;
        const vars = this.listaCultivos.filter(c => c.cultivo === cultivoSel);
        selectVar.innerHTML = '<option value="">-- Seleccione Variedad --</option>' +
            vars.map(v => `<option value="${v.variedad}">${v.variedad}</option>`).join('');
    },

    m_obtenerMaxIdPlantacion: async function() {
        try {
            const res = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(id AS INTEGER)) as max_id FROM inventario_plantacion`);
            if (res.data && res.data[0] && res.data[0].max_id) {
                return parseInt(res.data[0].max_id, 10) || 0;
            }
        } catch (e) {
            console.warn("Error calculando Max(id):", e);
        }
        return 0;
    },

    m_obtenerMaxRegLocal: async function(tabla) {
        try {
            const res = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(reg_local AS INTEGER)) as max_reg FROM ${tabla}`);
            if (res.data && res.data[0] && res.data[0].max_reg) {
                return parseInt(res.data[0].max_reg, 10) || 0;
            }
        } catch (e) {
            console.warn("Error calculando Max local:", e);
        }
        return 0;
    },


    m_abrirModal: function(tipo, data = null) {
        if (tipo !== 'INVENTARIO') return this.m_abrirFormTerritorial(tipo, data);
        const btnDel = document.getElementById('btn-eliminar-campos');
        if (btnDel) btnDel.style.display = 'none';
        const btnGuardar = document.getElementById('btn-guardar-campos');
        if (btnGuardar) { btnGuardar.innerText = 'GUARDAR SIEMBRA'; btnGuardar.disabled = false; }
        const container = document.getElementById('modal-formulario-campos');
        const footer = document.getElementById('modal-footer-campos');
        const esEdicion = data !== null;
        this.modalTipoActual = tipo;
        this.datosEdicionActual = data;

        let supTotalLote = 0;
        let supSembradaActiva = 0;
        let supVacia = 0;

        if (tipo === 'INVENTARIO') {
            const estabSel = esEdicion ? data.establecimiento : this.seleccionActual.establecimiento;
            const campoSel = esEdicion ? data.campo : this.seleccionActual.campo;
            const loteSel = esEdicion ? data.lote : (this.seleccionActual.lotes[0] || '1');

            const lotesDelCampo = this.m_obtenerCuadrosDelCampo(estabSel, campoSel);
            const loteInfo = lotesDelCampo.find(l => this.m_normalizarLoteNumero(l.lote) === this.m_normalizarLoteNumero(loteSel));
            
            supTotalLote = loteInfo ? (parseFloat(loteInfo.sup) || 0) : 0;

            const activasEnLote = this.inventarioActivo.filter(i => 
                this.m_coincideLote(i, estabSel, campoSel, loteSel) && 
                (!esEdicion || String(i.reg_local) !== String(data.reg_local))
            );

            supSembradaActiva = activasEnLote.reduce((acc, c) => acc + (parseFloat(c.sup) || 0), 0);
            supVacia = Math.max(0, supTotalLote - supSembradaActiva);
        }

        document.getElementById('modal-titulo-campos').innerText = esEdicion ? 'EDITAR SIEMBRA' : 'NUEVA SIEMBRA EN CUADRO';
        footer.style.display = 'flex';
        let htmlForm = '';

        if (tipo === 'INVENTARIO') {
            if (!esEdicion && (!this.seleccionActual.lotes || this.seleccionActual.lotes.length === 0)) {
                const lotesDelCampo = this.m_obtenerCuadrosDelCampo(this.seleccionActual.establecimiento, this.seleccionActual.campo);
                if (lotesDelCampo.length > 0) {
                    this.seleccionActual.lotes = [this.m_normalizarLoteNumero(lotesDelCampo[0].lote)];
                }
            }

            const loteSelFinal = esEdicion ? data.lote : (this.seleccionActual.lotes[0] || '1');
            const supSugeridaFinal = esEdicion ? data.sup : (supVacia > 0 ? supVacia.toFixed(1) : supTotalLote.toFixed(1));

            htmlForm = `
                <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                    <div style="background:var(--color-plant-soft); border-left:4px solid var(--color-plant); padding:10px 12px; border-radius:8px; font-size:0.82rem;">
                        <strong>Jerarquía:</strong> ${esEdicion ? data.establecimiento : this.seleccionActual.establecimiento} &gt; ${esEdicion ? data.campo : this.seleccionActual.campo} &gt; Lote ${loteSelFinal}
                    </div>

                    <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; background:#F8FAFC; border:1px solid var(--color-border); padding:10px; border-radius:8px; text-align:center;">
                        <div>
                            <span style="font-size:0.63rem; font-weight:700; color:var(--color-text-secondary); text-transform:uppercase;">Superficie Total</span>
                            <strong style="display:block; font-size:0.95rem; color:#211C16;">${supTotalLote.toFixed(1)} Has</strong>
                        </div>
                        <div>
                            <span style="font-size:0.63rem; font-weight:700; color:#E08600; text-transform:uppercase;">Sembrada Activa</span>
                            <strong style="display:block; font-size:0.95rem; color:#E08600;">${supSembradaActiva.toFixed(1)} Has</strong>
                        </div>
                        <div>
                            <span style="font-size:0.63rem; font-weight:700; color:#1FA958; text-transform:uppercase;">Disponible / Vacía</span>
                            <strong style="display:block; font-size:0.95rem; color:#1FA958;">${supVacia.toFixed(1)} Has</strong>
                        </div>
                    </div>

                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                        <div>
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                                <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700;">Cultivo</label>
                                <button type="button" onclick="ModuloCampos.m_abrirModalNuevoCultivoVariedad('CULTIVO')" style="background:transparent; border:none; color:var(--color-plant); font-size:0.68rem; font-weight:800; cursor:pointer; padding:0;">+ Nuevo</button>
                            </div>
                            <select id="f_cultivo" onchange="ModuloCampos.m_cargarVariedades(this.value)" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                                <option value="">Seleccionar cultivo...</option>
                                ${[...new Set(this.listaCultivos.map(c => c.cultivo))].filter(Boolean).sort().map(c => `<option value="${c}" ${data?.cultivo === c ? 'selected' : ''}>🌱 ${c}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                                <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700;">Variedad</label>
                                <button type="button" onclick="ModuloCampos.m_abrirModalNuevoCultivoVariedad('VARIEDAD')" style="background:transparent; border:none; color:var(--color-plant); font-size:0.68rem; font-weight:800; cursor:pointer; padding:0;">+ Nueva Var.</button>
                            </div>
                            <select id="f_variedad" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                                <option value="">-- Seleccione Variedad --</option>
                                ${esEdicion ? `<option value="${data.variedad}" selected>${data.variedad}</option>` : ''}
                            </select>
                        </div>
                    </div>

                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                        <div>
                            <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700;">Superficie a Sembrar (Has)</label>
                            <input type="number" step="0.01" id="f_sup_inventario" value="${supSugeridaFinal}" style="width:100%; padding:8px 10px; border-radius:8px; border:2px solid var(--color-plant); font-weight:700; font-size:0.85rem; box-sizing:border-box;">
                        </div>
                        <div>
                            <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700;">Fecha de Siembra</label>
                            <input type="date" id="f_fecha" value="${data?.fecha_siembra || data?.fecha_cosecha || new Date().toISOString().split('T')[0]}" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                        </div>
                    </div>
                    <input type="hidden" id="f_reg_local" value="${esEdicion ? data.reg_local : 0}">
                </div>`;
        }

        container.onkeydown = null;
        container.innerHTML = htmlForm;
        document.getElementById('modal-agrosoft-campos').style.display = 'flex';

        if (esEdicion && tipo === 'INVENTARIO') {
            this.m_cargarVariedades(data.cultivo);
            document.getElementById('f_variedad').value = data.variedad;
        }
    },

    m_abrirModalNuevoCultivoVariedad: function(modo) {
        const modalViejo = document.getElementById('modal-sub-cultivo-variedad');
        if (modalViejo) modalViejo.remove();

        const cultivoActual = document.getElementById('f_cultivo')?.value || '';
        const cultivosUnicos = [...new Set(this.listaCultivos.map(c => c.cultivo))].filter(Boolean).sort();

        const modalSubHtml = `
            <div id="modal-sub-cultivo-variedad" style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(20,26,36,0.6); backdrop-filter:blur(3px); z-index:1000000; display:flex; justify-content:center; align-items:center; font-family:'Roboto', sans-serif;">
                <div style="background:#FFFFFF; border:1.5px solid var(--color-plant); border-radius:14px; padding:22px; width:90%; max-width:420px; box-shadow:0 15px 35px rgba(0,0,0,0.2);">
                    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--color-border); padding-bottom:10px; margin-bottom:14px;">
                        <h4 style="margin:0; font-size:1rem; font-weight:800; color:var(--color-plant-dark);">
                            ${modo === 'CULTIVO' ? '🌱 NUEVO CULTIVO Y VARIEDAD' : '🧬 NUEVA VARIEDAD'}
                        </h4>
                        <span onclick="document.getElementById('modal-sub-cultivo-variedad').remove()" style="cursor:pointer; font-size:1.3rem; font-weight:bold; color:#6B6255;">&times;</span>
                    </div>

                    <div style="display:flex; flex-direction:column; gap:12px;">
                        <div>
                            <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Nombre del Cultivo</label>
                            ${modo === 'CULTIVO' ? `
                                <input type="text" id="sub_f_cultivo" placeholder="Ej: CEBOLLA, MANZANA, PERA..." style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; text-transform:uppercase; box-sizing:border-box;">
                            ` : `
                                <select id="sub_f_cultivo" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box; background:#FFFFFF;">
                                    ${cultivosUnicos.map(c => `<option value="${c}" ${c === cultivoActual ? 'selected' : ''}>${c}</option>`).join('')}
                                </select>
                            `}
                        </div>

                        <div>
                            <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Nombre de la Variedad</label>
                            <input type="text" id="sub_f_variedad" placeholder="Ej: SINTETICA 14, GALA, RED DELICIOUS..." style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                        </div>
                    </div>

                    <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:18px; border-top:1px solid var(--color-border); padding-top:12px;">
                        <button type="button" onclick="document.getElementById('modal-sub-cultivo-variedad').remove()" style="background:#F0F2F5; color:#211C16; border:1px solid var(--color-border); padding:7px 14px; border-radius:7px; font-weight:700; font-size:0.75rem; cursor:pointer;">CANCELAR</button>
                        <button type="button" id="btn-guardar-sub-cultivo" onclick="ModuloCampos.m_guardarNuevoCultivoVariedad('${modo}')" style="background:var(--color-plant); color:#FFFFFF; border:none; padding:7px 18px; border-radius:7px; font-weight:800; font-size:0.75rem; cursor:pointer;">GUARDAR</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalSubHtml);
        setTimeout(() => {
            const inputTarget = modo === 'CULTIVO' ? document.getElementById('sub_f_cultivo') : document.getElementById('sub_f_variedad');
            inputTarget?.focus();
        }, 100);
    },

    m_guardarNuevoCultivoVariedad: async function(modo) {
        const btn = document.getElementById('btn-guardar-sub-cultivo');
        const cultivoInput = document.getElementById('sub_f_cultivo');
        const variedadInput = document.getElementById('sub_f_variedad');

        const cultivo = (cultivoInput?.value || '').trim().toUpperCase();
        const variedad = (variedadInput?.value || '').trim();

        if (!cultivo) {
            this.m_notificarApple("Ingresá el nombre del cultivo.", "error");
            return;
        }
        if (!variedad) {
            this.m_notificarApple("Ingresá el nombre de la variedad.", "error");
            return;
        }

        if (btn) btn.innerText = "GUARDANDO...";

        try {
            const maxReg = await this.m_obtenerMaxRegLocal('cultivos_variedades');
            const nuevoRegLocal = String(maxReg + 1);

            const sql = `INSERT INTO cultivos_variedades (cultivo, variedad, reg_local, sincronizado) VALUES (?, ?, ?, 0)`;
            await this.m_ejecutarSqlLocal(sql, [cultivo, variedad, nuevoRegLocal]);

            this.listaCultivos.push({
                cultivo: cultivo,
                variedad: variedad,
                reg_local: nuevoRegLocal,
                sincronizado: 0
            });

            const selectCultivo = document.getElementById('f_cultivo');
            if (selectCultivo) {
                const cultivosUnicos = [...new Set(this.listaCultivos.map(c => c.cultivo))].filter(Boolean).sort();
                selectCultivo.innerHTML = '<option value="">Seleccionar cultivo...</option>' +
                    cultivosUnicos.map(c => `<option value="${c}" ${c === cultivo ? 'selected' : ''}>🌱 ${c}</option>`).join('');
            }

            this.m_cargarVariedades(cultivo);
            const selectVariedad = document.getElementById('f_variedad');
            if (selectVariedad) {
                selectVariedad.value = variedad;
            }

            document.getElementById('modal-sub-cultivo-variedad')?.remove();
            this.m_notificarApple(`✓ ${cultivo} (${variedad}) registrado correctamente.`, "exito");

        } catch (e) {
            console.error("❌ Error al guardar cultivo/variedad:", e);
            if (btn) btn.innerText = "GUARDAR";
            this.m_notificarApple("Error al guardar: " + e.message, "error");
        }
    },


    // =====================================================================
    // FORMULARIOS TERRITORIALES: ESTABLECIMIENTO / CAMPO / CUADRO
    // Cada nivel escribe en su propia tabla.
    // =====================================================================

    m_obtenerMaxColumna: async function(tabla, columna) {
        try {
            const res = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(${columna} AS INTEGER)) as max_val FROM ${tabla}`);
            if (res.data && res.data[0] && res.data[0].max_val) {
                return parseInt(res.data[0].max_val, 10) || 0;
            }
        } catch (e) {
            console.warn(`Error calculando Max(${columna}) en ${tabla}:`, e);
        }
        return 0;
    },

    m_htmlInput: function(id, label, valor = '', opts = {}) {
        const { tipo = 'text', placeholder = '', req = false, full = false, lista = null, ayuda = '', readonly = false, step = null } = opts;
        const listId = lista ? `dl-${id}` : '';
        return `
            <div class="campo-form ${full ? 'full' : ''}">
                <label for="${id}">${label}${req ? ' <span class="req">*</span>' : ''}</label>
                <input type="${tipo}" id="${id}" value="${this.m_esc(valor)}" placeholder="${this.m_esc(placeholder)}"
                    ${listId ? `list="${listId}"` : ''} ${readonly ? 'readonly' : ''} ${step ? `step="${step}"` : ''} autocomplete="off">
                ${lista ? `<datalist id="${listId}">${lista.map(v => `<option value="${this.m_esc(v)}">`).join('')}</datalist>` : ''}
                ${ayuda ? `<div class="ayuda">${ayuda}</div>` : ''}
            </div>`;
    },

    m_valoresUnicos: function(campo) {
        const fuentes = [...this.listaEstablecimientos, ...this.rawDataCuadros, ...this.listaCuadros];
        return [...new Set(fuentes.map(r => (r[campo] || '').toString().trim()).filter(Boolean))].sort();
    },

    m_val: function(id) {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
    },

    m_abrirFormTerritorial: function(tipo, data = null) {
        if (tipo === 'LOTE') tipo = 'CUADRO'; // compatibilidad con llamadas anteriores

        const container = document.getElementById('modal-formulario-campos');
        const footer = document.getElementById('modal-footer-campos');
        const btnGuardar = document.getElementById('btn-guardar-campos');
        const btnEliminar = document.getElementById('btn-eliminar-campos');
        if (!container) return;

        const esEdicion = !!(data && data.esEdicion);
        this.modalTipoActual = tipo;
        this.datosEdicionActual = data;
        footer.style.display = 'flex';
        if (btnGuardar) btnGuardar.innerText = esEdicion ? 'GUARDAR CAMBIOS' : 'GUARDAR';
        if (btnEliminar) btnEliminar.style.display = (esEdicion && data.puedeEliminar) ? 'inline-block' : 'none';

        const localidades = this.m_valoresUnicos('localidad');
        const provincias = this.m_valoresUnicos('provincia');
        let titulo = '';
        let html = '';

        if (tipo === 'ESTABLECIMIENTO') {
            const r = (data && data.registro) || {};
            const nombre = esEdicion ? data.nombre : '';
            const camposAfectados = esEdicion ? this.m_listarCamposDe(nombre).length : 0;
            titulo = esEdicion ? 'EDITAR ESTABLECIMIENTO' : 'NUEVO ESTABLECIMIENTO';
            html = `
                ${esEdicion && !data.registro ? `<div class="aviso-form ambar">Este establecimiento existía sólo dentro de campos/siembras. Al guardar se crea su ficha en la tabla <b>establecimientos</b>.</div>` : ''}
                ${esEdicion && camposAfectados > 0 ? `<div class="aviso-form">Si cambiás el nombre se actualizan también sus <b>${camposAfectados}</b> campo(s), cuadros y siembras.</div>` : ''}
                <div class="form-seccion">
                    <div class="form-seccion-titulo">Identificación</div>
                    <div class="form-grid">
                        ${this.m_htmlInput('fe_nombre', 'Nombre del establecimiento', nombre, { req: true, full: true, placeholder: 'Ej: Establecimiento Salvucci' })}
                        ${this.m_htmlInput('fe_razon', 'Razón social', r.razon_social, { placeholder: 'Ej: Salvucci S.A.' })}
                        ${this.m_htmlInput('fe_cuit', 'CUIT', r.cuit, { placeholder: '30-00000000-0' })}
                    </div>
                </div>
                <div class="form-seccion">
                    <div class="form-seccion-titulo">Ubicación</div>
                    <div class="form-grid">
                        ${this.m_htmlInput('fe_localidad', 'Localidad', r.localidad, { lista: localidades, placeholder: 'Ej: Chimpay' })}
                        ${this.m_htmlInput('fe_provincia', 'Provincia', r.provincia, { lista: provincias, placeholder: 'Ej: Río Negro' })}
                        ${this.m_htmlInput('fe_domicilio', 'Domicilio', r.domicilio, { full: true, placeholder: 'Ruta / Km / Calle' })}
                    </div>
                </div>
                <div class="form-seccion">
                    <div class="form-seccion-titulo">Contacto</div>
                    <div class="form-grid">
                        ${this.m_htmlInput('fe_responsable', 'Responsable', r.responsable, { placeholder: 'Encargado / Ing. a cargo' })}
                        ${this.m_htmlInput('fe_telefono', 'Teléfono', r.telefono, { tipo: 'tel' })}
                        <div class="campo-form full">
                            <label for="fe_obs">Observaciones</label>
                            <textarea id="fe_obs" rows="3">${this.m_esc(r.observaciones)}</textarea>
                        </div>
                    </div>
                </div>`;

        } else if (tipo === 'CAMPO') {
            const r = (data && data.registro) || {};
            const est = esEdicion ? data.establecimiento : (this.seleccionActual.establecimiento || '');
            const campo = esEdicion ? data.campo : '';
            const ests = this.m_listarEstablecimientos().map(e => e.nombre);
            const cuadrosAfectados = esEdicion ? this.m_obtenerCuadrosDelCampo(est, campo).length : 0;
            titulo = esEdicion ? 'EDITAR CAMPO / SECTOR' : 'NUEVO CAMPO / SECTOR';
            html = `
                ${esEdicion && cuadrosAfectados > 0 ? `<div class="aviso-form">Si cambiás el nombre o el establecimiento se mueven también sus <b>${cuadrosAfectados}</b> cuadro(s) y siembras.</div>` : ''}
                <div class="form-seccion">
                    <div class="form-seccion-titulo">Pertenencia</div>
                    <div class="form-grid">
                        <div class="campo-form full">
                            <label for="fc_est">Establecimiento <span class="req">*</span></label>
                            <select id="fc_est">
                                ${ests.map(e => `<option value="${this.m_esc(e)}" ${e === est ? 'selected' : ''}>🏢 ${this.m_esc(e)}</option>`).join('')}
                            </select>
                        </div>
                        ${this.m_htmlInput('fc_campo', 'Nombre del campo / sector', campo, { req: true, full: true, placeholder: 'Ej: Sector Norte' })}
                    </div>
                </div>
                <div class="form-seccion">
                    <div class="form-seccion-titulo">Datos del campo</div>
                    <div class="form-grid">
                        ${this.m_htmlInput('fc_sup', 'Superficie declarada (Has)', (data && data.cabecera && data.cabecera.sup_total) || '', { tipo: 'number', step: '0.01', placeholder: '0.00', ayuda: 'Si el campo tiene cuadros, se muestra la suma de sus cuadros.' })}
                        ${this.m_htmlInput('fc_localidad', 'Localidad', r.localidad, { lista: localidades, placeholder: 'Ej: Chimpay' })}
                        ${this.m_htmlInput('fc_provincia', 'Provincia', r.provincia, { lista: provincias })}
                        ${this.m_htmlInput('fc_domicilio', 'Domicilio', r.domicilio)}
                        ${this.m_htmlInput('fc_ubicacion', 'Ubicación / Google Maps', r.ubicacion, { full: true, placeholder: 'Link de Google Maps o coordenadas' })}
                    </div>
                </div>`;

        } else if (tipo === 'CUADRO') {
            const q = (data && data.registro) || {};
            const est = esEdicion ? data.establecimiento : (this.seleccionActual.establecimiento || '');
            const campo = esEdicion ? data.campo : (this.seleccionActual.campo || '');
            const lotesExistentes = this.m_obtenerCuadrosDelCampo(est, campo);
            const infoCampo = this.m_listarCamposDe(est).find(c => c.nombre === campo);
            const regCampo = (infoCampo && infoCampo.registro) || {};

            // Siguiente número de cuadro sugerido
            const nums = lotesExistentes.map(l => parseFloat(l.lote)).filter(n => !isNaN(n));
            const loteSugerido = (data && data.lote) ? data.lote : String(nums.length ? Math.max(...nums) + 1 : 1);
            const supAsignada = lotesExistentes
                .filter(l => l.origen === 'cuadros' && (!esEdicion || this.m_normalizarLoteNumero(l.lote) !== this.m_normalizarLoteNumero(data.lote)))
                .reduce((a, l) => a + (Number(l.sup) || 0), 0);
            const supDeclarada = infoCampo ? infoCampo.supDeclarada : 0;

            titulo = esEdicion ? `EDITAR CUADRO · LOTE ${data.lote}` : (data && data.lote ? `REGISTRAR FICHA · LOTE ${data.lote}` : 'NUEVO CUADRO / LOTE');
            html = `
                <div class="aviso-form">
                    <strong>Jerarquía:</strong> ${this.m_esc(est)} › ${this.m_esc(campo)}
                    ${supDeclarada > 0 ? `<br>Superficie del campo: <b>${this.m_fmtHas(supDeclarada)} Has</b> · ya asignada en cuadros: <b>${this.m_fmtHas(supAsignada)} Has</b> · disponible: <b>${this.m_fmtHas(Math.max(0, supDeclarada - supAsignada))} Has</b>` : ''}
                </div>
                ${data && data.origen && data.origen !== 'cuadros' ? `<div class="aviso-form ambar">Este lote aparece en ${data.origen === 'campos' ? 'la tabla campos (formato anterior)' : 'siembras'} pero no tiene ficha en <b>cuadros</b>. Al guardar se registra correctamente.</div>` : ''}
                <input type="hidden" id="fq_est" value="${this.m_esc(est)}">
                <input type="hidden" id="fq_campo" value="${this.m_esc(campo)}">
                <div class="form-seccion">
                    <div class="form-seccion-titulo">Identificación del cuadro</div>
                    <div class="form-grid">
                        ${this.m_htmlInput('fq_lote', 'N° de lote / cuadro', loteSugerido, { req: true, placeholder: 'Ej: 1' })}
                        ${this.m_htmlInput('fq_nombre', 'Nombre del cuadro', q.nombre_lote || (data && data.nombre_lote && data.origen === 'cuadros' ? data.nombre_lote : ''), { placeholder: 'Ej: Cuadro Norte' })}
                        ${this.m_htmlInput('fq_sup', 'Superficie (Has)', q.sup !== undefined && q.sup !== null ? q.sup : (data && data.sup ? data.sup : ''), { tipo: 'number', step: '0.01', req: true, placeholder: '0.00' })}
                    </div>
                </div>
                <div class="form-seccion">
                    <div class="form-seccion-titulo">Ubicación</div>
                    <div class="form-grid">
                        ${this.m_htmlInput('fq_localidad', 'Localidad', q.localidad || regCampo.localidad || '', { lista: localidades })}
                        ${this.m_htmlInput('fq_provincia', 'Provincia', q.provincia || regCampo.provincia || '', { lista: provincias })}
                        ${this.m_htmlInput('fq_domicilio', 'Domicilio', q.domicilio || regCampo.domicilio || '', { full: true })}
                        ${this.m_htmlInput('fq_poligono', 'Polígono georreferencial', q.poligono || (data && data.origen === 'campos' && q.ubicacion) || '', { full: true, placeholder: 'Link de Google Maps, KML o coordenadas' })}
                    </div>
                </div>`;
        }

        document.getElementById('modal-titulo-campos').innerText = titulo;
        container.innerHTML = html;
        document.getElementById('modal-agrosoft-campos').style.display = 'flex';

        setTimeout(() => {
            const primero = container.querySelector('input:not([type=hidden]):not([readonly]), select');
            if (primero) primero.focus();
        }, 60);

        // Enter guarda
        container.onkeydown = (ev) => {
            if (ev.key === 'Enter' && ev.target.tagName !== 'TEXTAREA') {
                ev.preventDefault();
                this.m_guardarRegistro();
            }
        };
    },

    m_editarEstablecimiento: function(nombre) {
        const e = this.m_listarEstablecimientos().find(x => x.nombre === nombre);
        if (!e) return;
        this.m_abrirFormTerritorial('ESTABLECIMIENTO', {
            esEdicion: true,
            nombre: e.nombre,
            registro: e.registro,
            puedeEliminar: !!e.registro
        });
    },

    m_editarLote: function(lote) {
        const est = this.seleccionActual.establecimiento;
        const campo = this.seleccionActual.campo;
        const l = this.m_obtenerCuadrosDelCampo(est, campo)
            .find(x => this.m_normalizarLoteNumero(x.lote) === this.m_normalizarLoteNumero(lote)
                    || String(x.reg_local) === String(lote));
        if (!l) return;
        this.m_abrirFormTerritorial('CUADRO', {
            esEdicion: l.origen === 'cuadros',
            establecimiento: est,
            campo: campo,
            lote: l.lote,
            nombre_lote: l.nombre_lote,
            sup: l.sup,
            origen: l.origen,
            registro: l.registro,
            puedeEliminar: l.origen === 'cuadros'
        });
    },

    m_editarCampoSector: function(est, campoActual) {
        const c = this.m_listarCamposDe(est).find(x => x.nombre === campoActual);
        if (!c) return;
        this.m_abrirFormTerritorial('CAMPO', {
            esEdicion: true,
            establecimiento: est,
            campo: campoActual,
            registro: c.registro,
            cabecera: c.cabecera,
            puedeEliminar: c.registros.length > 0
        });
    },

    // Crea la ficha del establecimiento si todavía no existe en su tabla
    m_asegurarEstablecimientoRegistrado: async function(nombre) {
        if (!nombre) return;
        const existe = this.listaEstablecimientos.some(e => this.m_norm(e.establecimiento) === this.m_norm(nombre));
        if (existe) return;
        try {
            const reg = (await this.m_obtenerMaxRegLocal('establecimientos')) + 1;
            const id = (await this.m_obtenerMaxColumna('establecimientos', 'id')) + 1;
            await this.m_ejecutarSqlLocal(
                `INSERT INTO establecimientos (id, reg_local, establecimiento, sincronizado) VALUES (?, ?, ?, 0)`,
                [id, String(reg), nombre]
            );
            this.listaEstablecimientos.push({ id, reg_local: String(reg), establecimiento: nombre });
        } catch (e) {
            console.warn("No se pudo registrar el establecimiento automáticamente:", e.message);
        }
    },

    m_guardarTerritorial: async function(tipo) {
        const btn = document.getElementById('btn-guardar-campos');
        const textoOriginal = btn ? btn.innerText : 'GUARDAR';
        const fallar = (msg) => {
            if (btn) { btn.innerText = textoOriginal; btn.disabled = false; }
            this.m_notificarApple(msg, 'error');
        };
        const data = this.datosEdicionActual || {};
        const esEdicion = !!data.esEdicion;
        if (btn) { btn.innerText = 'GUARDANDO...'; btn.disabled = true; }

        try {
            // ---------------- ESTABLECIMIENTO -> tabla establecimientos ----------------
            if (tipo === 'ESTABLECIMIENTO') {
                const nombre = this.m_val('fe_nombre');
                if (!nombre) return fallar('El nombre del establecimiento es obligatorio.');

                const duplicado = this.m_listarEstablecimientos().some(e =>
                    this.m_norm(e.nombre) === this.m_norm(nombre) &&
                    (!esEdicion || this.m_norm(e.nombre) !== this.m_norm(data.nombre)));
                if (duplicado) return fallar(`Ya existe un establecimiento llamado "${nombre}".`);

                const valores = [
                    nombre, this.m_val('fe_razon'), this.m_val('fe_cuit'), this.m_val('fe_localidad'),
                    this.m_val('fe_provincia'), this.m_val('fe_domicilio'), this.m_val('fe_responsable'),
                    this.m_val('fe_telefono'), this.m_val('fe_obs')
                ];

                if (esEdicion && data.registro) {
                    await this.m_ejecutarSqlLocal(
                        `UPDATE establecimientos SET establecimiento=?, razon_social=?, cuit=?, localidad=?, provincia=?, domicilio=?, responsable=?, telefono=?, observaciones=?, sincronizado=0 WHERE reg_local=?`,
                        [...valores, String(data.registro.reg_local)]
                    );
                } else {
                    const reg = (await this.m_obtenerMaxRegLocal('establecimientos')) + 1;
                    const id = (await this.m_obtenerMaxColumna('establecimientos', 'id')) + 1;
                    await this.m_ejecutarSqlLocal(
                        `INSERT INTO establecimientos (establecimiento, razon_social, cuit, localidad, provincia, domicilio, responsable, telefono, observaciones, reg_local, id, sincronizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
                        [...valores, String(reg), id]
                    );
                }

                // Renombrado en cascada
                if (esEdicion && data.nombre !== nombre) {
                    const cascada = [
                        `UPDATE campos SET establecimiento=?, sincronizado=0 WHERE UPPER(TRIM(establecimiento)) = UPPER(TRIM(?))`,
                        `UPDATE cuadros SET establecimiento=?, sincronizado=0 WHERE UPPER(TRIM(establecimiento)) = UPPER(TRIM(?))`,
                        `UPDATE inventario_plantacion SET establecimiento=?, sincronizado=0 WHERE UPPER(TRIM(establecimiento)) = UPPER(TRIM(?))`
                    ];
                    for (const sql of cascada) await this.m_ejecutarSqlLocal(sql, [nombre, data.nombre]);
                }

                this.seleccionActual.establecimiento = nombre;
                if (!esEdicion) { this.seleccionActual.campo = null; this.seleccionActual.lotes = []; }
            }

            // ---------------- CAMPO -> tabla campos ----------------
            else if (tipo === 'CAMPO') {
                const est = this.m_val('fc_est');
                const campo = this.m_val('fc_campo');
                if (!est || !campo) return fallar('Establecimiento y nombre del campo son obligatorios.');

                const duplicado = this.m_listarCamposDe(est).some(c =>
                    this.m_norm(c.nombre) === this.m_norm(campo) &&
                    !(esEdicion && this.m_norm(est) === this.m_norm(data.establecimiento) && this.m_norm(c.nombre) === this.m_norm(data.campo)));
                if (duplicado) return fallar(`"${campo}" ya existe en ${est}.`);

                const supTotal = parseFloat(this.m_val('fc_sup')) || 0;
                const loc = this.m_val('fc_localidad');
                const prov = this.m_val('fc_provincia');
                const dom = this.m_val('fc_domicilio');
                const ubic = this.m_val('fc_ubicacion');

                await this.m_asegurarEstablecimientoRegistrado(est);

                if (esEdicion) {
                    // Mover / renombrar todo lo que cuelga del campo
                    if (data.establecimiento !== est || data.campo !== campo) {
                        const w = `UPPER(TRIM(establecimiento)) = UPPER(TRIM(?)) AND UPPER(TRIM(campo)) = UPPER(TRIM(?))`;
                        await this.m_ejecutarSqlLocal(`UPDATE campos SET establecimiento=?, campo=?, sincronizado=0 WHERE ${w}`, [est, campo, data.establecimiento, data.campo]);
                        await this.m_ejecutarSqlLocal(`UPDATE cuadros SET establecimiento=?, campo=?, sincronizado=0 WHERE ${w}`, [est, campo, data.establecimiento, data.campo]);
                        await this.m_ejecutarSqlLocal(
                            `UPDATE inventario_plantacion SET establecimiento=?, campo=?, sector=?, sincronizado=0
                             WHERE UPPER(TRIM(establecimiento)) = UPPER(TRIM(?)) AND (UPPER(TRIM(campo)) = UPPER(TRIM(?)) OR UPPER(TRIM(sector)) = UPPER(TRIM(?)))`,
                            [est, campo, campo, data.establecimiento, data.campo, data.campo]
                        );
                    }
                    if (data.cabecera && data.cabecera.id !== undefined && data.cabecera.id !== null) {
                        await this.m_ejecutarSqlLocal(
                            `UPDATE campos SET localidad=?, provincia=?, domicilio=?, sup_total=?, ubicacion=?, sincronizado=0 WHERE id=?`,
                            [loc, prov, dom, supTotal, ubic, data.cabecera.id]
                        );
                    } else {
                        const reg = (await this.m_obtenerMaxRegLocal('campos')) + 1;
                        const id = (await this.m_obtenerMaxColumna('campos', 'id')) + 1;
                        await this.m_ejecutarSqlLocal(
                            `INSERT INTO campos (id, establecimiento, campo, localidad, provincia, domicilio, sup_total, ubicacion, reg_local, lote, sincronizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)`,
                            [id, est, campo, loc, prov, dom, supTotal, ubic, String(reg)]
                        );
                    }
                } else {
                    const reg = (await this.m_obtenerMaxRegLocal('campos')) + 1;
                    const id = (await this.m_obtenerMaxColumna('campos', 'id')) + 1;
                    await this.m_ejecutarSqlLocal(
                        `INSERT INTO campos (id, establecimiento, campo, localidad, provincia, domicilio, sup_total, ubicacion, reg_local, lote, sincronizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)`,
                        [id, est, campo, loc, prov, dom, supTotal, ubic, String(reg)]
                    );
                }

                this.seleccionActual = { establecimiento: est, campo: campo, lotes: [] };
            }

            // ---------------- CUADRO -> tabla cuadros ----------------
            else if (tipo === 'CUADRO') {
                const est = this.m_val('fq_est');
                const campo = this.m_val('fq_campo');
                const loteTxt = this.m_val('fq_lote');
                const lote = this.m_normalizarLoteNumero(loteTxt);
                const supTxt = this.m_val('fq_sup');
                const sup = parseFloat(supTxt);

                if (!est || !campo) return fallar('Seleccioná primero un establecimiento y un campo.');
                if (!lote) return fallar('El número de lote / cuadro es obligatorio.');
                if (supTxt === '' || isNaN(sup) || sup < 0) return fallar('Ingresá una superficie válida.');

                const loteOriginal = esEdicion ? this.m_normalizarLoteNumero(data.lote) : null;
                const duplicado = this.listaCuadros.some(c =>
                    this.m_norm(c.campo) === this.m_norm(campo) &&
                    (!c.establecimiento || this.m_norm(c.establecimiento) === this.m_norm(est)) &&
                    this.m_normalizarLoteNumero(c.lote) === lote &&
                    !(esEdicion && String(c.reg_local) === String(data.registro && data.registro.reg_local)));
                if (duplicado) return fallar(`El lote ${lote} ya existe en ${campo}.`);

                const nombreLote = this.m_val('fq_nombre') || `Cuadro ${lote}`;
                const valores = [
                    est, campo, this.m_val('fq_localidad'), this.m_val('fq_provincia'),
                    this.m_val('fq_domicilio'), nombreLote, lote, sup, this.m_val('fq_poligono')
                ];

                await this.m_asegurarEstablecimientoRegistrado(est);

                if (esEdicion && data.registro) {
                    await this.m_ejecutarSqlLocal(
                        `UPDATE cuadros SET establecimiento=?, campo=?, localidad=?, provincia=?, domicilio=?, nombre_lote=?, lote=?, sup=?, poligono=?, sincronizado=0 WHERE reg_local=?`,
                        [...valores, data.registro.reg_local]
                    );
                    // Si cambió el número de lote, las siembras lo acompañan
                    if (loteOriginal && loteOriginal !== lote) {
                        const siembras = [...this.inventarioActivo, ...this.inventarioHistorial]
                            .filter(i => this.m_coincideLote(i, est, campo, loteOriginal) &&
                                         this.m_normalizarLoteNumero(i.lote) === loteOriginal);
                        for (const s of siembras) {
                            await this.m_ejecutarSqlLocal(
                                `UPDATE inventario_plantacion SET lote=?, sincronizado=0 WHERE reg_local=? AND id=?`,
                                [lote, String(s.reg_local), s.id]
                            );
                        }
                    }
                } else {
                    const reg = (await this.m_obtenerMaxRegLocal('cuadros')) + 1;
                    const id = (await this.m_obtenerMaxColumna('cuadros', 'id')) + 1;
                    await this.m_ejecutarSqlLocal(
                        `INSERT INTO cuadros (establecimiento, campo, localidad, provincia, domicilio, nombre_lote, lote, sup, poligono, reg_local, id, sincronizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
                        [...valores, reg, id]
                    );
                }

                this.seleccionActual.establecimiento = est;
                this.seleccionActual.campo = campo;
                this.seleccionActual.lotes = [lote];
            }

            this.m_cerrarModal();
            const etiquetas = { ESTABLECIMIENTO: 'Establecimiento', CAMPO: 'Campo', CUADRO: 'Cuadro' };
            this.m_notificarApple(`${etiquetas[tipo]} ${esEdicion ? 'actualizado' : 'creado'} en base local.`, 'exito');
            await this.m_inicializar();

        } catch (e) {
            console.error("❌ Falló el guardado territorial:", e);
            fallar('Error al guardar: ' + e.message);
        }
    },

    m_eliminarTerritorial: async function() {
        const tipo = this.modalTipoActual;
        const data = this.datosEdicionActual || {};
        if (!data.esEdicion) return;

        try {
            if (tipo === 'CUADRO') {
                const activas = this.inventarioActivo.filter(i => this.m_coincideLote(i, data.establecimiento, data.campo, data.lote));
                if (activas.length > 0) {
                    return this.m_notificarApple(`El lote ${data.lote} tiene ${activas.length} siembra(s) activa(s). Cerralas antes de eliminarlo.`, 'error');
                }
                if (!confirm(`⚠️ ¿Eliminar el cuadro Lote ${data.lote} de ${data.campo}? Esta acción no se puede deshacer.`)) return;
                await this.m_ejecutarSqlLocal(`DELETE FROM cuadros WHERE reg_local = ?`, [data.registro.reg_local]);
                this.seleccionActual.lotes = [];

            } else if (tipo === 'CAMPO') {
                const cuadrosFicha = this.m_obtenerCuadrosDelCampo(data.establecimiento, data.campo).filter(l => l.origen === 'cuadros').length;
                const siembras = [...this.inventarioActivo, ...this.inventarioHistorial].filter(i => this.m_coincideLote(i, data.establecimiento, data.campo, [])).length;
                if (cuadrosFicha > 0 || siembras > 0) {
                    return this.m_notificarApple(`No se puede eliminar: el campo tiene ${cuadrosFicha} cuadro(s) y ${siembras} siembra(s) registradas.`, 'error');
                }
                if (!confirm(`⚠️ ¿Eliminar el campo "${data.campo}"? Esta acción no se puede deshacer.`)) return;
                await this.m_ejecutarSqlLocal(
                    `DELETE FROM campos WHERE UPPER(TRIM(establecimiento)) = UPPER(TRIM(?)) AND UPPER(TRIM(campo)) = UPPER(TRIM(?))`,
                    [data.establecimiento, data.campo]
                );
                this.seleccionActual.campo = null;

            } else if (tipo === 'ESTABLECIMIENTO') {
                const campos = this.m_listarCamposDe(data.nombre).length;
                if (campos > 0) {
                    return this.m_notificarApple(`No se puede eliminar: "${data.nombre}" tiene ${campos} campo(s). Eliminá o mové sus campos primero.`, 'error');
                }
                if (!confirm(`⚠️ ¿Eliminar el establecimiento "${data.nombre}"? Esta acción no se puede deshacer.`)) return;
                await this.m_ejecutarSqlLocal(`DELETE FROM establecimientos WHERE reg_local = ?`, [String(data.registro.reg_local)]);
                this.seleccionActual = { establecimiento: null, campo: null, lotes: [] };
            }

            this.m_cerrarModal();
            this.m_notificarApple('Registro eliminado de la base local.', 'exito');
            await this.m_inicializar();
        } catch (e) {
            console.error("❌ Error al eliminar:", e);
            this.m_notificarApple('Error al eliminar: ' + e.message, 'error');
        }
    },

    m_guardarRegistro: async function() {
        const tipo = this.modalTipoActual;
        if (tipo === 'ESTABLECIMIENTO' || tipo === 'CAMPO' || tipo === 'CUADRO') {
            return this.m_guardarTerritorial(tipo);
        }

        const btn = document.getElementById('btn-guardar-campos');
        if (btn) btn.innerText = "GUARDANDO...";

        const esEdicion = this.datosEdicionActual !== null;
        let reg_local_input = parseInt((document.getElementById('f_reg_local') || {}).value, 10) || 0;

        try {
            if (tipo === 'INVENTARIO') {
                const estabSel = esEdicion ? this.datosEdicionActual.establecimiento : this.seleccionActual.establecimiento;
                const campoSel = esEdicion ? this.datosEdicionActual.campo : this.seleccionActual.campo;
                const loteSel = esEdicion ? this.datosEdicionActual.lote : (this.seleccionActual.lotes[0] || '1');

                let finalRegLocal = reg_local_input;
                if (!esEdicion || finalRegLocal === 0) {
                    const maxVal = await this.m_obtenerMaxRegLocal('inventario_plantacion');
                    finalRegLocal = maxVal + 1;
                }

                const cultivo = document.getElementById('f_cultivo').value;
                const variedad = document.getElementById('f_variedad').value;
                const sup = parseFloat(document.getElementById('f_sup_inventario').value) || 0.0;
                const fecha = document.getElementById('f_fecha').value;

                if (!cultivo) {
                    if (btn) btn.innerText = "REINTENTAR";
                    return this.m_notificarApple("Seleccioná un cultivo.", "error");
                }

                let sql, params;
                if (esEdicion) {
                    sql = `UPDATE inventario_plantacion SET establecimiento=?, campo=?, sector=?, lote=?, cultivo=?, variedad=?, sup=?, fecha_siembra=?, estado='ACTIVO', sincronizado=0 WHERE reg_local=?`;
                    params = [estabSel, campoSel, campoSel, String(loteSel), cultivo, variedad, sup, fecha, String(finalRegLocal)];
                } else {
                    const maxId = await this.m_obtenerMaxIdPlantacion();
                    const nuevoId = maxId + 1;

                    sql = `INSERT INTO inventario_plantacion (reg_local, id, establecimiento, campo, sector, lote, cultivo, variedad, sup, fecha_siembra, estado, sincronizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVO', 0)`;
                    params = [String(finalRegLocal), nuevoId, estabSel, campoSel, campoSel, String(loteSel), cultivo, variedad, sup, fecha];
                }

                await this.m_ejecutarSqlLocal(sql, params);
            }

            this.m_cerrarModal();
            this.m_notificarApple("Guardado en Base Local con éxito.", "exito");
            this.m_inicializar();

        } catch (e) {
            console.error("❌ Falló el guardado local:", e.message);
            if (btn) btn.innerText = "REINTENTAR";
            this.m_notificarApple("Error al guardar: " + e.message, "error");
        }
    },

    m_cerrarModal: function() {
        const m = document.getElementById('modal-agrosoft-campos');
        if (m) m.style.display = 'none';
        const btnDel = document.getElementById('btn-eliminar-campos');
        if (btnDel) btnDel.style.display = 'none';
        const btn = document.getElementById('btn-guardar-campos');
        if (btn) btn.disabled = false;
    },

    m_verDetalle: function(reg) {
        const item = this.inventarioActivo.find(i => String(i.reg_local) === String(reg));
        if (item) this.m_abrirModal('INVENTARIO', item);
    }
};


// =========================================================================
// CONSTANTES Y HELPERS INSTITUCIONALES (SALVUCCI / AGROSOFT J&L)
// =========================================================================
const SALVUCCI_CONF = {
    pieInstitucional: 'Sistemas de Gestión Agrosoft J&L - Chimpay R.N. - Contacto: jsosa190585@gmail.com',
    empresaRazon: 'SALVUCCI GESTIÓN · AGROSOFT J&L',
    empresaDomicilio: 'Auditoría Territorial y Plantaciones',
    rgbTema: [30, 107, 76],        // #1E6B4C Verde institucional
    rgbTemaDark: [18, 63, 44],      // #123F2C
    argbTema: 'FF1E6B4C',
    argbDark: 'FF123F2C'
};

const CODE128_PATRONES = [
    '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
    '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
    '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
    '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
    '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
    '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
    '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
    '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
    '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
    '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
    '114131','311141','411131','211412','211214','211232','2331112'
];

function code128Modulos(texto) {
    const limpio = String(texto == null ? '' : texto).replace(/[^\x20-\x7E]/g, '').slice(0, 40) || ' ';
    const valores = [];
    for (let i = 0; i < limpio.length; i++) valores.push(limpio.charCodeAt(i) - 32);
    let suma = 104;
    valores.forEach((v, i) => { suma += v * (i + 1); });
    const indices = [104].concat(valores, [suma % 103, 106]);
    const trama = indices.map(i => CODE128_PATRONES[i]).join('');
    const elementos = [];
    let totalModulos = 0;
    for (let i = 0; i < trama.length; i++) {
        const ancho = parseInt(trama.charAt(i), 10);
        elementos.push({ barra: i % 2 === 0, ancho: ancho });
        totalModulos += ancho;
    }
    return { elementos: elementos, totalModulos: totalModulos, texto: limpio };
}

function dibujarCodigoBarrasPdf(doc, texto, x, y, ancho, alto) {
    const cb = code128Modulos(texto);
    const modulo = ancho / cb.totalModulos;
    doc.setFillColor(0, 0, 0);
    let cursor = x;
    cb.elementos.forEach(el => {
        const w = el.ancho * modulo;
        if (el.barra) doc.rect(cursor, y, w, alto, 'F');
        cursor += w;
    });
    doc.setFont('courier', 'normal');
    doc.setFontSize(6.4);
    doc.setTextColor(60, 60, 60);
    doc.text(cb.texto, x + ancho / 2, y + alto + 2.6, { align: 'center' });
}

function codigoBarrasPngBase64(texto, anchoPx, altoPx) {
    try {
        const cb = code128Modulos(texto);
        const lienzo = document.createElement('canvas');
        lienzo.width = anchoPx;
        lienzo.height = altoPx;
        const ctx = lienzo.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, anchoPx, altoPx);
        const modulo = anchoPx / cb.totalModulos;
        const altoBarras = altoPx - 13;
        ctx.fillStyle = '#000000';
        let cursor = 0;
        cb.elementos.forEach(el => {
            const w = el.ancho * modulo;
            if (el.barra) ctx.fillRect(cursor, 0, w, altoBarras);
            cursor += w;
        });
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(cb.texto, anchoPx / 2, altoPx - 1);
        return lienzo.toDataURL('image/png');
    } catch (e) {
        return null;
    }
}

function cargarLogoBase64() {
    if (typeof require === 'function') {
        try {
            const fs = require('fs');
            const pathMod = require('path');
            return fs.readFileSync(pathMod.join(__dirname, 'logo.png')).toString('base64');
        } catch (e) {
            return null;
        }
    }
    return null;
}

function generarFolio(prefijo) {
    const f = new Date();
    const d = f.getFullYear() + String(f.getMonth() + 1).padStart(2, '0') + String(f.getDate()).padStart(2, '0');
    return `${prefijo}-${d}-${Date.now().toString().slice(-5)}`;
}

function guardarEnDescargas(nombreArchivo, buffer) {
    const os = require('os');
    const pathMod = require('path');
    const fs = require('fs');
    const carpeta = pathMod.join(os.homedir(), 'Downloads');
    if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });
    const ruta = pathMod.join(carpeta, nombreArchivo);
    fs.writeFileSync(ruta, buffer);
    return ruta;
}

function descargarNativoBlob(blob, nombreArchivo) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', nombreArchivo);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

window.ModuloCampos = ModuloCampos;
window.PAR_ESTABLECIMIENTOS = ModuloCampos;