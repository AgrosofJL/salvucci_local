/**
 * ModuloProduccion: Control Integral de Cosechas, Rendimientos y Acopios
 * AgroSoft J&L - "Apple Soft Studio" Edition / Tipografía Roboto
 * Mode: Local-First (Engine SQLite IPC) + "No me quites nada" + Max(registro)+1 + sincronizado = 0
 * 
 * ACA ES LO NUEVO:
 * 1. Nueva solapa independiente exclusiva para "🌱 SIEMBRAS PENDIENTES DE COSECHA".
 * 2. Cabeceras fijas (sticky headers) en todas las tablas con scroll vertical optimizado.
 * 3. Filtrado dinámico independiente por establecimiento, campaña y búsqueda de texto en tiempo real.
 */
const ModuloProduccion = {
    datosProduccion: [],
    datosInventarioActivo: [],   // Inventario vivo de plantación activo (local)
    datosHistorialInactivo: [],  // Historial de siembras cerradas (local)
    datosAcopio: [],             // Espejo de acopio_produccion local
    filtroActual: null,          // Filtro por Establecimiento
    filtroCampana: '',           // Filtro por Campaña
    buscadorTexto: '',
    // ESTO LO MODIFIQUE: 3 Solapas tipo archivero (PRODUCCION | PENDIENTES | HISTORIAL)
    vistaActual: 'PRODUCCION',   // PRODUCCION | PENDIENTES | HISTORIAL

    // Helper IPC para ejecutar consultas SQL en la base SQLite local
    m_ejecutarSqlLocal: async function(sql, params = []) {
        if (window.apiLocal && window.apiLocal.query) {
            return await window.apiLocal.query({ sql, params });
        }
        if (window.electronAPI && window.electronAPI.invoke) {
            return await window.electronAPI.invoke('local-db-query', { sql, params });
        }
        throw new Error("No se encontró el puente IPC con la base de datos base local.");
    },

    // Normalizador numérico compatible con "1.0", "1", "Lote 1"
    m_normalizarLoteNumero: function(val) {
        if (val === null || val === undefined) return '';
        const str = val.toString().trim().toUpperCase().replace(/^(LOTE|CUADRO|L)\s*[-_:]?\s*/i, '');
        const num = parseFloat(str);
        return !isNaN(num) ? num.toString() : str;
    },

    /**
     * Carga 100% Offline desde SQLite local
     */
    m_inicializar: async function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;

        visor.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; min-height: 250px; gap:16px; font-family:'Roboto', sans-serif;">
                <div class="loader-apple"></div>
                <span style="color:#0071E3; font-weight:600; letter-spacing:0.4px; font-size:0.85rem;">CARGANDO INVENTARIO Y COSECHAS DESDE BASE LOCAL...</span>
            </div>
        `;

        try {
            const [resInventario, resProd, resHistorial, resAcopio] = await Promise.all([
                this.m_ejecutarSqlLocal(`SELECT * FROM inventario_plantacion WHERE UPPER(estado) = 'ACTIVO'`),
                this.m_ejecutarSqlLocal(`SELECT * FROM p_produccion ORDER BY fecha_cosecha DESC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM inventario_plantacion WHERE UPPER(estado) = 'INACTIVO'`),
                this.m_ejecutarSqlLocal(`SELECT * FROM acopio_produccion`)
            ]);

            this.datosInventarioActivo = resInventario.data || resInventario || [];
            this.datosProduccion = resProd.data || resProd || [];
            this.datosHistorialInactivo = resHistorial.data || resHistorial || [];
            this.datosAcopio = resAcopio.data || resAcopio || [];

            this.m_dibujarDashboard();
        } catch (err) {
            console.error("❌ Error en inicialización de Producción Base Local:", err);
            visor.innerHTML = `<div style="color:#E0342A; text-align:center; padding:40px; font-family:'Roboto';"><h3>ERROR LOCAL</h3><p>${err.message}</p></div>`;
        }
    },

    m_cambiarVista: function(vista) {
        this.vistaActual = vista;
        this.m_dibujarDashboard();
    },

    m_asegurarModalBase: function() {
        if (!document.getElementById('modal-agrosoft-produccion')) {
            const modalHTML = `
                <div id="modal-agrosoft-produccion" class="modal-overlay" style="display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(18, 22, 28, 0.48); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); z-index: 99999; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box;">
                    <div class="modal-apple-content" style="background: #FFFFFF; border: 1.5px solid #E0DCD4; border-radius: 14px; padding: 24px; width: 95%; max-width: 680px; max-height: 90vh; color: #1D1D1F; box-shadow: 0 10px 25px rgba(0,0,0,0.15); display: flex; flex-direction: column; position: relative;">
                        <div class="modal-header-apple" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid #E0DCD4; padding-bottom: 12px; flex-shrink: 0;">
                            <h3 id="modal-titulo-produccion" style="margin: 0; font-size: 1.15rem; font-weight: 800; font-family: 'Roboto', sans-serif; color: #123F2C; letter-spacing: -0.3px;">REGISTRO DE COSECHA</h3>
                            <button onclick="document.getElementById('modal-agrosoft-produccion').style.display='none'" style="background: none; border: none; color: #6E6E73; font-size: 1.5rem; font-weight:bold; cursor: pointer;">&times;</button>
                        </div>
                        <div id="modal-formulario-produccion" style="overflow-y: auto; padding-right: 4px;"></div>
                        <div class="modal-apple-footer" style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; border-top: 1px solid #E0DCD4; padding-top: 14px; flex-shrink: 0;">
                            <button onclick="document.getElementById('modal-agrosoft-produccion').style.display='none'" style="background: #F0F2F5; color: #1D1D1F; border: 1px solid #E0DCD4; padding: 9px 18px; border-radius: 8px; font-weight: 700; font-size: 0.8rem; cursor: pointer;">CANCELAR</button>
                            <button class="btn-save-soft" style="background: #1E6B4C; color: #FFF; border: none; padding: 9px 22px; border-radius: 8px; font-weight: 700; font-size: 0.8rem; cursor: pointer; box-shadow: 0 4px 12px rgba(30,107,76,0.25);" onclick="ModuloProduccion.m_guardarProduccion()">GUARDAR COSECHA</button>
                        </div>
                    </div>
                </div>`;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
        }
    },

    m_dibujarDashboard: function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;

        const datos = this.m_obtenerDatosFiltrados();
        const pendientes = this.m_obtenerCultivosActivosSinCosecha();
        
        const totalKilos = datos.reduce((acc, curr) => acc + (Number(curr.kilos) || 0), 0);
        const totalHas = datos.reduce((acc, curr) => acc + (Number(curr.sup) || 0), 0);
        const rendPromedio = totalHas > 0 ? (totalKilos / totalHas).toFixed(2) : "0.00";
        const totalHasPendientes = pendientes.reduce((acc, curr) => acc + (Number(curr.sup) || 0), 0);
        
        const establecimientos = [...new Set(this.datosInventarioActivo.map(p => p.establecimiento).concat(this.datosProduccion.map(p => p.establecimiento)).filter(Boolean))].sort();
        const campanas = [...new Set(this.datosProduccion.map(p => p.campaña).filter(Boolean))];

        visor.innerHTML = `
            <style>
                .prod-layout { font-family: 'Roboto', sans-serif; color: #1D1D1F; padding: 8px 18px 25px 18px; }
                
                /* TABS ARCHIVERO SUPERIOR */
                .tabs-header-archivero-main {
                    display: flex; gap: 8px; border-bottom: 2px solid #E0DCD4; margin-bottom: 12px; align-items: flex-end;
                }
                .tab-main-archivero {
                    display: flex; align-items: center; gap: 8px; padding: 9px 18px; background: #EAE8E1;
                    border: 1.5px solid #E0DCD4; border-bottom: none; border-radius: 12px 12px 0 0;
                    font-size: 0.82rem; font-weight: 800; color: #6B6255; cursor: pointer; transition: all 0.15s ease;
                    position: relative; bottom: -2px;
                }
                .tab-main-archivero:hover { background: #F0EEE8; color: #211C16; }
                .tab-main-archivero.active {
                    background: #FFFFFF; color: #123F2C; border-color: #E0DCD4; border-top: 3px solid #1E6B4C;
                    box-shadow: 0 -2px 8px rgba(0,0,0,0.04);
                }
                .badge-tab-main {
                    background: rgba(30, 107, 76, 0.1); color: #1E6B4C; padding: 2px 7px;
                    border-radius: 12px; font-size: 0.68rem; font-weight: 800;
                }
                .badge-tab-pend {
                    background: rgba(224, 134, 0, 0.12); color: #E08600; padding: 2px 7px;
                    border-radius: 12px; font-size: 0.68rem; font-weight: 800;
                }

                .grid-kpi-prod { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 12px; }
                @media (max-width: 1100px) { .grid-kpi-prod { grid-template-columns: repeat(2, 1fr); } }

                .card-kpi-prd {
                    background: #FFFFFF; border: 1.5px solid #E0DCD4; border-radius: 12px; padding: 12px 14px;
                    display: flex; flex-direction: column; gap: 3px; box-shadow: 0 2px 6px rgba(0,0,0,0.03);
                }
                .card-kpi-prd span { font-size: 0.62rem; color: #6B6255; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; }
                .card-kpi-prd strong { font-size: 1.25rem; font-weight: 800; color: #1D1D1F; }
                .card-kpi-prd.highlight-green strong { color: #1E6B4C; }
                .card-kpi-prd.highlight-blue strong { color: #0071E3; }

                .panel-box-plant {
                    background: #FFFFFF; border: 1.5px solid #E0DCD4; border-radius: 14px; padding: 14px;
                    display: flex; flex-direction: column; gap: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.04);
                }

                /* ESTO LO MODIFIQUE: CONTENEDOR CON CABECERAS FIJAS (STICKY HEADERS) */
                .wrapper-tabla-scroll-sticky {
                    max-height: calc(100vh - 275px);
                    overflow-y: auto;
                    overflow-x: auto;
                    border: 1px solid #E0DCD4;
                    border-radius: 10px;
                    background: #FFFFFF;
                    position: relative;
                }

                .tabla-cuadros-plant { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
                .tabla-cuadros-plant th {
                    background: #475569; color: #FFFFFF; font-size: 0.68rem; font-weight: 700;
                    text-transform: uppercase; padding: 10px 8px; text-align: left; letter-spacing: 0.4px;
                    position: sticky; top: 0; z-index: 10; box-shadow: 0 1px 3px rgba(0,0,0,0.12);
                }
                .tabla-cuadros-plant th.th-pendientes { background: #123F2C; }
                .tabla-cuadros-plant th.th-historial { background: #4B4F56; }
                
                .tabla-cuadros-plant td { padding: 9px 8px; border-bottom: 1px solid #E0DCD4; color: #211C16; vertical-align: middle; }
                .tabla-cuadros-plant tbody tr:hover { background: #F8FAFC; }

                .btn-accion-plant {
                    background: rgba(30, 107, 76, 0.1); border: 1px solid rgba(30,107,76,0.25); color: #1E6B4C;
                    padding: 4px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 700; cursor: pointer;
                    display: inline-flex; align-items: center; gap: 4px; transition: background 0.15s;
                }
                .btn-accion-plant:hover { background: rgba(30,107,76,0.2); }
                .btn-acopio { background: rgba(0,113,227,0.08); border-color: rgba(0,113,227,0.25); color: #0071E3; }
                .btn-acopio:hover { background: rgba(0,113,227,0.18); }
            </style>

            <div class="prod-layout animated fadeIn">
                ${ComponentesUI.botonVolverHTML('PRODUCCION')}

                <!-- ENCABEZADO Y TABS ARCHIVERO SUPERIOR -->
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; margin-bottom:10px; flex-wrap:wrap; gap:10px;">
                    <div>
                        <h2 style="margin:0; font-weight: 800; font-size: 1.3rem; letter-spacing: -0.5px; color:#123F2C;">Panel de Cosecha y Rendimientos</h2>
                        <p style="margin:2px 0 0 0; font-size:0.75rem; color:#6B6255;">Seguimiento de quintales cosechados sobre inventario vivo (base Local)</p>
                    </div>

                    <div style="display:flex; gap:8px; align-items:center;">
                        <button onclick="ModuloProduccion.m_exportarExcel()" style="background:#1FA958; color:#FFF; border:none; padding:7px 14px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:5px;">
                            <i data-lucide="file-spreadsheet" style="width:13px; height:13px;"></i> Excel
                        </button>
                        <button onclick="ModuloProduccion.m_exportarPDF()" style="background:#E0342A; color:#FFF; border:none; padding:7px 14px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:5px;">
                            <i data-lucide="file-text" style="width:13px; height:13px;"></i> PDF Reporte
                        </button>
                        <button onclick="ModuloProduccion.m_abrirModalProduccion()" style="background:#1E6B4C; color:#FFF; border:none; padding:7px 16px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer; display:flex; align-items:center; gap:6px;">
                            <i data-lucide="plus-circle" style="width:13px; height:13px;"></i> REGISTRAR COSECHA
                        </button>
                    </div>
                </div>

                <!-- ACA ES LO NUEVO: 3 TABS PRINCIPALES INCLUYENDO SOLAPA EXCLUSIVA PARA PENDIENTES -->
                <div class="tabs-header-archivero-main">
                    <div class="tab-main-archivero ${this.vistaActual === 'PRODUCCION' ? 'active' : ''}" onclick="ModuloProduccion.m_cambiarVista('PRODUCCION')">
                        <i data-lucide="bar-chart-3" style="width:14px; height:14px;"></i>
                        <span>COSECHAS Y RENDIMIENTO</span>
                        <span class="badge-tab-main">${datos.length} Registros</span>
                    </div>

                    <div class="tab-main-archivero ${this.vistaActual === 'PENDIENTES' ? 'active' : ''}" onclick="ModuloProduccion.m_cambiarVista('PENDIENTES')">
                        <i data-lucide="sprout" style="width:14px; height:14px; color:#E08600;"></i>
                        <span>🌱 PENDIENTES DE COSECHA</span>
                        <span class="badge-tab-pend">${pendientes.length} Lotes (${totalHasPendientes.toFixed(1)} Has)</span>
                    </div>

                    <div class="tab-main-archivero ${this.vistaActual === 'HISTORIAL' ? 'active' : ''}" onclick="ModuloProduccion.m_cambiarVista('HISTORIAL')">
                        <i data-lucide="archive" style="width:14px; height:14px;"></i>
                        <span>HISTORIAL DE SIEMBRA INACTIVA</span>
                        <span class="badge-tab-main" style="background:#E9EBEF; color:#4B4F56;">${this.datosHistorialInactivo.length} Cerrados</span>
                    </div>
                </div>

                <!-- KPIS PRINCIPALES FIJOS ARRIBA -->
                <div class="grid-kpi-prod">
                    <div class="card-kpi-prd highlight-green">
                        <span>VOLUMEN TOTAL COSECHADO</span>
                        <strong>${totalKilos.toLocaleString('es-AR')} KG</strong>
                    </div>
                    <div class="card-kpi-prd">
                        <span>RENDIMIENTO PROMEDIO GENERAL</span>
                        <strong style="color:#1E6B4C;">${rendPromedio} <small style="font-size:0.7rem; color:#6B6255;">kg/Ha</small></strong>
                    </div>
                    <div class="card-kpi-prd highlight-blue">
                        <span>SUPERFICIE TOTAL COSECHADA</span>
                        <strong>${totalHas.toFixed(1)} HAS</strong>
                    </div>
                    <div class="card-kpi-prd">
                        <span>PENDIENTES DE COSECHAR</span>
                        <strong style="color:#E08600;">${totalHasPendientes.toFixed(1)} HAS <small style="font-size:0.7rem; color:#6B6255;">(${pendientes.length} lotes)</small></strong>
                    </div>
                </div>

                <!-- BARRA DE BÚSQUEDA Y FILTROS -->
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap;">
                    <div style="display:flex; gap:8px; align-items:center;">
                        <input type="text" placeholder="🔍 Buscar lote, cultivo, campo..." value="${this.buscadorTexto}" oninput="ModuloProduccion.m_filtrarTexto(this.value)" style="padding:6px 12px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.78rem; outline:none; background:#FFFFFF; min-width:200px;">
                        
                        <select onchange="ModuloProduccion.m_aplicarFiltroEst(this.value)" style="padding:6px 12px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.78rem; outline:none; background:#FFFFFF; font-weight:600; cursor:pointer;">
                            <option value="">🏢 Todos los Establecimientos</option>
                            ${establecimientos.map(e => `<option value="${e}" ${this.filtroActual === e ? 'selected' : ''}>${e.toUpperCase()}</option>`).join('')}
                        </select>

                        ${this.vistaActual === 'PRODUCCION' ? `
                            <select onchange="ModuloProduccion.m_aplicarFiltroCampana(this.value)" style="padding:6px 12px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.78rem; outline:none; background:#FFFFFF; font-weight:600; cursor:pointer;">
                                <option value="">📅 Todas las Campañas</option>
                                ${campanas.map(c => `<option value="${c}" ${this.filtroCampana === c ? 'selected' : ''}>${c}</option>`).join('')}
                            </select>
                        ` : ''}
                    </div>

                    ${(this.filtroActual || this.filtroCampana || this.buscadorTexto) ? `
                        <button onclick="ModuloProduccion.m_limpiarFiltros()" style="background:rgba(224,52,42,0.1); border:1px solid rgba(224,52,42,0.25); color:#E0342A; padding:5px 12px; border-radius:6px; font-size:0.72rem; font-weight:700; cursor:pointer;">
                            ✕ Limpiar Filtros
                        </button>
                    ` : ''}
                </div>

                <!-- CONTENEDOR DINÁMICO SEGÚN LA SOLAPA SELECCIONADA -->
                ${this.vistaActual === 'PRODUCCION' ? this.m_renderVistaProduccion(datos) : ''}
                ${this.vistaActual === 'PENDIENTES' ? this.m_renderVistaPendientes(pendientes) : ''}
                ${this.vistaActual === 'HISTORIAL' ? this.m_renderHistorialInactivo() : ''}
            </div>
        `;
        if (window.lucide) lucide.createIcons();
    },

    // SOLAPA 1: TABLA DE COSECHAS REGISTRADAS CON CABECERAS FIJAS
    m_renderVistaProduccion: function(datos) {
        return `
            <div class="panel-box-plant">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:0.75rem; font-weight:800; color:#123F2C; text-transform:uppercase; letter-spacing:0.4px;">
                        🌾 Registro de Cosechas Realizadas (${datos.length})
                    </span>
                    <span style="font-size:0.72rem; color:#6B6255; font-weight:600;">Cabeceras siempre visibles</span>
                </div>

                <div class="wrapper-tabla-scroll-sticky scroll-apple">
                    <table class="tabla-cuadros-plant">
                        <thead>
                            <tr>
                                <th>Campaña</th>
                                <th>Fecha</th>
                                <th>Establecimiento & Campo</th>
                                <th>Lote</th>
                                <th>Cultivo & Variedad</th>
                                <th style="text-align:right;">Sup (Ha)</th>
                                <th style="text-align:right;">Kilos Netos</th>
                                <th style="text-align:right;">Rinde (Kg/Ha)</th>
                                <th style="text-align:center;">Acciones / Acopio</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this.m_renderFilasProduccion(datos)}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    // SOLAPA 2: TABLA DE SIEMBRAS ACTIVAS PENDIENTES DE COSECHA CON CABECERAS FIJAS
    m_renderVistaPendientes: function(pendientes) {
        return `
            <div class="panel-box-plant" style="background:#FAFBF9; border:1.5px solid rgba(30,107,76,0.3);">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <i data-lucide="sprout" style="width:16px; height:16px; color:#1E6B4C;"></i>
                        <span style="font-size:0.75rem; font-weight:800; color:#123F2C; text-transform:uppercase; letter-spacing:0.4px;">
                            🌱 Lotes con Siembra Activa Pendientes de Cosecha (${pendientes.length})
                        </span>
                    </div>
                    <span style="font-size:0.72rem; color:#6B6255; font-weight:600;">Inventario vivo de plantación</span>
                </div>

                <div class="wrapper-tabla-scroll-sticky scroll-apple">
                    <table class="tabla-cuadros-plant">
                        <thead>
                            <tr>
                                <th class="th-pendientes">Establecimiento</th>
                                <th class="th-pendientes">Campo / Sector</th>
                                <th class="th-pendientes">Lote / Cuadro</th>
                                <th class="th-pendientes">Cultivo</th>
                                <th class="th-pendientes">Variedad</th>
                                <th class="th-pendientes" style="text-align:right;">Superficie</th>
                                <th class="th-pendientes">Fecha Siembra</th>
                                <th class="th-pendientes" style="text-align:center;">Acción Directa</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${pendientes.length === 0 ? `
                                <tr><td colspan="8" style="text-align:center; padding:35px; color:#9AA0A6; font-style:italic;">No hay lotes con siembra activa pendientes de cosecha para los filtros seleccionados.</td></tr>
                            ` : pendientes.map(inv => `
                                <tr>
                                    <td><strong>${(inv.establecimiento || '-').toUpperCase()}</strong></td>
                                    <td>${inv.campo || inv.sector || '-'}</td>
                                    <td><span style="background:rgba(30,107,76,0.1); color:#1E6B4C; padding:2px 8px; border-radius:6px; font-weight:800; font-size:0.72rem;">Lote ${inv.lote}</span></td>
                                    <td><strong style="color:#1E6B4C;">🌱 ${(inv.cultivo || '').toUpperCase()}</strong></td>
                                    <td>${inv.variedad || 'General'}</td>
                                    <td style="text-align:right; font-weight:800; color:#1FA958;">${parseFloat(inv.sup || 0).toFixed(1)} Has</td>
                                    <td style="font-size:0.75rem; color:#6B6255;">${inv.fecha_siembra || '-'}</td>
                                    <td style="text-align:center;">
                                        <button class="btn-accion-plant" onclick='ModuloProduccion.m_abrirModalProduccionDesdeInventario(${JSON.stringify(inv)})' style="background:#1E6B4C; color:#FFFFFF; border:none; padding:5px 12px; border-radius:6px;">
                                            🌾 Cosechar Lote
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    // SOLAPA 3: TABLA DE HISTORIAL DE SIEMBRAS INACTIVAS CON CABECERAS FIJAS
    m_renderHistorialInactivo: function() {
        let historial = this.datosHistorialInactivo || [];
        if (this.filtroActual) {
            historial = historial.filter(h => (h.establecimiento || '').trim().toUpperCase() === this.filtroActual.trim().toUpperCase());
        }
        if (this.buscadorTexto) {
            const txt = this.buscadorTexto.toLowerCase();
            historial = historial.filter(h => 
                (h.campo || '').toLowerCase().includes(txt) ||
                (h.cultivo || '').toLowerCase().includes(txt) ||
                (h.variedad || '').toLowerCase().includes(txt) ||
                String(h.lote || '').toLowerCase().includes(txt)
            );
        }

        return `
            <div class="panel-box-plant">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:0.75rem; font-weight:800; color:#4B4F56; text-transform:uppercase; letter-spacing:0.4px;">
                        📜 Historial de Siembras Cerradas (${historial.length})
                    </span>
                    <span style="font-size:0.72rem; color:#6B6255; font-weight:600;">Cuadros finalizados o dados de baja</span>
                </div>

                <div class="wrapper-tabla-scroll-sticky scroll-apple">
                    <table class="tabla-cuadros-plant">
                        <thead>
                            <tr>
                                <th class="th-historial">Establecimiento</th>
                                <th class="th-historial">Campo / Sector</th>
                                <th class="th-historial">Localidad</th>
                                <th class="th-historial">Lote</th>
                                <th class="th-historial">Cultivo</th>
                                <th class="th-historial">Variedad</th>
                                <th class="th-historial" style="text-align:right;">Superficie</th>
                                <th class="th-historial">F. Siembra</th>
                                <th class="th-historial">F. Cierre</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${historial.length === 0 ? `
                                <tr><td colspan="9" style="text-align:center; padding:35px; color:#9AA0A6; font-style:italic;">No hay siembras cerradas registradas en el historial.</td></tr>
                            ` : historial.map(h => `
                                <tr>
                                    <td><strong>${(h.establecimiento || '-').toUpperCase()}</strong></td>
                                    <td>${h.campo || h.sector || '-'}</td>
                                    <td>${h.localidad || '-'}</td>
                                    <td><strong style="color:#0071E3;">Lote ${h.lote}</strong></td>
                                    <td><strong>${(h.cultivo || '-').toUpperCase()}</strong></td>
                                    <td>${h.variedad || '-'}</td>
                                    <td style="text-align:right; font-weight:800;">${parseFloat(h.sup || 0).toFixed(1)} Has</td>
                                    <td style="font-size:0.75rem; color:#6B6255;">${h.fecha_siembra || '-'}</td>
                                    <td style="font-size:0.75rem; color:#C62828; font-weight:700;">${h.fecha_cierre || '-'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    m_renderFilasProduccion: function(lista) {
        if (lista.length === 0) {
            return `<tr><td colspan="9" style="text-align:center; padding:35px; color:#9AA0A6; font-style:italic;">No hay registros de cosecha para los filtros seleccionados.</td></tr>`;
        }

        return lista.map(p => {
            const pendienteAcopio = this.m_calcularPendienteAcopio(p);
            const idTarget = p.reg_local || p.id;
            return `
                <tr>
                    <td><span style="background:#F0F2F5; color:#1D1D1F; padding:2px 8px; border-radius:6px; font-weight:700; font-size:0.7rem; border:1px solid #E0DCD4;">${p.campaña}</span></td>
                    <td style="font-size:0.75rem; color:#6B6255; font-weight:500;">${p.fecha_cosecha || '-'}</td>
                    <td>
                        <strong>${p.establecimiento}</strong>
                        <div style="font-size:0.7rem; color:#6B6255;">📍 ${p.campo}</div>
                    </td>
                    <td><strong style="color:#0071E3;">Lote ${p.lote}</strong></td>
                    <td>
                        <strong style="color:#1D1D1F;">${(p.cultivo || '').toUpperCase()}</strong>
                        <div style="font-size:0.7rem; color:#6B6255;">Var. ${p.variedad || 'S/V'}</div>
                    </td>
                    <td style="text-align:right; font-weight:700;">${parseFloat(p.sup || 0).toFixed(1)} Has</td>
                    <td style="text-align:right; font-weight:800; font-family:monospace; font-size:0.85rem;">${Number(p.kilos || 0).toLocaleString('es-AR')} Kg</td>
                    <td style="text-align:right; font-weight:800; color:#1FA958;">${p.rend_ha} <small style="font-size:0.65rem; color:#6B6255;">kg/Ha</small></td>
                    <td style="text-align:center;">
                        <div style="display:inline-flex; gap:6px; align-items:center;">
                            <button class="btn-accion-plant" onclick='ModuloProduccion.m_abrirModalProduccion(${JSON.stringify(p)})' title="Editar registro">
                                ✏️
                            </button>
                            ${pendienteAcopio > 0 ? `
                                <button class="btn-accion-plant btn-acopio" onclick="ModuloProduccion.m_acopiarDesdeProduccion('${idTarget}')" title="Enviar al Acopio (${pendienteAcopio.toLocaleString('es-AR')} kg pendientes)">
                                    🏢 Acopiar (${pendienteAcopio.toLocaleString('es-AR')} kg)
                                </button>
                            ` : `
                                <span style="font-size:0.68rem; color:#1FA958; font-weight:800; background:rgba(31,169,88,0.1); padding:3px 8px; border-radius:10px;">✓ ACOPIADO</span>
                            `}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    },

    m_obtenerCultivosActivosSinCosecha: function() {
        let lista = this.datosInventarioActivo.filter(inv =>
            !this.datosProduccion.some(p =>
                (p.establecimiento || '').trim().toUpperCase() === (inv.establecimiento || '').trim().toUpperCase() &&
                (p.campo || '').trim().toUpperCase() === (inv.campo || inv.sector || '').trim().toUpperCase() &&
                this.m_normalizarLoteNumero(p.lote) === this.m_normalizarLoteNumero(inv.lote)
            )
        );
        if (this.filtroActual) {
            lista = lista.filter(inv => (inv.establecimiento || '').trim().toUpperCase() === this.filtroActual.trim().toUpperCase());
        }
        if (this.buscadorTexto) {
            const txt = this.buscadorTexto.toLowerCase();
            lista = lista.filter(inv => 
                (inv.campo || inv.sector || '').toLowerCase().includes(txt) ||
                (inv.cultivo || '').toLowerCase().includes(txt) ||
                (inv.variedad || '').toLowerCase().includes(txt) ||
                String(inv.lote || '').toLowerCase().includes(txt)
            );
        }
        return lista;
    },

    m_obtenerDatosFiltrados: function() {
        return this.datosProduccion.filter(p => {
            if (this.filtroActual && (p.establecimiento || '').trim().toUpperCase() !== this.filtroActual.trim().toUpperCase()) return false;
            if (this.filtroCampana && p.campaña !== this.filtroCampana) return false;
            if (this.buscadorTexto) {
                const txt = this.buscadorTexto.toLowerCase();
                const matchLote = String(p.lote || '').toLowerCase().includes(txt);
                const matchCult = (p.cultivo || '').toLowerCase().includes(txt);
                const matchCampo = (p.campo || '').toLowerCase().includes(txt);
                const matchVar = (p.variedad || '').toLowerCase().includes(txt);
                if (!matchLote && !matchCult && !matchCampo && !matchVar) return false;
            }
            return true;
        });
    },

    m_aplicarFiltroEst: function(est) {
        this.filtroActual = est || null;
        this.m_dibujarDashboard();
    },

    m_aplicarFiltroCampana: function(camp) {
        this.filtroCampana = camp || '';
        this.m_dibujarDashboard();
    },

    m_filtrarTexto: function(txt) {
        this.buscadorTexto = txt || '';
        this.m_dibujarDashboard();
    },

    m_limpiarFiltros: function() {
        this.filtroActual = null;
        this.filtroCampana = '';
        this.buscadorTexto = '';
        this.m_dibujarDashboard();
    },

    m_calcularPendienteAcopio: function(p) {
        const acopiado = this.datosAcopio
            .filter(s => s.campaña == p.campaña && this.m_normalizarLoteNumero(s.lote) === this.m_normalizarLoteNumero(p.lote) && (s.establecimiento || '').trim().toUpperCase() === (p.establecimiento || '').trim().toUpperCase())
            .reduce((acc, curr) => acc + (Number(curr.kg_en_silo) || 0), 0);
        return Math.max(0, (Number(p.kilos) || 0) - acopiado);
    },

    m_abrirModalProduccionDesdeInventario: function(inv) {
        this.m_abrirModalProduccion(null);
        setTimeout(() => {
            const selEst = document.getElementById('f_establecimiento');
            if (selEst) {
                selEst.value = inv.establecimiento;
                this.m_cargarCamposSelect(inv.establecimiento, inv.campo || inv.sector);
            }
            const selCampo = document.getElementById('f_campo');
            if (selCampo) {
                selCampo.value = inv.campo || inv.sector;
                this.m_cargarLotesSelect(inv.campo || inv.sector, inv.lote);
            }
            const selLote = document.getElementById('f_lote');
            if (selLote) {
                selLote.value = inv.lote;
                this.m_autoCompletarLoteDesdeInventario(inv.lote);
            }
        }, 10);
    },

    m_acopiarDesdeProduccion: function(idProduccion) {
        const p = this.datosProduccion.find(x => String(x.reg_local) === String(idProduccion) || String(x.id) === String(idProduccion));
        if (!p) return;
        if (typeof ModuloAcopio === 'undefined') {
            if (window.ComponentesUI) window.ComponentesUI.notificar('error', 'El módulo de Acopio no está disponible.');
            else alert('El módulo de Acopio no está disponible.');
            return;
        }

        ModuloAcopio.datosProduccion = this.datosProduccion;
        ModuloAcopio.datosSilos = this.datosAcopio;
        ModuloAcopio.m_abrirModalAcopioRapido(null);

        setTimeout(() => {
            const selCampaña = document.getElementById('ac_campaña');
            if (!selCampaña) return;
            selCampaña.value = p.campaña;
            ModuloAcopio.m_cargarLotes(p.campaña);
            const selProd = document.getElementById('ac_registro_p');
            if (selProd) selProd.value = p.reg_local || p.id;
            ModuloAcopio.m_precargar(p.reg_local || p.id);
        }, 10);
    },

    m_abrirModalProduccion: function(data = null) {
        this.m_asegurarModalBase();
        
        const modal = document.getElementById('modal-agrosoft-produccion');
        const container = document.getElementById('modal-formulario-produccion');
        
        modal.style.display = 'flex';
        const esEdicion = data !== null;
        document.getElementById('modal-titulo-produccion').innerText = esEdicion ? 'MODIFICAR REGISTRO DE COSECHA' : 'NUEVO REGISTRO DE COSECHA';

        const establecimientosActivos = [...new Set(this.datosInventarioActivo.map(l => l.establecimiento).filter(Boolean))];

        const inicial = data || {
            establecimiento: this.filtroActual || '',
            campo: '', lote: '', cultivo: '', variedad: '', sup: '', kilos: '', campaña: '2025-2026'
        };

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Establecimiento Origen</label>
                        <select id="f_establecimiento" onchange="ModuloProduccion.m_cargarCamposSelect(this.value)" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF;">
                            <option value="">Seleccione Establecimiento...</option>
                            ${establecimientosActivos.map(e => `<option value="${e}" ${e === inicial.establecimiento ? 'selected' : ''}>${e.toUpperCase()}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Campo / Sector</label>
                        <select id="f_campo" onchange="ModuloProduccion.m_cargarLotesSelect(this.value)" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF;">
                            <option value="">Elija establecimiento...</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Lote Cuadro</label>
                        <select id="f_lote" onchange="ModuloProduccion.m_autoCompletarLoteDesdeInventario(this.value)" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF;">
                            <option value="">Elija campo...</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Ciclo Campaña</label>
                        <select id="f_campaña" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF; font-weight:600;">
                            <option ${inicial.campaña === '2025-2026' ? 'selected' : ''}>2025-2026</option>
                            <option ${inicial.campaña === '2024-2025' ? 'selected' : ''}>2024-2025</option>
                        </select>
                    </div>
                </div>

                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Cultivo Mapeado</label>
                        <input type="text" id="f_cultivo" readonly value="${inicial.cultivo}" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#F0F2F5; color:#6B6255; font-weight:600;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Variedad Específica</label>
                        <input type="text" id="f_variedad" readonly value="${inicial.variedad}" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#F0F2F5; color:#6B6255; font-weight:600;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Superficie Cosechada (Has)</label>
                        <input type="number" step="0.01" id="f_sup_prod" readonly value="${inicial.sup}" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#F0F2F5; color:#6B6255; font-weight:700;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#1E6B4C; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Kilos Netos Cosechados</label>
                        <input type="number" id="f_kilos" value="${inicial.kilos || ''}" oninput="ModuloProduccion.m_calcularRinde()" placeholder="Ej: 86000" style="width:100%; padding:8px 10px; border-radius:8px; border:2px solid #1E6B4C; font-size:0.9rem; font-weight:800; color:#123F2C; background:#FFFFFF;">
                    </div>
                </div>

                <div style="background:rgba(30,107,76,0.08); border:1px solid rgba(30,107,76,0.25); border-radius:10px; padding:12px 16px; display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:0.75rem; color:#1E6B4C; font-weight:800; letter-spacing:0.4px;">RENDIMIENTO ESTIMADO COMPUTADO</span>
                    <strong id="f_rend_ha_txt" style="font-size:1.25rem; color:#123F2C; font-weight:800;">${inicial.rend_ha || '0.00'} <span style="font-size:0.75rem; color:#6B6255; font-weight:500;">(kg/Ha)</span></strong>
                </div>

                <input type="hidden" id="f_reg_local" value="${esEdicion ? inicial.reg_local : 0}">
                <input type="hidden" id="f_id_produccion" value="${esEdicion ? (inicial.id || '') : ''}">
            </div>
        `;

        if (esEdicion && inicial.establecimiento) {
            this.m_cargarCamposSelect(inicial.establecimiento, inicial.campo);
            this.m_cargarLotesSelect(inicial.campo, inicial.lote);
            this.m_calcularRinde();
        }
    },

    m_cargarCamposSelect: function(estNom, preseleccionar = '') {
        const campos = [...new Set(this.datosInventarioActivo.filter(l => l.establecimiento === estNom).map(l => l.campo || l.sector).filter(Boolean))];
        const sel = document.getElementById('f_campo');
        if (!sel) return;
        sel.innerHTML = '<option value="">Seleccione Campo...</option>' + 
                        campos.map(c => `<option value="${c}" ${c === preseleccionar ? 'selected' : ''}>${c.toUpperCase()}</option>`).join('');
        document.getElementById('f_lote').innerHTML = '<option value="">Seleccione Lote...</option>';
    },

    m_cargarLotesSelect: function(campoNom, preseleccionar = '') {
        const est = document.getElementById('f_establecimiento').value;
        const lotes = this.datosInventarioActivo.filter(l => l.establecimiento === est && (l.campo === campoNom || l.sector === campoNom));
        const sel = document.getElementById('f_lote');
        if (!sel) return;
        sel.innerHTML = '<option value="">Seleccione Lote...</option>' + 
                        lotes.map(l => `<option value="${l.lote}" ${this.m_normalizarLoteNumero(l.lote) === this.m_normalizarLoteNumero(preseleccionar) ? 'selected' : ''}>Lote N° ${l.lote} (${l.cultivo} - ${l.sup} Ha)</option>`).join('');
    },

    m_autoCompletarLoteDesdeInventario: function(loteNum) {
        const est = document.getElementById('f_establecimiento').value;
        const campo = document.getElementById('f_campo').value;
        
        const plantacionData = this.datosInventarioActivo.find(l => 
            l.establecimiento === est && 
            (l.campo === campo || l.sector === campo) && 
            this.m_normalizarLoteNumero(l.lote) === this.m_normalizarLoteNumero(loteNum)
        );
        
        if (plantacionData) {
            document.getElementById('f_sup_prod').value = plantacionData.sup || 0;
            document.getElementById('f_cultivo').value = plantacionData.cultivo || 'S/D';
            document.getElementById('f_variedad').value = plantacionData.variedad || 'S/V';
            this.m_calcularRinde();
        }
    },

    m_calcularRinde: function() {
        const k = parseFloat(document.getElementById('f_kilos').value) || 0;
        const s = parseFloat(document.getElementById('f_sup_prod').value) || 0;
        const txt = document.getElementById('f_rend_ha_txt');
        if (txt) {
            const rinde = s > 0 ? (k / s).toFixed(2) : "0.00";
            txt.innerHTML = `${rinde} <span style="font-size:0.75rem; color:#6B6255; font-weight:500;">(kg/Ha)</span>`;
        }
    },

    m_guardarProduccion: async function() {
        const btn = document.querySelector('#modal-agrosoft-produccion .btn-save-soft');
        const btnOriginalText = btn ? btn.innerText : "GUARDAR COSECHA";
        
        if (btn) {
            btn.innerText = "GUARDANDO LOCALMENTE...";
            btn.disabled = true;
        }

        try {
            const rawRegLocal = document.getElementById('f_reg_local').value;
            const rawId = document.getElementById('f_id_produccion').value;
            let finalRegLocal = parseInt(rawRegLocal, 10) || 0;

            const establecimiento = document.getElementById('f_establecimiento').value;
            const campo = document.getElementById('f_campo').value;
            const lote = String(document.getElementById('f_lote').value);
            const kilos = parseFloat(document.getElementById('f_kilos').value) || 0;

            if (!establecimiento || !lote || kilos <= 0) {
                if (btn) {
                    btn.innerText = btnOriginalText;
                    btn.disabled = false;
                }
                return window.ComponentesUI ? window.ComponentesUI.notificar("⚠️ Ingrese establecimiento, lote y kilos cosechados válidos.") : alert("⚠️ Complete los datos obligatorios.");
            }

            const rawRend = document.getElementById('f_rend_ha_txt') ? document.getElementById('f_rend_ha_txt').innerText : "0";
            const rindeNumerico = parseFloat(rawRend) || 0;
            const cultivo = document.getElementById('f_cultivo').value;
            const variedad = document.getElementById('f_variedad').value;
            const sup = parseFloat(document.getElementById('f_sup_prod').value) || 0;
            const campaña = document.getElementById('f_campaña').value;
            const fechaCosecha = new Date().toISOString().split('T')[0];

            if (finalRegLocal > 0 || (rawId && rawId !== "")) {
                const sqlUpdate = `
                    UPDATE p_produccion SET
                        establecimiento = ?, campo = ?, lote = ?, cultivo = ?, variedad = ?,
                        sup = ?, kilos = ?, rend_ha = ?, campaña = ?, fecha_cosecha = ?,
                        estado = 'ACTIVO', sincronizado = 0
                    WHERE reg_local = ? OR id = ?
                `;
                await this.m_ejecutarSqlLocal(sqlUpdate, [
                    establecimiento, campo, lote, cultivo, variedad,
                    sup, kilos, rindeNumerico, campaña, fechaCosecha,
                    finalRegLocal, rawId
                ]);
            } else {
                const resMax = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(reg_local AS INTEGER)) as max_reg FROM p_produccion`);
                const maxVal = (resMax.data && resMax.data[0] && resMax.data[0].max_reg) 
                    ? Number(resMax.data[0].max_reg) 
                    : (resMax[0] && resMax[0].max_reg ? Number(resMax[0].max_reg) : 0);

                finalRegLocal = maxVal + 1;

                const sqlInsert = `
                    INSERT INTO p_produccion (
                        reg_local, establecimiento, campo, lote, cultivo, variedad,
                        sup, kilos, rend_ha, campaña, fecha_cosecha, estado, sincronizado
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVO', 0)
                `;
                await this.m_ejecutarSqlLocal(sqlInsert, [
                    finalRegLocal, establecimiento, campo, lote, cultivo, variedad,
                    sup, kilos, rindeNumerico, campaña, fechaCosecha
                ]);
            }

            document.getElementById('modal-agrosoft-produccion').style.display = 'none';
            await this.m_inicializar();
            if (window.ComponentesUI) window.ComponentesUI.notificar("✅ Registro de producción guardado localmente en base local.");
            
        } catch (err) {
            console.error("❌ Error al guardar producción local:", err);
            if (window.ComponentesUI) window.ComponentesUI.notificar("Error al guardar localmente: " + err.message);
            else alert("Error local: " + err.message);
        } finally {
            if (btn) {
                btn.innerText = btnOriginalText;
                btn.disabled = false;
            }
        }
    },

    m_exportarExcel: function() {
        const datos = this.m_obtenerDatosFiltrados();
        if (datos.length === 0) {
            return alert("No hay registros cargados para exportar.");
        }

        const headers = ["ID REGISTRO", "CAMPAÑA", "FECHA COSECHA", "ESTABLECIMIENTO", "CAMPO/SECTOR", "LOTE", "CULTIVO", "VARIEDAD", "SUPERFICIE HAS", "KILOS TOTALES", "RENDIMIENTO KG/HA"];
        
        let csvContent = "\uFEFF"; 
        csvContent += headers.join(";") + "\n";

        datos.forEach(p => {
            const fila = [
                p.reg_local || p.id,
                `"${p.campaña || ''}"`,
                p.fecha_cosecha || '',
                `"${p.establecimiento || ''}"`,
                `"${p.campo || ''}"`,
                p.lote || '',
                `"${p.cultivo || ''}"`,
                `"${p.variedad || ''}"`,
                p.sup || 0,
                p.kilos || 0,
                p.rend_ha || 0
            ];
            csvContent += fila.join(";") + "\n";
        });

        const historial = this.filtroActual ? this.datosHistorialInactivo.filter(h => (h.establecimiento || '').trim().toUpperCase() === this.filtroActual.trim().toUpperCase()) : this.datosHistorialInactivo;
        csvContent += "\nHISTORIAL DE SIEMBRA INACTIVA\n";
        csvContent += ["ESTABLECIMIENTO", "CAMPO", "LOCALIDAD", "LOTE", "SUP", "CULTIVO", "VARIEDAD", "FECHA SIEMBRA", "FECHA CIERRE"].join(";") + "\n";
        historial.forEach(h => {
            const fila = [
                `"${h.establecimiento || ''}"`, `"${h.campo || ''}"`, `"${h.localidad || ''}"`, h.lote || '',
                h.sup || 0, `"${(h.cultivo || '').toUpperCase()}"`, `"${h.variedad || ''}"`,
                h.fecha_siembra || '', h.fecha_cierre || ''
            ];
            csvContent += fila.join(";") + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const sufijoFile = this.filtroActual ? this.filtroActual.replace(/\s+/g, '_') : 'General';

        link.href = URL.createObjectURL(blob);
        link.setAttribute("download", `Salvucci_Produccion_${sufijoFile}_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    m_exportarPDF: async function() {
        const datos = this.m_obtenerDatosFiltrados();
        if (datos.length === 0) return alert("No hay registros para emitir el reporte.");

        const totalKilos = datos.reduce((a, c) => a + (Number(c.kilos) || 0), 0);
        const totalHas = datos.reduce((a, c) => a + (Number(c.sup) || 0), 0);
        const rindeGral = totalHas > 0 ? (totalKilos / totalHas).toFixed(2) : "0.00";

        const ventanaImpresion = window.open('', '_blank');
        ventanaImpresion.document.write(`
            <html>
            <head>
                <title>Salvucci Gestión - Reporte de Cosecha y Rendimiento</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap');
                    body { font-family: 'Roboto', sans-serif; color: #211C16; padding: 35px; margin: 0; background: #F5F4F1; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    .header-pdf-premium { border-bottom: 3px solid #1E6B4C; padding-bottom: 14px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; background:#FFFFFF; padding:18px; border-radius:12px; border:1px solid #E0DCD4; }
                    .logo-container-apple { width: 70px; height: 70px; display: flex; align-items: center; justify-content: center; margin-right: 15px; }
                    .logo-container-apple img { width: 100%; height: 100%; object-fit: contain; }
                    .titulos-reporte h1 { margin: 0; font-size: 18px; font-weight: 900; color: #123F2C; }
                    .titulos-reporte h2 { margin: 3px 0 0 0; font-size: 11px; color: #1E6B4C; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
                    .kpi-tile-top { background:rgba(30,107,76,0.08); border:1px solid rgba(30,107,76,0.25); padding:8px 14px; border-radius:8px; text-align:right; }
                    table { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 8px; background:#FFFFFF; border-radius:8px; overflow:hidden; }
                    th { background: #123F2C; color: #FFFFFF; text-align: left; padding: 8px; font-weight: 700; }
                    td { padding: 7px 8px; border-bottom: 1px solid #E0DCD4; color: #211C16; }
                    .footer-firma-fija { margin-top: 30px; border-top: 1px solid #E0DCD4; padding-top: 15px; display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: #6B6255; page-break-inside: avoid; }
                    @media print { body { background: #FFFFFF; padding: 15px; } }
                </style>
            </head>
            <body>
                <div class="header-pdf-premium">
                    <div style="display:flex; align-items:center;">
                        <div class="logo-container-apple">
                            <img src="logo.png" onerror="this.style.display='none';" />
                        </div>
                        <div class="titulos-reporte">
                            <h2>SALVUCCI GESTIÓN · PRODUCCIÓN Y RENDIMIENTOS</h2>
                            <h1>ESTABLECIMIENTO: ${this.filtroActual ? this.filtroActual.toUpperCase() : 'CONSOLIDADO GENERAL'}</h1>
                        </div>
                    </div>
                    <div class="kpi-tile-top">
                        <div style="font-size:9px; color:#6B6255; font-weight:700; text-transform:uppercase;">Volumen Total Cosechado</div>
                        <div style="font-size:16px; font-weight:900; color:#1E6B4C;">${totalKilos.toLocaleString('es-AR')} KG</div>
                        <small style="font-size:9px; color:#6B6255;">Rinde Promedio: ${rindeGral} kg/Ha</small>
                    </div>
                </div>

                <div style="margin-bottom:8px; font-size:11px; font-weight:800; color:#123F2C; text-transform:uppercase;">
                    ■ DETALLE DE COSECHAS REGISTRADAS (${datos.length})
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>CAMPAÑA</th><th>FECHA</th><th>ESTABLECIMIENTO</th><th>CAMPO</th><th>LOTE</th>
                            <th>CULTIVO</th><th>VARIEDAD</th><th style="text-align:right;">HAS</th>
                            <th style="text-align:right;">KILOS</th><th style="text-align:right;">RINDE (KG/HA)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${datos.map(p => `
                            <tr>
                                <td><b>${p.campaña}</b></td>
                                <td>${p.fecha_cosecha || '-'}</td>
                                <td>${p.establecimiento}</td>
                                <td>${p.campo}</td>
                                <td><b>Lote ${p.lote}</b></td>
                                <td><strong style="color:#1E6B4C;">${(p.cultivo || '').toUpperCase()}</strong></td>
                                <td>${p.variedad || '-'}</td>
                                <td style="text-align:right;">${parseFloat(p.sup || 0).toFixed(1)}</td>
                                <td style="text-align:right; font-weight:800;">${Number(p.kilos || 0).toLocaleString('es-AR')}</td>
                                <td style="text-align:right; font-weight:800; color:#1E6B4C;">${p.rend_ha}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div class="footer-firma-fija">
                    <span>Salvucci Gestión &bull; Ecosistema Territorial Local</span>
                    <span style="font-weight:bold;">Firma Responsable Auditoría: ___________________________</span>
                </div>

                <script>
                    window.onload = function() { setTimeout(() => { window.print(); window.close(); }, 300); }
                </script>
            </body>
            </html>
        `);
        ventanaImpresion.document.close();
    }
};

window.ModuloProduccion = ModuloProduccion;