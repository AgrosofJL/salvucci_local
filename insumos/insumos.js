/**
 * ModuloInsumos: Ingreso, Control de Depósitos y Catálogo Maestro de Insumos
 * AgroSoft J&L - "Apple Soft Studio" Edition / Tipografía Roboto
 * Mode: Local-First (Engine SQLite IPC) + "No me quites nada" + Max(registro)+1 + sincronizado = 0
 */
const ModuloInsumos = {
    datosIngresos: [],
    parametrosInsumos: [],      // Maestro de la tabla 'insumos'
    listaDepositos: [],
    listaProveedores: [],        // Maestro de la tabla 'proveedores'
    filtroActual: 'TODO',        // Depósito seleccionado
    filtroDescripcionActual: 'TODO', // Familia / Tipo seleccionado
    filtroBusquedaTxt: '',
    vistaActualInsumos: 'INGRESOS', // 'INGRESOS' | 'CATALOGO'

    // Helper IPC para ejecutar consultas SQL en la base SQLite local
    m_ejecutarSqlLocal: async function(sql, params = []) {
        if (window.apiLocal && window.apiLocal.query) {
            return await window.apiLocal.query({ sql, params });
        }
        if (window.electronAPI && window.electronAPI.invoke) {
            return await window.electronAPI.invoke('local-db-query', { sql, params });
        }
        throw new Error("No se encontró la conexión con el proceso principal de base local.");
    },

    // Helper para calcular Max(registro)+1
    m_obtenerMaxRegLocal: async function(tabla) {
        try {
            const res = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(reg_local AS INTEGER)) as max_reg FROM ${tabla}`);
            if (res.data && res.data[0] && res.data[0].max_reg !== null && res.data[0].max_reg !== undefined) {
                return parseInt(res.data[0].max_reg, 10) || 0;
            }
        } catch (e) {
            console.warn("No se pudo calcular Max local en la tabla " + tabla + ":", e);
        }
        return 0;
    },

    // Integración con sincronización global
    sincronizar: async function() {
        if (typeof window.sincronizarTodo === 'function') {
            await window.sincronizarTodo();
            this.m_notificarAlerta("Sincronización global completada con éxito.", 'exito');
        }
        await this.m_inicializar();
    },

    _m_obtenerColorDepo: function(depoName) {
        const name = (depoName || "SIN ASIGNAR").trim().toUpperCase();
        const paleta = [
            { bg: 'rgba(224, 134, 0, 0.05)',  border: 'rgba(224, 134, 0, 0.25)',  txt: '#E08600', badgeBg: 'rgba(224, 134, 0, 0.12)' },  
            { bg: 'rgba(0, 113, 227, 0.05)',  border: 'rgba(0, 113, 227, 0.25)',  txt: '#0071E3', badgeBg: 'rgba(0, 113, 227, 0.12)' },  
            { bg: 'rgba(31, 169, 88, 0.05)',  border: 'rgba(31, 169, 88, 0.25)',  txt: '#1FA958', badgeBg: 'rgba(31, 169, 88, 0.12)' }, 
            { bg: 'rgba(139, 79, 217, 0.05)', border: 'rgba(139, 79, 217, 0.25)', txt: '#8B4FD9', badgeBg: 'rgba(139, 79, 217, 0.12)' },  
            { bg: 'rgba(0, 163, 180, 0.05)',  border: 'rgba(0, 163, 180, 0.25)',  txt: '#00A3B4', badgeBg: 'rgba(0, 163, 180, 0.12)' },  
            { bg: 'rgba(224, 52, 42, 0.05)',   border: 'rgba(224, 52, 42, 0.25)',   txt: '#E0342A', badgeBg: 'rgba(224, 52, 42, 0.12)' }    
        ];

        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }
        const index = Math.abs(hash) % paleta.length;
        return paleta[index];
    },

    m_asegurarModalBase: function() {
        let modal = document.getElementById('modal-agrosoft');
        if (!modal) {
            const modalHTML = `
                <div id="modal-agrosoft" class="modal-overlay" style="display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(18, 22, 28, 0.48); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); z-index: 99999; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box;">
                    <div class="modal-apple-content" style="background: #FFFFFF; border: 1.5px solid #E0DCD4; border-radius: 14px; padding: 24px; width: 95%; max-width: 820px; max-height: 90vh; color: #1D1D1F; box-shadow: 0 10px 25px rgba(0,0,0,0.15); display: flex; flex-direction: column; position: relative;">
                        <div class="modal-header-apple" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid #E0DCD4; padding-bottom: 12px; flex-shrink: 0;">
                            <h3 id="modal-titulo" style="margin: 0; font-size: 1.15rem; font-weight: 800; font-family: 'Roboto', sans-serif; color: #123F2C; letter-spacing: -0.3px;">GESTIÓN TÉCNICA DE INSUMOS</h3>
                            <button onclick="ModuloInsumos.m_cerrarModal()" style="background: none; border: none; color: #6E6E73; font-size: 1.5rem; font-weight:bold; cursor: pointer;">&times;</button>
                        </div>
                        <div id="modal-formulario" style="max-height: 72vh; overflow-y: auto; padding-right: 4px;"></div>
                    </div>
                </div>`;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
        }
    },

    m_notificarAlerta: function(mensaje, tipo = 'alerta') {
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

    m_cerrarModal: function() {
        const modal = document.getElementById('modal-agrosoft');
        if (modal) modal.style.display = 'none';
    },

    m_inicializar: async function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;
        visor.innerHTML = `<div class="loader-apple" style="font-family: 'Roboto', sans-serif; text-align: center; padding: 40px; color: #1E6B4C; font-weight: 500; letter-spacing: 0.3px;">Cargando depósitos y catálogo de insumos desde base Local...</div>`;

        try {
            const [resIng, resDep, resProv, resInsMaestro] = await Promise.all([
                this.m_ejecutarSqlLocal(`SELECT * FROM insumos_ingresos ORDER BY fecha DESC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM depositos ORDER BY deposito ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM proveedores ORDER BY proveedor ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM insumos ORDER BY articulo ASC`)
            ]);

            this.datosIngresos = resIng.data || resIng || [];
            this.listaDepositos = resDep.data || resDep || [];
            this.listaProveedores = resProv.data || resProv || [];
            this.parametrosInsumos = resInsMaestro.data || resInsMaestro || [];

            this.m_dibujarEstructura();
        } catch (err) {
            console.error("❌ Error en Inicialización Local de Insumos:", err);
            visor.innerHTML = `<div style="color: #E0342A; padding: 20px; font-family: 'Roboto', sans-serif; font-weight: 500;">Error al cargar datos locales: ${err.message}</div>`;
        }
    },

    m_cambiarTabVista: function(vista) {
        this.vistaActualInsumos = vista;
        this.m_dibujarEstructura();
    },

    m_dibujarEstructura: function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;

        const datos = this.m_obtenerIngresosFiltrados();
        const totalImportePesos = datos.reduce((acc, curr) => acc + (Number(curr.importe_total) || 0), 0);
        const totalUnidades = datos.reduce((acc, curr) => acc + (Number(curr.total || curr.cant) || 0), 0);
        const totalDepositosCount = new Set(this.datosIngresos.map(i => i.campo_depo).filter(Boolean)).size;
        const totalArticulosCatalogo = this.parametrosInsumos.length;

        const depositosUnicos = [...new Set(this.datosIngresos.map(i => (i.campo_depo || "SIN ASIGNAR").toUpperCase()).filter(Boolean))].sort();

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

                .insumos-layout { font-family: 'Roboto', sans-serif; color: #1D1D1F; padding: 8px 18px 25px 18px; }

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

                .grid-kpi-insumos {
                    display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 12px;
                }
                @media (max-width: 1100px) { .grid-kpi-insumos { grid-template-columns: repeat(2, 1fr); } }
                @media (max-width: 600px) { .grid-kpi-insumos { grid-template-columns: 1fr; } }

                .kpi-card-ins {
                    background: #FFFFFF; border: 1.5px solid #E0DCD4; border-radius: 12px; padding: 12px 14px;
                    display: flex; flex-direction: column; justify-content: space-between; gap: 4px;
                    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03); transition: transform 0.15s ease, box-shadow 0.15s ease;
                }
                .kpi-card-ins:hover { transform: translateY(-2px); box-shadow: 0 6px 14px rgba(0, 0, 0, 0.06); }
                .kpi-header-row { display: flex; justify-content: space-between; align-items: center; }
                .kpi-card-ins .kpi-label { font-size: 0.62rem; color: #6B6255; font-weight: 800; letter-spacing: 0.4px; text-transform: uppercase; }
                
                .kpi-icon-pill {
                    width: 26px; height: 26px; border-radius: 8px; display: flex;
                    align-items: center; justify-content: center; flex-shrink: 0;
                }
                .kpi-card-ins .kpi-value {
                    font-size: 1.25rem; font-weight: 800; color: #1D1D1F; margin: 0; line-height: 1.15; letter-spacing: -0.3px;
                }
                .kpi-subtext { font-size: 0.68rem; color: #8E8E93; font-weight: 500; margin-top: 2px; display: block; }

                .kpi-card-ins.accent-neutral { border-left: 4px solid #4B4F56; }
                .kpi-card-ins.accent-neutral .kpi-icon-pill { background: #F0F2F5; color: #4B4F56; }
                .kpi-card-ins.accent-blue { border-left: 4px solid #0071E3; }
                .kpi-card-ins.accent-blue .kpi-icon-pill { background: rgba(0, 113, 227, 0.08); color: #0071E3; }
                .kpi-card-ins.accent-orange { border-left: 4px solid #E08600; }
                .kpi-card-ins.accent-orange .kpi-icon-pill { background: rgba(224, 134, 0, 0.1); color: #E08600; }
                .kpi-card-ins.accent-green { border-left: 4px solid #1E6B4C; }
                .kpi-card-ins.accent-green .kpi-icon-pill { background: rgba(30, 107, 76, 0.1); color: #1E6B4C; }

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
                .tabla-cuadros-plant th.th-catalogo { background: #4B4F56; }
                .tabla-cuadros-plant td { padding: 9px 8px; border-bottom: 1px solid #E0DCD4; color: #211C16; vertical-align: middle; }
                .tabla-cuadros-plant tbody tr:hover { background: #F8FAFC; }

                .btn-accion-plant {
                    background: rgba(30, 107, 76, 0.1); border: 1px solid rgba(30,107,76,0.25); color: #1E6B4C;
                    padding: 4px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 700; cursor: pointer;
                    display: inline-flex; align-items: center; gap: 4px; transition: background 0.15s;
                }
                .btn-accion-plant:hover { background: rgba(30,107,76,0.2); }
                .btn-delete-plant { background: rgba(224,52,42,0.1); border-color: rgba(224,52,42,0.25); color: #E0342A; }
                .btn-delete-plant:hover { background: rgba(224,52,42,0.2); }
            </style>

            <div class="insumos-layout animated fadeIn">
                ${ComponentesUI.botonVolverHTML('INSUMOS')}

                <!-- HEADER SUPERIOR -->
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; margin-bottom:10px; flex-wrap:wrap; gap:10px;">
                    <div>
                        <h2 style="margin:0; font-weight: 800; font-size: 1.3rem; letter-spacing: -0.5px; color:#123F2C;">Control y Stock de Insumos</h2>
                        <p style="margin:2px 0 0 0; font-size:0.75rem; color:#6B6255;">Gestión de existencias en galpones, remitos y catálogo maestro (base Local)</p>
                    </div>

                    <div style="display:flex; gap:8px; align-items:center;">
                        <button onclick="ModuloInsumos.m_exportarExcel()" style="background:#1FA958; color:#FFF; border:none; padding:7px 14px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:5px;">
                            <i data-lucide="file-spreadsheet" style="width:13px; height:13px;"></i> Excel
                        </button>
                        <button onclick="ModuloInsumos.m_exportarPDF()" style="background:#E0342A; color:#FFF; border:none; padding:7px 14px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:5px;">
                            <i data-lucide="file-text" style="width:13px; height:13px;"></i> PDF Reporte
                        </button>
                        <button onclick="ModuloInsumos.m_abrirModalIngreso()" style="background:#1E6B4C; color:#FFF; border:none; padding:7px 16px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer; display:flex; align-items:center; gap:6px;">
                            <i data-lucide="plus-circle" style="width:13px; height:13px;"></i> NUEVO INGRESO
                        </button>
                    </div>
                </div>

                <!-- TABS ARCHIVERO SUPERIOR -->
                <div class="tabs-header-archivero-main">
                    <div class="tab-main-archivero ${this.vistaActualInsumos === 'INGRESOS' ? 'active' : ''}" onclick="ModuloInsumos.m_cambiarTabVista('INGRESOS')">
                        <i data-lucide="package" style="width:14px; height:14px;"></i>
                        <span>INGRESOS Y STOCK EN DEPÓSITOS</span>
                        <span class="badge-tab-main">${datos.length} Movs</span>
                    </div>
                    <div class="tab-main-archivero ${this.vistaActualInsumos === 'CATALOGO' ? 'active' : ''}" onclick="ModuloInsumos.m_cambiarTabVista('CATALOGO')">
                        <i data-lucide="layers" style="width:14px; height:14px;"></i>
                        <span>CATÁLOGO MAESTRO DE ARTÍCULOS</span>
                        <span class="badge-tab-main" style="background:#E9EBEF; color:#4B4F56;">${totalArticulosCatalogo} Ítems</span>
                    </div>
                </div>

                <!-- KPIS PRINCIPALES -->
                <div class="grid-kpi-insumos">
                    <div class="card-kpi-ins accent-neutral">
                        <div class="kpi-header-row">
                            <span class="kpi-label">INGRESOS ASENTADOS</span>
                            <div class="kpi-icon-pill">
                                <i data-lucide="inbox" style="width:14px; height:14px;"></i>
                            </div>
                        </div>
                        <div>
                            <h3 class="kpi-value">${datos.length} <small>Registros</small></h3>
                            <span class="kpi-subtext">Movimientos de entrada</span>
                        </div>
                    </div>

                    <div class="card-kpi-ins accent-green">
                        <div class="kpi-header-row">
                            <span class="kpi-label">TOTAL FACTURADO ($)</span>
                            <div class="kpi-icon-pill">
                                <i data-lucide="banknote" style="width:14px; height:14px;"></i>
                            </div>
                        </div>
                        <div>
                            <h3 class="kpi-value" style="color:#1E6B4C;">$ ${totalImportePesos.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}</h3>
                            <span class="kpi-subtext">Valorización bruta consolidada</span>
                        </div>
                    </div>

                    <div class="card-kpi-ins accent-orange">
                        <div class="kpi-header-row">
                            <span class="kpi-label">DEPÓSITOS REGISTRADOS</span>
                            <div class="kpi-icon-pill">
                                <i data-lucide="warehouse" style="width:14px; height:14px;"></i>
                            </div>
                        </div>
                        <div>
                            <h3 class="kpi-value" style="color:#E08600;">${totalDepositosCount} <small>Puntos</small></h3>
                            <span class="kpi-subtext">${totalUnidades.toLocaleString('es-AR')} unidades en stock</span>
                        </div>
                    </div>

                    <div class="card-kpi-ins accent-blue">
                        <div class="kpi-header-row">
                            <span class="kpi-label">CATÁLOGO DE ARTÍCULOS</span>
                            <div class="kpi-icon-pill">
                                <i data-lucide="tag" style="width:14px; height:14px;"></i>
                            </div>
                        </div>
                        <div>
                            <h3 class="kpi-value" style="color:#0071E3;">${totalArticulosCatalogo} <small>Artículos</small></h3>
                            <span class="kpi-subtext">Fórmulas e insumos base</span>
                        </div>
                    </div>
                </div>

                <!-- BARRA DE FILTROS RÁPIDOS -->
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap;">
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <input type="text" id="buscador-insumos" placeholder="🔍 Buscar artículo, remito, proveedor..." value="${this.filtroBusquedaTxt}" oninput="ModuloInsumos.m_filtrarBusqueda(this.value)" style="padding:6px 12px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.78rem; outline:none; background:#FFFFFF; min-width:200px;">
                        
                        <select onchange="ModuloInsumos.m_filtrarPorGrupo(this.value)" style="padding:6px 12px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.78rem; outline:none; background:#FFFFFF; font-weight:600; cursor:pointer;">
                            <option value="TODO">🏢 Todos los Depósitos</option>
                            ${depositosUnicos.map(d => `<option value="${d}" ${this.filtroActual === d ? 'selected' : ''}>${d}</option>`).join('')}
                        </select>

                        <select id="select-filtro-tipo" onchange="ModuloInsumos.m_cambiarFiltroDescripcion(this.value)" style="padding:6px 12px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.78rem; outline:none; background:#FFFFFF; font-weight:600; cursor:pointer;">
                            ${this.m_renderPillsTipo()}
                        </select>
                    </div>

                    ${(this.filtroActual !== 'TODO' || this.filtroDescripcionActual !== 'TODO' || this.filtroBusquedaTxt) ? `
                        <button onclick="ModuloInsumos.m_limpiarFiltro()" style="background:rgba(224,52,42,0.1); border:1px solid rgba(224,52,42,0.25); color:#E0342A; padding:5px 12px; border-radius:6px; font-size:0.72rem; font-weight:700; cursor:pointer;">
                            ✕ Limpiar Filtros
                        </button>
                    ` : ''}
                </div>

                <!-- CONTENEDOR DE TABLAS EJECUTIVAS -->
                <div class="panel-box-plant">
                    ${this.vistaActualInsumos === 'INGRESOS' ? this.m_renderMegaTabla(datos) : this.m_renderCatalogoMaestro()}
                </div>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
    },

    m_renderMegaTabla: function(datos) {
        if (datos.length === 0) {
            return `
                <div style="text-align:center; padding:40px; color:#9AA0A6; font-family:'Roboto';">
                    <p style="margin:0; font-size:0.85rem; font-style:italic;">No se encontraron registros de ingreso para los filtros seleccionados.</p>
                </div>
            `;
        }

        return `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:0.75rem; font-weight:800; color:#123F2C; text-transform:uppercase; letter-spacing:0.4px;">
                    📦 Listado de Ingresos a Galpón (${datos.length})
                </span>
                <span style="font-size:0.72rem; color:#6B6255; font-weight:600;">Cabeceras fijas siempre visibles</span>
            </div>

            <div class="wrapper-tabla-scroll-sticky scroll-apple">
                <table class="tabla-cuadros-plant">
                    <thead>
                        <tr>
                            <th style="width: 85px;">Fecha</th>
                            <th style="width: 100px;">Remito</th>
                            <th>Depósito Destino</th>
                            <th>Artículo / Insumo</th>
                            <th>Familia</th>
                            <th>Proveedor</th>
                            <th style="text-align: right; width: 110px;">Cantidad</th>
                            <th style="text-align: right; width: 100px;">Unitario U$S</th>
                            <th style="text-align: right; width: 110px;">Total ($)</th>
                            <th style="text-align: center; width: 75px;">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${datos.map(i => {
                            const colorDep = this._m_obtenerColorDepo(i.campo_depo);
                            const esSincronizado = Number(i.sincronizado) === 1;
                            const badgeNube = esSincronizado 
                                ? `<span title="Sincronizado con el servidor" style="display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; background:rgba(31,169,88,0.12); border-radius:50%; color:#1FA958; margin-right:4px; vertical-align:middle;">
                                      <i data-lucide="cloud-check" style="width:11px; height:11px;"></i>
                                   </span>`
                                : `<span title="Pendiente de sincronización local" style="display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; background:rgba(224,134,0,0.12); border-radius:50%; color:#E08600; margin-right:4px; vertical-align:middle;">
                                      <i data-lucide="cloud-off" style="width:11px; height:11px;"></i>
                                   </span>`;

                            return `
                                <tr>
                                    <td style="white-space:nowrap; font-weight:600;">${i.fecha || '-'}</td>
                                    <td style="white-space:nowrap;">
                                        ${badgeNube}
                                        <span style="background:rgba(224,134,0,0.08); color:#E08600; padding:2px 6px; border-radius:4px; font-weight:800; font-size:0.7rem;">#${i.remito || 'S/R'}</span>
                                    </td>
                                    <td style="white-space:nowrap;">
                                        <span style="background:${colorDep.badgeBg}; color:${colorDep.txt}; border:1px solid ${colorDep.border}; padding:2px 7px; border-radius:5px; font-weight:800; font-size:0.68rem; display:inline-block;">
                                            🏢 ${i.campo_depo || 'S/D'}
                                        </span>
                                    </td>
                                    <td><strong>${i.articulo || '-'}</strong></td>
                                    <td><span style="background:#F0F2F5; color:#6B6255; padding:2px 6px; border-radius:4px; font-size:0.7rem; font-weight:600;">${i.descripcion || i.tipo_insumo || 'GENERAL'}</span></td>
                                    <td style="font-size:0.75rem;">${i.proveedor || '-'}</td>
                                    <td style="text-align: right; font-weight: 800; color: #1FA958; font-family:monospace;">${(i.total || i.cant || 0).toLocaleString('es-AR')} ${i.unidad || ''}</td>
                                    <td style="text-align: right; font-family:monospace; color:#6B6255;">U$S ${Number(i.imp_uni || 0).toFixed(2)}</td>
                                    <td style="text-align: right; font-weight: 800; color: #0071E3; font-family:monospace;">$ ${Number(i.importe_total || 0).toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                                    <td style="text-align: center; white-space:nowrap;">
                                        <div style="display:inline-flex; gap:4px; align-items:center;">
                                            <button class="btn-accion-plant" onclick="ModuloInsumos.m_abrirModalIngreso('${i.reg_local}')" title="Editar ingreso">
                                                ✏️
                                            </button>
                                            <button class="btn-accion-plant btn-delete-plant" onclick="ModuloInsumos.m_solicitarBorrado('${i.reg_local}', ${i.id}, '${i.articulo}')" title="Eliminar ingreso">
                                                🗑️
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },

    m_renderCatalogoMaestro: function() {
        const catalogo = this.parametrosInsumos;
        return `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:0.75rem; font-weight:800; color:#4B4F56; text-transform:uppercase; letter-spacing:0.4px;">
                    🏷️ Catálogo Maestro de Artículos Registrados (${catalogo.length})
                </span>
                <button onclick="ModuloInsumos.m_abrirModalNuevoArticulo()" class="btn-accion-plant" style="background:#1E6B4C; color:#FFF; border:none; padding:6px 14px; border-radius:6px; font-weight:700;">
                    + Nuevo Artículo Maestro
                </button>
            </div>

            <div class="wrapper-tabla-scroll-sticky scroll-apple">
                <table class="tabla-cuadros-plant">
                    <thead>
                        <tr>
                            <th class="th-catalogo">Rubro</th>
                            <th class="th-catalogo">Sub-Rubro</th>
                            <th class="th-catalogo">Código / Artículo</th>
                            <th class="th-catalogo">Descripción Técnica</th>
                            <th class="th-catalogo" style="text-align:center;">Unidad</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${catalogo.map(art => `
                            <tr>
                                <td><strong>${art.rubro || '-'}</strong></td>
                                <td>${art.sub_rubro || '-'}</td>
                                <td><strong style="color:#0071E3;">${art.articulo}</strong></td>
                                <td>${art.descripcion || '-'}</td>
                                <td style="text-align:center;"><span style="background:#F0F2F5; padding:2px 7px; border-radius:4px; font-weight:700; font-size:0.72rem;">${art.unidad_medida || 'U'}</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },

    m_filtrarPorGrupo: function(depoName) {
        this.filtroActual = depoName;
        this.m_dibujarEstructura();
    },

    m_limpiarFiltro: function() {
        this.filtroActual = 'TODO';
        this.filtroDescripcionActual = 'TODO';
        this.filtroBusquedaTxt = '';
        this.m_dibujarEstructura();
    },

    m_renderPillsTipo: function() {
        let dataset = this.datosIngresos;
        if (this.filtroActual !== 'TODO') {
            dataset = dataset.filter(i => (i.campo_depo || "SIN ASIGNAR").toUpperCase() === this.filtroActual.toUpperCase());
        }

        const familias = [...new Set(dataset.map(i => i.descripcion || i.tipo_insumo || 'GENERAL').filter(Boolean))].sort();

        let optionsHtml = `<option value="TODO">📁 Todas las Familias (${dataset.length})</option>`;
        familias.forEach(f => {
            const cant = dataset.filter(i => (i.descripcion || i.tipo_insumo || 'GENERAL') === f).length;
            const selected = this.filtroDescripcionActual === f ? 'selected' : '';
            optionsHtml += `<option value="${f}" ${selected}>📦 ${f.toUpperCase()} (${cant})</option>`;
        });

        return optionsHtml;
    },

    m_cambiarFiltroDescripcion: function(tipoVal) {
        this.filtroDescripcionActual = tipoVal;
        this.m_dibujarEstructura();
    },

    m_filtrarBusqueda: function(val) {
        this.filtroBusquedaTxt = val;
        this.m_dibujarEstructura();
    },

    m_obtenerIngresosFiltrados: function() {
        return this.datosIngresos.filter(i => {
            if (this.filtroActual !== 'TODO') {
                if ((i.campo_depo || "SIN ASIGNAR").toUpperCase() !== this.filtroActual.toUpperCase()) return false;
            }
            if (this.filtroDescripcionActual !== 'TODO') {
                const desc = i.descripcion || i.tipo_insumo || 'GENERAL';
                if (desc.toUpperCase() !== this.filtroDescripcionActual.toUpperCase()) return false;
            }
            if (this.filtroBusquedaTxt) {
                const txt = this.filtroBusquedaTxt.toLowerCase();
                const artMatch = (i.articulo || '').toLowerCase().includes(txt);
                const remMatch = String(i.remito || '').toLowerCase().includes(txt);
                const depMatch = (i.campo_depo || '').toLowerCase().includes(txt);
                const provMatch = (i.proveedor || '').toLowerCase().includes(txt);
                const descMatch = (i.descripcion || '').toLowerCase().includes(txt);
                if (!artMatch && !remMatch && !depMatch && !provMatch && !descMatch) return false;
            }
            return true;
        });
    },

    m_abrirModalIngreso: function(id = null) {
        this.m_asegurarModalBase();

        const reg = id ? this.datosIngresos.find(i => String(i.reg_local) === String(id)) : null;
        const modal = document.getElementById('modal-agrosoft');
        if (modal) modal.style.display = 'flex';

        const tituloModal = document.getElementById('modal-titulo');
        if (tituloModal) {
            tituloModal.innerText = reg ? "EDITAR INGRESO CONSOLIDADO DE INSUMOS" : "NUEVA CARGA TÉCNICA DE INSUMOS";
            tituloModal.style.color = '#123F2C'; 
        }

        const container = document.getElementById('modal-formulario');

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:repeat(3, 1fr); gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Fecha Carga</label>
                        <input type="date" id="i_fecha" value="${reg?.fecha || new Date().toISOString().split('T')[0]}" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Remito N°</label>
                        <input type="number" id="i_remito" value="${reg?.remito || ''}" placeholder="Ej: 00045120" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Depósito Destino</label>
                        <div style="display: flex; gap: 4px;">
                            <select id="i_depo_select" style="flex: 1; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF; cursor:pointer;">
                                <option value="">Depósito...</option>
                                ${this.listaDepositos.map(d => `<option value="${d.deposito}|${d.localidad || ''}" ${reg?.campo_depo === d.deposito ? 'selected' : ''}>🏢 ${d.deposito}</option>`).join('')}
                            </select>
                            <button type="button" onclick="ModuloInsumos.m_abrirModalNuevoDeposito()" title="Nuevo Depósito" style="background:#1E6B4C; border:none; color:#FFF; width:32px; height:32px; border-radius:8px; cursor:pointer; font-weight:900; font-size:1rem; display:flex; align-items:center; justify-content:center; flex-shrink: 0;">
                                +
                            </button>
                        </div>
                    </div>

                    <div style="grid-column: span 2;">
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Proveedor Origen</label>
                        <div style="display: flex; gap: 4px;">
                            <select id="i_prov_select" style="flex: 1; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF; cursor:pointer;">
                                <option value="">Proveedor...</option>
                                ${this.listaProveedores.map(p => `<option value="${p.proveedor}" ${reg?.proveedor === p.proveedor ? 'selected' : ''}>${p.proveedor}</option>`).join('')}
                                ${reg?.proveedor && !this.listaProveedores.some(p => p.proveedor === reg.proveedor) ? `<option value="${reg.proveedor}" selected>${reg.proveedor}</option>` : ''}
                            </select>
                            <button type="button" onclick="ModuloInsumos.m_abrirModalNuevoProveedor()" title="Nuevo Proveedor" style="background:#1E6B4C; border:none; color:#FFF; width:32px; height:32px; border-radius:8px; cursor:pointer; font-weight:900; font-size:1rem; display:flex; align-items:center; justify-content:center; flex-shrink: 0;">
                                +
                            </button>
                        </div>
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Recibió (Operador)</label>
                        <input type="text" id="i_reci" value="${reg?.recibio || ''}" placeholder="Nombre del responsable" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                </div>

                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Artículo / Insumo</label>
                        <div style="display:flex; gap:4px;">
                            <input list="lista-articulos" id="i_art" style="flex:1; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem;" placeholder="Buscar o ingresar artículo..." oninput="ModuloInsumos.m_buscarInsumosRemoto(this.value)" value="${reg?.articulo || ''}">
                            <datalist id="lista-articulos"></datalist>
                            <button type="button" onclick="ModuloInsumos.m_abrirModalNuevoArticulo()" title="Nuevo Artículo Maestro" style="background:#1E6B4C; border:none; color:#FFF; width:32px; height:32px; border-radius:8px; cursor:pointer; font-weight:900; font-size:1rem; display:flex; align-items:center; justify-content:center; flex-shrink: 0;">
                                +
                            </button>
                        </div>
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Descripción / Familia</label>
                        <input type="text" id="i_desc" value="${reg?.descripcion || ''}" placeholder="Ej: FUNGICIDA / HERBICIDA" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>

                    <div style="grid-column: span 2;">
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Unidad de Medida</label>
                        <input type="text" id="i_uni" value="${reg?.unidad || 'LTS'}" placeholder="Ej: LTS, KG, U, BOLSAS" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                </div>

                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:repeat(3, 1fr); gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Cantidad Envases</label>
                        <input type="number" id="i_cant" oninput="ModuloInsumos.m_calcularTotales()" value="${reg?.cant || ''}" placeholder="0" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Contenido x Envase</label>
                        <input type="number" id="i_env_x" oninput="ModuloInsumos.m_calcularTotales()" value="${reg?.envase_x || 1}" placeholder="1" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#1FA958; font-weight:800; text-transform:uppercase; display:block; margin-bottom:4px;">Stock Consolidado</label>
                        <input type="number" id="i_total" readonly style="width:100%; padding:8px 10px; border-radius:8px; border:2px solid #1FA958; background:rgba(31,169,88,0.06); color:#1FA958; font-weight:800; font-size:0.85rem; box-sizing:border-box;" value="${reg?.total || ''}">
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Costo Unitario (U$S)</label>
                        <input type="number" id="i_imp_u" step="0.01" oninput="ModuloInsumos.m_calcularTotales()" value="${reg?.imp_uni || ''}" placeholder="0.00" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>

                    <div style="grid-column: span 2;">
                        <label style="font-size:0.65rem; color:#0071E3; font-weight:800; text-transform:uppercase; display:block; margin-bottom:4px;">Valorización Total Pesos ($)</label>
                        <input type="number" id="i_imp_t" readonly style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #0071E3; background:rgba(0,113,227,0.06); color:#0071E3; font-weight:800; font-size:0.9rem; box-sizing:border-box;" value="${reg?.importe_total || ''}">
                    </div>
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid #E0DCD4; padding-top:12px; margin-top:4px;">
                    <button onclick="ModuloInsumos.m_cerrarModal()" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:8px 16px; border-radius:8px; font-weight:700; font-size:0.78rem; cursor:pointer;">CANCELAR</button>
                    <button id="btn-guardar-insumo-local" style="background:#1E6B4C; color:#FFF; border:none; padding:8px 22px; border-radius:8px; font-weight:700; font-size:0.78rem; cursor:pointer; box-shadow:0 4px 12px rgba(30,107,76,0.25);">
                        ${reg ? 'CONFIRMAR MODIFICACIÓN' : 'CONFIRMAR INGRESO'}
                    </button>
                </div>
            </div>`;

        document.getElementById('btn-guardar-insumo-local').onclick = () => this.m_guardarIngreso(id);
    },

    m_abrirModalNuevoDeposito: function() {
        this.m_asegurarModalBase();
        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        if (!container) return;
        
        const formOriginal = container.innerHTML;
        if (modal) modal.style.display = 'flex';

        document.getElementById('modal-titulo').innerText = "NUEVO DEPÓSITO DE ALMACENAMIENTO";

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                <div style="background:rgba(30,107,76,0.08); border-left:4px solid #1E6B4C; padding:10px 14px; border-radius:8px;">
                    <strong style="color:#123F2C; font-size:0.85rem;">NUEVO DEPÓSITO / GALPÓN</strong>
                    <p style="font-size:0.72rem; margin:2px 0 0 0; color:#6B6255;">Ingrese los datos para registrar un nuevo punto de acopio local.</p>
                </div>

                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Nombre del Depósito</label>
                        <input type="text" id="input_nuevo_deposito" placeholder="Ej: GALPÓN CENTRAL" style="text-transform:uppercase; width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Localidad / Ubicación</label>
                        <input type="text" id="input_nueva_localidad" placeholder="Ej: CHIMPAY" style="text-transform:uppercase; width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px; border-top:1px solid #E0DCD4; padding-top:12px;">
                    <button type="button" id="btn_cancelar_deposito" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:8px 16px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer;">VOLVER</button>
                    <button type="button" id="btn_confirmar_deposito" style="background:#1E6B4C; color:#FFFFFF; border:none; padding:8px 18px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer; box-shadow:0 4px 12px rgba(30,107,76,0.25);">REGISTRAR DEPÓSITO</button>
                </div>
            </div>
        `;

        document.getElementById('input_nuevo_deposito')?.focus();

        document.getElementById('btn_cancelar_deposito').onclick = () => {
            if (this.vistaActualInsumos === 'INGRESOS') {
                container.innerHTML = formOriginal;
                this.m_revinculareventosModal();
            } else {
                this.m_cerrarModal();
            }
        };

        document.getElementById('btn_confirmar_deposito').onclick = async () => {
            const nombreDepo = document.getElementById('input_nuevo_deposito').value.trim().toUpperCase();
            const localidad = document.getElementById('input_nueva_localidad').value.trim().toUpperCase();

            if (!nombreDepo) {
                this.m_notificarAlerta("Debe indicar el nombre del depósito.", 'alerta');
                return;
            }

            try {
                const maxVal = await this.m_obtenerMaxRegLocal('depositos');
                const nuevoRegLocal = String(maxVal + 1);

                const sqlInsert = `INSERT INTO depositos (reg_local, deposito, localidad, sincronizado) VALUES (?, ?, ?, 0)`;
                await this.m_ejecutarSqlLocal(sqlInsert, [nuevoRegLocal, nombreDepo, localidad]);

                this.listaDepositos.push({ reg_local: nuevoRegLocal, deposito: nombreDepo, localidad: localidad });

                if (this.vistaActualInsumos === 'INGRESOS') {
                    container.innerHTML = formOriginal;
                    this.m_revinculareventosModal();

                    const selectDepo = document.getElementById('i_depo_select');
                    if (selectDepo) {
                        const opt = new Option(`🏢 ${nombreDepo}`, `${nombreDepo}|${localidad}`, true, true);
                        selectDepo.add(opt);
                    }
                } else {
                    this.m_cerrarModal();
                    this.m_dibujarEstructura();
                }

                this.m_notificarAlerta("Nuevo depósito registrado con éxito en Base Local.", 'exito');
            } catch (err) {
                console.error("Error al registrar depósito:", err);
                this.m_notificarAlerta("Error al registrar depósito local: " + err.message, 'error');
            }
        };
    },

    m_abrirModalNuevoProveedor: function() {
        this.m_asegurarModalBase();
        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        if (!container) return;
        
        const formOriginal = container.innerHTML;
        if (modal) modal.style.display = 'flex';

        document.getElementById('modal-titulo').innerText = "NUEVO PROVEEDOR";

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                <div style="background:rgba(30,107,76,0.08); border-left:4px solid #1E6B4C; padding:10px 14px; border-radius:8px;">
                    <strong style="color:#123F2C; font-size:0.85rem;">NUEVO PROVEEDOR</strong>
                    <p style="font-size:0.72rem; margin:2px 0 0 0; color:#6B6255;">Ingrese la información para registrar un proveedor comercial.</p>
                </div>

                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Razón Social / Nombre</label>
                        <input type="text" id="input_nuevo_proveedor" placeholder="Ej: AGROQUÍMICA SUR S.A." style="text-transform:uppercase; width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">CUIT (Opcional)</label>
                        <input type="text" id="input_nuevo_cuit" placeholder="Ej: 30-12345678-9" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px; border-top:1px solid #E0DCD4; padding-top:12px;">
                    <button type="button" id="btn_cancelar_proveedor" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:8px 16px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer;">VOLVER</button>
                    <button type="button" id="btn_confirmar_proveedor" style="background:#1E6B4C; color:#FFFFFF; border:none; padding:8px 18px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer; box-shadow:0 4px 12px rgba(30,107,76,0.25);">REGISTRAR PROVEEDOR</button>
                </div>
            </div>
        `;

        document.getElementById('input_nuevo_proveedor')?.focus();

        document.getElementById('btn_cancelar_proveedor').onclick = () => {
            if (this.vistaActualInsumos === 'INGRESOS') {
                container.innerHTML = formOriginal;
                this.m_revinculareventosModal();
            } else {
                this.m_cerrarModal();
            }
        };

        document.getElementById('btn-confirmar-proveedor', 'btn_confirmar_proveedor');
        const btnConfProv = document.getElementById('btn_confirmar_proveedor');
        if (btnConfProv) {
            btnConfProv.onclick = async () => {
                const nombreProv = document.getElementById('input_nuevo_proveedor').value.trim().toUpperCase();
                const cuit = document.getElementById('input_nuevo_cuit').value.trim();

                if (!nombreProv) {
                    this.m_notificarAlerta("Debe indicar la razón social del proveedor.", 'alerta');
                    return;
                }

                try {
                    const sqlInsert = `INSERT INTO proveedores (proveedor, cuit, sincronizado) VALUES (?, ?, 0)`;
                    await this.m_ejecutarSqlLocal(sqlInsert, [nombreProv, cuit]);

                    this.listaProveedores.push({ proveedor: nombreProv, cuit: cuit });

                    if (this.vistaActualInsumos === 'INGRESOS') {
                        container.innerHTML = formOriginal;
                        this.m_revinculareventosModal();

                        const selectProv = document.getElementById('i_prov_select');
                        if (selectProv) {
                            const opt = new Option(nombreProv, nombreProv, true, true);
                            selectProv.add(opt);
                        }
                    } else {
                        this.m_cerrarModal();
                        this.m_dibujarEstructura();
                    }

                    this.m_notificarAlerta("Nuevo proveedor registrado con éxito en Base Local.", 'exito');
                } catch (err) {
                    console.error("Error al registrar proveedor:", err);
                    this.m_notificarAlerta("Error al registrar proveedor local: " + err.message, 'error');
                }
            };
        }
    },

    // ESTO LO MODIFIQUE / ACA ES LO NUEVO: Modal blindado con apertura segura y refresco inmediato
    m_abrirModalNuevoArticulo: function() {
        this.m_asegurarModalBase();
        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        if (!container) return;

        const formOriginal = container.innerHTML;
        if (modal) modal.style.display = 'flex';

        document.getElementById('modal-titulo').innerText = "NUEVO ARTÍCULO MAESTRO";

        const rubrosUnicos = [...new Set(this.parametrosInsumos.map(i => i.rubro).filter(Boolean))].sort();

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                <div style="background:rgba(30,107,76,0.08); border-left:4px solid #1E6B4C; padding:10px 14px; border-radius:8px;">
                    <strong style="color:#123F2C; font-size:0.85rem;">NUEVO ARTÍCULO MAESTRO</strong>
                    <p style="font-size:0.72rem; margin:2px 0 0 0; color:#6B6255;">Dé de alta un insumo que todavía no existe en el catálogo maestro.</p>
                </div>

                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Rubro</label>
                        <input type="text" id="input_nuevo_rubro" list="dl-rubros-nuevo-art" placeholder="Seleccione o escriba rubro" oninput="ModuloInsumos.m_filtrarSubRubrosNuevoArticulo(this.value)" style="text-transform:uppercase; width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                        <datalist id="dl-rubros-nuevo-art">${rubrosUnicos.map(r => `<option value="${r}">`).join('')}</datalist>
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Sub-Rubro</label>
                        <input type="text" id="input_nuevo_subrubro" list="dl-subrubros-nuevo-art" placeholder="Seleccione sub-rubro" style="text-transform:uppercase; width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                        <datalist id="dl-subrubros-nuevo-art"></datalist>
                    </div>
                </div>

                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Código / Nombre Artículo</label>
                        <input type="text" id="input_nuevo_art_codigo" placeholder="Ej: FUNG-0012" style="text-transform:uppercase; width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Unidad de Medida</label>
                        <input type="text" id="input_nuevo_art_unidad" placeholder="Ej: LTS, KG, U" style="text-transform:uppercase; width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                </div>

                <div>
                    <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Descripción Técnica</label>
                    <input type="text" id="input_nuevo_art_desc" placeholder="Ej: FUNGICIDA SISTÉMICO" style="text-transform:uppercase; width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px; border-top:1px solid #E0DCD4; padding-top:12px;">
                    <button type="button" id="btn_cancelar_articulo" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:8px 16px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer;">VOLVER</button>
                    <button type="button" id="btn_confirmar_articulo" style="background:#1E6B4C; color:#FFFFFF; border:none; padding:8px 18px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer; box-shadow:0 4px 12px rgba(30,107,76,0.25);">REGISTRAR ARTÍCULO</button>
                </div>
            </div>
        `;

        document.getElementById('input_nuevo_rubro')?.focus();

        document.getElementById('btn_cancelar_articulo').onclick = () => {
            if (this.vistaActualInsumos === 'INGRESOS') {
                container.innerHTML = formOriginal;
                this.m_revinculareventosModal();
            } else {
                this.m_cerrarModal();
            }
        };

        document.getElementById('btn_confirmar_articulo').onclick = async () => {
            const rubro = document.getElementById('input_nuevo_rubro').value.trim().toUpperCase();
            const subRubro = document.getElementById('input_nuevo_subrubro').value.trim().toUpperCase();
            const codigo = document.getElementById('input_nuevo_art_codigo').value.trim().toUpperCase();
            const unidad = document.getElementById('input_nuevo_art_unidad').value.trim().toUpperCase();
            const descripcion = document.getElementById('input_nuevo_art_desc').value.trim().toUpperCase();

            if (!rubro || !codigo || !descripcion) {
                this.m_notificarAlerta("Complete al menos rubro, código de artículo y descripción.", 'alerta');
                return;
            }

            if (this.parametrosInsumos.some(i => (i.articulo || '').toUpperCase() === codigo)) {
                this.m_notificarAlerta("Ya existe un artículo registrado con ese código.", 'alerta');
                return;
            }

            try {
                const maxVal = await this.m_obtenerMaxRegLocal('insumos');
                const nuevoRegLocal = String(maxVal + 1);

                const nuevoInsumo = {
                    reg_local: nuevoRegLocal,
                    rubro: rubro,
                    sub_rubro: subRubro,
                    articulo: codigo,
                    descripcion: descripcion,
                    unidad_medida: unidad
                };

                const sqlInsert = `INSERT INTO insumos (reg_local, rubro, sub_rubro, articulo, descripcion, unidad_medida, text_labor, sincronizado) VALUES (?, ?, ?, ?, ?, ?, 'SIN USO', 0)`;
                await this.m_ejecutarSqlLocal(sqlInsert, [
                    nuevoInsumo.reg_local, nuevoInsumo.rubro, nuevoInsumo.sub_rubro,
                    nuevoInsumo.articulo, nuevoInsumo.descripcion, nuevoInsumo.unidad_medida
                ]);

                this.parametrosInsumos.push(nuevoInsumo);

                if (this.vistaActualInsumos === 'INGRESOS') {
                    container.innerHTML = formOriginal;
                    this.m_revinculareventosModal();

                    const campoArt = document.getElementById('i_art');
                    if (campoArt) campoArt.value = codigo;
                    const campoDesc = document.getElementById('i_desc');
                    if (campoDesc) campoDesc.value = descripcion;
                    const campoUni = document.getElementById('i_uni');
                    if (campoUni) campoUni.value = unidad;
                } else {
                    this.m_cerrarModal();
                    this.m_dibujarEstructura();
                }

                this.m_notificarAlerta("Nuevo artículo registrado con éxito en Base Local.", 'exito');
            } catch (err) {
                console.error("Error al registrar artículo:", err);
                this.m_notificarAlerta("Error al registrar artículo local: " + err.message, 'error');
            }
        };
    },

    m_filtrarSubRubrosNuevoArticulo: function(rubroVal) {
        const datalist = document.getElementById('dl-subrubros-nuevo-art');
        if (!datalist) return;
        const rubroNorm = (rubroVal || '').trim().toUpperCase();
        const subRubros = [...new Set(
            this.parametrosInsumos
                .filter(i => (i.rubro || '').trim().toUpperCase() === rubroNorm)
                .map(i => i.sub_rubro)
                .filter(Boolean)
        )].sort();
        datalist.innerHTML = subRubros.map(sr => `<option value="${sr}">`).join('');
    },

    m_revinculareventosModal: function() {
        const btnSave = document.getElementById('btn-guardar-insumo-local');
        if (btnSave) btnSave.onclick = () => this.m_guardarIngreso();
    },

    m_calcularTotales: function() {
        const cant = parseFloat(document.getElementById('i_cant')?.value) || 0;
        const envX = parseFloat(document.getElementById('i_env_x')?.value) || 1;
        const impUni = parseFloat(document.getElementById('i_imp_u')?.value) || 0;

        const totalConsolidado = cant * envX;
        const importeTotal = totalConsolidado * impUni;

        const elTotal = document.getElementById('i_total');
        if (elTotal) elTotal.value = totalConsolidado;

        const elImpT = document.getElementById('i_imp_t');
        if (elImpT) elImpT.value = importeTotal.toFixed(2);
    },

    m_buscarInsumosRemoto: async function(query) {
        if (!query || query.length < 2) return;
        try {
            const res = await this.m_ejecutarSqlLocal(
                `SELECT articulo, descripcion, unidad_medida as unidad FROM insumos WHERE articulo LIKE ? LIMIT 8`,
                [`%${query}%`]
            );
            const datalist = document.getElementById('lista-articulos');
            if (datalist && res.data) {
                datalist.innerHTML = res.data.map(item => `<option value="${item.articulo}">${item.descripcion || ''}</option>`).join('');
            }
        } catch (err) {
            console.error(err);
        }
    },

    m_guardarIngreso: async function(regLocalId = null) {
        const btnGuardar = document.getElementById('btn-guardar-insumo-local');
        const comboDepo = document.getElementById('i_depo_select')?.value || '';
        const [depositoNombre, localidadVal] = comboDepo ? comboDepo.split('|') : ['', ''];

        const registro = {
            fecha: document.getElementById('i_fecha').value,
            remito: document.getElementById('i_remito').value,
            campo_depo: depositoNombre,
            localidad: localidadVal,
            proveedor: (document.getElementById('i_prov_select')?.value || '').toUpperCase(),
            recibio: document.getElementById('i_reci').value.toUpperCase(),
            articulo: document.getElementById('i_art').value.toUpperCase(),
            descripcion: document.getElementById('i_desc').value.toUpperCase(),
            unidad: document.getElementById('i_uni').value.toUpperCase(),
            cant: parseFloat(document.getElementById('i_cant').value) || 0,
            envase_x: parseFloat(document.getElementById('i_env_x').value) || 1,
            total: parseFloat(document.getElementById('i_total').value) || 0,
            imp_uni: parseFloat(document.getElementById('i_imp_u').value) || 0,
            importe_total: parseFloat(document.getElementById('i_imp_t').value) || 0
        };

        if (!registro.fecha || !registro.campo_depo || !registro.articulo || registro.total <= 0) {
            this.m_notificarAlerta("Por favor complete fecha, depósito, artículo y cantidades válidas.", 'alerta');
            return;
        }

        if (btnGuardar) {
            btnGuardar.innerText = "GUARDANDO...";
            btnGuardar.disabled = true;
        }

        try {
            if (regLocalId) {
                const sqlUpdate = `UPDATE insumos_ingresos SET fecha=?, remito=?, campo_depo=?, localidad=?, proveedor=?, recibio=?, articulo=?, descripcion=?, unidad=?, cant=?, envase_x=?, total=?, imp_uni=?, importe_total=?, sincronizado=0 WHERE reg_local=?`;
                await this.m_ejecutarSqlLocal(sqlUpdate, [
                    registro.fecha, registro.remito, registro.campo_depo, registro.localidad,
                    registro.proveedor, registro.recibio, registro.articulo, registro.descripcion,
                    registro.unidad, registro.cant, registro.envase_x, registro.total,
                    registro.imp_uni, registro.importe_total, String(regLocalId)
                ]);
            } else {
                const maxVal = await this.m_obtenerMaxRegLocal('insumos_ingresos');
                registro.reg_local = String(maxVal + 1);

                const sqlInsert = `INSERT INTO insumos_ingresos (reg_local, fecha, remito, campo_depo, localidad, proveedor, recibio, articulo, descripcion, unidad, cant, envase_x, total, imp_uni, importe_total, sincronizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`;
                await this.m_ejecutarSqlLocal(sqlInsert, [
                    registro.reg_local, registro.fecha, registro.remito, registro.campo_depo,
                    registro.localidad, registro.proveedor, registro.recibio, registro.articulo,
                    registro.descripcion, registro.unidad, registro.cant, registro.envase_x,
                    registro.total, registro.imp_uni, registro.importe_total
                ]);
            }

            this.m_cerrarModal();
            this.m_notificarAlerta("Ingreso registrado correctamente en Base Local.", 'exito');
            await this.m_inicializar();

        } catch (err) {
            console.error("Error al guardar ingreso:", err);
            this.m_notificarAlerta("Error al guardar en Base Local: " + err.message, 'error');
            if (btnGuardar) {
                btnGuardar.innerText = "CONFIRMAR INGRESO";
                btnGuardar.disabled = false;
            }
        }
    },

    m_solicitarBorrado: function(reg_local, id, articulo) {
        this.m_asegurarModalBase();
        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        const modalContent = document.querySelector('.modal-apple-content');
        if (modalContent) modalContent.style.maxWidth = '420px';

        document.getElementById('modal-titulo').innerText = "⚠️ REVERSIÓN DE EXISTENCIA";

        container.innerHTML = `
            <div style="font-family:'Roboto', sans-serif; text-align:center; display:flex; flex-direction:column; gap:14px; padding:10px 5px;">
                <div style="width:50px; height:50px; background:rgba(224,52,42,0.1); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto; border:1px solid rgba(224,52,42,0.25);">
                    <span style="color:#E0342A; font-size:1.5rem; font-weight:bold;">!</span>
                </div>

                <div>
                    <h3 style="margin:0; font-size:1.1rem; font-weight:bold; color:#1D1D1F;">¿Desea eliminar este registro?</h3>
                    <p style="margin:6px 0 0 0; font-size:0.8rem; color:#6E6E73; line-height:1.4;">
                        El ingreso de insumos será purgado del galpón:<br>
                        <strong style="color:#E0342A; font-size:0.88rem; display:block; margin-top:4px;">${articulo}</strong>
                    </p>
                </div>

                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:8px; border-top:1px solid #E0DCD4; padding-top:14px;">
                    <button onclick="ModuloInsumos.m_cerrarModal()" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:9px; border-radius:8px; font-weight:bold; font-size:0.78rem; cursor:pointer;">
                        CANCELAR
                    </button>
                    <button id="btn-eliminar-confirmar-ins" style="background:#E0342A; color:white; border:none; padding:9px; border-radius:8px; font-weight:bold; font-size:0.78rem; cursor:pointer; box-shadow:0 4px 12px rgba(224,52,42,0.25);">
                        ELIMINAR AHORA
                    </button>
                </div>
            </div>
        `;

        document.getElementById('btn-eliminar-confirmar-ins').onclick = () => this.m_ejecutarBorrado(reg_local, id);
        if (modal) modal.style.display = 'flex';
    },

    m_ejecutarBorrado: async function(reg_local, id) {
        try {
            const sqlDelete = `DELETE FROM insumos_ingresos WHERE reg_local = ? OR id = ?`;
            await this.m_ejecutarSqlLocal(sqlDelete, [String(reg_local), id]);

            this.m_cerrarModal();
            this.m_notificarAlerta("Registro purgado correctamente de la Base Local.", 'exito');
            await this.m_inicializar();
        } catch (e) {
            this.m_notificarAlerta("Error al revertir ingreso en Base Local: " + e.message, 'error');
        }
    },

    m_exportarPDF: function() {
        const datos = this.m_obtenerIngresosFiltrados();
        if (datos.length === 0) return alert("No hay registros para emitir el reporte.");

        const totalPesos = datos.reduce((a, c) => a + (Number(c.importe_total) || 0), 0);
        const totalCant = datos.reduce((a, c) => a + (Number(c.total || c.cant) || 0), 0);

        const ventanaImpresion = window.open('', '_blank');
        ventanaImpresion.document.write(`
            <html>
            <head>
                <title>Salvucci Gestión - Control de Insumos</title>
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
                            <h2>SALVUCCI GESTIÓN · INSUMOS Y EXISTENCIAS</h2>
                            <h1>REPORTE GENERAL DE INGRESOS A GALPÓN</h1>
                        </div>
                    </div>
                    <div class="kpi-tile-top">
                        <div style="font-size:9px; color:#6B6255; font-weight:700; text-transform:uppercase;">Valorización Total</div>
                        <div style="font-size:16px; font-weight:900; color:#1E6B4C;">$ ${totalPesos.toLocaleString('es-AR', {minimumFractionDigits:2})}</div>
                        <small style="font-size:9px; color:#6B6255;">Total Stock: ${totalCant.toLocaleString('es-AR')} Unidades</small>
                    </div>
                </div>

                <div style="margin-bottom:8px; font-size:11px; font-weight:800; color:#123F2C; text-transform:uppercase;">
                    ■ DETALLE DE ENTRADAS A DEPÓSITOS (${datos.length})
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>FECHA</th><th>REMITO</th><th>DEPÓSITO</th><th>ARTÍCULO</th>
                            <th>FAMILIA</th><th>PROVEEDOR</th><th style="text-align:right;">CANTIDAD</th>
                            <th style="text-align:right;">UNIT. U$S</th><th style="text-align:right;">TOTAL ($)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${datos.map(i => `
                            <tr>
                                <td><b>${i.fecha || '-'}</b></td>
                                <td>#${i.remito || 'S/R'}</td>
                                <td><b>${i.campo_depo || 'S/D'}</b></td>
                                <td><strong>${i.articulo || '-'}</strong></td>
                                <td>${i.descripcion || i.tipo_insumo || '-'}</td>
                                <td>${i.proveedor || '-'}</td>
                                <td style="text-align:right; font-weight:700; color:#1E6B4C;">${(i.total || i.cant || 0).toLocaleString('es-AR')} ${i.unidad || ''}</td>
                                <td style="text-align:right;">U$S ${Number(i.imp_uni || 0).toFixed(2)}</td>
                                <td style="text-align:right; font-weight:800;">$ ${Number(i.importe_total || 0).toLocaleString('es-AR', {minimumFractionDigits:2})}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div class="footer-firma-fija">
                    <span>Salvucci Gestión &bull; Control de Insumos y Almacenamiento</span>
                    <span style="font-weight:bold;">Firma Responsable Depósito: ___________________________</span>
                </div>

                <script>
                    window.onload = function() { setTimeout(() => { window.print(); window.close(); }, 300); }
                </script>
            </body>
            </html>
        `);
        ventanaImpresion.document.close();
    },

    m_exportarExcel: function() {
        const datos = this.m_obtenerIngresosFiltrados();
        if (datos.length === 0) return alert("No hay registros para exportar.");

        const headers = [
            "REG. LOCAL", "FECHA", "REMITO", "DEPÓSITO", "LOCALIDAD", "ARTÍCULO",
            "FAMILIA", "UNIDAD", "PROVEEDOR", "RECIBIÓ", "CANT. ENVASES", "ENV. X",
            "STOCK TOTAL", "COSTO UNIT U$S", "IMPORTE TOTAL ($)"
        ];

        let csvContent = "\uFEFF" + headers.join(";") + "\n";

        datos.forEach(i => {
            const fila = [
                i.reg_local || '', i.fecha || '', i.remito || '', `"${i.campo_depo || ''}"`,
                `"${i.localidad || ''}"`, `"${i.articulo || ''}"`, `"${i.descripcion || i.tipo_insumo || ''}"`,
                `"${i.unidad || ''}"`, `"${i.proveedor || ''}"`, `"${i.recibio || ''}"`,
                i.cant || 0, i.envase_x || 1, i.total || 0, i.imp_uni || 0, i.importe_total || 0
            ];
            csvContent += fila.join(";") + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.setAttribute("download", `Salvucci_Ingresos_Insumos_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
};

window.ModuloInsumos = ModuloInsumos;