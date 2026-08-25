/**
 * ModuloStockInsumos: Auditoría de Inventario Real-Time (LOCAL-FIRST SQLITE ENGINE)
 * AgroSoft J&L - "Apple Soft Studio" Edition / Tipografía Roboto
 * Paradigma: Local-First (Base SQLite Local -> Sincronizador Async)
 * Directivas: "No me quites nada" + Max(registro)+1 + Estado Activo + sincronizado = 0
 */
const ModuloStockInsumos = {
    datosStock: [],        
    datosOriginales: { ingresos: [], egresos: [] }, 
    listaDepositos: [], 
    
    filtroDeposito: 'TODO',
    filtroTipo: 'TODO',
    textoBusqueda: '',
    vistaActualTab: 'TODOS', // 'TODOS' | 'ALERTAS'
    
    parametros: {
        cuadros: [],
        gastos: []
    },

    // Helper IPC para ejecutar consultas SQL locales
    m_ejecutarSqlLocal: async function(sql, params = []) {
        if (window.apiLocal && window.apiLocal.query) {
            return await window.apiLocal.query({ sql, params });
        }
        if (window.electronAPI && window.electronAPI.invoke) {
            return await window.electronAPI.invoke('local-db-query', { sql, params });
        }
        throw new Error("No se encontró el puente IPC con la base de datos local.");
    },

    m_asegurarModalBase: function() {
        let modal = document.getElementById('modal-agrosoft');
        if (!modal) {
            const modalHTML = `
                <div id="modal-agrosoft" class="modal-overlay" style="display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(18, 22, 28, 0.48); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); z-index: 99999; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box;">
                    <div class="modal-apple-content" style="background: #FFFFFF; border: 1.5px solid #E0DCD4; border-radius: 14px; padding: 24px; width: 95%; max-width: 780px; max-height: 90vh; color: #1D1D1F; box-shadow: 0 10px 25px rgba(0,0,0,0.15); display: flex; flex-direction: column; position: relative;">
                        <div class="modal-header-apple" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid #E0DCD4; padding-bottom: 12px; flex-shrink: 0;">
                            <h3 id="modal-titulo" style="margin: 0; font-size: 1.15rem; font-weight: 800; font-family: 'Roboto', sans-serif; color: #123F2C; letter-spacing: -0.3px;">GESTIÓN DE STOCK</h3>
                            <button onclick="ModuloStockInsumos.m_cerrarModal()" style="background: none; border: none; color: #6E6E73; font-size: 1.5rem; font-weight:bold; cursor: pointer;">&times;</button>
                        </div>
                        <div id="modal-formulario" style="max-height: 72vh; overflow-y: auto; padding-right: 4px;"></div>
                    </div>
                </div>`;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
        }
    },

    m_cerrarModal: function() {
        const modal = document.getElementById('modal-agrosoft');
        if (modal) modal.style.display = 'none';
    },

    m_notificarAlerta: function(mensaje, tipo = 'exito') {
        const colorBorde = tipo === 'exito' ? '#1FA958' : tipo === 'error' ? '#E0342A' : '#E08600';
        const icono = tipo === 'exito' ? '✅' : tipo === 'error' ? '❌' : '📦';

        const toastHTML = `
            <div id="apple-toast-premium" style="position: fixed; top: 30px; left: 50%; transform: translateX(-50%); background: #FFFFFF; border-left: 4px solid ${colorBorde}; border-top: 1px solid #E0DCD4; border-bottom: 1px solid #E0DCD4; border-right: 1px solid #E0DCD4; border-radius: 14px; padding: 12px 22px; display: flex; align-items: center; gap: 12px; color: #1D1D1F; font-family: 'Roboto', sans-serif; font-size: 0.85rem; font-weight: 600; box-shadow: 0 6px 16px rgba(20,26,36,0.12); z-index: 100000;">
                <span style="font-size: 1.1rem;">${icono}</span>
                <div>${mensaje}</div>
            </div>
        `;
        document.getElementById('apple-toast-premium')?.remove();
        document.body.insertAdjacentHTML('beforeend', toastHTML);

        setTimeout(() => {
            const el = document.getElementById('apple-toast-premium');
            if (el) {
                el.style.transition = "all 0.4s ease";
                el.style.opacity = "0";
                el.style.transform = "translate(-50%, -20px) scale(0.95)";
                setTimeout(() => el.remove(), 400);
            }
        }, 3500);
    },

    m_inicializar: async function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;
        visor.innerHTML = `<div class="loader-apple" style="font-family:'Roboto', sans-serif; text-align:center; padding:50px; color:#1E6B4C; font-weight:500; letter-spacing: 0.3px;">Calculando stock y existencias consolidadas desde SQLite local...</div>`;

        try {
            const [resDep, resCuadros, resGastos, resIng, resEgr] = await Promise.all([
                this.m_ejecutarSqlLocal(`SELECT * FROM depositos ORDER BY deposito ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM campos ORDER BY establecimiento ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM tipos_gastos ORDER BY nombre_gasto ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM insumos_ingresos`),
                this.m_ejecutarSqlLocal(`SELECT * FROM egresos_insumos ORDER BY fecha DESC`)
            ]);

            this.listaDepositos = resDep.data || resDep || [];
            this.parametros.cuadros = resCuadros.data || resCuadros || [];
            this.parametros.gastos = resGastos.data || resGastos || [];
            
            this.datosOriginales.ingresos = resIng.data || resIng || [];
            this.datosOriginales.egresos = resEgr.data || resEgr || [];
            
            this.filtroDeposito = 'TODO';
            this.filtroTipo = 'TODO';
            this.textoBusqueda = '';
            this.vistaActualTab = 'TODOS';

            this.m_procesarStockGlobal();
            this.m_dibujarEstructura();
        } catch (err) {
            console.error("❌ Error en Auditoría de Stock Local:", err);
            visor.innerHTML = `<div style="color:#E0342A; padding:20px; font-family:'Roboto'; font-weight: 500;">Error local al procesar el stock desde base local: ${err.message}</div>`;
        }
    },

    m_procesarStockGlobal: function() {
        const consolidado = {};

        this.datosOriginales.ingresos.forEach(i => {
            const artKey = (i.articulo || "SIN ARTICULO").trim().toUpperCase();
            if (!consolidado[artKey]) {
                consolidado[artKey] = { 
                    articulo: i.articulo, 
                    descripcion: (i.descripcion || "GENERAL").trim().toUpperCase(), 
                    tipo_insumos: (i.tipo_insumo || "GENERAL").trim().toUpperCase(),
                    entradas: 0, 
                    salidas: 0, 
                    unidad: i.unidad || 'u' 
                };
            }
            consolidado[artKey].entradas += Number(i.total || i.cant) || 0;
            if (i.descripcion && consolidado[artKey].descripcion === "GENERAL") {
                consolidado[artKey].descripcion = i.descripcion.trim().toUpperCase();
            }
        });

        this.datosOriginales.egresos.forEach(e => {
            const artKey = (e.insumo || "SIN ARTICULO").trim().toUpperCase();
            if (!consolidado[artKey]) {
                consolidado[artKey] = { 
                    articulo: e.insumo, 
                    descripcion: (e.comentario || "GENERAL").trim().toUpperCase(), 
                    tipo_insumos: (e.tipo_labor || "GENERAL").trim().toUpperCase(), 
                    entradas: 0, 
                    salidas: 0, 
                    unidad: 'u' 
                };
            }
            if ((e.estado || 'Activo').toUpperCase() === 'ACTIVO') {
                consolidado[artKey].salidas += Number(e.total_consumo) || 0;
            }
        });

        this.datosStock = Object.values(consolidado).map(s => ({
            ...s,
            stock_actual: s.entradas - s.salidas
        })).filter(x => x.entradas > 0 || x.salidas > 0).sort((a, b) => a.articulo.localeCompare(b.articulo));
    },

    m_cambiarTabVista: function(vista) {
        this.vistaActualTab = vista;
        this.m_dibujarEstructura();
    },

    m_obtenerStockFiltrado: function() {
        let datasetBase = [];

        if (this.filtroDeposito === 'TODO') {
            datasetBase = JSON.parse(JSON.stringify(this.datosStock));
        } else {
            const consolidadoPorDepo = {};
            
            this.datosOriginales.ingresos.filter(x => (x.campo_depo || '').trim().toUpperCase() === this.filtroDeposito.trim().toUpperCase()).forEach(i => {
                const artKey = i.articulo.trim().toUpperCase();
                if (!consolidadoPorDepo[artKey]) {
                    consolidadoPorDepo[artKey] = { 
                        articulo: i.articulo, 
                        descripcion: (i.descripcion || "GENERAL").trim().toUpperCase(), 
                        tipo_insumos: (i.tipo_insumo || "GENERAL").trim().toUpperCase(), 
                        entradas: 0, 
                        salidas: 0, 
                        unidad: i.unidad || 'u' 
                    };
                }
                consolidadoPorDepo[artKey].entradas += Number(i.total || i.cant) || 0;
            });

            this.datosOriginales.egresos.filter(x => (x.deposito_origen || '').trim().toUpperCase() === this.filtroDeposito.trim().toUpperCase() && (x.estado || 'Activo').toUpperCase() === 'ACTIVO').forEach(e => {
                const artKey = e.insumo.trim().toUpperCase();
                if (!consolidadoPorDepo[artKey]) {
                    consolidadoPorDepo[artKey] = { 
                        articulo: e.insumo, 
                        descripcion: (e.comentario || "GENERAL").trim().toUpperCase(), 
                        tipo_insumos: (e.tipo_labor || "GENERAL").trim().toUpperCase(), 
                        entradas: 0, 
                        salidas: 0, 
                        unidad: 'u' 
                    };
                }
                consolidadoPorDepo[artKey].salidas += Number(e.total_consumo) || 0;
            });

            datasetBase = Object.values(consolidadoPorDepo).map(s => ({
                ...s,
                stock_actual: s.entradas - s.salidas
            })).filter(x => x.entradas > 0 || x.salidas > 0);
        }

        if (this.filtroTipo !== 'TODO') {
            datasetBase = datasetBase.filter(s => s.tipo_insumos === this.filtroTipo.toUpperCase() || s.descripcion === this.filtroTipo.toUpperCase());
        }

        if (this.textoBusqueda) {
            const v = this.textoBusqueda.toLowerCase();
            datasetBase = datasetBase.filter(s => 
                s.articulo.toLowerCase().includes(v) || 
                s.descripcion.toLowerCase().includes(v) ||
                s.tipo_insumos.toLowerCase().includes(v)
            );
        }

        if (this.vistaActualTab === 'ALERTAS') {
            datasetBase = datasetBase.filter(x => x.stock_actual <= 0);
        }

        return datasetBase;
    },

    m_dibujarEstructura: function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;

        const datos = this.m_obtenerStockFiltrado();
        const totalItems = this.datosStock.length;
        const totalAlertas = this.datosStock.filter(x => x.stock_actual <= 0).length;
        const volumenEntradas = this.datosStock.reduce((acc, c) => acc + c.entradas, 0);
        const volumenExistente = this.datosStock.reduce((acc, c) => acc + Math.max(0, c.stock_actual), 0);

        const tiposInsumosUnicos = [...new Set(this.datosStock.map(s => s.tipo_insumos || s.descripcion).filter(Boolean))].sort();
        const depositosDisponibles = [...new Set(this.datosOriginales.ingresos.map(i => (i.campo_depo || '').trim().toUpperCase()).filter(Boolean))].sort();

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

                .stock-ins-layout { font-family: 'Roboto', sans-serif; color: #1D1D1F; padding: 8px 18px 25px 18px; }

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
                    background: var(--color-plant-soft); color: var(--color-plant); padding: 2px 7px;
                    border-radius: 12px; font-size: 0.68rem; font-weight: 800;
                }
                .badge-tab-alert {
                    background: rgba(224, 52, 42, 0.12); color: #E0342A; padding: 2px 7px;
                    border-radius: 12px; font-size: 0.68rem; font-weight: 800;
                }

                /* GRID Y TARJETAS KPI */
                .grid-kpi-stock {
                    display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 12px;
                }
                @media (max-width: 1100px) { .grid-kpi-stock { grid-template-columns: repeat(2, 1fr); } }
                @media (max-width: 600px) { .grid-kpi-stock { grid-template-columns: 1fr; } }

                .kpi-card-stk {
                    background: #FFFFFF; border: 1.5px solid #E0DCD4; border-radius: 12px; padding: 12px 14px;
                    display: flex; flex-direction: column; justify-content: space-between; gap: 4px;
                    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03); transition: transform 0.15s ease, box-shadow 0.15s ease;
                }
                .kpi-card-stk:hover { transform: translateY(-2px); box-shadow: 0 6px 14px rgba(0, 0, 0, 0.06); }
                .kpi-header-row { display: flex; justify-content: space-between; align-items: center; }
                .kpi-card-stk .kpi-label { font-size: 0.62rem; color: #6B6255; font-weight: 800; letter-spacing: 0.4px; text-transform: uppercase; }
                
                .kpi-icon-pill {
                    width: 26px; height: 26px; border-radius: 8px; display: flex;
                    align-items: center; justify-content: center; flex-shrink: 0;
                }
                .kpi-card-stk .kpi-value {
                    font-size: 1.25rem; font-weight: 800; color: #1D1D1F; margin: 0; line-height: 1.15; letter-spacing: -0.3px;
                }
                .kpi-subtext { font-size: 0.68rem; color: #8E8E93; font-weight: 500; margin-top: 2px; display: block; }

                .kpi-card-stk.accent-neutral { border-left: 4px solid #4B4F56; }
                .kpi-card-stk.accent-neutral .kpi-icon-pill { background: #F0F2F5; color: #4B4F56; }
                .kpi-card-stk.accent-green { border-left: 4px solid #1E6B4C; }
                .kpi-card-stk.accent-green .kpi-icon-pill { background: rgba(30, 107, 76, 0.1); color: #1E6B4C; }
                .kpi-card-stk.accent-orange { border-left: 4px solid #E08600; }
                .kpi-card-stk.accent-orange .kpi-icon-pill { background: rgba(224, 134, 0, 0.1); color: #E08600; }
                .kpi-card-stk.accent-red { border-left: 4px solid #E0342A; }
                .kpi-card-stk.accent-red .kpi-icon-pill { background: rgba(224, 52, 42, 0.1); color: #E0342A; }

                .panel-box-plant {
                    background: #FFFFFF; border: 1.5px solid #E0DCD4; border-radius: 14px; padding: 14px;
                    display: flex; flex-direction: column; gap: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.04);
                }

                /* CABECERAS FIJAS (STICKY HEADERS) */
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
                    background: #123F2C; color: #FFFFFF; font-size: 0.68rem; font-weight: 700;
                    text-transform: uppercase; padding: 10px 8px; text-align: left; letter-spacing: 0.4px;
                    position: sticky; top: 0; z-index: 10; box-shadow: 0 1px 3px rgba(0,0,0,0.12);
                }
                .tabla-cuadros-plant td { padding: 9px 8px; border-bottom: 1px solid #E0DCD4; color: #211C16; vertical-align: middle; }
                .tabla-cuadros-plant tbody tr:hover { background: #F8FAFC; }

                .btn-accion-plant {
                    background: rgba(30, 107, 76, 0.1); border: 1px solid rgba(30,107,76,0.25); color: #1E6B4C;
                    padding: 4px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 700; cursor: pointer;
                    display: inline-flex; align-items: center; gap: 4px; transition: background 0.15s;
                }
                .btn-accion-plant:hover { background: rgba(30,107,76,0.2); }
                .badge-condicion { padding: 3px 8px; border-radius: 6px; font-size: 0.68rem; font-weight: 800; text-transform: uppercase; display: inline-block; }
            </style>

            <div class="stock-ins-layout animated fadeIn">
                ${ComponentesUI.botonVolverHTML('INSUMOS')}

                <!-- HEADER SUPERIOR -->
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; margin-bottom:10px; flex-wrap:wrap; gap:10px;">
                    <div>
                        <h2 style="margin:0; font-weight: 800; font-size: 1.3rem; letter-spacing: -0.5px; color:#123F2C;">Auditoría de Stock de Insumos</h2>
                        <p style="margin:2px 0 0 0; font-size:0.75rem; color:#6B6255;">Balances de existencia en tiempo real e inventario físico por galpón (Base Local)</p>
                    </div>

                    <div style="display:flex; gap:8px; align-items:center;">
                        <button onclick="ModuloStockInsumos.m_exportarExcel()" style="background:#1FA958; color:#FFF; border:none; padding:7px 14px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:5px;">
                            <i data-lucide="file-spreadsheet" style="width:13px; height:13px;"></i> Excel
                        </button>
                        <button onclick="ModuloStockInsumos.m_exportarPDF()" style="background:#E0342A; color:#FFF; border:none; padding:7px 14px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:5px;">
                            <i data-lucide="file-text" style="width:13px; height:13px;"></i> PDF Reporte
                        </button>
                        <button onclick="window.sincronizar_todo && window.sincronizar_todo()" style="background:#0071E3; color:#FFF; border:none; padding:7px 16px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer; display:flex; align-items:center; gap:6px;" title="Sincronizar con base central">
                            <i data-lucide="refresh-cw" style="width:13px; height:13px;"></i> SINCRONIZAR ALL
                        </button>
                    </div>
                </div>

                <!-- TABS ARCHIVERO SUPERIOR -->
                <div class="tabs-header-archivero-main">
                    <div class="tab-main-archivero ${this.vistaActualTab === 'TODOS' ? 'active' : ''}" onclick="ModuloStockInsumos.m_cambiarTabVista('TODOS')">
                        <i data-lucide="boxes" style="width:14px; height:14px;"></i>
                        <span>TODO EL STOCK DISPONIBLE</span>
                        <span class="badge-tab-main">${this.datosStock.length} Artículos</span>
                    </div>
                    <div class="tab-main-archivero ${this.vistaActualTab === 'ALERTAS' ? 'active' : ''}" onclick="ModuloStockInsumos.m_cambiarTabVista('ALERTAS')">
                        <i data-lucide="alert-triangle" style="width:14px; height:14px; color:#E0342A;"></i>
                        <span>ALERTAS / QUIEBRES DE STOCK</span>
                        <span class="badge-tab-alert">${totalAlertas} Críticos</span>
                    </div>
                </div>

                <!-- KPIS PRINCIPALES -->
                <div class="grid-kpi-stock">
                    <div class="card-kpi-stk accent-neutral">
                        <div class="kpi-header-row">
                            <span class="kpi-label">VARIEDAD DE ARTÍCULOS</span>
                            <div class="kpi-icon-pill">
                                <i data-lucide="boxes" style="width:14px; height:14px;"></i>
                            </div>
                        </div>
                        <div>
                            <h3 class="kpi-value">${totalItems} <small>Insumos</small></h3>
                            <span class="kpi-subtext">Catálogo activo en depósitos</span>
                        </div>
                    </div>

                    <div class="card-kpi-stk accent-green">
                        <div class="kpi-header-row">
                            <span class="kpi-label">EXISTENCIA NETA TOTAL</span>
                            <div class="kpi-icon-pill">
                                <i data-lucide="package-check" style="width:14px; height:14px;"></i>
                            </div>
                        </div>
                        <div>
                            <h3 class="kpi-value" style="color:#1E6B4C;">${volumenExistente.toLocaleString('es-AR')} <small>Uds</small></h3>
                            <span class="kpi-subtext">Unidades listas para despacho</span>
                        </div>
                    </div>

                    <div class="card-kpi-stk accent-orange">
                        <div class="kpi-header-row">
                            <span class="kpi-label">VOLUMEN HISTÓRICO INGRESADO</span>
                            <div class="kpi-icon-pill">
                                <i data-lucide="trending-up" style="width:14px; height:14px;"></i>
                            </div>
                        </div>
                        <div>
                            <h3 class="kpi-value" style="color:#E08600;">${volumenEntradas.toLocaleString('es-AR')} <small>Uds</small></h3>
                            <span class="kpi-subtext">Cargas acumuladas en galpones</span>
                        </div>
                    </div>

                    <div class="card-kpi-stk accent-red">
                        <div class="kpi-header-row">
                            <span class="kpi-label">LÍNEAS SIN STOCK</span>
                            <div class="kpi-icon-pill">
                                <i data-lucide="alert-octagon" style="width:14px; height:14px;"></i>
                            </div>
                        </div>
                        <div>
                            <h3 class="kpi-value" style="color:#E0342A;">${totalAlertas} <small>Líneas</small></h3>
                            <span class="kpi-subtext">Requieren reposición</span>
                        </div>
                    </div>
                </div>

                <!-- BARRA DE BÚSQUEDA Y FILTROS -->
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap;">
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <input type="text" id="buscador-stock" placeholder="🔍 Buscar insumo o descripción técnica..." value="${this.textoBusqueda}" oninput="ModuloStockInsumos.m_onBusquedaInput(this.value)" style="padding:6px 12px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.78rem; outline:none; background:#FFFFFF; min-width:240px;">
                        
                        <select onchange="ModuloStockInsumos.m_onDepositoChange(this.value)" style="padding:6px 12px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.78rem; outline:none; background:#FFFFFF; font-weight:600; cursor:pointer;">
                            <option value="TODO">🏢 Todos los Depósitos</option>
                            ${depositosDisponibles.map(d => `<option value="${d}" ${this.filtroDeposito === d ? 'selected' : ''}>${d}</option>`).join('')}
                        </select>

                        <select id="filtro-tipo-insumo" onchange="ModuloStockInsumos.m_onTipoChange(this.value)" style="padding:6px 12px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.78rem; outline:none; background:#FFFFFF; font-weight:600; cursor:pointer;">
                            <option value="TODO">🏷️ Todas las Familias / Grupos</option>
                            ${tiposInsumosUnicos.map(t => `<option value="${t}" ${this.filtroTipo === t ? 'selected' : ''}>${t}</option>`).join('')}
                        </select>
                    </div>

                    ${(this.filtroDeposito !== 'TODO' || this.filtroTipo !== 'TODO' || this.textoBusqueda || this.vistaActualTab !== 'TODOS') ? `
                        <button onclick="ModuloStockInsumos.m_limpiarFiltro()" style="background:rgba(224,52,42,0.1); border:1px solid rgba(224,52,42,0.25); color:#E0342A; padding:5px 12px; border-radius:6px; font-size:0.72rem; font-weight:700; cursor:pointer;">
                            ✕ Limpiar Filtros
                        </button>
                    ` : ''}
                </div>

                <!-- TABLA EJECUTIVA CON CABECERAS FIJAS -->
                <div class="panel-box-plant">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.75rem; font-weight:800; color:#123F2C; text-transform:uppercase; letter-spacing:0.4px;">
                            📋 Inventario Físico de Insumos (${datos.length})
                        </span>
                        <span style="font-size:0.72rem; color:#6B6255; font-weight:600;">Cabeceras fijas siempre visibles</span>
                    </div>

                    <div class="wrapper-tabla-scroll-sticky scroll-apple">
                        <table class="tabla-cuadros-plant">
                            <thead>
                                <tr>
                                    <th>Artículo / Insumo Maestro</th>
                                    <th>Ubicación por Almacén / Galpón</th>
                                    <th>Familia / Grupo</th>
                                    <th style="text-align:right;">Total Entradas</th>
                                    <th style="text-align:right;">Total Consumos</th>
                                    <th style="text-align:right;">Stock Neto</th>
                                    <th style="text-align:center;">Condición</th>
                                    <th style="text-align:center; width:90px;">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${this.m_renderFilasTablaStock(datos)}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>
        `;
        if (window.lucide) lucide.createIcons();
    },

    m_renderFilasTablaStock: function(datos) {
        if (datos.length === 0) {
            return `<tr><td colspan="8" style="text-align:center; padding:35px; color:#9AA0A6; font-style:italic;">No se encontraron artículos para los filtros seleccionados.</td></tr>`;
        }

        return datos.map(s => {
            const esCritico = s.stock_actual <= 0;
            const labelCondicion = esCritico ? 'SIN EXISTENCIA' : 'DISPONIBLE';

            const unicosDepositosConStock = [];
            const historialDepositos = [...new Set(this.datosOriginales.ingresos.map(x => x.campo_depo).filter(Boolean))];
            
            historialDepositos.forEach(depoName => {
                const ent = this.datosOriginales.ingresos.filter(x => (x.articulo || '').trim().toUpperCase() === s.articulo.trim().toUpperCase() && (x.campo_depo || '').trim().toUpperCase() === depoName.trim().toUpperCase()).reduce((a,c) => a + (Number(c.total || c.cant) || 0), 0);
                const sal = this.datosOriginales.egresos.filter(x => (x.insumo || '').trim().toUpperCase() === s.articulo.trim().toUpperCase() && (x.deposito_origen || '').trim().toUpperCase() === depoName.trim().toUpperCase() && (x.estado || 'Activo').toUpperCase() === 'ACTIVO').reduce((a,c) => a + (Number(c.total_consumo) || 0), 0);
                const netoDepo = ent - sal;
                if (netoDepo > 0) {
                    unicosDepositosConStock.push({ name: depoName, stk: netoDepo });
                }
            });

            const leyendaUbicaciones = unicosDepositosConStock.map(ud => `
                <span style="font-size:0.68rem; background:#F0F2F5; border:1px solid #E0DCD4; color:#6B6255; padding:2px 6px; border-radius:4px;">
                    🏢 ${ud.name}: <b style="color:#1D1D1F;">${ud.stk.toLocaleString('es-AR')}</b>
                </span>
            `).join(' ') || `<span style="font-size:0.68rem; color:#E0342A; font-weight:600;">⚠️ Sin existencias físicas</span>`;

            return `
                <tr>
                    <td>
                        <strong style="color:#1D1D1F; font-size:0.86rem;">${s.articulo}</strong>
                    </td>
                    <td>
                        <div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">
                            ${leyendaUbicaciones}
                        </div>
                    </td>
                    <td>
                        <span style="background:#F0F2F5; color:#1D1D1F; padding:2px 7px; border-radius:4px; font-weight:600; font-size:0.72rem;">
                            ${s.tipo_insumos || s.descripcion || 'GENERAL'}
                        </span>
                    </td>
                    <td style="text-align:right; font-family:monospace; color:#6B6255;">${s.entradas.toLocaleString('es-AR')} ${s.unidad}</td>
                    <td style="text-align:right; font-family:monospace; color:#E0342A;">-${s.salidas.toLocaleString('es-AR')} ${s.unidad}</td>
                    <td style="text-align:right; font-weight:800; font-size:0.95rem; color:${esCritico ? '#E0342A' : '#1FA958'}; font-family:monospace;">
                        ${s.stock_actual.toLocaleString('es-AR')} ${s.unidad}
                    </td>
                    <td style="text-align:center;">
                        <span class="badge-condicion" style="background:${esCritico ? 'rgba(224,52,42,0.1)' : 'rgba(31,169,88,0.1)'}; color:${esCritico ? '#E0342A' : '#1FA958'};">
                            ${labelCondicion}
                        </span>
                    </td>
                    <td style="text-align:center;">
                        <button class="btn-accion-plant" onclick="ModuloStockInsumos.m_abrirAccionesInsumo('${s.articulo.replace(/'/g, "\\'")}', ${s.stock_actual}, '${s.unidad}')" title="Desglose y movimientos de stock">
                            📦 Gestionar
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    },

    m_onDepositoChange: function(depo) {
        this.filtroDeposito = depo;
        this.m_dibujarEstructura();
    },

    m_onTipoChange: function(tipoSel) {
        this.filtroTipo = tipoSel;
        this.m_dibujarEstructura();
    },

    m_onBusquedaInput: function(texto) {
        this.textoBusqueda = texto;
        this.m_dibujarEstructura();
    },

    m_limpiarFiltro: function() {
        this.filtroDeposito = 'TODO';
        this.filtroTipo = 'TODO';
        this.textoBusqueda = '';
        this.vistaActualTab = 'TODOS';
        this.m_dibujarEstructura();
    },

    m_abrirAccionesInsumo: function(articulo, stockGlobal, unidad) {
        this.m_asegurarModalBase();
        
        const modal = document.getElementById('modal-agrosoft');
        const modalContent = document.querySelector('.modal-apple-content');
        if (modalContent) modalContent.style.maxWidth = '720px';

        document.getElementById('modal-titulo').innerText = `DESGLOSE DE UBICACIÓN LOGÍSTICA`;
        
        const historialDepositosUnicos = [...new Set(this.datosOriginales.ingresos.map(x => x.campo_depo).filter(Boolean))];

        const desgloseFisico = historialDepositosUnicos.map(depoName => {
            const ent = this.datosOriginales.ingresos.filter(x => (x.articulo || '').trim().toUpperCase() === articulo.trim().toUpperCase() && (x.campo_depo || '').trim().toUpperCase() === depoName.trim().toUpperCase()).reduce((a,c) => a + (Number(c.total || c.cant) || 0), 0);
            const sal = this.datosOriginales.egresos.filter(x => (x.insumo || '').trim().toUpperCase() === articulo.trim().toUpperCase() && (x.deposito_origen || '').trim().toUpperCase() === depoName.trim().toUpperCase() && (x.estado || 'Activo').toUpperCase() === 'ACTIVO').reduce((a,c) => a + (Number(c.total_consumo) || 0), 0);
            return { deposito: depoName, subtotal: ent - sal };
        }).filter(f => f.subtotal > 0);

        const container = document.getElementById('modal-formulario');
        
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:14px; font-family:'Roboto', sans-serif;">
                <div style="background:#F8FAFC; border:1px solid #E0DCD4; padding:14px 16px; border-radius:12px; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-size:0.65rem; color:#6B6255; text-transform:uppercase; font-weight:700;">Artículo Seleccionado</div>
                        <div style="font-size:1.15rem; font-weight:800; color:#123F2C; margin-top:2px;">${articulo}</div>
                    </div>
                    <div style="text-align:right;">
                        <span style="font-size:0.65rem; color:#1FA958; font-weight:700; display:block; text-transform:uppercase;">Existencias Totales</span>
                        <strong style="font-size:1.25rem; color:#1FA958;">${stockGlobal.toLocaleString('es-AR')} <small style="font-size:0.75rem; color:#6B6255;">${unidad}</small></strong>
                    </div>
                </div>

                <div>
                    <h4 style="margin:0 0 10px 0; font-size:0.75rem; color:#6B6255; font-weight:800; text-transform:uppercase;">Disponibilidad Física por Almacén</h4>
                    <div style="display:flex; flex-direction:column; gap:8px;">
                        ${desgloseFisico.length === 0 ? `<div style="color:#E0342A; font-size:0.82rem; padding:14px; background:rgba(224,52,42,0.06); border-radius:10px; text-align:center; font-weight:600;">Sin existencias físicas en ningún depósito técnico.</div>` :
                        desgloseFisico.map(f => `
                            <div style="background:#FFFFFF; border:1px solid #E0DCD4; padding:12px 14px; border-radius:10px; display:flex; justify-content:space-between; align-items:center;">
                                <div>
                                    <span style="font-weight:700; color:#1D1D1F; font-size:0.88rem;">🏢 ${f.deposito}</span>
                                </div>
                                <div style="display:flex; align-items:center; gap:14px;">
                                    <strong style="color:#123F2C; font-size:0.95rem; font-weight:800; font-family:monospace;">${f.subtotal.toLocaleString('es-AR')} <small style="color:#6B6255;">${unidad}</small></strong>
                                    <div style="display:flex; gap:6px;">
                                        <button class="btn-accion-plant" onclick="ModuloStockInsumos.m_formTransferir('${f.deposito.replace(/'/g, "\\'")}', '${articulo.replace(/'/g, "\\'")}', ${f.subtotal}, '${unidad}')" style="background:#0071E3; color:#FFF; border:none; padding:5px 12px; border-radius:6px;">
                                            🔄 Mover
                                        </button>
                                        <button class="btn-accion-plant" onclick="ModuloStockInsumos.m_formConsumir('${f.deposito.replace(/'/g, "\\'")}', '${articulo.replace(/'/g, "\\'")}', ${f.subtotal}, '${unidad}')" style="background:#1FA958; color:#FFF; border:none; padding:5px 12px; border-radius:6px;">
                                            📤 Egresar
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
        if (modal) modal.style.display = 'flex';
    },

    m_formTransferir: function(deposito, articulo, stockActual, unidad) {
        const destinosDisponibles = [...new Set(this.datosOriginales.ingresos.map(x => x.campo_depo).filter(Boolean))].filter(d => d.trim().toUpperCase() !== deposito.trim().toUpperCase());
        
        const container = document.getElementById('modal-formulario');
        document.getElementById('modal-titulo').innerText = "TRANSFERENCIA DE STOCK ENTRE GALPONES";

        const modalContent = document.querySelector('.modal-apple-content');
        if (modalContent) modalContent.style.maxWidth = '520px';

        const matchStock = this.datosStock.find(x => x.articulo.trim().toUpperCase() === articulo.trim().toUpperCase());
        const stockGlobalActual = matchStock ? matchStock.stock_actual : stockActual;

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                <div style="background:rgba(0,113,227,0.06); padding:12px; border-radius:10px; font-size:0.82rem; color:#1D1D1F; border-left:4px solid #0071E3;">
                    <strong style="color: #0071E3;">Insumo:</strong> ${articulo}<br><strong>Origen:</strong> ${deposito}
                </div>

                <div>
                    <label style="font-size:0.65rem; color:#6B6255; text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Depósito Destino</label>
                    <select id="trans_destino" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF; outline:none;">
                        <option value="">Seleccione depósito destino...</option>
                        ${destinosDisponibles.map(d => `<option value="${d}">${d}</option>`).join('')}
                        ${this.listaDepositos.filter(x => !destinosDisponibles.includes(x.deposito) && x.deposito !== deposito).map(cat => `<option value="${cat.deposito}">${cat.deposito} (Nuevo Destino)</option>`).join('')}
                    </select>
                </div>

                <div>
                    <label style="font-size:0.65rem; color:#6B6255; text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Cantidad a Transferir (Máx: ${stockActual})</label>
                    <input type="number" id="trans_cantidad" min="1" max="${stockActual}" placeholder="0.00" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.9rem; font-weight:700; box-sizing:border-box;">
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px; border-top:1px solid #E0DCD4; padding-top:12px;">
                    <button class="btn-accion-plant" onclick="ModuloStockInsumos.m_abrirAccionesInsumo('${articulo.replace(/'/g, "\\'")}', ${stockGlobalActual}, '${unidad}')" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:8px 16px;">VOLVER</button>
                    <button id="btn_submit_operacion" class="btn-accion-plant" onclick="ModuloStockInsumos.m_ejecutarTransferencia('${deposito.replace(/'/g, "\\'")}', '${articulo.replace(/'/g, "\\'")}', ${stockActual}, '${unidad}')" style="background:#0071E3; color:#FFF; border:none; padding:8px 20px; font-weight:700;">CONFIRMAR TRASLADO</button>
                </div>
            </div>
        `;
    },

    m_ejecutarTransferencia: async function(origen, articulo, stockActual, unidad) {
        const destino = document.getElementById('trans_destino').value;
        const cantidad = parseFloat(document.getElementById('trans_cantidad').value) || 0;

        if (!destino) return window.ComponentesUI ? window.ComponentesUI.notifica("⚠️ Seleccione un depósito de destino.") : alert("⚠️ Seleccione destino.");
        if (cantidad <= 0 || cantidad > stockActual) return window.ComponentesUI ? window.ComponentesUI.notifica("⚠️ Cantidad no válida.") : alert("⚠️ Cantidad no válida.");

        const btnSubmit = document.getElementById('btn_submit_operacion');
        if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.innerText = "TRASLADANDO..."; }

        try {
            // Regla Max(reg_local)+1 para egresos_insumos
            const resMaxEgr = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(reg_local AS INTEGER)) as max_reg FROM egresos_insumos`);
            const maxValEgr = (resMaxEgr.data && resMaxEgr.data[0] && resMaxEgr.data[0].max_reg) ? Number(resMaxEgr.data[0].max_reg) : 0;
            const nuevoRegLocalEgreso = String(maxValEgr + 1);

            // Regla Max(reg_local)+1 para insumos_ingresos
            const resMaxIng = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(reg_local AS INTEGER)) as max_reg FROM insumos_ingresos`);
            const maxValIng = (resMaxIng.data && resMaxIng.data[0] && resMaxIng.data[0].max_reg) ? Number(resMaxIng.data[0].max_reg) : 0;
            const nuevoRegLocalIngreso = String(maxValIng + 1);

            const fechaActual = new Date().toISOString().split('T')[0];

            // 1. Inserción de salida
            const sqlInsertEgr = `
                INSERT INTO egresos_insumos (
                    reg_local, fecha, insumo, total_consumo, deposito_origen,
                    estado, comentario, tabla_origen, sincronizado
                ) VALUES (?, ?, ?, ?, ?, 'Activo', ?, 'CONTROL_STOCK_FRONT', 0)
            `;
            await this.m_ejecutarSqlLocal(sqlInsertEgr, [
                nuevoRegLocalEgreso, fechaActual, articulo, cantidad, origen,
                `TRASLADO INTERNO AUTOMÁTICO HACIA ${destino}`
            ]);

            // 2. Inserción de entrada
            const sqlInsertIng = `
                INSERT INTO insumos_ingresos (
                    reg_local, fecha, articulo, total, campo_depo,
                    proveedor, descripcion, sincronizado
                ) VALUES (?, ?, ?, ?, ?, 'TRANSFERENCIA INTERNA', ?, 0)
            `;
            await this.m_ejecutarSqlLocal(sqlInsertIng, [
                nuevoRegLocalIngreso, fechaActual, articulo, cantidad, destino,
                `STOCK TRASLADADO DESDE DEPÓSITO ${origen}`
            ]);

            this.m_cerrarModal();
            this.m_notificarAlerta("Transferencia registrada con éxito en Base Local.", "exito");
            await this.m_inicializar();
        } catch (e) {
            console.error("❌ Error en transferencia local:", e);
            alert("Error al transferir: " + e.message);
            if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerText = "CONFIRMAR TRASLADO"; }
        }
    },

    m_formConsumir: function(deposito, articulo, stockActual, unidad) {
        const container = document.getElementById('modal-formulario');
        document.getElementById('modal-titulo').innerText = "NUEVO DESPACHO VALORIZADO DE INSUMOS";

        const modalContent = document.querySelector('.modal-apple-content');
        if (modalContent) modalContent.style.maxWidth = '750px';

        const estDestinosUnicos = [...new Set(this.parametros.cuadros.map(c => c.establecimiento).filter(Boolean))];

        const matchStock = this.datosStock.find(x => x.articulo.trim().toUpperCase() === articulo.trim().toUpperCase());
        const stockGlobalActual = matchStock ? matchStock.stock_actual : stockActual;

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 12px 14px; border-radius: 10px; display:grid; grid-template-columns: repeat(3, 1fr); gap:10px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Origen Establecimiento</label>
                        <input type="text" id="e_est" value="LOGÍSTICA INVENTARIO" readonly style="width:100%; padding:7px; border-radius:6px; border:1px solid #E0DCD4; background:#F0F2F5; color:#6B6255; font-size:0.8rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Origen Depósito</label>
                        <input type="text" id="e_dep_origen" value="${deposito}" readonly style="width:100%; padding:7px; border-radius:6px; border:1px solid #E0DCD4; background:#F0F2F5; color:#6B6255; font-size:0.8rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Insumo Seleccionado</label>
                        <input type="text" id="e_insumo" value="${articulo}" readonly style="width:100%; padding:7px; border-radius:6px; border:1px solid #E0DCD4; background:#F0F2F5; color:#1D1D1F; font-weight:700; font-size:0.8rem; box-sizing:border-box;">
                    </div>
                </div>

                <div style="background:rgba(30,107,76,0.08); border:1px solid rgba(30,107,76,0.25); border-radius:10px; padding:10px; text-align:center;">
                    <small style="color:#1E6B4C; font-weight:700; font-size:0.62rem; text-transform:uppercase;">Stock Disponible en Almacén</small>
                    <h4 id="lbl_stk_disponible" style="margin:2px 0 0 0; font-size:1.15rem; font-weight:800; color:#123F2C;">${stockActual.toLocaleString('es-AR')} ${unidad}</h4>
                </div>

                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Establecimiento Destino</label>
                        <select id="e_est_destino" onchange="ModuloStockInsumos.m_onDestinoEstablecimientoChange(this.value)" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF;">
                            <option value="">Seleccione destino...</option>
                            ${estDestinosUnicos.map(ed => `<option value="${ed.toUpperCase()}">${ed.toUpperCase()}</option>`).join('')}
                        </select>
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Cuadro Destino (Lotes)</label>
                        <select id="e_cuadro_select" onchange="ModuloStockInsumos.m_onDestinoCuadroChange(this.value)" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF;">
                            <option value="">Esperando establecimiento...</option>
                        </select>
                        <input type="hidden" id="e_campo" value="">
                        <input type="hidden" id="e_cuadro_txt" value="">
                    </div>

                    <div style="grid-column: 1 / -1;">
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Labor Destino / Aplicación</label>
                        <input type="text" id="e_labor" placeholder="Ej: Pulverización Lote 1" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                </div>

                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:repeat(3, 1fr); gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Fecha Despacho</label>
                        <input type="date" id="e_fecha" value="${new Date().toISOString().split('T')[0]}" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Sup. Cobertura (Ha)</label>
                        <input type="number" step="0.01" id="e_sup_input" oninput="ModuloStockInsumos.m_recalcular()" value="0" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#E0342A; font-weight:700; text-transform:uppercase;">Cantidad a Despachar</label>
                        <input type="number" step="0.01" id="e_cant_input" oninput="ModuloStockInsumos.m_recalcular()" value="0" style="width:100%; padding:8px 10px; border-radius:8px; border:2px solid #E0342A; font-size:0.9rem; font-weight:bold; box-sizing:border-box;">
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Precio Unit. (U$S)</label>
                        <input type="number" id="e_imp_u" step="0.001" oninput="ModuloStockInsumos.m_recalcular()" value="0" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Cotización Dólar ($)</label>
                        <input type="number" id="e_coti" oninput="ModuloStockInsumos.m_recalcular()" value="1200" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div style="background:rgba(0,113,227,0.06); padding:8px 10px; border-radius:8px; border: 1px solid rgba(0,113,227,0.18);">
                        <label style="color:#0071E3; font-weight:700; font-size:0.6rem;">COSTO / HA (U$S)</label>
                        <input type="number" id="e_c_ha_u" readonly value="0" style="font-weight:800; background:transparent; border:none; color:#0071E3; font-size: 1rem; outline:none;">
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Total Dólar (U$S)</label>
                        <input type="number" id="e_t_dolar" readonly value="0" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#F0F2F5; color:#6B6255; font-weight:700; box-sizing:border-box;">
                    </div>
                    <div style="grid-column: span 2;">
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Total Pesos ($)</label>
                        <input type="number" id="e_t_pesos" readonly value="0" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#F0F2F5; color:#1E6B4C; font-weight:800; box-sizing:border-box;">
                    </div>

                    <div style="grid-column: 1 / -1;">
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Centro de Costo Imputable</label>
                        <div style="display:flex; gap:6px;">
                            <select id="e_centro" style="flex:1; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF;">
                                <option value="">Seleccione Centro de Costo...</option>
                                ${this.parametros.gastos.map(g => `<option value="${g.nombre_gasto}">${g.nombre_gasto}</option>`).join('')}
                            </select>
                            <button type="button" class="btn-accion-plant" onclick="ModuloStockInsumos.m_nuevoCentroCosto()" style="background:#1E6B4C; color:white; border:none; width:34px; height:34px; border-radius:8px; font-weight:700; font-size:1.1rem;">+</button>
                        </div>
                    </div>
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid #E0DCD4; padding-top:12px; margin-top:4px;">
                    <button type="button" class="btn-accion-plant" onclick="ModuloStockInsumos.m_abrirAccionesInsumo('${articulo.replace(/'/g, "\\'")}', ${stockGlobalActual}, '${unidad}')" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:8px 16px;">VOLVER</button>
                    <button type="button" class="btn-accion-plant" id="btn-guardar-egreso-local" style="background:#1E6B4C; color:#FFF; border:none; padding:8px 22px; font-weight:700; box-shadow:0 4px 12px rgba(30,107,76,0.25);">CONFIRMAR DESPACHO</button>
                </div>
            </div>`;

        document.getElementById('btn-guardar-egreso-local').onclick = () => this.m_ejecutarConsumo(deposito, articulo, stockActual);
    },

    m_onDestinoEstablecimientoChange: function(estSel) {
        const selectCuadro = document.getElementById('e_cuadro_select');
        if (!selectCuadro) return;
        if (!estSel) { selectCuadro.innerHTML = '<option value="">Esperando establecimiento destino...</option>'; return; }
        const cuadrosFiltrados = this.parametros.cuadros.filter(c => (c.establecimiento || '').trim().toUpperCase() === estSel.trim().toUpperCase());
        selectCuadro.innerHTML = '<option value="">Seleccione Lote / Cuadro...</option>' + cuadrosFiltrados.map(c => `<option value="${c.reg_local || c.id}">${c.campo || 'SIN LOTE'} — ${c.lote || 'S/D'} (${c.sup_total || 0} Ha)</option>`).join('');
    },

    m_onDestinoCuadroChange: function(regLocalCuadro) {
        if (!regLocalCuadro) return;
        const matchCuadro = this.parametros.cuadros.find(c => String(c.reg_local || c.id) === String(regLocalCuadro));
        if (matchCuadro) {
            document.getElementById('e_sup_input').value = parseFloat(matchCuadro.sup_total || 0);
            document.getElementById('e_campo').value = matchCuadro.campo || '';
            document.getElementById('e_cuadro_txt').value = matchCuadro.lote || '';
            this.m_recalcular();
        }
    },

    m_nuevoCentroCosto: function() {
        const container = document.getElementById('modal-formulario');
        if (!container) return;
        const formOriginal = container.innerHTML;

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                <div style="background:rgba(30,107,76,0.08); border-left:4px solid #1E6B4C; padding:10px 14px; border-radius:8px;">
                    <strong style="color:#123F2C; font-size:0.85rem;">NUEVA CATEGORÍA DE GASTO</strong>
                    <p style="font-size:0.72rem; margin:2px 0 0 0; color:#6B6255;">Agregue un concepto maestro en tipos_gastos para imputar egresos.</p>
                </div>

                <div>
                    <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Nombre del Concepto</label>
                    <input type="text" id="input_nuevo_centro" placeholder="Ej: HERBICIDAS LOTE COMPUESTO" style="text-transform:uppercase; width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px; border-top:1px solid #E0DCD4; padding-top:12px;">
                    <button type="button" id="btn-cancelar-centro" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:8px 16px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer;">VOLVER</button>
                    <button type="button" id="btn-confirmar-centro" style="background:#1E6B4C; color:white; border:none; padding:8px 18px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer; box-shadow:0 4px 12px rgba(30,107,76,0.25);">REGISTRAR</button>
                </div>
            </div>`;
        
        document.getElementById('input_nuevo_centro')?.focus();

        document.getElementById('btn-cancelar-centro').onclick = () => { container.innerHTML = formOriginal; };
        document.getElementById('btn-confirmar-centro').onclick = async () => {
            const nombre = document.getElementById('input_nuevo_centro').value.trim().toUpperCase();
            if (!nombre) return alert("Descripción requerida.");
            
            try {
                await this.m_ejecutarSqlLocal(`INSERT INTO tipos_gastos (nombre_gasto, sincronizado) VALUES (?, 0)`, [nombre]);
                ModuloStockInsumos.parametros.gastos.push({ nombre_gasto: nombre });
                
                container.innerHTML = formOriginal;
                const selectCentro = document.getElementById('e_centro');
                if (selectCentro) { selectCentro.add(new Option(nombre, nombre, true, true)); }
            } catch (err) {
                alert("Error al insertar centro de costo local: " + err.message);
            }
        };
    },

    m_recalcular: function() {
        const sup = parseFloat(document.getElementById('e_sup_input').value) || 0;
        const cant = parseFloat(document.getElementById('e_cant_input').value) || 0;
        const precioU = parseFloat(document.getElementById('e_imp_u').value) || 0;
        const coti = parseFloat(document.getElementById('e_coti').value) || 0;
        const totalDolar = cant * precioU;
        document.getElementById('e_t_dolar').value = totalDolar.toFixed(2);
        document.getElementById('e_t_pesos').value = (totalDolar * coti).toFixed(2);
        document.getElementById('e_c_ha_u').value = sup > 0 ? (totalDolar / sup).toFixed(2) : (0).toFixed(2);
    },

    m_ejecutarConsumo: async function(deposito, articulo, stockActual) {
        const cantidad = parseFloat(document.getElementById('e_cant_input').value) || 0;
        const estDestino = document.getElementById('e_est_destino').value;
        if (!estDestino) return window.ComponentesUI ? window.ComponentesUI.notifica("⚠️ Seleccione Establecimiento destino.") : alert("⚠️ Seleccione Establecimiento destino.");
        if (cantidad <= 0 || cantidad > stockActual) return window.ComponentesUI ? window.ComponentesUI.notifica("⚠️ Cantidad excedida o inválida.") : alert("⚠️ Cantidad excedida.");
        
        const btnSave = document.getElementById('btn-guardar-egreso-local');
        if (btnSave) { btnSave.disabled = true; btnSave.innerText = "DESPACHANDO..."; }

        try {
            const resMax = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(reg_local AS INTEGER)) as max_reg FROM egresos_insumos`);
            const maxVal = (resMax.data && resMax.data[0] && resMax.data[0].max_reg) ? Number(resMax.data[0].max_reg) : 0;
            const nuevoRegLocal = String(maxVal + 1);

            const supUso = parseFloat(document.getElementById('e_sup_input').value) || 0;
            const impUni = parseFloat(document.getElementById('e_imp_u').value) || 0;
            const coti = parseFloat(document.getElementById('e_coti').value) || 0;
            const tDolar = parseFloat(document.getElementById('e_t_dolar').value) || 0;
            const tPesos = parseFloat(document.getElementById('e_t_pesos').value) || 0;

            const sqlInsert = `
                INSERT INTO egresos_insumos (
                    reg_local, fecha, insumo, deposito_origen, establecimiento,
                    campo, cuadro, labor, sup_uso, total_consumo, dosis_ha,
                    imp_uni, cotizacion, total_dolar, total_pesos, centro_costo,
                    estado, tabla_origen, tipo_labor, sincronizado
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Activo', 'CONTROL_STOCK_FRONT', 'EGRESO DE STOCK', 0)
            `;

            const paramsInsert = [
                nuevoRegLocal,
                document.getElementById('e_fecha').value,
                articulo,
                deposito,
                estDestino,
                document.getElementById('e_campo').value || null,
                document.getElementById('e_cuadro_txt').value || null,
                document.getElementById('e_labor').value || null,
                supUso,
                cantidad,
                supUso > 0 ? (cantidad / supUso) : 0,
                impUni,
                coti,
                tDolar,
                tPesos,
                document.getElementById('e_centro').value || null
            ];

            await this.m_ejecutarSqlLocal(sqlInsert, paramsInsert);

            this.m_cerrarModal();
            this.m_notificarAlerta("Despacho registrado con éxito en Base Local.", "exito");
            await this.m_inicializar();
        } catch (e) {
            console.error("❌ Error al egresar consumo local:", e);
            alert("Error al egresar localmente: " + e.message);
            if (btnSave) { btnSave.disabled = false; btnSave.innerText = "CONFIRMAR DESPACHO"; }
        }
    },

    m_exportarExcel: function() {
        if (!this.datosStock || this.datosStock.length === 0) return alert("No existen registros.");
        const headers = ["ARTICULO", "GRUPO / FAMILIA", "TOTAL ENTRADAS", "TOTAL CONSUMOS", "STOCK NETO", "UNIDAD"];
        let csvContent = "\uFEFF" + headers.join(";") + "\n";

        this.datosStock.forEach(s => {
            csvContent += [`"${s.articulo}"`, `"${s.tipo_insumos || s.descripcion}"`, s.entradas, s.salidas, s.stock_actual, `"${s.unidad}"`].join(";") + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.setAttribute("download", `Salvucci_Stock_Insumos_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    m_exportarPDF: function() {
        if (!this.datosStock || this.datosStock.length === 0) return alert("No hay datos para exportar.");
        
        const totalEntradas = this.datosStock.reduce((a, c) => a + c.entradas, 0);
        const totalSalidas = this.datosStock.reduce((a, c) => a + c.salidas, 0);
        const totalNeto = this.datosStock.reduce((a, c) => a + Math.max(0, c.stock_actual), 0);

        const ventanaPDF = window.open('', '_blank');
        ventanaPDF.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Reporte de Stock - Salvucci Gestión</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap');
                    body { font-family: 'Roboto', sans-serif; color: #211C16; padding: 35px; margin: 0; background: #F5F4F1; }
                    .header-pdf-premium { border-bottom: 3px solid #1E6B4C; padding-bottom: 14px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; background:#FFFFFF; padding:18px; border-radius:12px; border:1px solid #E0DCD4; }
                    .logo-container-apple { width: 70px; height: 70px; display: flex; align-items: center; justify-content: center; margin-right: 15px; }
                    .logo-container-apple img { width: 100%; height: 100%; object-fit: contain; }
                    .titulos-reporte h1 { margin: 0; font-size: 18px; font-weight: 900; color: #123F2C; }
                    .titulos-reporte h2 { margin: 3px 0 0 0; font-size: 11px; color: #1E6B4C; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
                    .kpi-tile-top { background:rgba(30,107,76,0.08); border:1px solid rgba(30,107,76,0.25); padding:8px 14px; border-radius:8px; text-align:right; }
                    table { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 8px; background:#FFFFFF; border-radius:8px; overflow:hidden; }
                    th { background: #123F2C; color: #FFFFFF; text-align: left; padding: 8px; font-weight: 700; text-transform: uppercase; }
                    td { padding: 7px 8px; border-bottom: 1px solid #E0DCD4; color: #211C16; }
                    .badge-condicion { padding: 2px 6px; border-radius: 4px; font-size: 8px; font-weight: bold; text-transform: uppercase; }
                </style>
            </head>
            <body>
                <div class="header-pdf-premium">
                    <div style="display:flex; align-items:center;">
                        <div class="logo-container-apple">
                            <img src="logo.png" onerror="this.style.display='none';" />
                        </div>
                        <div class="titulos-reporte">
                            <h2>SALVUCCI GESTIÓN · AUDITORÍA DE INSUMOS</h2>
                            <h1>BALANCE GENERAL DE EXISTENCIAS</h1>
                        </div>
                    </div>
                    <div class="kpi-tile-top">
                        <div style="font-size:9px; color:#6B6255; font-weight:700; text-transform:uppercase;">Stock Físico Neto</div>
                        <div style="font-size:16px; font-weight:900; color:#1E6B4C;">${totalNeto.toLocaleString('es-AR')} UDS</div>
                        <small style="font-size:9px; color:#6B6255;">Entradas: ${totalEntradas.toLocaleString('es-AR')} | Salidas: ${totalSalidas.toLocaleString('es-AR')}</small>
                    </div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>ARTÍCULO / CONCEPTO MAESTRO</th>
                            <th>GRUPO / FAMILIA</th>
                            <th style="text-align:right;">TOTAL ENTRADAS</th>
                            <th style="text-align:right;">TOTAL CONSUMOS</th>
                            <th style="text-align:right;">STOCK NETO</th>
                            <th style="text-align:center;">CONDICIÓN</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.datosStock.map(s => {
                            const crit = s.stock_actual <= 0;
                            return `
                                <tr>
                                    <td><b>${s.articulo}</b></td>
                                    <td>${s.tipo_insumos || s.descripcion || 'GENERAL'}</td>
                                    <td style="text-align:right;">${s.entradas.toLocaleString('es-AR')} ${s.unidad}</td>
                                    <td style="text-align:right; color:#E0342A;">-${s.salidas.toLocaleString('es-AR')} ${s.unidad}</td>
                                    <td style="text-align:right; font-weight:bold; color:${crit ? '#E0342A' : '#1E6B4C'};">${s.stock_actual.toLocaleString('es-AR')} ${s.unidad}</td>
                                    <td style="text-align:center;"><span class="badge-condicion" style="background:${crit ? '#FCE8E6' : '#E4F9EC'}; color:${crit ? '#A8071A' : '#14804A'};">${crit ? 'SIN STOCK' : 'DISPONIBLE'}</span></td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>

                <script>
                    window.onload = function() { setTimeout(() => { window.print(); window.close(); }, 300); }
                </script>
            </body>
            </html>
        `);
        ventanaPDF.document.close();
    }
};

window.ModuloStockInsumos = ModuloStockInsumos;