/**
 * stock_insumos.js - Auditoría y Consolidación de Stock Físico
 * Sistema: SALVUCCI / AgroSoft J&L
 * Lógica: SUM(insumos_ingresos.total) - SUM(egresos_insumos.total_consumo WHERE estado = 'ACTIVO')
 * Matching: TRIM(UPPER(insumos_ingresos.articulo)) === TRIM(UPPER(egresos_insumos.insumo))
 */

// Helper universal de normalización de cadenas (elimina espacios múltiples y pasa a mayúsculas)
const _normalizarTextoStock = (txt) => (txt || '').toString().replace(/\s+/g, ' ').trim().toUpperCase();

const ModuloStockInsumos = {
    datosStock: [],        
    datosOriginales: { ingresos: [], egresos: [], insumosMaestros: [] }, 
    listaDepositos: [], 
    
    filtroDeposito: 'TODO',
    filtroTipo: 'TODO',
    textoBusqueda: '',
    vistaActualTab: 'TODOS', // 'TODOS' | 'ALERTAS' | 'SIN_CATEGORIA'
    
    parametros: {
        cuadros: [],
        gastos: []
    },

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
        const modalContent = document.querySelector('.modal-apple-content');
        if (modalContent) modalContent.style.maxWidth = '780px';
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
        visor.innerHTML = `<div class="loader-apple" style="font-family:'Roboto', sans-serif; text-align:center; padding:50px; color:#1E6B4C; font-weight:500; letter-spacing: 0.3px;">Consolidando entradas de ingresos y egresos de campo...</div>`;

        try {
            const [resDep, resCuadros, resGastos, resIng, resEgr, resIns] = await Promise.all([
                this.m_ejecutarSqlLocal(`SELECT * FROM depositos ORDER BY deposito ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM campos ORDER BY establecimiento ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM tipos_gastos ORDER BY nombre_gasto ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM insumos_ingresos`),
                this.m_ejecutarSqlLocal(`SELECT * FROM egresos_insumos ORDER BY fecha DESC`),
                this.m_ejecutarSqlLocal(`SELECT reg_local, rubro, sub_rubro, articulo, descripcion, unidad_medida FROM insumos ORDER BY articulo ASC`)
            ]);

            this.listaDepositos = resDep.data || resDep || [];
            this.parametros.cuadros = resCuadros.data || resCuadros || [];
            this.parametros.gastos = resGastos.data || resGastos || [];
            
            this.datosOriginales.ingresos = resIng.data || resIng || [];
            this.datosOriginales.egresos = resEgr.data || resEgr || [];
            this.datosOriginales.insumosMaestros = resIns.data || resIns || [];
            
            this.filtroDeposito = 'TODO';
            this.filtroTipo = 'TODO';
            this.textoBusqueda = '';
            this.vistaActualTab = 'TODOS';

            this.m_procesarStockGlobal();
            this.m_dibujarEstructura();
        } catch (err) {
            console.error("❌ Error en Inicialización de Stock:", err);
            visor.innerHTML = `<div style="color:#E0342A; padding:20px; font-family:'Roboto'; font-weight: 500;">Error al procesar el stock local: ${err.message}</div>`;
        }
    },

    m_procesarStockGlobal: function() {
    const consolidado = {};
    const mapaMaestro = new Map();

    // Mapeo del catálogo maestro para tomar Rubro y Sub-Rubro
    (this.datosOriginales.insumosMaestros || []).forEach(m => {
        const k = (m.articulo || '').trim().toUpperCase();
        if (k) mapaMaestro.set(k, m);
    });

    // 1. Entradas desde insumos_ingresos
    (this.datosOriginales.ingresos || []).forEach(i => {
        const artKey = (i.articulo || "SIN ARTICULO").trim().toUpperCase();
        if (!consolidado[artKey]) {
            const maestro = mapaMaestro.get(artKey);
            consolidado[artKey] = { 
                reg_local_maestro: maestro?.reg_local || null,
                articulo: i.articulo, 
                rubro: (maestro?.rubro || i.descripcion || "GENERAL").trim().toUpperCase(),
                sub_rubro: (maestro?.sub_rubro || "").trim().toUpperCase(),
                descripcion: (maestro?.descripcion || i.descripcion || "GENERAL").trim().toUpperCase(), 
                tipo_insumos: (i.tipo_insumo || "GENERAL").trim().toUpperCase(),
                entradas: 0, 
                salidas: 0, 
                unidad: maestro?.unidad_medida || i.unidad || 'LITROS' 
            };
        }
        consolidado[artKey].entradas += Number(i.total) || 0;
        if (i.descripcion && consolidado[artKey].descripcion === "GENERAL") {
            consolidado[artKey].descripcion = i.descripcion.trim().toUpperCase();
        }
    });

    // 2. Salidas directas desde egresos_insumos
    (this.datosOriginales.egresos || []).forEach(e => {
        const artKey = (e.insumo || "SIN ARTICULO").trim().toUpperCase();
        if (!consolidado[artKey]) {
            const maestro = mapaMaestro.get(artKey);
            consolidado[artKey] = { 
                reg_local_maestro: maestro?.reg_local || null,
                articulo: e.insumo, 
                rubro: (maestro?.rubro || "GENERAL").trim().toUpperCase(),
                sub_rubro: (maestro?.sub_rubro || "").trim().toUpperCase(),
                descripcion: (maestro?.descripcion || e.comentario || "GENERAL").trim().toUpperCase(), 
                tipo_insumos: (e.tipo_labor || "GENERAL").trim().toUpperCase(), 
                entradas: 0, 
                salidas: 0, 
                unidad: maestro?.unidad_medida || 'LITROS' 
            };
        }
        // Suma directa de consumo sin trabas de condición
        consolidado[artKey].salidas += Number(e.total_consumo) || 0;
    });

    // 3. Balance neto
    this.datosStock = Object.values(consolidado).map(s => {
        const sinRubro = !s.rubro || s.rubro === '0' || s.rubro === 'SIN ASIGNAR';
        const sinSubRubro = !s.sub_rubro || s.sub_rubro === '0' || s.sub_rubro === 'SIN ASIGNAR';
        return {
            ...s,
            stock_actual: s.entradas - s.salidas,
            estaIncompleto: sinRubro && sinSubRubro
        };
    }).filter(x => x.entradas > 0 || x.salidas > 0).sort((a, b) => a.articulo.localeCompare(b.articulo));
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
        const mapaMaestro = new Map();
        const depoSel = this.filtroDeposito.trim().toUpperCase();

        (this.datosOriginales.insumosMaestros || []).forEach(m => {
            const k = (m.articulo || '').trim().toUpperCase();
            if (k) mapaMaestro.set(k, m);
        });
        
        // Entradas del depósito
        (this.datosOriginales.ingresos || [])
            .filter(x => (x.campo_depo || '').trim().toUpperCase() === depoSel)
            .forEach(i => {
                const artKey = (i.articulo || "SIN ARTICULO").trim().toUpperCase();
                const maestro = mapaMaestro.get(artKey);

                if (!consolidadoPorDepo[artKey]) {
                    consolidadoPorDepo[artKey] = { 
                        reg_local_maestro: maestro?.reg_local || null,
                        articulo: i.articulo, 
                        rubro: (maestro?.rubro || i.descripcion || "GENERAL").trim().toUpperCase(),
                        sub_rubro: (maestro?.sub_rubro || "").trim().toUpperCase(),
                        descripcion: (maestro?.descripcion || i.descripcion || "GENERAL").trim().toUpperCase(), 
                        entradas: 0, 
                        salidas: 0, 
                        unidad: maestro?.unidad_medida || i.unidad || 'LITROS' 
                    };
                }
                consolidadoPorDepo[artKey].entradas += Number(i.total) || 0;
            });

        // Consumos del depósito
        (this.datosOriginales.egresos || [])
            .filter(x => (x.deposito_origen || '').trim().toUpperCase() === depoSel)
            .forEach(e => {
                const artKey = (e.insumo || "SIN ARTICULO").trim().toUpperCase();
                const maestro = mapaMaestro.get(artKey);

                if (!consolidadoPorDepo[artKey]) {
                    consolidadoPorDepo[artKey] = { 
                        reg_local_maestro: maestro?.reg_local || null,
                        articulo: e.insumo, 
                        rubro: (maestro?.rubro || "GENERAL").trim().toUpperCase(),
                        sub_rubro: (maestro?.sub_rubro || "").trim().toUpperCase(),
                        descripcion: (maestro?.descripcion || e.comentario || "GENERAL").trim().toUpperCase(), 
                        entradas: 0, 
                        salidas: 0, 
                        unidad: maestro?.unidad_medida || 'LITROS' 
                    };
                }
                consolidadoPorDepo[artKey].salidas += Number(e.total_consumo) || 0;
            });

        datasetBase = Object.values(consolidadoPorDepo)
            .filter(x => x.entradas > 0 || x.salidas > 0)
            .map(s => ({
                ...s,
                stock_actual: s.entradas - s.salidas,
                estaIncompleto: !s.rubro || s.rubro === 'SIN ASIGNAR'
            }));
    }

    if (this.filtroTipo !== 'TODO') {
        datasetBase = datasetBase.filter(s => s.rubro === this.filtroTipo.toUpperCase() || s.sub_rubro === this.filtroTipo.toUpperCase());
    }

    if (this.textoBusqueda) {
        const v = this.textoBusqueda.toLowerCase();
        datasetBase = datasetBase.filter(s => 
            s.articulo.toLowerCase().includes(v) || 
            s.rubro.toLowerCase().includes(v) ||
            s.sub_rubro.toLowerCase().includes(v) ||
            s.descripcion.toLowerCase().includes(v)
        );
    }

    if (this.vistaActualTab === 'ALERTAS') {
        datasetBase = datasetBase.filter(x => x.stock_actual <= 0);
    } else if (this.vistaActualTab === 'SIN_CATEGORIA') {
        datasetBase = datasetBase.filter(x => x.estaIncompleto);
    }

    return datasetBase;
},

    m_dibujarEstructura: function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;

        const datos = this.m_obtenerStockFiltrado();
        const totalAlertas = this.datosStock.filter(x => x.stock_actual <= 0).length;
        const totalIncompletos = this.datosStock.filter(x => x.estaIncompleto).length;

        const rubrosUnicos = [...new Set(this.datosStock.map(s => s.rubro).filter(r => r && r !== '0' && r !== 'SIN ASIGNAR'))].sort();
        const depositosDisponibles = [...new Set(this.datosOriginales.ingresos.map(i => _normalizarTextoStock(i.campo_depo)).filter(Boolean))].sort();

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
                .badge-tab-warn {
                    background: rgba(224, 134, 0, 0.12); color: #E08600; padding: 2px 7px;
                    border-radius: 12px; font-size: 0.68rem; font-weight: 800;
                }

                .panel-box-plant {
                    background: #FFFFFF; border: 1.5px solid #E0DCD4; border-radius: 14px; padding: 14px;
                    display: flex; flex-direction: column; gap: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.04);
                }

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
                ${typeof ComponentesUI !== 'undefined' && ComponentesUI.botonVolverHTML ? ComponentesUI.botonVolverHTML('INSUMOS') : ''}

                <!-- HEADER SUPERIOR -->
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; margin-bottom:10px; flex-wrap:wrap; gap:10px;">
                    <div>
                        <h2 style="margin:0; font-weight: 800; font-size: 1.3rem; letter-spacing: -0.5px; color:#123F2C;">Auditoría de Stock de Insumos</h2>
                        <p style="margin:2px 0 0 0; font-size:0.75rem; color:#6B6255;">Entradas de remito menos consumos directos de labores y órdenes (Base Local)</p>
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
                        <span>TODO EL STOCK ACTIVO</span>
                        <span class="badge-tab-main">${this.datosStock.length} Artículos</span>
                    </div>
                    <div class="tab-main-archivero ${this.vistaActualTab === 'ALERTAS' ? 'active' : ''}" onclick="ModuloStockInsumos.m_cambiarTabVista('ALERTAS')">
                        <i data-lucide="alert-triangle" style="width:14px; height:14px; color:#E0342A;"></i>
                        <span>QUIEBRES DE STOCK</span>
                        <span class="badge-tab-alert">${totalAlertas} Críticos</span>
                    </div>
                    <div class="tab-main-archivero ${this.vistaActualTab === 'SIN_CATEGORIA' ? 'active' : ''}" onclick="ModuloStockInsumos.m_cambiarTabVista('SIN_CATEGORIA')">
                        <i data-lucide="help-circle" style="width:14px; height:14px; color:#E08600;"></i>
                        <span>SIN RUBRO / SUB-RUBRO</span>
                        <span class="badge-tab-warn">${totalIncompletos} Pendientes</span>
                    </div>
                </div>

                <!-- BARRA DE BÚSQUEDA Y FILTROS -->
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap;">
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <input type="text" id="buscador-stock" placeholder="🔍 Buscar insumo, rubro, sub-rubro..." value="${this.textoBusqueda}" oninput="ModuloStockInsumos.m_onBusquedaInput(this.value)" style="padding:6px 12px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.78rem; outline:none; background:#FFFFFF; min-width:280px;">
                        
                        <select onchange="ModuloStockInsumos.m_onDepositoChange(this.value)" style="padding:6px 12px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.78rem; outline:none; background:#FFFFFF; font-weight:600; cursor:pointer;">
                            <option value="TODO">🏢 Todos los Depósitos</option>
                            ${depositosDisponibles.map(d => `<option value="${d}" ${this.filtroDeposito === d ? 'selected' : ''}>${d}</option>`).join('')}
                        </select>

                        <select id="filtro-tipo-insumo" onchange="ModuloStockInsumos.m_onTipoChange(this.value)" style="padding:6px 12px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.78rem; outline:none; background:#FFFFFF; font-weight:600; cursor:pointer;">
                            <option value="TODO">🏷️ Todos los Rubros</option>
                            ${rubrosUnicos.map(t => `<option value="${t}" ${this.filtroTipo === t ? 'selected' : ''}>${t}</option>`).join('')}
                        </select>
                    </div>

                    ${(this.filtroDeposito !== 'TODO' || this.filtroTipo !== 'TODO' || this.textoBusqueda || this.vistaActualTab !== 'TODOS') ? `
                        <button onclick="ModuloStockInsumos.m_limpiarFiltro()" style="background:rgba(224,52,42,0.1); border:1px solid rgba(224,52,42,0.25); color:#E0342A; padding:5px 12px; border-radius:6px; font-size:0.72rem; font-weight:700; cursor:pointer;">
                            ✕ Limpiar Filtros
                        </button>
                    ` : ''}
                </div>

                <!-- TABLA EJECUTIVA -->
                <div class="panel-box-plant">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.75rem; font-weight:800; color:#123F2C; text-transform:uppercase; letter-spacing:0.4px;">
                            📋 Balance de Stock Físico (${datos.length})
                        </span>
                        <span style="font-size:0.72rem; color:#6B6255; font-weight:600;">Cabeceras fijas siempre visibles</span>
                    </div>

                    <div class="wrapper-tabla-scroll-sticky scroll-apple">
                        <table class="tabla-cuadros-plant">
                            <thead>
                                <tr>
                                    <th>Artículo / Insumo Maestro</th>
                                    <th>Ubicación por Almacén / Galpón</th>
                                    <th>Familia / Grupo (Rubro · Sub-Rubro)</th>
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
            const artKeyTarget = _normalizarTextoStock(s.articulo);
            
            historialDepositos.forEach(depoName => {
                const depoNorm = _normalizarTextoStock(depoName);

                const ent = this.datosOriginales.ingresos
                    .filter(x => _normalizarTextoStock(x.articulo) === artKeyTarget && _normalizarTextoStock(x.campo_depo) === depoNorm)
                    .reduce((a, c) => a + (parseFloat(c.total) || parseFloat(c.cant) || parseFloat(c.cantidad) || 0), 0);

                const sal = this.datosOriginales.egresos
                    .filter(x => _normalizarTextoStock(x.insumo || x.articulo) === artKeyTarget && _normalizarTextoStock(x.deposito_origen) === depoNorm && (!_normalizarTextoStock(x.estado) || _normalizarTextoStock(x.estado) === 'ACTIVO'))
                    .reduce((a, c) => a + (parseFloat(c.total_consumo) || parseFloat(c.cantidad) || parseFloat(c.cant) || parseFloat(c.dosis_ha) || 0), 0);

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

            let celdaFamiliaHTML = '';
            if (s.estaIncompleto) {
                celdaFamiliaHTML = `
                    <div onclick="ModuloStockInsumos.m_abrirModalEdicionArticulo('${s.articulo.replace(/'/g, "\\'")}')" style="cursor:pointer; display:inline-flex; flex-direction:column; gap:2px;" title="Clic para asignar Rubro y Sub-Rubro">
                        <span style="background:rgba(224,134,0,0.12); color:#E08600; border:1px dashed #E08600; padding:3px 8px; border-radius:6px; font-weight:800; font-size:0.7rem;">
                            ⚠️ ${!s.rubro ? 'SIN RUBRO' : s.rubro} · ${!s.sub_rubro ? 'SIN SUB-RUBRO' : s.sub_rubro}
                        </span>
                        <small style="color:#0071E3; font-weight:700; font-size:0.65rem;">+ Completar Clasificación</small>
                    </div>
                `;
            } else {
                celdaFamiliaHTML = `
                    <div style="display:inline-flex; flex-direction:column;">
                        <span style="background:#F0F2F5; color:#123F2C; padding:2px 7px; border-radius:4px; font-weight:800; font-size:0.72rem;">
                            🏷️ ${s.rubro}
                        </span>
                        ${s.sub_rubro ? `<span style="font-size:0.68rem; color:#6B6255; margin-left:4px; margin-top:2px;">${s.sub_rubro}</span>` : ''}
                    </div>
                `;
            }

            return `
                <tr>
                    <td>
                        <strong style="color:#1D1D1F; font-size:0.86rem;">${s.articulo}</strong>
                        ${s.descripcion ? `<div style="font-size:0.7rem; color:#6B6255;">${s.descripcion}</div>` : ''}
                    </td>
                    <td>
                        <div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">
                            ${leyendaUbicaciones}
                        </div>
                    </td>
                    <td>
                        ${celdaFamiliaHTML}
                    </td>
                    <td style="text-align:right; font-family:monospace; color:#6B6255;">${s.entradas.toLocaleString('es-AR')} ${s.unidad}</td>
                    <td style="text-align:right; font-family:monospace; color:#E0342A; font-weight:700;">-${s.salidas.toLocaleString('es-AR')} ${s.unidad}</td>
                    <td style="text-align:right; font-weight:800; font-size:0.95rem; color:${esCritico ? '#E0342A' : '#1FA958'}; font-family:monospace;">
                        ${s.stock_actual.toLocaleString('es-AR')} ${s.unidad}
                    </td>
                    <td style="text-align:center;">
                        <span class="badge-condicion" style="background:${esCritico ? 'rgba(224,52,42,0.1)' : 'rgba(31,169,88,0.1)'}; color:${esCritico ? '#E0342A' : '#1FA958'};">
                            ${labelCondicion}
                        </span>
                    </td>
                    <td style="text-align:center; white-space:nowrap;">
                        <div style="display:inline-flex; gap:4px; align-items:center;">
                            <button class="btn-accion-plant" onclick="ModuloStockInsumos.m_abrirModalEdicionArticulo('${s.articulo.replace(/'/g, "\\'")}')" title="Modificar ficha técnica y categorías">
                                ✏️
                            </button>
                            <button class="btn-accion-plant" onclick="ModuloStockInsumos.m_abrirAccionesInsumo('${s.articulo.replace(/'/g, "\\'")}', ${s.stock_actual}, '${s.unidad}')" title="Desglose y movimientos de stock">
                                📦
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    },

    m_abrirModalEdicionArticulo: function(codigoArticulo) {
        this.m_asegurarModalBase();
        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        if (!container) return;

        const modalContent = document.querySelector('.modal-apple-content');
        if (modalContent) modalContent.style.maxWidth = '680px';

        const codigoNorm = _normalizarTextoStock(codigoArticulo);
        let art = this.datosOriginales.insumosMaestros.find(i => _normalizarTextoStock(i.articulo) === codigoNorm);
        if (!art) {
            const st = this.datosStock.find(x => _normalizarTextoStock(x.articulo) === codigoNorm);
            art = {
                reg_local: null,
                articulo: codigoArticulo,
                rubro: st?.rubro || '',
                sub_rubro: st?.sub_rubro || '',
                descripcion: st?.descripcion || '',
                unidad_medida: st?.unidad || 'LTS'
            };
        }

        document.getElementById('modal-titulo').innerText = "CLASIFICACIÓN Y FICHA TÉCNICA";

        const rubrosUnicos = [...new Set(this.datosOriginales.insumosMaestros.map(i => (i.rubro || '').trim().toUpperCase()).filter(r => r && r !== '0' && r !== 'SIN ASIGNAR'))].sort();

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                <div style="background:rgba(30,107,76,0.08); border-left:4px solid #1E6B4C; padding:10px 14px; border-radius:8px;">
                    <strong style="color:#123F2C; font-size:0.85rem;">ASIGNACIÓN DE RUBRO Y SUB-RUBRO</strong>
                    <p style="font-size:0.72rem; margin:2px 0 0 0; color:#6B6255;">Seleccione o cree nuevos rubros y sub-rubros para clasificar el insumo.</p>
                </div>

                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Rubro Principal</label>
                        <div style="display:flex; gap:6px;">
                            <select id="sel_rubro_modal" onchange="ModuloStockInsumos.m_onRubroModalChange(this.value)" style="flex:1; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF; font-weight:600; cursor:pointer;">
                                <option value="">Seleccione Rubro...</option>
                                ${rubrosUnicos.map(r => `<option value="${r}" ${art.rubro === r ? 'selected' : ''}>🏷️ ${r}</option>`).join('')}
                            </select>
                            <button type="button" onclick="ModuloStockInsumos.m_promptNuevoRubro()" title="Agregar nuevo Rubro" style="background:#1E6B4C; color:white; border:none; width:34px; height:34px; border-radius:8px; font-weight:900; font-size:1.1rem; cursor:pointer; flex-shrink:0;">+</button>
                        </div>
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Sub-Rubro</label>
                        <div style="display:flex; gap:6px;">
                            <select id="sel_subrubro_modal" style="flex:1; padding:8px 10px; border-radius:8px; border:1.5px solid #1E6B4C; font-size:0.85rem; background:#FFFFFF; font-weight:600; cursor:pointer;">
                                <option value="">Esperando selección de rubro...</option>
                            </select>
                            <button type="button" onclick="ModuloStockInsumos.m_promptNuevoSubRubro()" title="Agregar nuevo Sub-Rubro" style="background:#1E6B4C; color:white; border:none; width:34px; height:34px; border-radius:8px; font-weight:900; font-size:1.1rem; cursor:pointer; flex-shrink:0;">+</button>
                        </div>
                    </div>
                </div>

                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Código / Nombre Artículo</label>
                        <input type="text" id="edit_articulo" value="${art.articulo}" style="text-transform:uppercase; width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; font-weight:bold; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Unidad de Medida</label>
                        <input type="text" id="edit_unidad" value="${art.unidad_medida || 'LTS'}" placeholder="LTS, KG, U" style="text-transform:uppercase; width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                </div>

                <div>
                    <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Descripción Técnica</label>
                    <input type="text" id="edit_descripcion" value="${art.descripcion || ''}" placeholder="Especificación técnica o formulación" style="text-transform:uppercase; width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px; border-top:1px solid #E0DCD4; padding-top:12px;">
                    <button type="button" onclick="ModuloStockInsumos.m_cerrarModal()" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:8px 16px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer;">CANCELAR</button>
                    <button type="button" id="btn_guardar_maestro_stk" style="background:#1E6B4C; color:#FFFFFF; border:none; padding:8px 20px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer; box-shadow:0 4px 12px rgba(30,107,76,0.25);">
                        GUARDAR CAMBIOS MAESTROS
                    </button>
                </div>
            </div>
        `;

        if (art.rubro) {
            this.m_onRubroModalChange(art.rubro, art.sub_rubro);
        } else {
            this.m_onRubroModalChange('', '');
        }

        if (modal) modal.style.display = 'flex';

        document.getElementById('btn_guardar_maestro_stk').onclick = async () => {
            const rubro = document.getElementById('sel_rubro_modal').value.trim().toUpperCase();
            const subRubro = document.getElementById('sel_subrubro_modal').value.trim().toUpperCase();
            const nuevoCodigo = document.getElementById('edit_articulo').value.trim().toUpperCase();
            const unidad = document.getElementById('edit_unidad').value.trim().toUpperCase() || 'U';
            const descripcion = document.getElementById('edit_descripcion').value.trim().toUpperCase();

            if (!nuevoCodigo) {
                this.m_notificarAlerta("El código o nombre del artículo no puede estar vacío.", 'error');
                return;
            }

            try {
                if (art.reg_local) {
                    const sqlUpdate = `
                        UPDATE insumos 
                        SET rubro = ?, sub_rubro = ?, articulo = ?, descripcion = ?, unidad_medida = ?, sincronizado = 0 
                        WHERE reg_local = ?
                    `;
                    await this.m_ejecutarSqlLocal(sqlUpdate, [rubro, subRubro, nuevoCodigo, descripcion, unidad, String(art.reg_local)]);
                } else {
                    const resMax = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(reg_local AS INTEGER)) as max_reg FROM insumos`);
                    const maxVal = (resMax.data && resMax.data[0] && resMax.data[0].max_reg) ? Number(resMax.data[0].max_reg) : 0;
                    const nuevoRegLocal = String(maxVal + 1);

                    const sqlInsert = `
                        INSERT INTO insumos (reg_local, rubro, sub_rubro, articulo, descripcion, unidad_medida, text_labor, sincronizado) 
                        VALUES (?, ?, ?, ?, ?, ?, 'SIN USO', 0)
                    `;
                    await this.m_ejecutarSqlLocal(sqlInsert, [nuevoRegLocal, rubro, subRubro, nuevoCodigo, descripcion, unidad]);
                }

                // Propagación si cambió el nombre del insumo
                if (_normalizarTextoStock(codigoArticulo) !== _normalizarTextoStock(nuevoCodigo)) {
                    await this.m_ejecutarSqlLocal(`UPDATE insumos_ingresos SET articulo = ?, sincronizado = 0 WHERE UPPER(TRIM(articulo)) = ?`, [nuevoCodigo, codigoArticulo]);
                    await this.m_ejecutarSqlLocal(`UPDATE egresos_insumos SET insumo = ?, sincronizado = 0 WHERE UPPER(TRIM(insumo)) = ?`, [nuevoCodigo, codigoArticulo]);
                }

                this.m_cerrarModal();
                this.m_notificarAlerta("Clasificación guardada con éxito.", 'exito');
                await this.m_inicializar();

            } catch (err) {
                console.error("Error al actualizar maestro:", err);
                this.m_notificarAlerta("Error al actualizar artículo: " + err.message, 'error');
            }
        };
    },

    m_onRubroModalChange: function(rubroVal, subRubroSeleccionado = '') {
        const selectSub = document.getElementById('sel_subrubro_modal');
        if (!selectSub) return;

        const rubroNorm = _normalizarTextoStock(rubroVal);

        if (!rubroNorm) {
            selectSub.innerHTML = '<option value="">Seleccione un Rubro primero...</option>';
            return;
        }

        const subRubrosDelRubro = [...new Set(
            this.datosOriginales.insumosMaestros
                .filter(i => _normalizarTextoStock(i.rubro) === rubroNorm)
                .map(i => _normalizarTextoStock(i.sub_rubro))
                .filter(sr => sr && sr !== '0' && sr !== 'SIN ASIGNAR')
        )].sort();

        let optionsHTML = '<option value="">Seleccione Sub-Rubro...</option>';
        subRubrosDelRubro.forEach(sr => {
            const isSel = (_normalizarTextoStock(subRubroSeleccionado) === sr) ? 'selected' : '';
            optionsHTML += `<option value="${sr}" ${isSel}>📦 ${sr}</option>`;
        });

        if (subRubroSeleccionado && !subRubrosDelRubro.includes(_normalizarTextoStock(subRubroSeleccionado))) {
            optionsHTML += `<option value="${_normalizarTextoStock(subRubroSeleccionado)}" selected>📦 ${_normalizarTextoStock(subRubroSeleccionado)}</option>`;
        }

        selectSub.innerHTML = optionsHTML;
    },

    m_promptNuevoRubro: function() {
        const nuevo = prompt("Ingrese el nombre del nuevo RUBRO maestro:");
        if (!nuevo || !nuevo.trim()) return;
        const nombreRubro = nuevo.trim().toUpperCase();

        const selectRubro = document.getElementById('sel_rubro_modal');
        if (selectRubro) {
            const opt = new Option(`🏷️ ${nombreRubro}`, nombreRubro, true, true);
            selectRubro.add(opt);
            this.m_onRubroModalChange(nombreRubro, '');
        }
    },

    m_promptNuevoSubRubro: function() {
        const rubroActual = document.getElementById('sel_rubro_modal')?.value;
        if (!rubroActual) {
            alert("Primero seleccione o cree un Rubro.");
            return;
        }

        const nuevo = prompt(`Ingrese el nuevo SUB-RUBRO para [${rubroActual}]:`);
        if (!nuevo || !nuevo.trim()) return;
        const nombreSub = nuevo.trim().toUpperCase();

        const selectSub = document.getElementById('sel_subrubro_modal');
        if (selectSub) {
            const opt = new Option(`📦 ${nombreSub}`, nombreSub, true, true);
            selectSub.add(opt);
        }
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
        const artKeyTarget = _normalizarTextoStock(articulo);

        const desgloseFisico = historialDepositosUnicos.map(depoName => {
            const depoNorm = _normalizarTextoStock(depoName);

            const ent = this.datosOriginales.ingresos
                .filter(x => _normalizarTextoStock(x.articulo) === artKeyTarget && _normalizarTextoStock(x.campo_depo) === depoNorm)
                .reduce((a,c) => a + (parseFloat(c.total) || parseFloat(c.cant) || parseFloat(c.cantidad) || 0), 0);

            const sal = this.datosOriginales.egresos
                .filter(x => _normalizarTextoStock(x.insumo || x.articulo) === artKeyTarget && _normalizarTextoStock(x.deposito_origen) === depoNorm && (!_normalizarTextoStock(x.estado) || _normalizarTextoStock(x.estado) === 'ACTIVO'))
                .reduce((a,c) => a + (parseFloat(c.total_consumo) || parseFloat(c.cantidad) || parseFloat(c.cant) || 0), 0);

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
        const destinosDisponibles = [...new Set(this.datosOriginales.ingresos.map(x => x.campo_depo).filter(Boolean))].filter(d => _normalizarTextoStock(d) !== _normalizarTextoStock(deposito));
        
        const container = document.getElementById('modal-formulario');
        document.getElementById('modal-titulo').innerText = "TRANSFERENCIA DE STOCK ENTRE GALPONES";

        const modalContent = document.querySelector('.modal-apple-content');
        if (modalContent) modalContent.style.maxWidth = '520px';

        const matchStock = this.datosStock.find(x => _normalizarTextoStock(x.articulo) === _normalizarTextoStock(articulo));
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
                        ${this.listaDepositos.filter(x => !destinosDisponibles.includes(x.deposito) && _normalizarTextoStock(x.deposito) !== _normalizarTextoStock(deposito)).map(cat => `<option value="${cat.deposito}">${cat.deposito} (Nuevo Destino)</option>`).join('')}
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

        if (!destino) return alert("⚠️ Seleccione destino.");
        if (cantidad <= 0 || cantidad > stockActual) return alert("⚠️ Cantidad no válida.");

        const btnSubmit = document.getElementById('btn_submit_operacion');
        if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.innerText = "TRASLADANDO..."; }

        try {
            const resMaxEgr = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(reg_local AS INTEGER)) as max_reg FROM egresos_insumos`);
            const maxValEgr = (resMaxEgr.data && resMaxEgr.data[0] && resMaxEgr.data[0].max_reg) ? Number(resMaxEgr.data[0].max_reg) : 0;
            const nuevoRegLocalEgreso = String(maxValEgr + 1);

            const resMaxIng = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(reg_local AS INTEGER)) as max_reg FROM insumos_ingresos`);
            const maxValIng = (resMaxIng.data && resMaxIng.data[0] && resMaxIng.data[0].max_reg) ? Number(resMaxIng.data[0].max_reg) : 0;
            const nuevoRegLocalIngreso = String(maxValIng + 1);

            const fechaActual = new Date().toISOString().split('T')[0];

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

        const matchStock = this.datosStock.find(x => _normalizarTextoStock(x.articulo) === _normalizarTextoStock(articulo));
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
        const cuadrosFiltrados = this.parametros.cuadros.filter(c => _normalizarTextoStock(c.establecimiento) === _normalizarTextoStock(estSel));
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
        if (!estDestino) return alert("⚠️ Seleccione Establecimiento destino.");
        if (cantidad <= 0 || cantidad > stockActual) return alert("⚠️ Cantidad excedida.");
        
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
        const headers = ["ARTICULO", "RUBRO", "SUB-RUBRO", "TOTAL ENTRADAS", "TOTAL CONSUMOS", "STOCK NETO", "UNIDAD"];
        let csvContent = "\uFEFF" + headers.join(";") + "\n";

        this.datosStock.forEach(s => {
            csvContent += [`"${s.articulo}"`, `"${s.rubro || 'SIN RUBRO'}"`, `"${s.sub_rubro || 'SIN SUB-RUBRO'}"`, s.entradas, s.salidas, s.stock_actual, `"${s.unidad}"`].join(";") + "\n";
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
                            <th>RUBRO / SUB-RUBRO</th>
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
                                    <td>${s.rubro || 'SIN RUBRO'} · ${s.sub_rubro || 'SIN SUB-RUBRO'}</td>
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