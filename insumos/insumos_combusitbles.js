/**
 * ARCHIVO: modulo_combustible.js
 * Sistema: Salvucci Gestión · AgroSoft J&L
 * Descripción: Módulo Central de Combustibles y Cisternas integrado con SQLite IPC Local
 * Mode: "No me quites nada" + Regla Max(registro)+1 + Dynamic SQLite IPC + Sync Flag (sincronizado=0)
 * Formato visual unificado: Salvucci Apple Soft / Roboto
 */

const ModuloCombustible = {
    datosIngresos: [],
    datosConsumos: [],
    tanques: [],
    parametros: {
        gastos: [],       // Catálogo de tipos_gastos
        labores: [],      // Matriz de tareas de tipos_labores
        insumosComb: [],  // Memoria para insumos (Combustibles/Lubricantes)
        campos: []        // Memoria para campos agrupados
    },

    filtroTanque: 'TODO',
    filtroTipo: 'TODO',
    textoBusqueda: '',
    tabActiva: 'consumos',

    m_ejecutarSqlLocal: async function(sql, params = []) {
        if (window.apiLocal && window.apiLocal.query) {
            return await window.apiLocal.query({ sql, params });
        }
        if (window.electronAPI && window.electronAPI.invoke) {
            return await window.electronAPI.invoke('local-db-query', { sql, params });
        }
        throw new Error("No se encontró la conexión con el proceso principal de Base Local.");
    },

    m_asegurarModalBase: function() {
        let modal = document.getElementById('modal-agrosoft');
        if (!modal) {
            const modalHTML = `
                <div id="modal-agrosoft" class="modal-overlay" style="display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(18, 22, 28, 0.48); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); z-index: 99999; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box;">
                    <div class="modal-apple-content" style="background: #FFFFFF; border: 1.5px solid var(--color-border); border-radius: 14px; padding: 24px; width: 95%; max-width: 900px; max-height: 90vh; color: var(--color-text); box-shadow: 0 10px 25px rgba(0,0,0,0.15); display: flex; flex-direction: column; position: relative;">
                        <div class="modal-header-apple" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid var(--color-border); padding-bottom: 12px; flex-shrink: 0;">
                            <h3 id="modal-titulo" style="margin: 0; font-size: 1.15rem; font-weight: 800; font-family: 'Roboto', sans-serif; color: var(--color-plant-dark); letter-spacing: -0.3px;">CONTROL DE COMBUSTIBLE</h3>
                            <button onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background: none; border: none; color: var(--color-text-secondary); font-size: 1.5rem; font-weight: bold; cursor: pointer;">&times;</button>
                        </div>
                        <div id="modal-formulario" style="max-height: 75vh; overflow-y: auto; padding-right: 4px;"></div>
                    </div>
                </div>`;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
        }
    },

    m_inicializar: async function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;
        visor.innerHTML = `<div class="loader-apple" style="font-family: 'Roboto', sans-serif; text-align: center; padding: 50px; color: #1E6B4C; font-weight: 500; letter-spacing: 0.3px;">Cargando Central de Combustibles y Cisternas (Base Local)...</div>`;

        try {
            const [resIngresos, resConsumos, resGastos, resLabores, resInsumos, resCampos] = await Promise.all([
                this.m_ejecutarSqlLocal(`SELECT * FROM combustibles_ingresos ORDER BY fecha DESC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM consumos_combustibles ORDER BY fecha DESC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM tipos_gastos ORDER BY nombre_gasto ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM tipos_labores ORDER BY labor ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM insumos WHERE UPPER(rubro) = 'COMBUSTIBLE' OR UPPER(rubro) = 'LUBRICANTE' ORDER BY articulo ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM campos ORDER BY campo ASC`)
            ]);

            this.datosIngresos = resIngresos.data || resIngresos || [];
            this.datosConsumos = resConsumos.data || resConsumos || [];
            this.parametros.gastos = resGastos.data || resGastos || [];
            this.parametros.labores = resLabores.data || resLabores || [];
            this.parametros.insumosComb = resInsumos.data || resInsumos || []; 
            this.parametros.campos = resCampos.data || resCampos || [];      

            this.filtroTanque = 'TODO';
            this.filtroTipo = 'TODO';
            this.textoBusqueda = '';

            this.m_procesarSaldos();
            this.m_dibujarTodo();
        } catch (err) {
            console.error("❌ Error en Combustibles Local AgroSoft:", err);
            visor.innerHTML = `<div style="color: #E0342A; padding: 20px; font-family: 'Roboto', sans-serif;">Error al cargar datos locales de combustible: ${err.message}</div>`;
        }
    },

    m_procesarSaldos: function() {
        const stock = {};
        this.datosIngresos.forEach(i => {
            const key = `${(i.campo_cisterna || 'GENERAL').trim().toUpperCase()}-${(i.combustible || 'DIESEL').trim().toUpperCase()}`;
            if (!stock[key]) stock[key] = { actual: 0, nombre: i.campo_cisterna || 'GENERAL', tipo: i.combustible || 'DIESEL', entradas: 0, salidas: 0 };
            const cant = Number(i.cantidad) || 0;
            stock[key].actual += cant;
            stock[key].entradas += cant;
        });
        this.datosConsumos.forEach(c => {
            const key = `${(c.campo || 'GENERAL').trim().toUpperCase()}-${(c.combustible || 'DIESEL').trim().toUpperCase()}`;
            if (!stock[key]) stock[key] = { actual: 0, nombre: c.campo || 'GENERAL', tipo: c.combustible || 'DIESEL', entradas: 0, salidas: 0 };
            const cant = Number(c.cantidad) || 0;
            stock[key].actual -= cant;
            stock[key].salidas += cant;
        });
        this.tanques = Object.values(stock);
    },

    m_dibujarTodo: function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;

        const tiposCombustiblesUnicos = [...new Set(this.tanques.map(t => t.tipo))].sort();
        const globalLts = this.tanques.reduce((a,c) => a + c.actual, 0);
        const globalIngresos = this.datosIngresos.reduce((a,c) => a + (Number(c.cantidad) || 0), 0);
        const globalConsumos = this.datosConsumos.reduce((a,c) => a + (Number(c.cantidad) || 0), 0);

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
                }

                .combustibles-layout {
                    font-family: 'Roboto', -apple-system, sans-serif;
                    background: var(--color-bg);
                    color: var(--color-text);
                    width: 100%;
                    min-height: calc(100vh - 10px);
                    display: flex;
                    flex-direction: column;
                }

                .panel-pro-combustibles {
                    font-family: 'Roboto', sans-serif;
                    color: var(--color-text);
                    padding: 8px 18px 20px 18px;
                    max-height: calc(100vh - 15px);
                    overflow-y: auto;
                }

                /* HEADER KPIS */
                .grid-kpi-comb { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 14px; }
                @media (max-width: 1100px) { .grid-kpi-comb { grid-template-columns: repeat(2, 1fr); } }

                .card-kpi-comb-box {
                    background: var(--color-surface); border: 1.5px solid var(--color-border); border-radius: 12px; padding: 12px 14px;
                    display: flex; flex-direction: column; gap: 3px; box-shadow: 0 2px 6px rgba(0,0,0,0.03);
                }
                .card-kpi-comb-box span { font-size: 0.62rem; color: var(--color-text-secondary); font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; }
                .card-kpi-comb-box strong { font-size: 1.25rem; font-weight: 800; color: var(--color-text); font-family: monospace; }
                .card-kpi-comb-box.highlight-green strong { color: var(--color-plant); }
                .card-kpi-comb-box.highlight-red strong { color: #E0342A; }
                .card-kpi-comb-box.highlight-blue strong { color: #0071E3; }

                /* CISTERNAS CARDS */
                .grid-tanques-apple { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; margin-bottom: 16px; }

                .card-tanque-comb {
                    background: var(--color-surface); border: 1.5px solid var(--color-border); border-radius: 14px; padding: 14px 16px;
                    display: flex; flex-direction: column; gap: 6px; box-shadow: 0 2px 6px rgba(0,0,0,0.03);
                    cursor: pointer; transition: all 0.2s ease; position: relative;
                }
                .card-tanque-comb:hover { border-color: var(--color-plant); transform: translateY(-2px); box-shadow: 0 6px 14px rgba(30,107,76,0.12); }
                .card-tanque-comb.active-filter { background: var(--color-plant-soft); border-color: var(--color-plant); border-left: 4px solid var(--color-plant); }

                .badge-comb-tipo { font-size: 0.65rem; font-weight: 800; padding: 2px 8px; border-radius: 6px; width: fit-content; text-transform: uppercase; }
                .level-indicator-bg { width: 100%; height: 7px; background: #EAE8E1; border-radius: 4px; overflow: hidden; margin-top: 4px; border: 1px solid var(--color-border); }
                .level-indicator-bar { height: 100%; border-radius: 3px; transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1); }

                /* BARRA DE FILTROS */
                .top-filter-bar-comb {
                    background: var(--color-surface); border: 1.5px solid var(--color-border); border-radius: 12px; padding: 10px 14px;
                    margin-bottom: 14px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; box-shadow: 0 2px 5px rgba(0,0,0,0.04);
                }
                .top-filter-bar-comb input {
                    background: #F8FAFC; border: 1px solid var(--color-border); color: var(--color-text); padding: 7px 12px;
                    border-radius: 8px; font-size: 0.8rem; outline: none; flex: 1; min-width: 220px;
                }
                .top-filter-bar-comb input:focus { border-color: var(--color-plant); background: #FFFFFF; }
                .top-filter-bar-comb select {
                    background: #F8FAFC; border: 1px solid var(--color-border); color: var(--color-text); padding: 7px 12px;
                    border-radius: 8px; font-size: 0.8rem; outline: none; cursor: pointer; font-weight: 600;
                }
                .top-filter-bar-comb select:focus { border-color: var(--color-plant); background: #FFFFFF; }

                /* TABS ARCHIVERO */
                .tabs-header-archivero-main { display: flex; gap: 8px; border-bottom: 2px solid var(--color-border); margin-bottom: 12px; align-items: flex-end; }
                .tab-main-archivero {
                    display: flex; align-items: center; gap: 8px; padding: 9px 18px; background: #EAE8E1;
                    border: 1.5px solid var(--color-border); border-bottom: none; border-radius: 12px 12px 0 0;
                    font-size: 0.82rem; font-weight: 800; color: var(--color-text-secondary); cursor: pointer; transition: all 0.15s ease;
                    position: relative; bottom: -2px;
                }
                .tab-main-archivero:hover { background: #F0EEE8; color: var(--color-text); }
                .tab-main-archivero.active {
                    background: #FFFFFF; color: var(--color-plant-dark); border-color: var(--color-border); border-top: 3px solid var(--color-plant);
                    box-shadow: 0 -2px 8px rgba(0,0,0,0.04);
                }
                .badge-tab-main { background: var(--color-plant-soft); color: var(--color-plant); padding: 2px 7px; border-radius: 12px; font-size: 0.68rem; font-weight: 800; }

                /* TABLA STICKY */
                .wrapper-tabla-scroll-sticky {
                    max-height: calc(100vh - 300px); overflow-y: auto; overflow-x: auto;
                    border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-surface); position: relative;
                }
                .tabla-cuadros-plant { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
                .tabla-cuadros-plant th {
                    background: var(--color-plant-dark); color: #FFFFFF; font-size: 0.68rem; font-weight: 700;
                    text-transform: uppercase; padding: 10px 8px; text-align: left; letter-spacing: 0.4px;
                    position: sticky; top: 0; z-index: 10; box-shadow: 0 1px 3px rgba(0,0,0,0.12);
                }
                .tabla-cuadros-plant th.th-ingreso { background: var(--color-plant); }
                .tabla-cuadros-plant td { padding: 9px 8px; border-bottom: 1px solid var(--color-border); color: var(--color-text); vertical-align: middle; }
                .tabla-cuadros-plant tbody tr:hover { background: #F8FAFC; }

                .btn-accion-plant {
                    background: var(--color-plant-soft); border: 1px solid rgba(30,107,76,0.25); color: var(--color-plant);
                    padding: 4px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 700; cursor: pointer;
                    display: inline-flex; align-items: center; gap: 4px; transition: background 0.15s;
                }
                .btn-accion-plant:hover { background: rgba(30,107,76,0.2); }
                .btn-delete-plant { background: rgba(224,52,42,0.1); border-color: rgba(224,52,42,0.25); color: #E0342A; }
                .btn-delete-plant:hover { background: rgba(224,52,42,0.2); }

                .split-workspace-comb { display: grid; grid-template-columns: 1fr 320px; gap: 14px; align-items: start; }
            </style>

            <div class="combustibles-layout animated fadeIn">
                <div class="panel-pro-combustibles">
                    ${typeof ComponentesUI !== 'undefined' && ComponentesUI.botonVolverHTML ? ComponentesUI.botonVolverHTML('INSUMOS') : ''}

                    <!-- HEADER SUPERIOR -->
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; margin-bottom:10px; flex-wrap:wrap; gap:10px;">
                        <div>
                            <h2 style="margin:0; font-weight: 800; font-size: 1.3rem; letter-spacing: -0.5px; color:var(--color-plant-dark);">Central de Combustibles y Cisternas</h2>
                            <p style="margin:2px 0 0 0; font-size:0.75rem; color:var(--color-text-secondary);">Balances de gasoil/nafta por campo, descargas de camión y egresos analíticos (Base Local)</p>
                        </div>

                        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                            <button onclick="ModuloCombustible.m_exportarExcel()" style="background:#1FA958; color:#FFF; border:none; padding:7px 14px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:5px;">
                                <i data-lucide="file-spreadsheet" style="width:13px; height:13px;"></i> Excel
                            </button>
                            <button onclick="ModuloCombustible.m_exportarPDF()" style="background:#E0342A; color:#FFF; border:none; padding:7px 14px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:5px;">
                                <i data-lucide="file-text" style="width:13px; height:13px;"></i> Analytics PDF
                            </button>
                            <button onclick="ModuloCombustible.m_abrirModalTransferencia()" style="background:#0071E3; color:#FFF; border:none; padding:7px 14px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:5px;">
                                <i data-lucide="arrow-left-right" style="width:13px; height:13px;"></i> Traslado
                            </button>
                            <button onclick="ModuloCombustible.m_abrirModalIngreso()" style="background:var(--color-plant); color:#FFF; border:none; padding:7px 14px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:5px;">
                                <i data-lucide="plus-circle" style="width:13px; height:13px;"></i> + Compra (Carga)
                            </button>
                            <button onclick="ModuloCombustible.m_abrirModalConsumo()" style="background:#E0342A; color:#FFF; border:none; padding:7px 14px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:5px;">
                                <i data-lucide="fuel" style="width:13px; height:13px;"></i> - Consumo (Despacho)
                            </button>
                        </div>
                    </div>

                    <!-- KPIS PRINCIPALES DE RESUMEN ENERGÉTICO -->
                    <div class="grid-kpi-comb">
                        <div class="card-kpi-comb-box highlight-green">
                            <span>STOCK NETO ACTIVO EN CISTERNAS</span>
                            <strong>${globalLts.toLocaleString('es-AR')} LTS</strong>
                        </div>
                        <div class="card-kpi-comb-box">
                            <span>TOTAL COMPRADO (INGRESOS)</span>
                            <strong style="color:var(--color-plant);">+ ${globalIngresos.toLocaleString('es-AR')} LTS</strong>
                        </div>
                        <div class="card-kpi-comb-box highlight-red">
                            <span>TOTAL DESPACHADO (CONSUMOS)</span>
                            <strong>- ${globalConsumos.toLocaleString('es-AR')} LTS</strong>
                        </div>
                        <div class="card-kpi-comb-box highlight-blue">
                            <span>CISTERNAS / PUNTOS OPERATIVOS</span>
                            <strong>${this.tanques.length} TANQUES</strong>
                        </div>
                    </div>

                    <!-- CISTERNAS GRÁFICAS -->
                    <div class="grid-tanques-apple">
                        ${this.tanques.map(t => {
                            const maxCapacidadSugerida = 50000; 
                            const pctLlenado = Math.min((t.actual / maxCapacidadSugerida) * 100, 100).toFixed(0);
                            const esGasoil = t.tipo.includes('DIESEL') || t.tipo.includes('GASOIL');
                            const badgeColor = esGasoil ? 'background:rgba(224,134,0,0.12); color:#E08600;' : 'background:rgba(0,113,227,0.1); color:#0071E3;';
                            const barColor = esGasoil ? '#E08600' : '#0071E3';
                            const isCardActive = this.filtroTanque === t.nombre ? 'active-filter' : '';

                            return `
                                <div class="card-tanque-comb ${isCardActive}" data-tanquename="${t.nombre}" onclick="ModuloCombustible.m_onTanqueCardClick('${t.nombre}', this)">
                                    <div style="display:flex; justify-content:space-between; align-items:center;">
                                        <span class="badge-comb-tipo" style="${badgeColor}">🛢️ ${t.tipo}</span>
                                        <span style="font-size:0.68rem; color:var(--color-text-secondary); font-weight:800;">${pctLlenado}% Vol</span>
                                    </div>
                                    <h4 style="margin:6px 0 2px 0; font-size:1.05rem; font-weight:800; color:var(--color-plant-dark);">🏢 ${t.nombre}</h4>
                                    <div style="display:flex; justify-content:space-between; align-items:baseline;">
                                        <strong style="font-size:1.35rem; color:${t.actual <= 0 ? '#E0342A' : 'var(--color-plant)'}; font-family:monospace;">
                                            ${t.actual.toLocaleString('es-AR')} <span style="font-size:0.75rem; font-weight:600; color:var(--color-text-secondary);">Lts</span>
                                        </strong>
                                    </div>
                                    <div class="level-indicator-bg">
                                        <div class="level-indicator-bar" style="width: ${pctLlenado}%; background: ${barColor};"></div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>

                    <!-- BARRA DE BÚSQUEDA Y FILTRO -->
                    <div class="top-filter-bar-comb">
                        <input type="text" id="busqueda-combustible" placeholder="🔍 Buscar por operario, máquina, labor, remito o proveedor..." value="${this.textoBusqueda}" oninput="ModuloCombustible.m_onBusquedaInput(this.value)">
                        <select id="select-tipo-comb" onchange="ModuloCombustible.m_onTipoChange(this.value)">
                            <option value="TODO">🎛️ Todos los Rubros</option>
                            ${tiposCombustiblesUnicos.map(tipo => `<option value="${tipo}" ${this.filtroTipo === tipo ? 'selected' : ''}>${tipo}</option>`).join('')}
                        </select>
                        ${(this.filtroTanque !== 'TODO' || this.filtroTipo !== 'TODO' || this.textoBusqueda) ? `
                            <button onclick="ModuloCombustible.m_limpiarFiltrosSistemas()" style="background:rgba(224,52,42,0.1); border:1px solid rgba(224,52,42,0.25); color:#E0342A; padding:6px 12px; border-radius:6px; font-size:0.72rem; font-weight:700; cursor:pointer;">
                                ✕ Limpiar Filtros
                            </button>
                        ` : ''}
                    </div>

                    <!-- TABS ARCHIVERO SUPERIOR -->
                    <div class="tabs-header-archivero-main">
                        <div class="tab-main-archivero ${this.tabActiva === 'consumos' ? 'active' : ''}" onclick="ModuloCombustible.m_cambiarTabArchivero('consumos')">
                            <i data-lucide="fuel" style="width:14px; height:14px; color:#E0342A;"></i>
                            <span>CONSUMOS / SALIDAS A CAMPO</span>
                            <span class="badge-tab-main" style="background:rgba(224,52,42,0.1); color:#E0342A;">${this.datosConsumos.length} Regs</span>
                        </div>
                        <div class="tab-main-archivero ${this.tabActiva === 'ingresos' ? 'active' : ''}" onclick="ModuloCombustible.m_cambiarTabArchivero('ingresos')">
                            <i data-lucide="truck" style="width:14px; height:14px; color:var(--color-plant);"></i>
                            <span>INGRESOS / COMPRAS DE CAMIÓN</span>
                            <span class="badge-tab-main">${this.datosIngresos.length} Regs</span>
                        </div>
                    </div>

                    <!-- WORKSPACE DIVIDIDO: TABLA STICKY + SIDEBAR ANALÍTICO -->
                    <div class="split-workspace-comb">
                        <div class="panel-box-plant" style="background: var(--color-surface); border: 1.5px solid var(--color-border); border-radius: 14px; padding: 14px; box-shadow: 0 2px 5px rgba(0,0,0,0.04); display:flex; flex-direction:column; gap:10px;">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-size:0.75rem; font-weight:800; color:var(--color-plant-dark); text-transform:uppercase; letter-spacing:0.4px;">
                                    ${this.tabActiva === 'consumos' ? '📉 Registro Histórico de Despachos y Consumo Directo' : '📈 Registro de Compras e Ingresos a Cisterna'}
                                </span>
                                <span style="font-size:0.72rem; color:var(--color-text-secondary); font-weight:600;">Cabeceras fijas siempre visibles</span>
                            </div>

                            <div id="contenedor-tablas" class="wrapper-tabla-scroll-sticky scroll-apple">
                                ${this.tabActiva === 'consumos' ? this.m_renderTablaConsumos(this.datosConsumos) : this.m_renderTablaIngresos(this.datosIngresos)}
                            </div>
                        </div>

                        <aside id="sidebar-analytics-comb" class="panel-box-plant" style="background: var(--color-surface); border: 1.5px solid var(--color-border); border-radius: 14px; padding: 16px; box-shadow: 0 2px 5px rgba(0,0,0,0.04);">
                            ${this.m_renderSidebarDetalles()}
                        </aside>
                    </div>
                </div>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
    },

    m_renderTablaConsumos: function(dataset) {
        if(dataset.length === 0) return `<div style="padding:35px; text-align:center; color:#9AA0A6; font-style:italic;">No se encontraron consumos con los filtros activos.</div>`;
        return `
            <table class="tabla-cuadros-plant">
                <thead>
                    <tr>
                        <th style="width:85px;">Fecha</th>
                        <th>Maquinaria / Unidad</th>
                        <th>Operario</th>
                        <th>Cisterna Origen</th>
                        <th>Labor / Lote</th>
                        <th style="text-align:right;">Volumen</th>
                        <th style="text-align:center; width:90px;">Acciones</th>
                    </tr>
                </thead>
                <tbody>
                    ${dataset.map(c => `
                        <tr>
                            <td style="white-space:nowrap; font-weight:600; font-size:0.78rem;">${c.fecha || '-'}</td>
                            <td>
                                <strong style="color:var(--color-text); font-size:0.86rem;">🚜 ${c.maquina || 'S/D'}</strong>
                                ${c.centro_costo ? `<div style="font-size:0.68rem; color:var(--color-text-secondary);">Rubro: ${c.centro_costo}</div>` : ''}
                            </td>
                            <td><span style="font-size:0.78rem; color:var(--color-text);">👤 ${c.operario || '-'}</span></td>
                            <td>
                                <span style="background:rgba(0,113,227,0.08); color:#0071E3; padding:2px 6px; border-radius:4px; font-weight:700; font-size:0.7rem;">
                                    🏢 ${c.campo || 'S/D'}
                                </span>
                                <div style="font-size:0.68rem; color:var(--color-text-secondary); margin-top:2px;">${c.combustible || 'DIESEL'}</div>
                            </td>
                            <td>
                                <div style="font-weight:700; color:var(--color-plant-dark); font-size:0.75rem;">${c.labor || 'GENERAL'}</div>
                                <div style="font-size:0.68rem; color:var(--color-text-secondary);">Lote: ${c.lote || 'S/D'} (${c.sup || 0} Ha)</div>
                            </td>
                            <td style="text-align:right; font-weight:800; color:#E0342A; font-family:monospace; font-size:0.9rem; white-space:nowrap;">
                                - ${Number(c.cantidad).toLocaleString('es-AR')} Lts
                            </td>
                            <td style="text-align:center; white-space:nowrap;">
                                <div style="display:inline-flex; gap:4px; align-items:center;">
                                    <button class="btn-accion-plant" onclick="ModuloCombustible.m_abrirModalConsumo('${c.reg_local}')" title="Editar">✏️</button>
                                    <button class="btn-accion-plant btn-delete-plant" onclick="ModuloCombustible.m_borrarConsumo('${c.reg_local}')" title="Borrar">🗑️</button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    },

    m_renderTablaIngresos: function(dataset) {
        if(dataset.length === 0) return `<div style="padding:35px; text-align:center; color:#9AA0A6; font-style:italic;">No se encontraron ingresos con los filtros activos.</div>`;
        return `
            <table class="tabla-cuadros-plant">
                <thead>
                    <tr>
                        <th class="th-ingreso" style="width:85px;">Fecha</th>
                        <th class="th-ingreso">Proveedor Comercial</th>
                        <th class="th-ingreso">Remito</th>
                        <th class="th-ingreso">Cisterna Destino</th>
                        <th class="th-ingreso" style="text-align:right;">Precio Unitario</th>
                        <th class="th-ingreso" style="text-align:right;">Volumen</th>
                        <th class="th-ingreso" style="text-align:center; width:90px;">Acciones</th>
                    </tr>
                </thead>
                <tbody>
                    ${dataset.map(i => `
                        <tr>
                            <td style="white-space:nowrap; font-weight:600; font-size:0.78rem;">${i.fecha || '-'}</td>
                            <td>
                                <strong style="color:var(--color-text); font-size:0.86rem;">${i.proveedor || '-'}</strong>
                                <div style="font-size:0.68rem; color:var(--color-plant); font-weight:700;">${i.combustible || 'DIESEL'}</div>
                            </td>
                            <td><span style="background:rgba(224,134,0,0.08); color:#E08600; padding:2px 6px; border-radius:4px; font-weight:800; font-size:0.7rem;">#${i.remito || 'S/R'}</span></td>
                            <td>
                                <span style="background:#F0F2F5; color:var(--color-plant-dark); padding:2px 6px; border-radius:4px; font-weight:700; font-size:0.7rem;">
                                    🏢 ${i.campo_cisterna || 'S/D'}
                                </span>
                            </td>
                            <td style="text-align:right; font-family:monospace; font-size:0.75rem; color:var(--color-text-secondary);">
                                $ ${Number(i['imp uni_ars'] || i.imp_uni_ars || 0).toLocaleString('es-AR')}
                                <div style="font-size:0.65rem; color:#0071E3;">U$S ${(Number(i.imp_uni_usd) || 0).toFixed(3)}</div>
                            </td>
                            <td style="text-align:right; font-weight:800; color:var(--color-plant); font-family:monospace; font-size:0.9rem; white-space:nowrap;">
                                + ${Number(i.cantidad).toLocaleString('es-AR')} Lts
                            </td>
                            <td style="text-align:center; white-space:nowrap;">
                                <div style="display:inline-flex; gap:4px; align-items:center;">
                                    <button class="btn-accion-plant" onclick="ModuloCombustible.m_abrirModalIngreso('${i.reg_local}')" title="Editar">✏️</button>
                                    <button class="btn-accion-plant btn-delete-plant" onclick="ModuloCombustible.m_borrarIngreso('${i.reg_local}')" title="Borrar">🗑️</button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    },

    m_renderSidebarDetalles: function() {
        if (this.filtroTanque === 'TODO') {
            const globalLts = this.tanques.reduce((a,c) => a + c.actual, 0);
            const globalConsumos = this.datosConsumos.reduce((a,c) => a + (Number(c.cantidad) || 0), 0);
            const globalInversion = this.datosConsumos.reduce((a,c) => a + (Number(c.total_pesos) || 0), 0);
            return `
                <div style="display:flex; flex-direction:column; gap:12px;">
                    <div style="border-bottom:1.5px solid var(--color-border); padding-bottom:8px;">
                        <span style="font-size:0.65rem; color:var(--color-text-secondary); font-weight:800; text-transform:uppercase;">Analytics General</span>
                        <h3 style="margin:2px 0 0 0; font-size:1.05rem; font-weight:800; color:var(--color-plant-dark);">Balance Energético</h3>
                    </div>

                    <div style="background:#F8FAFC; border:1px solid var(--color-border); padding:12px; border-radius:10px;">
                        <span style="font-size:0.65rem; color:var(--color-plant); font-weight:800; display:block; text-transform:uppercase;">Stock Físico Consolidado</span>
                        <strong style="font-size:1.35rem; color:var(--color-plant); font-family:monospace;">${globalLts.toLocaleString('es-AR')} Lts</strong>
                    </div>

                    <div style="background:#F8FAFC; border:1px solid var(--color-border); padding:12px; border-radius:10px;">
                        <span style="font-size:0.65rem; color:#E0342A; font-weight:800; display:block; text-transform:uppercase;">Total Retirado por Maquinarias</span>
                        <strong style="font-size:1.35rem; color:#E0342A; font-family:monospace;">${globalConsumos.toLocaleString('es-AR')} Lts</strong>
                    </div>

                    <div style="background:#F8FAFC; border:1px solid var(--color-border); padding:12px; border-radius:10px;">
                        <span style="font-size:0.65rem; color:#E08600; font-weight:800; display:block; text-transform:uppercase;">Inversión Imputada ($ ARS)</span>
                        <strong style="font-size:1.2rem; color:#E08600; font-family:monospace;">$ ${globalInversion.toLocaleString('es-AR')}</strong>
                    </div>
                </div>
            `;
        }

        const t = this.tanques.find(x => x.nombre.trim().toUpperCase() === this.filtroTanque.trim().toUpperCase());
        if(!t) return `<div style="color:var(--color-text-secondary); font-size:0.8rem;">Seleccione una cisterna.</div>`;

        const consumosAsociados = this.datosConsumos.filter(c => (c.campo || '').trim().toUpperCase() === t.nombre.trim().toUpperCase());
        const totalPesosGastados = consumosAsociados.reduce((acc, c) => acc + (Number(c.total_pesos) || 0), 0);
        const maquinariaMasConsumidora = [...new Set(consumosAsociados.map(c => c.maquina))][0] || "Sin registros";

        return `
            <div style="display:flex; flex-direction:column; gap:12px;">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1.5px solid var(--color-border); padding-bottom:8px;">
                    <div>
                        <span style="font-size:0.65rem; font-weight:800; color:#0071E3; text-transform:uppercase;">Auditoría Cisterna</span>
                        <h3 style="margin:2px 0 0 0; font-size:1.05rem; font-weight:800; color:var(--color-plant-dark);">${t.nombre}</h3>
                    </div>
                    <button onclick="ModuloCombustible.m_onTanqueCardClick('TODO')" style="background:rgba(224,52,42,0.1); border:1px solid rgba(224,52,42,0.2); color:#E0342A; font-size:0.68rem; font-weight:800; padding:4px 8px; border-radius:6px; cursor:pointer;">Cerrar ✕</button>
                </div>

                <div style="display:flex; flex-direction:column; gap:8px;">
                    <div style="display:flex; justify-content:space-between; background:#F8FAFC; border:1px solid var(--color-border); padding:8px 12px; border-radius:8px;">
                        <span style="font-size:0.72rem; color:var(--color-text-secondary); font-weight:600;">Combustible</span>
                        <strong style="color:#0071E3; font-size:0.8rem;">${t.tipo}</strong>
                    </div>
                    <div style="display:flex; justify-content:space-between; background:#F8FAFC; border:1px solid var(--color-border); padding:8px 12px; border-radius:8px;">
                        <span style="font-size:0.72rem; color:var(--color-text-secondary); font-weight:600;">Stock Disponible</span>
                        <strong style="color:var(--color-plant); font-size:0.95rem; font-family:monospace;">${t.actual.toLocaleString('es-AR')} Lts</strong>
                    </div>
                    <div style="display:flex; justify-content:space-between; background:#F8FAFC; border:1px solid var(--color-border); padding:8px 12px; border-radius:8px;">
                        <span style="font-size:0.72rem; color:var(--color-text-secondary); font-weight:600;">Compras (Entradas)</span>
                        <strong style="color:var(--color-text); font-size:0.88rem; font-family:monospace;">+ ${t.entradas.toLocaleString('es-AR')} Lts</strong>
                    </div>
                    <div style="display:flex; justify-content:space-between; background:#F8FAFC; border:1px solid var(--color-border); padding:8px 12px; border-radius:8px;">
                        <span style="font-size:0.72rem; color:var(--color-text-secondary); font-weight:600;">Despachos (Salidas)</span>
                        <strong style="color:#E0342A; font-size:0.88rem; font-family:monospace;">- ${t.salidas.toLocaleString('es-AR')} Lts</strong>
                    </div>
                    <div style="display:flex; justify-content:space-between; background:#F8FAFC; border:1px solid var(--color-border); padding:8px 12px; border-radius:8px;">
                        <span style="font-size:0.72rem; color:var(--color-text-secondary); font-weight:600;">Inversión Imputada</span>
                        <strong style="color:#E08600; font-size:0.88rem; font-family:monospace;">$ ${totalPesosGastados.toLocaleString('es-AR')}</strong>
                    </div>
                    <div style="background:#F8FAFC; border:1px solid var(--color-border); padding:10px 12px; border-radius:8px;">
                        <span style="font-size:0.65rem; color:var(--color-text-secondary); display:block; font-weight:700; text-transform:uppercase;">Mayor Demanda Reciente</span>
                        <strong style="color:var(--color-plant-dark); font-size:0.85rem; display:block; margin-top:2px;">🚜 ${maquinariaMasConsumidora}</strong>
                    </div>
                </div>
            </div>
        `;
    },

    m_aplicarFiltrosCombustible: function() {
        let consumosFiltrados = this.datosConsumos;
        let ingresosFiltrados = this.datosIngresos;

        if (this.filtroTanque !== 'TODO') {
            const ft = this.filtroTanque.trim().toUpperCase();
            consumosFiltrados = consumosFiltrados.filter(c => (c.campo || '').trim().toUpperCase() === ft);
            ingresosFiltrados = ingresosFiltrados.filter(i => (i.campo_cisterna || '').trim().toUpperCase() === ft);
        }
        if (this.filtroTipo !== 'TODO') {
            const ftp = this.filtroTipo.trim().toUpperCase();
            consumosFiltrados = consumosFiltrados.filter(c => (c.combustible || '').trim().toUpperCase() === ftp);
            ingresosFiltrados = ingresosFiltrados.filter(i => (i.combustible || '').trim().toUpperCase() === ftp);
        }
        if (this.textoBusqueda) {
            const txt = this.textoBusqueda.toLowerCase();
            consumosFiltrados = consumosFiltrados.filter(c => 
                (c.maquina || '').toLowerCase().includes(txt) || 
                (c.operario || '').toLowerCase().includes(txt) ||
                (c.labor || '').toLowerCase().includes(txt) ||
                (c.centro_costo || '').toLowerCase().includes(txt)
            );
            ingresosFiltrados = ingresosFiltrados.filter(i => 
                (i.proveedor || '').toLowerCase().includes(txt) || 
                (i.remito && String(i.remito).toLowerCase().includes(txt))
            );
        }

        const cont = document.getElementById('contenedor-tablas');
        if (cont) {
            cont.innerHTML = this.tabActiva === 'consumos' 
                ? this.m_renderTablaConsumos(consumosFiltrados) 
                : this.m_renderTablaIngresos(ingresosFiltrados);
        }
        const sidebar = document.getElementById('sidebar-analytics-comb');
        if (sidebar) sidebar.innerHTML = this.m_renderSidebarDetalles();
    },

    m_onTanqueCardClick: function(nombreTanque, elemento) {
        if(this.filtroTanque === nombreTanque) {
            this.filtroTanque = 'TODO';
            if(elemento) elemento.classList.remove('active-filter');
        } else {
            this.filtroTanque = nombreTanque;
            document.querySelectorAll('.card-tanque-comb').forEach(el => el.classList.remove('active-filter'));
            if(elemento) elemento.classList.add('active-filter');
        }
        this.m_aplicarFiltrosCombustible();
    },

    m_onBusquedaInput: function(valor) { this.textoBusqueda = valor; this.m_aplicarFiltrosCombustible(); },
    m_onTipoChange: function(tipoSel) { this.filtroTipo = tipoSel; this.m_aplicarFiltrosCombustible(); },
    m_limpiarFiltrosSistemas: function() { 
        this.filtroTanque = 'TODO'; 
        this.filtroTipo = 'TODO'; 
        this.textoBusqueda = ''; 
        document.querySelectorAll('.card-tanque-comb').forEach(el => el.classList.remove('active-filter'));
        const inp = document.getElementById('busqueda-combustible');
        if(inp) inp.value = '';
        const sel = document.getElementById('select-tipo-comb');
        if(sel) sel.value = 'TODO';
        this.m_aplicarFiltrosCombustible(); 
    },
    m_cambiarTabArchivero: function(tipo) { 
        this.tabActiva = tipo; 
        this.m_dibujarTodo();
    },

    m_abrirModalIngreso: function(id = null) {
        this.m_asegurarModalBase();
        const reg = id ? this.datosIngresos.find(i => i.reg_local === id) : null;
        const modal = document.getElementById('modal-agrosoft');
        if(modal) modal.style.display = 'flex';
        document.getElementById('modal-titulo').innerText = reg ? "MODIFICAR INGRESO / COMPRA" : "REGISTRO DE INGRESO / COMPRA";

        const camposAgrupados = [...new Set(this.parametros.campos.map(c => c.campo).filter(Boolean))];

        document.getElementById('modal-formulario').innerHTML = `
            <div style="display:flex; flex-direction:column; gap:14px; font-family:'Roboto', sans-serif;">
                <div style="background: #F8FAFC; border: 1px solid var(--color-border); padding: 14px; border-radius: 12px; display:grid; grid-template-columns:repeat(3, 1fr); gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Fecha</label>
                        <input type="date" id="com_fecha" value="${reg?.fecha || new Date().toISOString().split('T')[0]}" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Cisterna / Campo</label>
                        <select id="com_campo" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; background:#FFFFFF;">
                            <option value="">Seleccione Cisterna...</option>
                            ${camposAgrupados.map(cp => {
                                const isSelected = reg?.campo_cisterna && reg.campo_cisterna.trim().toUpperCase() === cp.trim().toUpperCase() ? 'selected' : '';
                                return `<option value="${cp.toUpperCase()}" ${isSelected}>${cp.toUpperCase()}</option>`;
                            }).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Combustible</label>
                        <select id="com_tipo" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; background:#FFFFFF;">
                            <option value="">Seleccione Artículo...</option>
                            ${this.parametros.insumosComb.map(ins => {
                                const isSelected = reg?.combustible && reg.combustible.trim().toUpperCase() === ins.articulo.trim().toUpperCase() ? 'selected' : '';
                                return `<option value="${ins.articulo.toUpperCase()}" ${isSelected}>${ins.articulo.toUpperCase()} (${ins.rubro})</option>`;
                            }).join('')}
                        </select>
                    </div>
                </div>

                <div style="background: #F8FAFC; border: 1px solid var(--color-border); padding: 14px; border-radius: 12px; display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Proveedor</label>
                        <input type="text" id="com_prov" value="${reg?.proveedor || ''}" placeholder="Razón social" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Remito N°</label>
                        <input type="text" id="com_remito" value="${reg?.remito || ''}" placeholder="Ej: 000123" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:var(--color-plant); text-transform:uppercase; font-weight:800; display:block; margin-bottom:4px;">Cantidad (Litros)</label>
                        <input type="number" id="com_cant" value="${reg?.cantidad || ''}" placeholder="0" style="width:100%; padding:8px 10px; border-radius:8px; border:2px solid var(--color-plant) !important; font-size:0.95rem; font-weight:bold; box-sizing:border-box;">
                    </div>
                </div>

                <div style="background: #F8FAFC; border: 1px solid var(--color-border); padding: 14px; border-radius: 12px; display:grid; grid-template-columns:repeat(3, 1fr); gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Precio Unit. ($ ARS)</label>
                        <input type="number" id="com_imp_uni_p" oninput="ModuloCombustible.m_recalcularIngreso()" value="${reg?.['imp uni_ars'] || reg?.imp_uni_ars || ''}" placeholder="0.00" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Cotización Dólar</label>
                        <input type="number" id="com_coti" oninput="ModuloCombustible.m_recalcularIngreso()" value="${reg?.cotizacion || 1200}" placeholder="1200" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#0071E3; text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Precio Unit. (U$S)</label>
                        <input type="number" id="com_imp_uni_u" step="0.001" readonly value="${reg?.imp_uni_usd || ''}" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid rgba(0,113,227,0.25); background:rgba(0,113,227,0.06); color:#0071E3; font-weight:bold; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--color-border); padding-top:12px; margin-top:4px;">
                    <button type="button" onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background:#F0F2F5; color:var(--color-text); border:1px solid var(--color-border); padding:8px 16px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer;">CANCELAR</button>
                    <button type="button" id="btn-guardar-ingreso-local" style="background:var(--color-plant); color:#FFF; border:none; padding:8px 22px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer; box-shadow:0 4px 12px rgba(30,107,76,0.25);">
                        ${reg ? 'CONFIRMAR MODIFICACIÓN' : 'CONFIRMAR INGRESO'}
                    </button>
                </div>
            </div>`;

        document.getElementById('btn-guardar-ingreso-local').onclick = () => this.m_guardarIngreso(id);
    },

    m_recalcularIngreso: function() {
        const pesos = parseFloat(document.getElementById('com_imp_uni_p').value) || 0;
        const coti = parseFloat(document.getElementById('com_coti').value) || 0;
        const inputUSD = document.getElementById('com_imp_uni_u');
        if (inputUSD) {
            inputUSD.value = coti > 0 ? (pesos / coti).toFixed(3) : '0.000';
        }
    },

    m_abrirModalConsumo: function(id = null) {
        this.m_asegurarModalBase();
        const reg = id ? this.datosConsumos.find(c => c.reg_local === id) : null;
        const modal = document.getElementById('modal-agrosoft');
        if(modal) modal.style.display = 'flex';
        document.getElementById('modal-titulo').innerText = reg ? "MODIFICAR CONSUMO / EGRESO" : "REGISTRO DE CONSUMO / EGRESO";

        const cisternasConStock = this.tanques.filter(t => t.actual > 0 || id);

        document.getElementById('modal-formulario').innerHTML = `
            <div style="display:flex; flex-direction:column; gap:14px; font-family:'Roboto', sans-serif;">
                <div style="background: #F8FAFC; border: 1px solid var(--color-border); padding: 14px; border-radius: 12px; display:grid; grid-template-columns:repeat(3, 1fr); gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Fecha</label>
                        <input type="date" id="c_fecha" value="${reg?.fecha || new Date().toISOString().split('T')[0]}" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Máquina / Unidad</label>
                        <input type="text" id="c_maq" value="${reg?.maquina || ''}" placeholder="Ej: TRACTOR JOHN DEERE" style="text-transform:uppercase; width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Operario</label>
                        <input type="text" id="c_ope" value="${reg?.operario || ''}" placeholder="Nombre del chofer" style="text-transform:uppercase; width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                    </div>
                </div>

                <div style="background: #F8FAFC; border: 1px solid var(--color-border); padding: 14px; border-radius: 12px; display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Cisterna Origen (Stock Disp.)</label>
                        <select id="c_origen" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; background:#FFFFFF;" onchange="ModuloCombustible.m_buscarUltimoPrecio()">
                            <option value="">Seleccionar cisterna...</option>
                            ${cisternasConStock.map(t => `
                                <option value="${t.nombre}|${t.tipo}" ${reg?.campo == t.nombre && reg?.combustible == t.tipo ? 'selected' : ''}>
                                    ${t.nombre} - ${t.tipo} (${t.actual.toLocaleString('es-AR')} Lts)
                                </option>
                            `).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Lote Cuadro</label>
                        <input type="text" id="c_lote" value="${reg?.lote || ''}" placeholder="Ej: LOTE 1" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Superficie (Ha)</label>
                        <input type="number" step="0.1" id="c_sup" value="${reg?.sup || ''}" placeholder="0" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                    </div>
                </div>

                <div style="background: #F8FAFC; border: 1px solid var(--color-border); padding: 14px; border-radius: 12px; display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Labor Realizada</label>
                        <select id="c_labor" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; background:#FFFFFF;" onchange="ModuloCombustible.m_onLaborChange(this.value)">
                            <option value="">Seleccione labor...</option>
                            ${this.parametros.labores.map(l => `<option value="${l.labor}" ${reg?.labor === l.labor ? 'selected' : ''}>${l.labor}</option>`).join('')}
                        </select>
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Centro de Costo</label>
                        <div style="display:flex; gap:6px;">
                            <select id="c_centro" style="flex:1; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; background:#FFFFFF;">
                                <option value="">Seleccione grupo...</option>
                                ${this.parametros.gastos.map(g => `<option value="${g.nombre_gasto}" ${reg?.centro_costo === g.nombre_gasto ? 'selected' : ''}>${g.nombre_gasto}</option>`).join('')}
                            </select>
                            <button type="button" class="btn-accion-plant" onclick="ModuloCombustible.m_nuevoCentroCostoExpress()" title="Crear nuevo centro de costo" style="background:var(--color-plant); color:#FFF; border:none; width:34px; height:34px; border-radius:8px; font-weight:bold; font-size:1.1rem;">+</button>
                        </div>
                    </div>
                </div>

                <div style="background: #F8FAFC; border: 1px solid var(--color-border); padding: 14px; border-radius: 12px; display:grid; grid-template-columns:repeat(3, 1fr); gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#E0342A; text-transform:uppercase; font-weight:800; display:block; margin-bottom:4px;">Cantidad Despachada (Litros)</label>
                        <input type="number" id="c_cant" value="${reg?.cantidad || ''}" placeholder="0" style="width:100%; padding:8px 10px; border-radius:8px; border:2px solid #E0342A !important; font-size:0.95rem; font-weight:bold; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Precio Unit. ($ ARS)</label>
                        <input type="number" id="c_p_p" value="${reg?.imp_uni_pesos || ''}" placeholder="0.00" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Precio Unit. (U$S)</label>
                        <input type="number" id="c_p_u" step="0.001" value="${reg?.imp_uni_dolar || ''}" placeholder="0.000" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                    </div>
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--color-border); padding-top:12px; margin-top:4px;">
                    <button type="button" onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background:#F0F2F5; color:var(--color-text); border:1px solid var(--color-border); padding:8px 16px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer;">CANCELAR</button>
                    <button type="button" id="btn-guardar-consumo-local" style="background:#E0342A; color:#FFF; border:none; padding:8px 22px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer; box-shadow:0 4px 12px rgba(224,52,42,0.25);">
                        ${reg ? 'CONFIRMAR MODIFICACIÓN' : 'CONFIRMAR CONSUMO'}
                    </button>
                </div>
            </div>`;
        
        if(!reg) this.m_buscarUltimoPrecio(); 
        document.getElementById('btn-guardar-consumo-local').onclick = () => this.m_guardarConsumo(id);
    },

    m_abrirModalTransferencia: function() {
        this.m_asegurarModalBase();
        const modal = document.getElementById('modal-agrosoft');
        if(modal) modal.style.display = 'flex';
        document.getElementById('modal-titulo').innerText = "TRASLADO INTERNO DE COMBUSTIBLE";

        const cisternasConStock = this.tanques.filter(t => t.actual > 0);

        document.getElementById('modal-formulario').innerHTML = `
            <div style="display:flex; flex-direction:column; gap:14px; font-family:'Roboto', sans-serif;">
                <div style="background: #F8FAFC; border: 1px solid var(--color-border); padding: 14px; border-radius: 12px;">
                    <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Fecha Traslado</label>
                    <input type="date" id="tr_fecha" value="${new Date().toISOString().split('T')[0]}" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                </div>

                <div style="background: #F8FAFC; border: 1px solid var(--color-border); padding: 14px; border-radius: 12px; display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#E08600; text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Cisterna Origen (Retira)</label>
                        <select id="tr_origen" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; background:#FFFFFF;">
                            <option value="">Seleccionar origen...</option>
                            ${cisternasConStock.map(t => `<option value="${t.nombre}|${t.tipo}">${t.nombre} - ${t.tipo} (${t.actual.toLocaleString('es-AR')} Lts)</option>`).join('')}
                        </select>
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#0071E3; text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Cisterna Destino (Recibe)</label>
                        <select id="tr_destino" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; background:#FFFFFF;">
                            <option value="">Seleccionar destino...</option>
                            ${this.tanques.map(t => `<option value="${t.nombre}|${t.tipo}">${t.nombre} - ${t.tipo}</option>`).join('')}
                        </select>
                    </div>
                </div>

                <div style="background: #F8FAFC; border: 1px solid var(--color-border); padding: 14px; border-radius: 12px;">
                    <label style="font-size:0.65rem; color:var(--color-plant); text-transform:uppercase; font-weight:800; display:block; margin-bottom:4px;">Volumen a Trasladar (Litros)</label>
                    <input type="number" id="tr_cant" placeholder="0" style="width:100%; padding:8px 10px; border-radius:8px; border:2px solid var(--color-plant) !important; font-size:0.95rem; font-weight:bold; box-sizing:border-box;">
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--color-border); padding-top:12px; margin-top:4px;">
                    <button type="button" onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background:#F0F2F5; color:var(--color-text); border:1px solid var(--color-border); padding:8px 16px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer;">CANCELAR</button>
                    <button type="button" id="btn-confirmar-traslado" style="background:#0071E3; color:#FFF; border:none; padding:8px 22px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer; box-shadow:0 4px 12px rgba(0,113,227,0.25);">
                        EJECUTAR TRASLADO SEGURO
                    </button>
                </div>
            </div>`;

        document.getElementById('btn-confirmar-traslado').onclick = () => this.m_ejecutarTransferencia();
    },

    m_ejecutarTransferencia: async function() {
        const origen = document.getElementById('tr_origen').value;
        const destino = document.getElementById('tr_destino').value;
        const cant = parseFloat(document.getElementById('tr_cant').value) || 0;
        const fecha = document.getElementById('tr_fecha').value;

        if(!origen || !destino) return alert("⚠️ Especifique de manera obligatoria cisterna de origen y destino.");
        if(cant <= 0) return alert("⚠️ Indique un volumen superior a cero.");
        if(origen === destino) return alert("⚠️ No se puede trasladar stock hacia la misma cisterna.");

        const [oCampo, oTipo] = origen.split('|');
        const [dCampo, dTipo] = destino.split('|');

        if(oTipo !== dTipo) return alert("⚠️ Incompatibilidad física: Las cisternas deben manejar el mismo tipo de combustible.");

        const cisternaSeleccionada = this.tanques.find(t => t.nombre === oCampo && t.tipo === oTipo);
        if(cisternaSeleccionada && cant > cisternaSeleccionada.actual) {
            return alert(`⚠️ Volumen insuficiente. La cisterna de origen solo cuenta con ${cisternaSeleccionada.actual} litros disponibles.`);
        }

        const btn = document.getElementById('btn-confirmar-traslado');
        if(btn) { btn.disabled = true; btn.innerText = "PROCESANDO TRASLADO..."; }

        try {
            const resMaxC = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(REPLACE(reg_local, 'CONS-', '') AS INTEGER)) as max_val FROM consumos_combustibles`);
            const maxValC = (resMaxC.data && resMaxC.data[0] && resMaxC.data[0].max_val) ? Number(resMaxC.data[0].max_val) : 0;
            const nuevoIdConsumo = "CONS-" + (maxValC + 1);

            const resMaxI = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(REPLACE(reg_local, 'ING-', '') AS INTEGER)) as max_val FROM combustibles_ingresos`);
            const maxValI = (resMaxI.data && resMaxI.data[0] && resMaxI.data[0].max_val) ? Number(resMaxI.data[0].max_val) : 0;
            const nuevoIdIngreso = "ING-" + (maxValI + 1);

            const ultimoIngreso = this.datosIngresos.find(i => i.campo_cisterna === oCampo && i.combustible === oTipo);
            const p_p = ultimoIngreso ? (ultimoIngreso['imp uni_ars'] || ultimoIngreso.imp_uni_ars || 0) : 0;
            const p_u = ultimoIngreso ? (ultimoIngreso.imp_uni_usd || ultimoIngreso.imp_uni_dolar || 0) : 0;
            const coti = ultimoIngreso ? (ultimoIngreso.cotizacion || 1200) : 1200;

            const numericIdIngreso = maxValI + 1;

            // Inserto Consumo Salida Local
            const sqlConsumo = `
                INSERT INTO consumos_combustibles (
                    reg_local, fecha, maquina, operario, campo, combustible, cantidad, 
                    lote, sup, labor, centro_costo, imp_uni_pesos, total_pesos, 
                    imp_uni_dolar, total_dolar, usuario, sincronizado
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            await this.m_ejecutarSqlLocal(sqlConsumo, [
                nuevoIdConsumo, fecha, "TRASLADO INTERNO", "SISTEMA LOGÍSTICO", oCampo, oTipo, cant,
                "TR-00", 0, "TRANSFERENCIA DE STOCK", "LOGISTICA CISTERNAS", p_p, cant * p_p,
                p_u, cant * p_u, "ADM", 0
            ]);

            // Inserto Ingreso Entrada Local
            const sqlIngreso = `
                INSERT INTO combustibles_ingresos (
                    reg_local, fecha, campo_cisterna, combustible, proveedor, remito, 
                    cantidad, imp_uni_ars, cotizacion, imp_uni_usd, id, usuario, sincronizado
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            await this.m_ejecutarSqlLocal(sqlIngreso, [
                nuevoIdIngreso, fecha, dCampo, dTipo, `TRASLADO DESDE ${oCampo}`, "AUTO-TR",
                cant, p_p, coti, p_u, numericIdIngreso, "OPERADOR ADM", 0
            ]);

            document.getElementById('modal-agrosoft').style.display = 'none';
            await this.m_inicializar();
            if (window.ComponentesUI && window.ComponentesUI.notificar) {
                window.ComponentesUI.notificar("🔄 Traslado de combustible registrado con éxito.");
            }
        } catch (e) {
            console.error("❌ Error en traslado local:", e);
            alert("Error en traslado logístico local: " + e.message);
            if(btn) { btn.disabled = false; btn.innerText = "EJECUTAR TRASLADO SEGURO"; }
        }
    },

    m_borrarConsumo: async function(id) {
        if (!confirm("⚠️ ¿Desea eliminar este registro de consumo energético? Se descontará en caliente de todos los balances.")) return;
        try {
            await this.m_ejecutarSqlLocal(`DELETE FROM consumos_combustibles WHERE reg_local = ?`, [id]);
            
            const regLocalNumeric = parseInt(id.replace(/[^0-9]/g, ""));
            if (!isNaN(regLocalNumeric)) {
                await this.m_ejecutarSqlLocal(`DELETE FROM egresos_insumos WHERE reg_local = ? AND tabla_origen = 'COMBUSTIBLE'`, [String(regLocalNumeric)]);
            }

            await this.m_inicializar();
        } catch (err) { 
            console.error(err);
            alert("Error al eliminar el consumo local: " + err.message); 
        }
    },

    m_borrarIngreso: async function(id) {
        if (!confirm("⚠️ ¿Desea eliminar esta compra/ingreso de combustible? Esto afectará el cubicaje acumulado de la cisterna.")) return;
        try {
            await this.m_ejecutarSqlLocal(`DELETE FROM combustibles_ingresos WHERE reg_local = ?`, [id]);
            await this.m_inicializar();
        } catch (err) { 
            console.error(err);
            alert("Error al eliminar el ingreso local: " + err.message); 
        }
    },

    m_onLaborChange: function(laborSeleccionada) {
        if (!laborSeleccionada) return;
        const matchLabor = this.parametros.labores.find(l => l.labor === laborSeleccionada);
        if (matchLabor && matchLabor.rubro) {
            const rubroFormateado = matchLabor.rubro.trim().toUpperCase();
            const selectCentro = document.getElementById('c_centro');
            if (selectCentro) {
                let existeOp = false;
                for (let i = 0; i < selectCentro.options.length; i++) {
                    if (selectCentro.options[i].value === rubroFormateado) { selectCentro.selectedIndex = i; existeOp = true; break; }
                }
                if (!existeOp) { selectCentro.add(new Option(rubroFormateado, rubroFormateado, true, true)); }
            }
        }
    },

    m_nuevoCentroCostoExpress: function() {
        const container = document.getElementById('modal-formulario');
        if (!container) return;
        const formOriginal = container.innerHTML;

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                <div style="background:var(--color-plant-soft); border-left:4px solid var(--color-plant); padding:10px 14px; border-radius:8px;">
                    <strong style="color:var(--color-plant-dark); font-size:0.85rem;">NUEVA NOMENCLATURA EN TIPOS_GASTOS</strong>
                    <p style="font-size:0.72rem; margin:2px 0 0 0; color:var(--color-text-secondary);">Agregue un nuevo concepto de imputación de costos energéticos.</p>
                </div>
                <div>
                    <label style="font-size:0.65rem; color:var(--color-text-secondary); font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Descripción del Rubro Contable</label>
                    <input type="text" id="txt_nuevo_rubro_comb" placeholder="Ej: LABORES CONTRATISTAS" style="text-transform:uppercase; width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                </div>
                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px; border-top:1px solid var(--color-border); padding-top:12px;">
                    <button type="button" id="btn-abortar-rubro" style="background:#F0F2F5; color:var(--color-text); border:1px solid var(--color-border); padding:8px 16px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer;">VOLVER</button>
                    <button type="button" id="btn-confirmar-rubro" style="background:var(--color-plant); color:#FFF; border:none; padding:8px 18px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer; box-shadow:0 4px 12px rgba(30,107,76,0.25);">REGISTRAR</button>
                </div>
            </div>`;
        document.getElementById('btn-abortar-rubro').onclick = () => { container.innerHTML = formOriginal; };
        document.getElementById('btn-confirmar-rubro').onclick = async () => {
            const nombre = document.getElementById('txt_nuevo_rubro_comb').value.trim().toUpperCase();
            if (!nombre) return alert("Descripción mandatoria.");
            try {
                await this.m_ejecutarSqlLocal(`INSERT INTO tipos_gastos (nombre_gasto, sincronizado) VALUES (?, 0)`, [nombre]);
                this.parametros.gastos.push({ nombre_gasto: nombre });
                container.innerHTML = formOriginal;
                const selectCentro = document.getElementById('c_centro');
                if (selectCentro) { selectCentro.add(new Option(nombre, nombre, true, true)); }
            } catch (err) { alert(err.message); }
        };
    },

    m_buscarUltimoPrecio: function() {
        const selectElement = document.getElementById('c_origen');
        if (!selectElement) return;
        const seleccion = selectElement.value;
        if (!seleccion) return;
        const [campo, tipo] = seleccion.split('|');
        const ultimoIngreso = this.datosIngresos.find(i => i.campo_cisterna === campo && i.combustible === tipo);
        if (ultimoIngreso) {
            const inputPesos = document.getElementById('c_p_p');
            const inputDolar = document.getElementById('c_p_u');
            if (inputPesos) inputPesos.value = ultimoIngreso['imp uni_ars'] || ultimoIngreso.imp_uni_ars || 0;
            if (inputDolar) inputDolar.value = ultimoIngreso.imp_uni_usd || ultimoIngreso.imp_uni_dolar || 0;
        }
    },

    m_guardarIngreso: async function(id) {
        const btn = document.getElementById('btn-guardar-ingreso-local');
        let registroID = id;
        
        if (!registroID) {
            const resMax = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(REPLACE(reg_local, 'ING-', '') AS INTEGER)) as max_val FROM combustibles_ingresos`);
            const maxVal = (resMax.data && resMax.data[0] && resMax.data[0].max_val) ? Number(resMax.data[0].max_val) : 0;
            const nuevoNum = maxVal + 1;
            registroID = "ING-" + nuevoNum;
        }

        const fecha = document.getElementById('com_fecha').value;
        const campoCisterna = document.getElementById('com_campo').value.toUpperCase();
        const combustible = document.getElementById('com_tipo').value.toUpperCase();
        const proveedor = document.getElementById('com_prov').value.toUpperCase();
        const remito = document.getElementById('com_remito').value;
        const cantidad = parseInt(document.getElementById('com_cant').value) || 0;
        const impUniArs = parseInt(document.getElementById('com_imp_uni_p').value) || 0;
        const cotizacion = parseInt(document.getElementById('com_coti').value) || 0;
        const impUniUsd = parseFloat(document.getElementById('com_imp_uni_u').value) || 0;

        if (!campoCisterna || !combustible || cantidad <= 0) {
            return alert("⚠️ Complete cisterna, combustible y una cantidad mayor a cero.");
        }

        if (btn) { btn.innerText = "GUARDANDO LOCAL..."; btn.disabled = true; }

        try {
            const numericId = parseInt(registroID.replace(/[^0-9]/g, "")) || Math.floor(Math.random() * 900000) + 100000;

            const sqlUpsert = `
                INSERT INTO combustibles_ingresos (
                    reg_local, fecha, campo_cisterna, combustible, proveedor, remito, 
                    cantidad, imp_uni_ars, cotizacion, imp_uni_usd, id, usuario, sincronizado
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                ON CONFLICT(reg_local, id) DO UPDATE SET
                    fecha=excluded.fecha,
                    campo_cisterna=excluded.campo_cisterna,
                    combustible=excluded.combustible,
                    proveedor=excluded.proveedor,
                    remito=excluded.remito,
                    cantidad=excluded.cantidad,
                    imp_uni_ars=excluded.imp_uni_ars,
                    cotizacion=excluded.cotizacion,
                    imp_uni_usd=excluded.imp_uni_usd,
                    sincronizado=0
            `;

            await this.m_ejecutarSqlLocal(sqlUpsert, [
                registroID, fecha, campoCisterna, combustible, proveedor, remito,
                cantidad, impUniArs, cotizacion, impUniUsd, numericId, "OPERADOR ADM"
            ]);

            document.getElementById('modal-agrosoft').style.display = 'none';
            await this.m_inicializar();
        } catch (e) { 
            console.error("❌ Error al guardar ingreso local:", e);
            alert(e.message); 
            if (btn) { btn.disabled = false; btn.innerText = "CONFIRMAR"; } 
        }
    },

    m_guardarConsumo: async function(id) {
        const btn = document.getElementById('btn-guardar-consumo-local');
        const selectOrigen = document.getElementById('c_origen').value;
        if (!selectOrigen) return alert("⚠️ Debe seleccionar una cisterna origen.");

        const [campo, tipo] = selectOrigen.split('|');
        const cant = parseFloat(document.getElementById('c_cant').value) || 0;
        const p_p = parseFloat(document.getElementById('c_p_p').value) || 0;
        const p_u = parseFloat(document.getElementById('c_p_u').value) || 0;

        if (cant <= 0) return alert("⚠️ Indique una cantidad de litros mayor a cero.");

        let idRegistroUnico = id;
        if (!idRegistroUnico) {
            const resMaxC = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(REPLACE(reg_local, 'CONS-', '') AS INTEGER)) as max_val FROM consumos_combustibles`);
            const maxVal = (resMaxC.data && resMaxC.data[0] && resMaxC.data[0].max_val) ? Number(resMaxC.data[0].max_val) : 0;
            const nuevoNum = maxVal + 1;
            idRegistroUnico = "CONS-" + nuevoNum;
        }

        const regLocalNumeric = parseInt(idRegistroUnico.replace(/[^0-9]/g, "")) || Math.floor(Math.random() * 900000) + 100000;

        const fecha = document.getElementById('c_fecha').value;
        const maquina = document.getElementById('c_maq').value.toUpperCase();
        const operario = document.getElementById('c_ope').value.toUpperCase();
        const lote = document.getElementById('c_lote').value;
        const sup = document.getElementById('c_sup').value;
        const labor = document.getElementById('c_labor').value;
        const centroCosto = document.getElementById('c_centro').value;
        const totalPesos = parseFloat((cant * p_p).toFixed(2));
        const totalDolar = parseFloat((cant * p_u).toFixed(2));

        if (btn) { btn.innerText = "GUARDANDO LOCAL..."; btn.disabled = true; }

        try {
            // 1. Inserción local en consumos_combustibles
            const sqlConsumos = `
                INSERT INTO consumos_combustibles (
                    reg_local, fecha, maquina, operario, campo, combustible, cantidad, 
                    lote, sup, labor, centro_costo, imp_uni_pesos, total_pesos, 
                    imp_uni_dolar, total_dolar, usuario, sincronizado
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                ON CONFLICT(reg_local) DO UPDATE SET
                    fecha=excluded.fecha,
                    maquina=excluded.maquina,
                    operario=excluded.operario,
                    campo=excluded.campo,
                    combustible=excluded.combustible,
                    cantidad=excluded.cantidad,
                    lote=excluded.lote,
                    sup=excluded.sup,
                    labor=excluded.labor,
                    centro_costo=excluded.centro_costo,
                    imp_uni_pesos=excluded.imp_uni_pesos,
                    total_pesos=excluded.total_pesos,
                    imp_uni_dolar=excluded.imp_uni_dolar,
                    total_dolar=excluded.total_dolar,
                    sincronizado=0
            `;

            await this.m_ejecutarSqlLocal(sqlConsumos, [
                idRegistroUnico, fecha, maquina, operario, campo, tipo, cant,
                lote, sup, labor, centroCosto, p_p, totalPesos, p_u, totalDolar, "ADM"
            ]);

            // 2. Trazabilidad espejo en egresos_insumos con regla Max(orden_trab)+1
            const resMaxE = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(orden_trab AS INTEGER)) as max_ot FROM egresos_insumos`);
            const maxOrden = (resMaxE.data && resMaxE.data[0] && resMaxE.data[0].max_ot) ? Number(resMaxE.data[0].max_ot) : 0;
            const nuevaOT = String(maxOrden + 1);

            const sqlEgresos = `
                INSERT INTO egresos_insumos (
                    reg_local, tabla_origen, orden_trab, fecha, deposito_origen, insumo, 
                    establecimiento, campo, labor, tipo_labor, cuadro, sup_uso, total_consumo, 
                    imp_uni, total_dolar, total_pesos, centro_costo, comentario, estado, id, sincronizado
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                ON CONFLICT(reg_local, id) DO UPDATE SET
                    fecha=excluded.fecha,
                    deposito_origen=excluded.deposito_origen,
                    insumo=excluded.insumo,
                    establecimiento=excluded.establecimiento,
                    campo=excluded.campo,
                    labor=excluded.labor,
                    tipo_labor=excluded.tipo_labor,
                    cuadro=excluded.cuadro,
                    sup_uso=excluded.sup_uso,
                    total_consumo=excluded.total_consumo,
                    imp_uni=excluded.imp_uni,
                    total_dolar=excluded.total_dolar,
                    total_pesos=excluded.total_pesos,
                    centro_costo=excluded.centro_costo,
                    comentario=excluded.comentario,
                    estado='Activo',
                    sincronizado=0
            `;

            await this.m_ejecutarSqlLocal(sqlEgresos, [
                String(regLocalNumeric),
                "COMBUSTIBLE",
                nuevaOT,
                fecha,
                campo,
                tipo,
                campo,
                campo,
                labor,
                labor,
                (lote && lote.trim() !== "" && lote !== "0") ? lote : "Sin Cuadro",
                parseFloat(sup) || 0,
                cant,
                p_u,
                totalDolar,
                totalPesos,
                (centroCosto && centroCosto.trim() !== "") ? centroCosto.toUpperCase() : "COMBUSTIBLE",
                `Operario: ${operario}`,
                'Activo',
                regLocalNumeric
            ]);

            document.getElementById('modal-agrosoft').style.display = 'none';
            await this.m_inicializar();
        } catch (e) { 
            console.error("❌ Error al guardar consumo local:", e);
            alert(e.message); 
            if (btn) { btn.disabled = false; btn.innerText = "CONFIRMAR"; } 
        }
    }
};

window.ModuloCombustible = ModuloCombustible;