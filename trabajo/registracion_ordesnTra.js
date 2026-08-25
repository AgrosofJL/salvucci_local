/**
 * ModuloOrdenes: Tablero de Control de Órdenes y Recetas Agronómicas
 * AgroSoft J&L - "Apple Soft Studio" Edition / Tipografía Roboto
 * Mode: Local-First (Engine SQLite IPC) + "No me quites nada" + sincronizado = 0
 */
const ModuloOrdenes = {
    parametros: {
        campos: [],
        cuadros: [],
        insumos: [],
        labores: [],
        ordenes: []
    },
    lotesSeleccionados: [],
    lotesActuales: [],
    rawIngresos: [],
    rawEgresos: [],
    _chartEstado: null,
    _chartInversion: null,
    tablaTabEstado: 'ACTIVAS',

    // Helper IPC para ejecutar SQL en la base SQLite local
    m_ejecutarSqlLocal: async function(sql, params = []) {
        if (window.apiLocal && window.apiLocal.query) {
            return await window.apiLocal.query({ sql, params });
        }
        if (window.electronAPI && window.electronAPI.invoke) {
            return await window.electronAPI.invoke('local-db-query', { sql, params });
        }
        throw new Error("No se encontró el puente IPC con la base de datos base local.");
    },

    m_asegurarModalBase: function() {
        let modal = document.getElementById('modal-agrosoft');
        if (!modal) {
            const modalHTML = `
                <div id="modal-agrosoft" class="modal-overlay" style="display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(18, 22, 28, 0.48); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); z-index: 999999; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box;">
                    <div class="modal-apple-content scroll-apple" style="background: #FFFFFF !important; opacity: 1 !important; border: 1.5px solid #E0DCD4; border-radius: 16px; padding: 24px; width: 95%; max-width: 920px; color: #1D1D1F; box-shadow: 0 10px 25px rgba(0,0,0,0.15); display: flex; flex-direction: column; position: relative; margin: auto; max-height: 90vh; overflow-y: auto;">
                        <div class="modal-header-apple" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid #E0DCD4; padding-bottom: 12px; background: #FFFFFF;">
                            <h3 id="modal-titulo" style="margin: 0; font-size: 1.15rem; font-weight: 800; font-family: 'Roboto', sans-serif; color: #123F2C; letter-spacing: -0.3px;">REGISTRO DE RECETA DE TRABAJO</h3>
                            <button onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background: none; border: none; color: #6E6E73; font-size: 1.5rem; font-weight: bold; cursor: pointer;">&times;</button>
                        </div>
                        <div id="modal-formulario" style="max-height: 75vh; overflow-y: auto; padding-right: 4px; background: #FFFFFF;" class="scroll-apple"></div>
                        <div class="modal-apple-footer" id="modal-acciones-footer" style="display: none;"></div>
                    </div>
                </div>`;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
            modal = document.getElementById('modal-agrosoft');
        }
    },

    m_inicializar: async function() {
        let visor = document.getElementById('pantalla-dinamica') || document.getElementById('contenedor-principal');
        if (!visor) return;

        visor.innerHTML = '<div class="loader-apple" style="font-family:\'Roboto\', sans-serif; text-align:center; padding:50px; color:#1E6B4C; font-weight:600; letter-spacing:0.3px;">Sincronizando Tablero de Control de Órdenes y Recetas (base Local)...</div>';

        try {
            const [resCam, resCua, resIns, resLab, resOrd, resIng] = await Promise.all([
                this.m_ejecutarSqlLocal(`SELECT * FROM campos ORDER BY establecimiento ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM cuadros ORDER BY lote ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM insumos ORDER BY articulo ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM tipos_labores ORDER BY labor ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM egresos_insumos ORDER BY id DESC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM insumos_ingresos`)
            ]);

            this.parametros.campos = resCam.data || resCam || [];
            this.parametros.cuadros = resCua.data || resCua || [];
            this.parametros.labores = resLab.data || resLab || [];
            
            this.rawIngresos = resIng.data || resIng || [];
            this.rawEgresos = resOrd.data || resOrd || []; 

            this.m_calcularStockPorDeposito('DEB_CENTRAL');
            this.parametros.ordenes = this.rawEgresos;

            this.m_dibujarInterfaz();
            this.m_filtrarCascada();
        } catch (err) {
            console.error("Error al inicializar ModuloOrdenes Local:", err);
            visor.innerHTML = `<div style="color:#E0342A; padding:20px; font-family:'Roboto'; border: 1px solid rgba(224,52,42,0.2); background: rgba(224,52,42,0.04); border-radius: 12px;">Error en ModuloOrdenes Local: ${err.message}</div>`;
        }
    },

    m_calcularStockPorDeposito: function(depositoId) {
        const consolidado = {};
        const depoKey = (depositoId || "DEB_CENTRAL").trim().toUpperCase();

        this.rawIngresos.forEach(i => {
            if ((i.campo_depo || "").trim().toUpperCase() !== depoKey) return;
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
        });

        this.rawEgresos.forEach(e => {
            if ((e.estado || 'ACTIVO').toUpperCase() === 'CANCELADO') return; 
            if ((e.deposito_origen || "").trim().toUpperCase() !== depoKey) return;
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
            consolidado[artKey].salidas += Number(e.total_consumo) || 0;
        });

        this.parametros.insumos = Object.values(consolidado).map(s => ({
            ...s,
            stock_actual: s.entradas - s.salidas
        })).sort((a, b) => a.articulo.localeCompare(b.articulo));
    },

    m_cambiarDeposito: function(depositoId) {
        const depoKey = (depositoId || "DEB_CENTRAL").trim().toUpperCase();

        document.querySelectorAll('.producto-row').forEach(row => {
            const selectInsumo = row.querySelector('.p-insumo');
            const inputDepoRow = row.querySelector('.p-deposito');
            
            if (!selectInsumo) return;
            if (selectInsumo.value !== "") return;

            if (inputDepoRow) inputDepoRow.value = depoKey;

            this.m_calcularStockPorDeposito(depoKey);
            const insumosDisponibles = this.parametros.insumos.filter(i => (i.stock_actual || 0) > 0);

            selectInsumo.innerHTML = `<option value="">Insumo...</option>` + insumosDisponibles.map(i => {
                return `<option value="${i.articulo}" data-stock="${i.stock_actual}" data-unidad="${i.unidad}">📦 ${i.articulo.toUpperCase()} (${i.stock_actual} ${i.unidad})</option>`;
            }).join('');

            this.m_actualizarStockLabel(selectInsumo);
        });

        this.m_recalcularTodo();
        this.m_mostrarNotificacion(`Depósito activo: ${depoKey}`, 'exito');
    },

    m_mostrarConfirmacion: function(titulo, mensaje) {
        return new Promise((resolve) => {
            const backdrop = document.createElement('div');
            backdrop.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(18, 22, 28, 0.48); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); z-index: 101000; display: flex; align-items: center; justify-content: center; font-family: 'Roboto', sans-serif; opacity: 0; transition: opacity 0.2s ease;`;

            const modal = document.createElement('div');
            modal.style.cssText = `background: #FFFFFF !important; opacity: 1 !important; border: 1.5px solid #E0DCD4; border-radius: 16px; padding: 24px; width: 90%; max-width: 420px; box-shadow: 0 12px 32px rgba(0,0,0,0.2); transform: scale(0.92); transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1); text-align: center; margin: auto;`;

            modal.innerHTML = `
                <div style="display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; background: rgba(224,134,0,0.1); border-radius: 50%; margin-bottom: 12px;">
                    <span style="font-size:1.4rem; color:#E08600;">❓</span>
                </div>
                <h3 style="margin: 0 0 8px 0; color: #123F2C; font-size: 1.1rem; font-weight: 800;">${titulo.toUpperCase()}</h3>
                <p style="margin: 0 0 20px 0; color: #6B6255; font-size: 0.85rem; line-height: 1.4;">${mensaje}</p>
                <div style="display: flex; gap: 10px; justify-content: center;">
                    <button id="btn-conf-cancelar" style="flex: 1; background: #F0F2F5; border: 1px solid #E0DCD4; color: #1D1D1F; padding: 10px; font-weight: 700; border-radius: 8px; font-size: 0.8rem; cursor: pointer;">CANCELAR</button>
                    <button id="btn-conf-aceptar" style="flex: 1; background: #1E6B4C; border: none; color: #FFFFFF; padding: 10px; font-weight: 700; border-radius: 8px; font-size: 0.8rem; cursor: pointer; box-shadow: 0 4px 12px rgba(30,107,76,0.25);">CONFIRMAR</button>
                </div>
            `;

            backdrop.appendChild(modal);
            document.body.appendChild(backdrop);

            requestAnimationFrame(() => {
                backdrop.style.opacity = '1';
                modal.style.transform = 'scale(1)';
            });

            const cerrarModal = (resultado) => {
                backdrop.style.opacity = '0';
                modal.style.transform = 'scale(0.92)';
                backdrop.addEventListener('transitionend', () => {
                    backdrop.remove();
                    resolve(resultado);
                });
            };

            backdrop.querySelector('#btn-conf-cancelar').onclick = () => cerrarModal(false);
            backdrop.querySelector('#btn-conf-aceptar').onclick = () => cerrarModal(true);
            backdrop.onclick = (e) => { if (e.target === backdrop) cerrarModal(false); };
        });
    },

    m_mostrarNotificacion: function(mensaje, tipo = 'exito') {
        const colorBorde = tipo === 'exito' ? '#1FA958' : '#E0342A'; 
        const icono = tipo === 'exito' ? '✅' : '⚠️';

        const toastHTML = `
            <div id="apple-toast-premium" style="position: fixed; top: 30px; left: 50%; transform: translateX(-50%); background: #FFFFFF; border-left: 4px solid ${colorBorde}; border-top: 1px solid #E0DCD4; border-bottom: 1px solid #E0DCD4; border-right: 1px solid #E0DCD4; border-radius: 14px; padding: 12px 22px; display: flex; align-items: center; gap: 12px; color: #1D1D1F; font-family: 'Roboto', sans-serif; font-size: 0.85rem; font-weight: 600; box-shadow: 0 6px 16px rgba(20,26,36,0.12); z-index: 1000000;">
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

    m_dibujarInterfaz: function() {
        const visor = document.getElementById('pantalla-dinamica') || document.getElementById('contenedor-principal');
        if (!visor) return;

        const estUnicos = [...new Set(this.parametros.campos.map(c => c.establecimiento))].filter(Boolean).sort();
        const rubrosUnicos = [...new Set(this.parametros.labores.map(l => l.rubro).filter(Boolean))].sort();

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

                .ordenes-master-container {
                    font-family: 'Roboto', sans-serif;
                    padding: 8px 18px 25px 18px;
                    color: #1D1D1F;
                    width: 100% !important;
                    box-sizing: border-box;
                    max-height: calc(100vh - 65px);
                    overflow-y: auto;
                }

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
                .badge-tab-orange {
                    background: rgba(224, 134, 0, 0.12); color: #E08600; padding: 2px 7px;
                    border-radius: 12px; font-size: 0.68rem; font-weight: 800;
                }

                /* GRID Y TARJETAS KPI */
                .grid-kpi-ot {
                    display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 12px;
                }
                @media (max-width: 1100px) { .grid-kpi-ot { grid-template-columns: repeat(2, 1fr); } }
                @media (max-width: 600px) { .grid-kpi-ot { grid-template-columns: 1fr; } }

                .kpi-card-ot {
                    background: #FFFFFF; border: 1.5px solid #E0DCD4; border-radius: 12px; padding: 12px 14px;
                    display: flex; flex-direction: column; justify-content: space-between; gap: 4px;
                    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03); transition: transform 0.15s ease, box-shadow 0.15s ease;
                    cursor: pointer;
                }
                .kpi-card-ot:hover { transform: translateY(-2px); box-shadow: 0 6px 14px rgba(0, 0, 0, 0.06); }
                .kpi-header-row { display: flex; justify-content: space-between; align-items: center; }
                .kpi-card-ot .kpi-label { font-size: 0.62rem; color: #6B6255; font-weight: 800; letter-spacing: 0.4px; text-transform: uppercase; }
                
                .kpi-icon-pill {
                    width: 26px; height: 26px; border-radius: 8px; display: flex;
                    align-items: center; justify-content: center; flex-shrink: 0;
                }
                .kpi-card-ot .kpi-value {
                    font-size: 1.25rem; font-weight: 800; color: #1D1D1F; margin: 0; line-height: 1.15; letter-spacing: -0.3px;
                }
                .kpi-subtext { font-size: 0.68rem; color: #8E8E93; font-weight: 500; margin-top: 2px; display: block; }

                .kpi-card-ot.accent-neutral { border-left: 4px solid #4B4F56; }
                .kpi-card-ot.accent-neutral .kpi-icon-pill { background: #F0F2F5; color: #4B4F56; }
                .kpi-card-ot.accent-orange { border-left: 4px solid #E08600; }
                .kpi-card-ot.accent-orange .kpi-icon-pill { background: rgba(224, 134, 0, 0.1); color: #E08600; }
                .kpi-card-ot.accent-green { border-left: 4px solid #1E6B4C; }
                .kpi-card-ot.accent-green .kpi-icon-pill { background: rgba(30, 107, 76, 0.1); color: #1E6B4C; }
                .kpi-card-ot.accent-blue { border-left: 4px solid #0071E3; }
                .kpi-card-ot.accent-blue .kpi-icon-pill { background: rgba(0, 113, 227, 0.08); color: #0071E3; }

                .panel-box-plant {
                    background: #FFFFFF; border: 1.5px solid #E0DCD4; border-radius: 14px; padding: 14px;
                    display: flex; flex-direction: column; gap: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.04);
                }

                .grid-filtros-ot {
                    display: grid;
                    grid-template-columns: 1.8fr repeat(5, 1fr);
                    gap: 8px;
                    background: #F8FAFC;
                    padding: 10px 12px;
                    border-radius: 10px;
                    border: 1px solid #E0DCD4;
                    align-items: center;
                    margin-bottom: 10px;
                }

                @media (max-width: 1200px) {
                    .grid-filtros-ot { grid-template-columns: repeat(3, 1fr); }
                }

                .input-filtro-ot {
                    background: #FFFFFF !important;
                    border: 1px solid #E0DCD4;
                    padding: 6px 8px;
                    border-radius: 8px;
                    color: #1D1D1F;
                    font-size: 0.76rem;
                    outline: none;
                    width: 100%;
                    box-sizing: border-box;
                    font-family: 'Roboto', sans-serif;
                }
                .input-filtro-ot:focus { border-color: #1E6B4C; }

                /* TABLA STICKY */
                .wrapper-tabla-ordenes {
                    max-height: 380px;
                    overflow-y: auto;
                    overflow-x: auto;
                    border-radius: 10px;
                    border: 1px solid #E0DCD4;
                    position: relative;
                }

                .tabla-ordenes-pro {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 0.8rem;
                    text-align: left;
                }

                .tabla-ordenes-pro th {
                    background: #123F2C;
                    color: #FFFFFF;
                    font-weight: 700;
                    font-size: 0.68rem;
                    text-transform: uppercase;
                    letter-spacing: 0.4px;
                    padding: 10px 8px;
                    position: sticky;
                    top: 0;
                    z-index: 10;
                }

                .tabla-ordenes-pro td {
                    padding: 9px 8px;
                    border-bottom: 1px solid #E0DCD4;
                    color: #211C16;
                    vertical-align: middle;
                }

                .tabla-ordenes-pro tbody tr:hover { background: #F8FAFC; }

                .badge-ot-status {
                    padding: 3px 8px;
                    border-radius: 6px;
                    font-size: 0.65rem;
                    font-weight: 800;
                    display: inline-block;
                    letter-spacing: 0.3px;
                    text-transform: uppercase;
                }
                .status-terminado { background: rgba(31,169,88,0.1); color: #1FA958; border: 1px solid rgba(31,169,88,0.25); }
                .status-pendiente { background: rgba(224,134,0,0.1); color: #E08600; border: 1px solid rgba(224,134,0,0.25); }
                .status-en_proceso { background: rgba(0,113,227,0.1); color: #0071E3; border: 1px solid rgba(0,113,227,0.25); }

                .btn-accion-plant {
                    background: var(--color-plant-soft); border: 1px solid rgba(30,107,76,0.25); color: var(--color-plant);
                    padding: 4px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 700; cursor: pointer;
                    display: inline-flex; align-items: center; gap: 4px;
                }
                .btn-accion-plant:hover { background: rgba(30,107,76,0.2); }

                .producto-row { display: grid; grid-template-columns: 1.4fr 2.2fr 1fr 1fr 1fr 1fr 34px; gap: 8px; background: #F8FAFC; padding: 8px 10px; border-radius: 8px; margin-bottom: 6px; align-items: end; border: 1px solid #E0DCD4; }
                .producto-row-header { display: grid; grid-template-columns: 1.4fr 2.2fr 1fr 1fr 1fr 1fr 34px; gap: 8px; padding: 0 10px; margin-bottom: 4px; font-size: 0.62rem; font-weight: 700; color: #6B6255; text-transform: uppercase; }
                .lote-tag { background: rgba(30,107,76,0.1); color: #1E6B4C; border: 1px solid rgba(30,107,76,0.25); padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 6px; font-size: 0.72rem; font-weight: 800; margin: 2px; }
            </style>

            ${ComponentesUI.botonVolverCustomHTML("if(window.ModuloRegistracion) ModuloRegistracion.m_dibujarSelectorInicial(); else ComponentesUI.irACategoria('LABORES');", 'Volver al panel de Registración')}
            <div class="ordenes-master-container animated fadeIn">

                <!-- HEADER SUPERIOR -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top:4px; margin-bottom: 10px; flex-wrap: wrap; gap: 10px;">
                    <div>
                        <h2 style="margin:0; font-weight: 800; font-size: 1.3rem; letter-spacing: -0.5px; color:#123F2C;">Control de Órdenes y Recetas</h2>
                        <p style="margin:2px 0 0 0; font-size:0.75rem; color:#6B6255;">Planificación agronómica y auditoría técnica en campo (base Local)</p>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <button onclick="ModuloOrdenes.m_exportarExcelGlobal()" style="background: #1FA958; color: #FFFFFF; border: none; padding: 7px 14px; border-radius: 8px; font-size: 0.75rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 5px;">
                            <i data-lucide="file-spreadsheet" style="width:13px; height:13px;"></i> Excel
                        </button>
                        <button onclick="ModuloOrdenes.m_exportarPDFGlobal()" style="background: #E0342A; color: #FFFFFF; border: none; padding: 7px 14px; border-radius: 8px; font-size: 0.75rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 5px;">
                            <i data-lucide="file-text" style="width:13px; height:13px;"></i> PDF Reporte
                        </button>
                        <button onclick="window.sincronizar_todo && window.sincronizar_todo()" style="background: #0071E3; color: #FFFFFF; border: none; padding: 7px 14px; border-radius: 8px; font-size: 0.75rem; font-weight: 700; cursor: pointer; display:flex; align-items:center; gap:5px;" title="Sincronizar con base central">
                            <i data-lucide="refresh-cw" style="width:13px; height:13px;"></i> SINCRONIZAR ALL
                        </button>
                        <button onclick="ModuloOrdenes.m_abrirFormulario()" style="background: #1E6B4C; color: #FFFFFF; border: none; padding: 7px 16px; border-radius: 8px; font-size: 0.75rem; font-weight: 700; cursor: pointer; display:flex; align-items:center; gap:6px;">
                            <i data-lucide="plus-circle" style="width:13px; height:13px;"></i> NUEVA RECETA
                        </button>
                    </div>
                </div>

                <!-- TABS ARCHIVERO SUPERIOR -->
                <div class="tabs-header-archivero-main">
                    <div class="tab-main-archivero ${this.tablaTabEstado === 'ACTIVAS' ? 'active' : ''}" onclick="ModuloOrdenes.m_cambiarTabTablaOrdenes('ACTIVAS')">
                        <i data-lucide="clock" style="width:14px; height:14px;"></i>
                        <span>ÓRDENES PENDIENTES / ACTIVAS</span>
                        <span class="badge-tab-orange" id="tab-badge-ot-activas">0</span>
                    </div>
                    <div class="tab-main-archivero ${this.tablaTabEstado === 'TERMINADAS' ? 'active' : ''}" onclick="ModuloOrdenes.m_cambiarTabTablaOrdenes('TERMINADAS')">
                        <i data-lucide="check-circle" style="width:14px; height:14px;"></i>
                        <span>ÓRDENES TERMINADAS</span>
                        <span class="badge-tab-main" id="tab-badge-ot-terminadas">0</span>
                    </div>
                </div>

                <!-- KPIS PRINCIPALES -->
                <div class="grid-kpi-ot">
                    <div class="kpi-card-ot accent-neutral" onclick="ModuloOrdenes.m_filtrarEstadoDirecto('')">
                        <div class="kpi-header-row">
                            <span class="kpi-label">TOTAL ÓRDENES EMITIDAS</span>
                            <div class="kpi-icon-pill">
                                <i data-lucide="clipboard-list" style="width:14px; height:14px;"></i>
                            </div>
                        </div>
                        <div>
                            <h3 class="kpi-value" id="kpi_ot_total_cant">0 OTs</h3>
                            <span class="kpi-subtext" id="kpi_ot_total_has">0.00 Ha Cobertura</span>
                        </div>
                    </div>

                    <div class="kpi-card-ot accent-orange" onclick="ModuloOrdenes.m_filtrarEstadoDirecto('PENDIENTE')">
                        <div class="kpi-header-row">
                            <span class="kpi-label">PENDIENTES DE LABOR</span>
                            <div class="kpi-icon-pill">
                                <i data-lucide="clock" style="width:14px; height:14px;"></i>
                            </div>
                        </div>
                        <div>
                            <h3 class="kpi-value" style="color:#E08600;" id="kpi_ot_pendientes">0</h3>
                            <span class="kpi-subtext">Por ejecutar en lote</span>
                        </div>
                    </div>

                    <div class="kpi-card-ot accent-green" onclick="ModuloOrdenes.m_filtrarEstadoDirecto('TERMINADO')">
                        <div class="kpi-header-row">
                            <span class="kpi-label">ÓRDENES FINALIZADAS</span>
                            <div class="kpi-icon-pill">
                                <i data-lucide="check-check" style="width:14px; height:14px;"></i>
                            </div>
                        </div>
                        <div>
                            <h3 class="kpi-value" style="color:#1E6B4C;" id="kpi_ot_terminadas">0</h3>
                            <span class="kpi-subtext">Aplicadas con éxito</span>
                        </div>
                    </div>

                    <div class="kpi-card-ot accent-blue">
                        <div class="kpi-header-row">
                            <span class="kpi-label">INVERSIÓN TOTAL EN RECETAS</span>
                            <div class="kpi-icon-pill">
                                <i data-lucide="dollar-sign" style="width:14px; height:14px;"></i>
                            </div>
                        </div>
                        <div>
                            <h3 class="kpi-value" style="color:#0071E3;" id="kpi_ot_total_usd">U$S 0.00</h3>
                            <span class="kpi-subtext" id="kpi_ot_total_ars">$ 0.00 ARS</span>
                        </div>
                    </div>
                </div>

                <!-- BARRA DE FILTROS CASCADA -->
                <div class="grid-filtros-ot">
                    <div>
                        <input type="text" id="ot_filtro_texto" placeholder="🔍 OT, Insumo, Campo, Contratista..." oninput="ModuloOrdenes.m_filtrarCascada()" class="input-filtro-ot">
                    </div>
                    <div>
                        <select id="ot_filtro_est" onchange="ModuloOrdenes.m_filtrarCascada()" class="input-filtro-ot">
                            <option value="">🏢 Todos los Establecimientos</option>
                            ${estUnicos.map(e => `<option value="${e}">${e}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <select id="ot_filtro_estado" onchange="ModuloOrdenes.m_filtrarCascada()" class="input-filtro-ot">
                            <option value="">Estado: Todos</option>
                            <option value="PENDIENTE">⏳ Pendientes</option>
                            <option value="EN PROCESO">🚜 En Proceso</option>
                            <option value="TERMINADO">✅ Terminadas</option>
                        </select>
                    </div>
                    <div>
                        <select id="ot_filtro_rubro" onchange="ModuloOrdenes.m_filtrarCascada()" class="input-filtro-ot">
                            <option value="">🛠️ Todos los Rubros</option>
                            ${rubrosUnicos.map(r => `<option value="${r}">${r}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <input type="date" id="ot_filtro_desde" onchange="ModuloOrdenes.m_filtrarCascada()" class="input-filtro-ot" title="Fecha Desde">
                    </div>
                    <div>
                        <input type="date" id="ot_filtro_hasta" onchange="ModuloOrdenes.m_filtrarCascada()" class="input-filtro-ot" title="Fecha Hasta">
                    </div>
                </div>

                <!-- GRÁFICOS ANALÍTICOS -->
                <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 12px; margin-bottom: 12px;">
                    <div class="panel-box-plant" style="padding:12px;">
                        <span style="font-size: 0.72rem; font-weight: 800; color: #123F2C; text-transform:uppercase;">Estado de las Órdenes de Trabajo</span>
                        <div style="height: 160px; position: relative;">
                            <canvas id="chart_ot_estados"></canvas>
                        </div>
                    </div>
                    <div class="panel-box-plant" style="padding:12px;">
                        <span style="font-size: 0.72rem; font-weight: 800; color: #123F2C; text-transform:uppercase;">Inversión por Establecimiento (U$S)</span>
                        <div style="height: 160px; position: relative;">
                            <canvas id="chart_ot_inversion"></canvas>
                        </div>
                    </div>
                </div>

                <!-- TABLA EJECUTIVA CON CABECERAS FIJAS -->
                <div class="panel-box-plant">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 0.75rem; font-weight: 800; color: #123F2C; text-transform:uppercase; letter-spacing:0.4px;">
                            📋 Registro de Órdenes y Recetas Agronómicas
                        </span>
                        <span style="font-size: 0.7rem; background: #F0F2F5; color: #6B6255; padding: 3px 8px; border-radius: 10px; font-weight: 800;" id="lbl_ot_cant_registros">0 Órdenes</span>
                    </div>

                    <div class="wrapper-tabla-ordenes scroll-apple">
                        <table class="tabla-ordenes-pro">
                            <thead>
                                <tr>
                                    <th style="width: 110px;">Estado</th>
                                    <th style="width: 120px;">OT / Ref</th>
                                    <th style="width: 90px;">Fecha</th>
                                    <th>Establecimiento & Campo</th>
                                    <th>Lotes</th>
                                    <th>Labor / CC</th>
                                    <th style="text-align: right; width: 120px;">Costo Total U$S</th>
                                    <th style="text-align: center; width: 90px;">Acciones</th>
                                </tr>
                            </thead>
                            <tbody id="tbody_ot_principal"></tbody>
                            <tfoot>
                                <tr>
                                    <td colspan="6" style="text-align:left; font-weight:800;">TOTAL VISIBLE EN SELECCIÓN:</td>
                                    <td id="ft_ot_usd" style="text-align:right; font-weight:800; color:#1E6B4C; font-family:monospace;">U$S 0.00</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>

            </div>
        `;
        if (window.lucide) lucide.createIcons();
    },

    m_obtenerGruposOrdenes: function(listaOrdenes) {
        const ordenesAgrupadas = [];
        (listaOrdenes || this.parametros.ordenes).forEach(o => {
            const otKey = o.orden_trab || 'SIN-OT';
            const refKey = o.ref_orden || 'SIN-REF';
            
            let existe = ordenesAgrupadas.find(x => String(x.orden_trab) === String(otKey) && String(x.ref_orden) === String(refKey));
            
            if (!existe) {
                ordenesAgrupadas.push({
                    orden_trab: otKey,
                    ref_orden: refKey,
                    fecha: o.fecha || '-',
                    estado: (o.estado || 'PENDIENTE').toUpperCase(),
                    establecimiento: o.establecimiento || '-',
                    campo: o.campo || '-',
                    cuadros: [o.cuadro].filter(Boolean),
                    tipo_labor: o.tipo_labor || o.centro_costo || '-',
                    contratista: o.contratista || '-',
                    costo_final: parseFloat(o.costo_final || o.total_dolar || 0),
                    costo_pesos: parseFloat(o.total_pesos || 0),
                    sup_total: parseFloat(o.sup_uso || 0),
                    filasRaw: [o]
                });
            } else {
                if (o.cuadro && !existe.cuadros.includes(o.cuadro)) {
                    existe.cuadros.push(o.cuadro);
                    existe.sup_total += parseFloat(o.sup_uso || 0);
                }
                existe.costo_final += parseFloat(o.costo_final || o.total_dolar || 0);
                existe.costo_pesos += parseFloat(o.total_pesos || 0);
                existe.filasRaw.push(o);
            }
        });
        return ordenesAgrupadas;
    },

    m_obtenerFiltros: function() {
        return {
            texto: (document.getElementById('ot_filtro_texto')?.value || '').toLowerCase().trim(),
            est: (document.getElementById('ot_filtro_est')?.value || '').toLowerCase(),
            estado: document.getElementById('ot_filtro_estado')?.value || '',
            rubro: (document.getElementById('ot_filtro_rubro')?.value || '').toLowerCase(),
            desde: document.getElementById('ot_filtro_desde')?.value || '',
            hasta: document.getElementById('ot_filtro_hasta')?.value || ''
        };
    },

    m_aplicarFiltros: function(f) {
        const grupos = this.m_obtenerGruposOrdenes();
        return grupos.filter(g => {
            if (f.texto) {
                const otMatch = String(g.orden_trab).toLowerCase().includes(f.texto);
                const refMatch = String(g.ref_orden).toLowerCase().includes(f.texto);
                const estMatch = g.establecimiento.toLowerCase().includes(f.texto);
                const campoMatch = g.campo.toLowerCase().includes(f.texto);
                const conMatch = g.contratista.toLowerCase().includes(f.texto);
                const insMatch = g.filasRaw.some(r => (r.insumo || '').toLowerCase().includes(f.texto));
                if (!otMatch && !refMatch && !estMatch && !campoMatch && !conMatch && !insMatch) return false;
            }
            if (f.est && !g.establecimiento.toLowerCase().includes(f.est)) return false;
            if (f.estado && g.estado !== f.estado) return false;
            if (f.rubro && !g.tipo_labor.toLowerCase().includes(f.rubro)) return false;
            if (f.desde && g.fecha && g.fecha < f.desde) return false;
            if (f.hasta && g.fecha && g.fecha > f.hasta) return false;
            return true;
        });
    },

    m_esGrupoTerminado: function(g) {
        return g.estado === 'TERMINADO' || g.estado === 'FINALIZADO';
    },

    m_filtrarCascada: function() {
        const datosGlobales = this.m_aplicarFiltros(this.m_obtenerFiltros());

        const datosTabla = datosGlobales.filter(g => {
            const terminado = this.m_esGrupoTerminado(g);
            if (this.tablaTabEstado === 'TERMINADAS') return terminado;
            return !terminado;
        });

        this.m_actualizarBadgesTabTablaOrdenes(datosGlobales);
        this.m_renderizarTabla(datosTabla);
        this.m_actualizarKPIs(datosGlobales);
        this.m_renderizarGraficos(datosGlobales);
    },

    m_cambiarTabTablaOrdenes: function(tab) {
        this.tablaTabEstado = tab;
        document.querySelectorAll('.tab-main-archivero').forEach(btn => {
            btn.classList.toggle('active', (tab === 'ACTIVAS' && btn.innerText.includes('ACTIVAS')) || (tab === 'TERMINADAS' && btn.innerText.includes('TERMINADAS')));
        });
        this.m_filtrarCascada();
    },

    m_actualizarBadgesTabTablaOrdenes: function(datosGlobales) {
        const badgeActivas = document.getElementById('tab-badge-ot-activas');
        const badgeTerminadas = document.getElementById('tab-badge-ot-terminadas');
        if (badgeActivas) badgeActivas.innerText = datosGlobales.filter(g => !this.m_esGrupoTerminado(g)).length;
        if (badgeTerminadas) badgeTerminadas.innerText = datosGlobales.filter(g => this.m_esGrupoTerminado(g)).length;
    },

    m_filtrarEstadoDirecto: function(stKey) {
        const selState = document.getElementById('ot_filtro_estado');
        if (selState) selState.value = stKey;

        if (stKey === 'TERMINADO') this.tablaTabEstado = 'TERMINADAS';
        else if (stKey === 'PENDIENTE' || stKey === 'EN PROCESO') this.tablaTabEstado = 'ACTIVAS';

        document.querySelectorAll('.tab-main-archivero').forEach(btn => {
            btn.classList.toggle('active', (this.tablaTabEstado === 'ACTIVAS' && btn.innerText.includes('ACTIVAS')) || (this.tablaTabEstado === 'TERMINADAS' && btn.innerText.includes('TERMINADAS')));
        });

        this.m_filtrarCascada();
    },

    m_renderizarTabla: function(datos) {
        const tbody = document.getElementById('tbody_ot_principal');
        if (!tbody) return;

        const lblCant = document.getElementById('lbl_ot_cant_registros');
        if (lblCant) lblCant.innerText = `${datos.length} Órdenes`;

        if (datos.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 35px; color: #9AA0A6; font-style:italic;">
                        No se encontraron órdenes de trabajo para los filtros seleccionados.
                    </td>
                </tr>`;
            return;
        }

        tbody.innerHTML = datos.map(o => {
            const stClass = `status-${o.estado.toLowerCase().replace(' ', '_')}`;
            return `
                <tr style="cursor: pointer;" onclick="ModuloOrdenes.m_verDetalleFlotante(${o.orden_trab}, '${o.ref_orden}')">
                    <td>
                        <span class="badge-ot-status ${stClass}">${o.estado}</span>
                    </td>
                    <td>
                        <strong style="color:#0071E3; font-size:0.83rem;">OT #${o.orden_trab}</strong>
                        <div style="font-size:0.68rem; color:#6B6255;">Ref: ${o.ref_orden || '-'}</div>
                    </td>
                    <td style="color:#6B6255; font-weight:600;">
                        ${o.fecha}
                    </td>
                    <td>
                        <strong>${o.establecimiento}</strong>
                        <div style="font-size:0.7rem; color:#6B6255;">📍 ${o.campo}</div>
                    </td>
                    <td>
                        <span style="background:rgba(30,107,76,0.1); color:#1E6B4C; padding:2px 6px; border-radius:4px; font-weight:800; font-size:0.72rem;">
                            Lote(s): ${o.cuadros.join(', ') || 'Gral'}
                        </span>
                    </td>
                    <td>
                        <span style="background:#F0F2F5; color:#1D1D1F; padding:2px 7px; border-radius:4px; font-weight:700; font-size:0.72rem;">
                            ${o.tipo_labor}
                        </span>
                    </td>
                    <td style="text-align: right; font-weight: 800; color: #1E6B4C; font-family:monospace;">
                        U$S ${o.costo_final.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}
                    </td>
                    <td style="text-align: center;" onclick="event.stopPropagation();">
                        <button class="btn-accion-plant" onclick="ModuloOrdenes.m_verDetalleFlotante(${o.orden_trab}, '${o.ref_orden}')" title="Ver Detalle de OT">
                            👁️ Ver
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    },

    m_actualizarKPIs: function(datos) {
        let totalUsd = 0, totalArs = 0, totalHas = 0;
        let pendCount = 0, termCount = 0;

        datos.forEach(o => {
            totalUsd += o.costo_final;
            totalArs += o.costo_pesos;
            totalHas += o.sup_total;

            if (o.estado === 'PENDIENTE' || o.estado === 'EN PROCESO') pendCount++;
            if (o.estado === 'TERMINADO' || o.estado === 'FINALIZADO') termCount++;
        });

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
        set('kpi_ot_total_cant', `${datos.length} OTs`);
        set('kpi_ot_total_has', `${totalHas.toFixed(1)} Ha Cobertura`);
        set('kpi_ot_pendientes', pendCount);
        set('kpi_ot_terminadas', termCount);
        set('kpi_ot_total_usd', `U$S ${totalUsd.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`);
        set('kpi_ot_total_ars', `$ ${totalArs.toLocaleString('es-AR', {minimumFractionDigits:0, maximumFractionDigits:0})} ARS`);

        set('ft_ot_usd', `U$S ${totalUsd.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`);
    },

    m_renderizarGraficos: function(datos) {
        if (typeof Chart === 'undefined') return;

        const canvasEst = document.getElementById('chart_ot_estados');
        if (canvasEst) {
            let p = 0, e = 0, t = 0;
            datos.forEach(d => {
                if (d.estado === 'PENDIENTE') p++;
                else if (d.estado === 'EN PROCESO') e++;
                else t++;
            });

            if (this._chartEstado) this._chartEstado.destroy();

            this._chartEstado = new Chart(canvasEst.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: ['Pendientes', 'En Proceso', 'Terminadas'],
                    datasets: [{
                        data: [p, e, t],
                        backgroundColor: ['#E08600', '#0071E3', '#1FA958'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'right', labels: { boxWidth: 10, font: { family: 'Roboto', size: 10 } } }
                    }
                }
            });
        }

        const canvasInv = document.getElementById('chart_ot_inversion');
        if (canvasInv) {
            const porEst = {};
            datos.forEach(d => {
                porEst[d.establecimiento] = (porEst[d.establecimiento] || 0) + d.costo_final;
            });

            const labels = Object.keys(porEst);
            const values = Object.values(porEst);

            if (this._chartInversion) this._chartInversion.destroy();

            this._chartInversion = new Chart(canvasInv.getContext('2d'), {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Inversión USD',
                        data: values,
                        backgroundColor: '#1E6B4C',
                        borderRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { beginAtZero: true, grid: { color: '#E0DCD4' } },
                        x: { grid: { display: false } }
                    }
                }
            });
        }
    },

    m_verDetalleFlotante: function(ot, ref) {
        setTimeout(() => {
            this.m_asegurarModalBase();
            
            const modalContent = document.querySelector('.modal-apple-content');
            if (modalContent) modalContent.style.maxWidth = '920px';

            const registrosOT = this.parametros.ordenes.filter(o => String(o.orden_trab) === String(ot) && (o.ref_orden || 'SIN-REF').toString() === ref.toString());
            if (registrosOT.length === 0) return;

            const infoCabecera = registrosOT[0];
            const container = document.getElementById('modal-formulario');
            const titulo = document.getElementById('modal-titulo');
            
            if (titulo) {
                titulo.innerText = `DETALLE DE ORDEN DE TRABAJO N° ${ot}`;
            }

            let htmlDetalleInsumos = `
                <div style="margin-top: 14px; background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px;">
                    <span style="font-size:0.68rem; font-weight:800; display:block; margin-bottom:8px; color:#123F2C; letter-spacing:0.4px; text-transform: uppercase;">Insumos Asignados y Dosificación</span>
                    <table style="width:100%; font-size:0.8rem; border-collapse:collapse;">
                        <thead>
                            <tr style="border-bottom:2px solid #E0DCD4; color:#6B6255; font-size:0.68rem; font-weight:700;">
                                <th align="left" style="padding:8px 6px;">CUADRO</th>
                                <th align="left" style="padding:8px 6px;">INSUMO RECETADO</th>
                                <th align="center" style="padding:8px 6px;">DOSIS/HA</th>
                                <th align="right" style="padding:8px 6px;">CONSUMO</th>
                                <th align="right" style="padding:8px 6px;">U$S TOTAL</th>
                                <th align="right" style="padding:8px 6px;">$ ARS TOTAL</th>
                                <th align="center" style="padding:8px 6px;">ESTADO</th>
                                <th align="center" style="padding:8px 6px; width:75px;">ACCIONES</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            registrosOT.forEach(r => {
                const estadoActivo = (r.estado || 'PENDIENTE').toUpperCase(); 
                htmlDetalleInsumos += `
                    <tr style="border-bottom:1px solid #E0DCD4;">
                        <td style="padding:7px 6px; font-weight:700;">Lote ${r.cuadro} <small style="color:#6B6255;">(${r.sup_uso} ha)</small></td>
                        <td style="padding:7px 6px; color:#123F2C; font-weight:700;">🌱 ${r.insumo} <small style="color:#6B6255;">[${r.deposito_origen || 'S/D'}]</small></td>
                        <td align="center" style="padding:7px 6px;">${parseFloat(r.dosis_ha || 0).toFixed(2)}</td>
                        <td align="right" style="padding:7px 6px; color:#E0342A; font-weight:700;">${parseFloat(r.total_consumo || 0).toFixed(2)}</td>
                        <td align="right" style="padding:7px 6px; color:#1E6B4C; font-weight:800;">U$S ${parseFloat(r.total_dolar || 0).toFixed(2)}</td>
                        <td align="right" style="padding:7px 6px; font-weight:600;">$ ${parseFloat(r.total_pesos || 0).toFixed(0)}</td>
                        <td align="center" style="padding:7px 6px;"><span class="badge-ot-status status-${estadoActivo.toLowerCase().replace(' ', '_')}">${estadoActivo}</span></td>
                        <td align="center" style="padding:7px 6px;">
                            <div style="display:inline-flex; gap:4px;">
                                <button class="btn-accion-plant" onclick="ModuloOrdenes.m_editarFilaRegistro(${r.id})" title="Editar insumo">✏️</button>
                                <button class="btn-accion-plant" style="color:#E0342A; border-color:rgba(224,52,42,0.25);" onclick="ModuloOrdenes.m_eliminarFilaRegistro(${r.id}, ${r.orden_trab}, '${r.ref_orden || 'SIN-REF'}')" title="Eliminar fila">🗑️</button>
                            </div>
                        </td>
                    </tr>
                `;
            });

            htmlDetalleInsumos += `</tbody></table></div>`;

            if (container) {
                container.innerHTML = `
                    <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-size:0.68rem; font-weight:800; color:#123F2C; text-transform: uppercase;">Datos Generales de Cabecera</span>
                            <button type="button" onclick="ModuloOrdenes.m_editarCabeceraForm(${ot}, '${ref}')" class="btn-accion-plant">
                                ⚙️ Editar Cabecera
                            </button>
                        </div>

                        <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; background:#F8FAFC; padding:12px; border-radius:10px; border:1px solid #E0DCD4; font-size:0.8rem;">
                            <div><label style="color:#6B6255; font-size:0.65rem; font-weight:700; text-transform:uppercase;">Fecha Emisión</label><p style="margin:2px 0; font-weight:700;">${infoCabecera.fecha}</p></div>
                            <div><label style="color:#6B6255; font-size:0.65rem; font-weight:700; text-transform:uppercase;">Ref Orden</label><p style="margin:2px 0; font-weight:700; color:#0071E3;">#${infoCabecera.ref_orden || '-'}</p></div>
                            <div><label style="color:#6B6255; font-size:0.65rem; font-weight:700; text-transform:uppercase;">Establecimiento</label><p style="margin:2px 0; font-weight:700;">${infoCabecera.establecimiento}</p></div>
                            <div><label style="color:#6B6255; font-size:0.65rem; font-weight:700; text-transform:uppercase;">Estado</label><div style="margin:2px 0;"><span class="badge-ot-status status-${infoCabecera.estado.toLowerCase().replace(' ', '_')}">${infoCabecera.estado}</span></div></div>
                            <div><label style="color:#6B6255; font-size:0.65rem; font-weight:700; text-transform:uppercase;">Labor</label><p style="margin:2px 0; font-weight:700;">${infoCabecera.tipo_labor}</p></div>
                            <div><label style="color:#6B6255; font-size:0.65rem; font-weight:700; text-transform:uppercase;">Contratista</label><p style="margin:2px 0; font-weight:700;">${infoCabecera.contratista || '-'}</p></div>
                            <div><label style="color:#6B6255; font-size:0.65rem; font-weight:700; text-transform:uppercase;">Cotización</label><p style="margin:2px 0; font-weight:700; color:#0071E3;">$ ${infoCabecera.cotizacion}</p></div>
                            <div><label style="color:#6B6255; font-size:0.65rem; font-weight:700; text-transform:uppercase;">Inversión OT Total</label><p style="margin:2px 0; font-weight:900; color:#1E6B4C; font-size:1.1rem;">U$S ${registrosOT.reduce((a,c)=>a+parseFloat(c.costo_final||0),0).toFixed(2)}</p></div>
                        </div>

                        ${htmlDetalleInsumos}

                        <div style="display:flex; gap:8px; justify-content:flex-end; align-items:center; border-top:1px solid #E0DCD4; padding-top:12px; margin-top:8px;">
                            <button onclick="ModuloOrdenes.m_exportarVoucherOTExcel(${ot}, '${ref}')" style="background:#1FA958; color:#FFF; border:none; padding:7px 12px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer;">
                                🗂️ Excel OT
                            </button>
                            <button style="background:#1E6B4C; color:#FFFFFF; border:none; padding:7px 14px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer;" onclick="ModuloOrdenes.m_imprimirVoucherOTPDF(${ot}, '${ref}')">
                                🖨️ Imprimir Receta (PDF)
                            </button>
                            ${infoCabecera.estado !== 'TERMINADO' ? `
                                <button style="background:#0071E3; color:white; border:none; padding:7px 14px; border-radius:8px; font-weight:700; cursor:pointer; font-size:0.75rem;" onclick="ModuloOrdenes.m_finalizarProcesoCompleto(${ot}, '${ref}')">
                                    ✅ Finalizar Orden
                                </button>
                            ` : ''}
                            <button onclick="document.getElementById('modal-agrosoft').style.display = 'none';" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:7px 12px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer;">
                                Cerrar
                            </button>
                        </div>
                    </div>
                `;
            }
            
            document.getElementById('modal-agrosoft').style.display = 'flex';
        }, 10);
    },

    m_eliminarFilaRegistro: async function(idRegistro, ot, ref) {
        const confirma = await this.m_mostrarConfirmacion(
            "Eliminar Insumo",
            "¿Desea eliminar este insumo de la orden de trabajo? Se recalcularán los totales en la base local."
        );

        if (!confirma) return;

        try {
            await this.m_ejecutarSqlLocal(`DELETE FROM egresos_insumos WHERE id = ? OR reg_local = ?`, [idRegistro, idRegistro]);

            this.m_mostrarNotificacion("Insumo eliminado con éxito.", "exito");
            await this.m_inicializar();

            const restantes = this.parametros.ordenes.filter(o => String(o.orden_trab) === String(ot) && (o.ref_orden || 'SIN-REF').toString() === ref.toString());
            if (restantes.length > 0) {
                this.m_verDetalleFlotante(ot, ref);
            } else {
                document.getElementById('modal-agrosoft').style.display = 'none';
            }
        } catch (err) {
            this.m_mostrarNotificacion("Error al eliminar registro local: " + err.message, "error");
        }
    },

    m_editarCabeceraForm: function(ot, ref) {
        const registrosOT = this.parametros.ordenes.filter(o => String(o.orden_trab) === String(ot) && (o.ref_orden || 'SIN-REF').toString() === ref.toString());
        if (registrosOT.length === 0) return;

        const infoCabecera = registrosOT[0];
        const modalForm = document.getElementById('modal-formulario');
        const modalTitulo = document.getElementById('modal-titulo');

        if (modalTitulo) modalTitulo.innerText = "CONFIGURACIÓN DE CABECERA DE OT";
        
        const estUnicos = [...new Set(this.parametros.campos.map(c => c.establecimiento).filter(Boolean))];
        const rubrosUnicos = [...new Set(this.parametros.labores.map(l => l.rubro).filter(Boolean))];

        if (modalForm) {
            modalForm.innerHTML = `
                <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                    <div style="background:rgba(30,107,76,0.08); border-left:4px solid #1E6B4C; padding:10px 12px; border-radius:8px; font-size:0.8rem;">
                        El cambio impactará en las <strong>${registrosOT.length} filas</strong> de insumos asociadas a esta OT.
                    </div>

                    <div style="background:#F8FAFC; border:1px solid #E0DCD4; padding:12px; border-radius:10px; display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                        <div>
                            <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Fecha Planificación</label>
                            <input type="date" id="cab_edit_fecha" value="${infoCabecera.fecha || ''}" class="input-filtro-ot" style="padding:8px;">
                        </div>
                        <div>
                            <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Ref Orden</label>
                            <input type="number" id="cab_edit_ref_orden" value="${infoCabecera.ref_orden || ''}" class="input-filtro-ot" style="padding:8px;">
                        </div>
                    </div>

                    <div style="background:#F8FAFC; border:1px solid #E0DCD4; padding:12px; border-radius:10px; display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                        <div>
                            <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Establecimiento</label>
                            <select id="cab_edit_establecimiento" class="input-filtro-ot" style="padding:8px;">
                                <option value="">Seleccione...</option>
                                ${estUnicos.map(e => `<option value="${e.toUpperCase()}" ${e.toUpperCase() === (infoCabecera.establecimiento || '').trim().toUpperCase() ? 'selected' : ''}>🏢 ${e.toUpperCase()}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Estado General</label>
                            <select id="cab_edit_estado" class="input-filtro-ot" style="padding:8px; font-weight:700; color:#E08600;">
                                <option value="PENDIENTE" ${infoCabecera.estado === 'PENDIENTE' ? 'selected' : ''}>⏳ PENDIENTE</option>
                                <option value="EN PROCESO" ${infoCabecera.estado === 'EN PROCESO' ? 'selected' : ''}>🚜 EN PROCESO</option>
                                <option value="TERMINADO" ${infoCabecera.estado === 'TERMINADO' ? 'selected' : ''}>✅ TERMINADO</option>
                            </select>
                        </div>
                    </div>

                    <div style="background:#F8FAFC; border:1px solid #E0DCD4; padding:12px; border-radius:10px; display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                        <div>
                            <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Labor Principal / CC</label>
                            <select id="cab_edit_tipo_labor" class="input-filtro-ot" style="padding:8px;">
                                <option value="">Seleccione...</option>
                                ${rubrosUnicos.map(r => `<option value="${r.toUpperCase()}" ${r.toUpperCase() === (infoCabecera.tipo_labor || '').trim().toUpperCase() ? 'selected' : ''}>🛠️ ${r.toUpperCase()}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label style="font-size:0.65rem; color:#0071E3; font-weight:700; text-transform:uppercase;">Cotización ($)</label>
                            <input type="number" id="cab_edit_cotizacion" value="${infoCabecera.cotizacion || 1200}" class="input-filtro-ot" style="padding:8px; color:#0071E3; font-weight:700;">
                        </div>
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Contratista Aplicador</label>
                        <input type="text" id="cab_edit_contratista" value="${infoCabecera.contratista || ''}" class="input-filtro-ot" style="padding:8px; text-transform:uppercase;">
                    </div>

                    <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid #E0DCD4; padding-top:12px; margin-top:4px;">
                        <button type="button" onclick="ModuloOrdenes.m_verDetalleFlotante(${ot}, '${ref}')" style="background:#F0F2F5; font-size:0.75rem; border-radius:8px; padding:8px 16px; color:#1D1D1F; border:1px solid #E0DCD4; cursor:pointer; font-weight:700;">CANCELAR</button>
                        <button type="button" onclick="ModuloOrdenes.m_guardarCabeceraCompleta(${ot}, '${ref}', this)" style="background:#1E6B4C; font-size:0.75rem; border-radius:8px; padding:8px 20px; color:#FFFFFF; border:none; cursor:pointer; font-weight:700; box-shadow:0 4px 12px rgba(30,107,76,0.25);">
                            GUARDAR CAMBIOS
                        </button>
                    </div>
                </div>
            `;
        }
    },

    m_guardarCabeceraCompleta: async function(ot, ref, btnElement) {
    const nuevaFecha = document.getElementById('cab_edit_fecha')?.value;
    const refVal = document.getElementById('cab_edit_ref_orden')?.value;
    const nuevaRef = refVal && refVal.trim() !== '' ? parseInt(refVal, 10) : null;
    const nuevoEstablecimiento = (document.getElementById('cab_edit_establecimiento')?.value || '').trim().toUpperCase();
    const nuevoEstado = document.getElementById('cab_edit_estado')?.value;
    const nuevaLabor = (document.getElementById('cab_edit_tipo_labor')?.value || '').trim().toUpperCase();
    const nuevoContratista = (document.getElementById('cab_edit_contratista')?.value || '').trim().toUpperCase();
    const nuevaCotizacion = parseFloat(document.getElementById('cab_edit_cotizacion')?.value);

    if (!nuevaFecha || !nuevoEstablecimiento || !nuevaLabor || isNaN(nuevaCotizacion) || nuevaCotizacion <= 0) {
        return this.m_mostrarNotificacion("Complete los campos obligatorios.", "error");
    }

    try {
        const refParam = ref === 'SIN-REF' ? null : ref;

        const sqlUpdate = `
            UPDATE egresos_insumos SET
                fecha = ?, 
                ref_orden = ?, 
                establecimiento = ?, 
                estado = ?,
                tipo_labor = ?, 
                centro_costo = ?, 
                contratista = ?, 
                cotizacion = ?,
                total_pesos = ROUND(total_dolar * ?, 4), 
                sincronizado = 0
            WHERE orden_trab = ? AND (ref_orden = ? OR (? IS NULL AND ref_orden IS NULL))
        `;

        await this.m_ejecutarSqlLocal(sqlUpdate, [
            nuevaFecha, 
            nuevaRef, 
            nuevoEstablecimiento, 
            nuevoEstado,
            nuevaLabor, 
            nuevaLabor, 
            nuevoContratista, 
            nuevaCotizacion,
            nuevaCotizacion, 
            ot, 
            refParam, 
            refParam
        ]);

        this.m_mostrarNotificacion("Cabecera y totales actualizados con éxito.", "exito");
        await this.m_inicializar();
        
        if (typeof this.m_verDetalleFlotante === 'function') {
            this.m_verDetalleFlotante(ot, nuevaRef !== null ? nuevaRef : 'SIN-REF');
        }
    } catch (err) {
        console.error("❌ Error al guardar cabecera:", err);
        this.m_mostrarNotificacion("Error al actualizar cambios locales: " + err.message, "error");
    }
},

    m_editarFilaRegistro: async function(idRegistro) {
        const reg = this.parametros.ordenes.find(o => String(o.id) === String(idRegistro) || String(o.reg_local) === String(idRegistro));
        if (!reg) return;

        this.m_asegurarModalBase();

        const modalTitulo = document.getElementById('modal-titulo');
        const modalForm = document.getElementById('modal-formulario');
        const modalOverlay = document.getElementById('modal-agrosoft');

        if (modalTitulo) modalTitulo.innerText = "MODIFICAR CONTROL DE INSUMO";

        const deppsIngresosUnicos = [...new Set(this.rawIngresos.map(i => (i.campo_depo || '').trim().toUpperCase()).filter(Boolean))].sort();
        const rubrosUnicos = [...new Set(this.parametros.labores.map(l => l.rubro).filter(Boolean))];
        const cuadrosDelCampo = this.parametros.cuadros.filter(c => (c.campo || '').trim().toUpperCase() === (reg.campo || '').trim().toUpperCase());
        
        const depActual = (reg.deposito_origen || 'DEB_CENTRAL').toUpperCase();
        this.m_calcularStockPorDeposito(depActual);
        
        const insumosDisponibles = this.parametros.insumos.filter(i => (i.stock_actual || 0) > 0 || i.articulo.trim().toUpperCase() === reg.insumo.trim().toUpperCase());
        
        const opcionesDepoHtml = deppsIngresosUnicos.map(dep => `<option value="${dep}" ${dep === depActual ? 'selected' : ''}>🏢 ${dep}</option>`).join('');
        const opcionesRubroHtml = rubrosUnicos.map(rub => `<option value="${rub.toUpperCase()}" ${rub.toUpperCase() === (reg.tipo_labor || '').trim().toUpperCase() ? 'selected' : ''}>🛠️ ${rub.toUpperCase()}</option>`).join('');
        
        const opcionesCuadrosHtml = cuadrosDelCampo.map(c => `
            <option value="${c.lote}" data-sup="${c.sup}" ${c.lote.toString() === (reg.cuadro || '').toString() ? 'selected' : ''}>
                🌾 LOTE N° ${c.lote} (${c.sup} Ha)
            </option>
        `).join('');

        const opcionesInsumosHtml = insumosDisponibles.map(i => {
            const esElActual = i.articulo.trim().toUpperCase() === reg.insumo.trim().toUpperCase();
            return `<option value="${i.articulo.replace(/"/g, '&quot;')}" data-stock="${i.stock_actual}" data-unidad="${i.unidad}" ${esElActual ? 'selected' : ''}>📦 ${i.articulo.toUpperCase()} (${i.stock_actual} ${i.unidad || 'u'})</option>`;
        }).join('');

        if (modalForm) {
            modalForm.innerHTML = `
                <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                    <div style="background:rgba(30,107,76,0.08); padding:10px 12px; border-radius:8px; font-size:0.8rem; color: #123F2C;">
                        <strong>Ubicación:</strong> ${reg.establecimiento.toUpperCase()} &rsaquo; ${reg.campo.toUpperCase()}
                    </div>
                    
                    <div style="background:#F8FAFC; border:1px solid #E0DCD4; padding:12px; border-radius:10px; display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                        <div>
                            <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">OT N°</label>
                            <input type="number" id="edit_orden_trab" value="${reg.orden_trab}" class="input-filtro-ot" style="padding:8px; font-weight:700; color:#0071E3;">
                        </div>
                        <div>
                            <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">REF N°</label>
                            <input type="number" id="edit_ref_orden" value="${reg.ref_orden || ''}" class="input-filtro-ot" style="padding:8px;">
                        </div>
                    </div>

                    <div style="background:#F8FAFC; border:1px solid #E0DCD4; padding:12px; border-radius:10px; display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                        <div>
                            <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Fecha</label>
                            <input type="date" id="edit_fecha" value="${reg.fecha || ''}" class="input-filtro-ot" style="padding:8px;">
                        </div>
                        <div>
                            <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Cotización Divisa ($)</label>
                            <input type="number" id="edit_cotizacion" value="${reg.cotizacion || 1200}" class="input-filtro-ot" style="padding:8px;">
                        </div>
                    </div>

                    <div style="background:#F8FAFC; border:1px solid #E0DCD4; padding:12px; border-radius:10px; display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                        <div>
                            <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Depósito</label>
                            <select id="edit_deposito_select" class="input-filtro-ot" style="padding:8px;">${opcionesDepoHtml}</select>
                        </div>
                        <div>
                            <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Tipo Labor</label>
                            <select id="edit_tipo_labor_select" class="input-filtro-ot" style="padding:8px;">${opcionesRubroHtml}</select>
                        </div>
                    </div>

                    <div style="background:#F8FAFC; border:1px solid #E0DCD4; padding:12px; border-radius:10px;">
                        <label style="font-size:0.65rem; color:#123F2C; font-weight:800; text-transform:uppercase;">Cuadro / Lote Asignado</label>
                        <select id="edit_cuadro_select" class="input-filtro-ot" style="padding:8px; font-weight:700;">
                            ${opcionesCuadrosHtml}
                        </select>
                    </div>

                    <div style="background:#F8FAFC; border:1px solid #E0DCD4; padding:12px; border-radius:10px;">
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Insumo Recetado</label>
                        <select id="edit_insumo_select" onchange="ModuloOrdenes.m_actualizarStockLabel(this)" class="input-filtro-ot" style="padding:8px;">
                            <option value="">Insumo...</option>
                            ${opcionesInsumosHtml}
                        </select>
                        <div style="display: flex; justify-content: space-between; margin-top: 4px; padding: 0 2px;">
                            <div class="stock-indicator" style="font-size: 0.65rem; color: #6B6255;">Stock disponible: -</div>
                            <div id="edit_depo_badge" style="font-size: 0.63rem; color: #1E6B4C; font-weight: 700;">🏢 ${depActual}</div>
                        </div>
                    </div>

                    <div style="background:#F8FAFC; border:1px solid #E0DCD4; padding:12px; border-radius:10px; display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                        <div>
                            <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Dosis por Ha</label>
                            <input type="number" id="edit_dosis_ha_input" value="${reg.dosis_ha}" step="0.01" min="0" class="input-filtro-ot" style="padding:8px;">
                        </div>
                        <div>
                            <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Precio Unitario (U$S)</label>
                            <input type="number" id="edit_imp_uni_input" value="${reg.imp_uni}" step="0.001" min="0" class="input-filtro-ot" style="padding:8px;">
                        </div>
                    </div>

                    <div style="display:flex; justify-content:flex-end; gap:8px; border-top:1px solid #E0DCD4; padding-top:12px; margin-top:4px;">
                        <button type="button" onclick="ModuloOrdenes.m_verDetalleFlotante(${reg.orden_trab}, '${reg.ref_orden || 'SIN-REF'}')" style="background:#F0F2F5; font-size:0.75rem; border-radius:8px; padding:8px 16px; color:#1D1D1F; border:1px solid #E0DCD4; cursor:pointer; font-weight:700;">CANCELAR</button>
                        <button type="button" id="btn_confirmar_dosis_update" style="background:#1E6B4C; font-size:0.75rem; border-radius:8px; padding:8px 20px; color:#FFFFFF; border:none; cursor:pointer; font-weight:700; box-shadow:0 4px 12px rgba(30,107,76,0.25);">APLICAR CAMBIOS</button>
                    </div>
                </div>
            `;
        }

        if (modalOverlay) modalOverlay.style.display = 'flex';

        const selectInsumoEdit = document.getElementById('edit_insumo_select');
        if (selectInsumoEdit) this.m_actualizarStockLabel(selectInsumoEdit);

        const btnGuardar = document.getElementById('btn_confirmar_dosis_update');
        if (btnGuardar) {
            btnGuardar.onclick = async () => {
                const nuevoInsumo = (document.getElementById('edit_insumo_select')?.value || '').trim().toUpperCase();
                const nuevaDosis = parseFloat(document.getElementById('edit_dosis_ha_input').value);
                const nuevoValorUss = parseFloat(document.getElementById('edit_imp_uni_input').value);
                const cotizacionNum = parseFloat(document.getElementById('edit_cotizacion').value);
                const otNum = parseInt(document.getElementById('edit_orden_trab').value, 10);
                const refNum = document.getElementById('edit_ref_orden').value ? parseInt(document.getElementById('edit_ref_orden').value, 10) : null;
                const nuevaFecha = document.getElementById('edit_fecha').value;
                const nuevoDeposito = document.getElementById('edit_deposito_select').value.toUpperCase();
                const nuevoTipoLabor = document.getElementById('edit_tipo_labor_select').value.toUpperCase();
                
                const selectCuadro = document.getElementById('edit_cuadro_select');
                const nuevoCuadro = selectCuadro.value;
                const opcionCuadroSeleccionada = selectCuadro.options[selectCuadro.selectedIndex];
                const supLote = opcionCuadroSeleccionada ? parseFloat(opcionCuadroSeleccionada.getAttribute('data-sup')) : parseFloat(reg.sup_uso);

                if (!otNum || !nuevaFecha || !nuevoInsumo || isNaN(nuevaDosis) || isNaN(nuevoValorUss) || !nuevoCuadro) {
                    return this.m_mostrarNotificacion("Verifique los datos ingresados.", "error");
                }

                btnGuardar.disabled = true;
                btnGuardar.innerText = "GUARDANDO...";

                const nuevoConsumo = supLote * nuevaDosis;
                const nuevoTotalDolar = nuevoConsumo * nuevoValorUss; 
                const nuevoTotalPesos = nuevoTotalDolar * cotizacionNum;
                const tieneApoyo = parseFloat(reg.ha_apoyo) > 0;
                const apoyoFilaDolar = tieneApoyo ? (supLote * (parseFloat(reg.total_apoyo) / parseFloat(reg.ha_apoyo))) : 0;
                const costoMoOriginal = supLote * (parseFloat(reg.costo_ha) || 0);
                const costoFinalFila = nuevoTotalDolar + costoMoOriginal + apoyoFilaDolar;
                const costoFinalHaDolar = supLote > 0 ? (costoFinalFila / supLote) : 0;

                try {
                    const sqlUpdate = `
                        UPDATE egresos_insumos SET
                            orden_trab = ?, ref_orden = ?, fecha = ?, deposito_origen = ?,
                            tipo_labor = ?, centro_costo = ?, cuadro = ?, sup_uso = ?,
                            insumo = ?, imp_uni = ?, dosis_ha = ?, cotizacion = ?,
                            total_consumo = ?, total_dolar = ?, total_pesos = ?,
                            costo_final = ?, costo_final_ha_dolar = ?, comentario = ?,
                            sincronizado = 0
                        WHERE id = ? OR reg_local = ?
                    `;

                    await this.m_ejecutarSqlLocal(sqlUpdate, [
                        otNum, refNum, nuevaFecha, nuevoDeposito,
                        nuevoTipoLabor, nuevoTipoLabor, nuevoCuadro, supLote,
                        nuevoInsumo, nuevoValorUss, nuevaDosis, cotizacionNum,
                        nuevoConsumo, nuevoTotalDolar, nuevoTotalPesos,
                        costoFinalFila, costoFinalHaDolar, `Modificado desde panel de control. Lote: ${nuevoCuadro}.`,
                        reg.id, reg.reg_local
                    ]);

                    this.m_mostrarNotificacion("Registro actualizado con éxito en base local.", "exito");
                    await this.m_inicializar();
                    this.m_verDetalleFlotante(otNum, refNum || 'SIN-REF');
                } catch (err) {
                    console.error("❌ Error al guardar edición de insumo:", err);
                    this.m_mostrarNotificacion("Error al guardar: " + err.message, "error");
                    btnGuardar.disabled = false;
                    btnGuardar.innerText = "APLICAR CAMBIOS";
                }
            };
        }
    },

    m_finalizarProcesoCompleto: async function(ot, ref) {
        const confirma = await this.m_mostrarConfirmacion(
            "Finalizar Orden", 
            `¿Estás seguro de dar por TERMINADA la Orden de Trabajo N° ${ot}?`
        );
        
        if (!confirma) return; 

        try {
            await this.m_ejecutarSqlLocal(
                `UPDATE egresos_insumos SET estado = 'TERMINADO', sincronizado = 0 WHERE orden_trab = ?`,
                [ot]
            );

            this.m_mostrarNotificacion(`Proceso finalizado con éxito para la OT N° ${ot}!`, 'exito');
            
            const modalAgrosoft = document.getElementById('modal-agrosoft');
            if (modalAgrosoft) modalAgrosoft.style.display = 'none';
            
            await this.m_inicializar(); 
        } catch (err) {
            console.error("❌ Error al finalizar OT:", err);
            this.m_mostrarNotificacion("Error al finalizar proceso local: " + err.message, 'error');
        }
    },

    m_abrirFormulario: function() {
        setTimeout(() => {
            this.m_asegurarModalBase();

            const modalContent = document.querySelector('.modal-apple-content');
            if (modalContent) modalContent.style.maxWidth = '920px';

            this.lotesSeleccionados = [];
            const container = document.getElementById('modal-formulario');
            const titulo = document.getElementById('modal-titulo');
            
            if (titulo) {
                titulo.innerText = 'CONFECCIÓN DE RECETA DE APLICACIÓN';
            }
            
            const estUnicos = [...new Set(this.parametros.campos.map(c => c.establecimiento).filter(Boolean))];
            const rubrosUnicos = [...new Set(this.parametros.labores.map(l => l.rubro).filter(Boolean))];

            if (container) {
                container.innerHTML = `
                    <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                        <div class="tabs-header-archivero-main" style="margin-bottom:8px;">
                            <div class="tab-main-archivero active" data-tab="1" onclick="ModuloOrdenes.m_cambiarTabReceta(1)"><span>1. DATOS GENERALES</span></div>
                            <div class="tab-main-archivero" data-tab="2" onclick="ModuloOrdenes.m_cambiarTabReceta(2)"><span>2. RECETA DE INSUMOS</span> <span class="badge-tab-main" id="tab-badge-insumos">0</span></div>
                            <div class="tab-main-archivero" data-tab="3" onclick="ModuloOrdenes.m_cambiarTabReceta(3)"><span>3. APLICACIÓN Y COSTOS</span></div>
                        </div>

                        <div class="panel-box-plant" style="padding:14px;">

                            <!-- PASO 1 -->
                            <div class="tab-panel-receta activo" data-panel="1">
                                <div style="display:grid; grid-template-columns: repeat(12, 1fr); gap: 10px;">
                                    <div style="grid-column: span 6;">
                                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Rubro Operativo</label>
                                        <select id="rec_rubro" onchange="ModuloOrdenes.m_filtrarLaboresPorRubro(this.value)" class="input-filtro-ot">
                                            <option value="">Seleccione Rubro...</option>
                                            ${rubrosUnicos.map(r => `<option value="${r}">${r}</option>`).join('')}
                                        </select>
                                    </div>
                                    <div style="grid-column: span 6;"><label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Tipo Labor</label><select id="rec_tipo_app" class="input-filtro-ot"><option value="">Seleccione Rubro...</option></select></div>

                                    <div style="grid-column: span 3;"><label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Orden Trabajo</label><input type="number" id="rec_orden_cab" placeholder="4500" class="input-filtro-ot" style="font-weight:700; color:#0071E3;"></div>
                                    <div style="grid-column: span 3;"><label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Ref Orden</label><input type="number" id="rec_ref_orden" placeholder="102" class="input-filtro-ot"></div>
                                    <div style="grid-column: span 3;"><label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Fecha Planificación</label><input type="date" id="rec_fecha" value="${new Date().toISOString().split('T')[0]}" class="input-filtro-ot"></div>
                                    <div style="grid-column: span 3;"><label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Estado Aplicación</label><select id="rec_estado" class="input-filtro-ot" style="font-weight:700; color:#E08600;"><option value="PENDIENTE">⏳ PENDIENTE</option><option value="EN PROCESO">🚜 EN PROCESO</option><option value="TERMINADO">✅ TERMINADO</option></select></div>

                                    <div style="grid-column: span 6;"><label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Establecimiento</label><select id="rec_est" onchange="ModuloOrdenes.m_filtrarCampos(this.value)" class="input-filtro-ot"><option value="">Seleccione...</option>${estUnicos.map(e => `<option value="${e}">${e}</option>`).join('')}</select></div>
                                    <div style="grid-column: span 6;"><label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Campo / Sector</label><select id="rec_campo" onchange="ModuloOrdenes.m_filtrarLotes(this.value)" class="input-filtro-ot"><option value="">-</option></select></div>

                                    <div style="grid-column: span 4;"><label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Añadir Cuadro / Lote</label><select id="rec_cuadro" onchange="ModuloOrdenes.m_agregarLoteALista(this.value)" class="input-filtro-ot"><option value="">Seleccione...</option></select></div>
                                    <div style="grid-column: span 4;"><label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Superficie Cobertura (Ha)</label><input type="number" id="rec_sup" placeholder="0.00" readonly class="input-filtro-ot" style="font-weight:800; color:#1E6B4C;"></div>
                                    <div style="grid-column: span 4;"><label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Cotización Divisa ($)</label><input type="number" id="rec_cot" value="1200" oninput="ModuloOrdenes.m_recalcularTodo()" class="input-filtro-ot"></div>

                                    <div style="grid-column: span 12; margin-top: 4px;">
                                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Lotes Seleccionados en Receta:</label>
                                        <div id="lista-lotes-badge" style="min-height:36px; padding:6px; background:#F8FAFC; border-radius:8px; border:1px solid #E0DCD4; display:flex; flex-wrap:wrap; gap:4px; align-items:center;"></div>
                                    </div>
                                </div>
                            </div>

                            <!-- PASO 2 -->
                            <div class="tab-panel-receta" data-panel="2" style="display:none;">
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                    <span style="font-size:0.68rem; font-weight:800; color:#123F2C; letter-spacing:0.4px; text-transform: uppercase;">Insumos e Ingredientes Activos</span>
                                    <button type="button" onclick="ModuloOrdenes.m_agregarFilaProducto()" class="btn-accion-plant">
                                        + Agregar Insumo
                                    </button>
                                </div>
                                <div class="producto-row-header">
                                    <span>Depósito Origen</span>
                                    <span>Insumo</span>
                                    <span>Dosis/Ha</span>
                                    <span>Consumo</span>
                                    <span>U$S Unit</span>
                                    <span>Total U$S</span>
                                    <span></span>
                                </div>
                                <div id="contenedor-productos"></div>
                                <div id="vista-previa-insumos" style="background: #F8FAFC; border-radius: 8px; padding: 10px; border: 1px dashed #E0DCD4; margin-top: 8px;">
                                    <span style="color:#6B6255; font-size:0.75rem; font-style:italic;">Cargue insumos para ver el detalle de consumo...</span>
                                </div>
                            </div>

                            <!-- PASO 3 -->
                            <div class="tab-panel-receta" data-panel="3" style="display:none;">
                                <div style="display:grid; grid-template-columns: repeat(12, 1fr); gap: 10px;">
                                    <label style="grid-column: span 12; display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                        <input type="checkbox" id="check_apoyo" onchange="ModuloOrdenes.m_toggleApoyo(this.checked)">
                                        <span style="font-size:0.75rem; font-weight:800; color:#1E6B4C;">¿REQUIERE APOYO / LOGÍSTICA DE CARGA?</span>
                                    </label>

                                    <div style="grid-column: span 6;"><label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Contratista Aplicador</label><input type="text" id="rec_contratista" placeholder="Ej: Propio / Terceros" class="input-filtro-ot"></div>
                                    <div style="grid-column: span 6;"><label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Mano Obra U$S/Ha</label><input type="number" id="rec_mo" oninput="ModuloOrdenes.m_recalcularTodo()" placeholder="0.00" class="input-filtro-ot"></div>

                                    <div class="div-apoyo" style="grid-column: span 4; display:none;"><label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Costo Apoyo U$S/Ha</label><input type="number" id="rec_costo_apoyo" value="0" oninput="ModuloOrdenes.m_recalcularTodo()" class="input-filtro-ot"></div>
                                    <div class="div-apoyo" style="grid-column: span 4; display:none;"><label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Has Logística Apoyo</label><input type="number" id="rec_ha_apoyo" value="0" oninput="ModuloOrdenes.m_recalcularTodo()" class="input-filtro-ot"></div>
                                    <div class="div-apoyo" style="grid-column: span 4; display:none;"><label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Personal Técnico Apoyo</label><input type="text" id="rec_pers_apoyo" placeholder="Chofer/Equipo" class="input-filtro-ot"></div>

                                    <div style="grid-column: span 12;"><label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Total Insumos U$S</label><input type="number" id="rec_total_ins" readonly class="input-filtro-ot" style="background:#F0F2F5; font-weight:800; color:#1E6B4C;"></div>
                                </div>
                            </div>
                        </div>

                        <div style="background: rgba(30,107,76,0.08); border:1px solid rgba(30,107,76,0.25); border-radius:10px; padding:10px 14px; display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-size:0.75rem; font-weight:800; color:#123F2C; text-transform:uppercase; letter-spacing:0.4px;">Costo Total Liquidado de Operación</span>
                            <input type="number" id="rec_total_todo" readonly style="border:none; background:transparent; color:#1E6B4C; font-weight:900; font-size:1.3rem; text-align:right; width:180px; font-family:'Roboto';">
                        </div>

                        <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #E0DCD4; padding-top: 12px; margin-top: 4px;">
                            <button type="button" onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background: #F0F2F5; color: #1D1D1F; border: 1px solid #E0DCD4; padding: 8px 18px; font-weight: 700; border-radius: 8px; font-size: 0.78rem; cursor: pointer;">CANCELAR</button>
                            <button type="button" id="btn-guardar-despacho-action" style="background: #1E6B4C; color: #FFFFFF; border: none; padding: 8px 22px; font-weight: 700; border-radius: 8px; font-size: 0.78rem; cursor: pointer; box-shadow:0 4px 12px rgba(30,107,76,0.25);">GUARDAR RECETA</button>
                        </div>
                    </div>
                `;
            }

            const btnGuardar = document.getElementById('btn-guardar-despacho-action');
            if (btnGuardar) {
                btnGuardar.onclick = (e) => ModuloOrdenes.m_guardarReceta(e);
            }

            this.m_agregarFilaProducto();
            document.getElementById('modal-agrosoft').style.display = 'flex';
        }, 10);
    },

    m_cambiarTabReceta: function(numTab) {
        document.querySelectorAll('.tab-main-archivero').forEach(btn => {
            btn.classList.toggle('active', Number(btn.getAttribute('data-tab')) === numTab);
        });
        document.querySelectorAll('.tab-panel-receta').forEach(panel => {
            panel.style.display = Number(panel.getAttribute('data-panel')) === numTab ? 'block' : 'none';
        });
    },

    m_actualizarBadgeInsumos: function() {
        const badge = document.getElementById('tab-badge-insumos');
        if (badge) badge.innerText = document.querySelectorAll('.producto-row').length;
    },

    m_filtrarLaboresPorRubro: function(rubroSel) {
        const selectLabor = document.getElementById('rec_tipo_app');
        if (!selectLabor) return;
        if (!rubroSel) {
            selectLabor.innerHTML = '<option value="">Seleccione Rubro...</option>';
            return;
        }
        const laboresFiltradas = this.parametros.labores.filter(l => l.rubro === rubroSel);
        selectLabor.innerHTML = laboresFiltradas.length === 0 
            ? '<option value="">Sin labores...</option>' 
            : laboresFiltradas.map(l => `<option value="${l.labor}">${l.labor}</option>`).join('');
    },

    m_recalcularTodo: function() {
        const supTotal = parseFloat(document.getElementById('rec_sup')?.value) || 0;
        const moHa = parseFloat(document.getElementById('rec_mo')?.value) || 0;
        const apoyoHa = parseFloat(document.getElementById('rec_costo_apoyo')?.value) || 0;
        let costoInsumosTotal = 0;

        let htmlResumen = `<table style="width:100%; font-size:0.78rem; color: #1D1D1F; border-collapse: collapse;"><thead><tr style="border-bottom: 2px solid #E0DCD4; color:#6B6255; font-size:0.65rem; font-weight:700;"><th align="left">ARTÍCULO</th><th align="center">DOSIS</th><th align="right">CONS. TOTAL</th><th align="right">SUBTOTAL U$S</th></tr></thead><tbody>`;

        document.querySelectorAll('.producto-row').forEach(row => {
            const selectInsumo = row.querySelector('.p-insumo');
            if (!selectInsumo) return;
            const insumo = selectInsumo.value;
            const selectedOption = selectInsumo.options[selectInsumo.selectedIndex];
            
            const unidad = selectedOption ? selectedOption.getAttribute('data-unidad') || '' : '';
            const dosis = parseFloat(row.querySelector('.p-dosis').value) || 0;
            const uUnit = parseFloat(row.querySelector('.p-u-unit').value) || 0;
            
            const tConsumo = supTotal * dosis;
            const tUSS = tConsumo * uUnit;
            
            const inputConsumo = row.querySelector('.p-total-cons');
            if (inputConsumo) inputConsumo.value = tConsumo.toFixed(2);
            const inputTotal = row.querySelector('.p-u-total');
            if (inputTotal) inputTotal.value = tUSS.toFixed(2);
            
            if (insumo) {
                costoInsumosTotal += tUSS;
                htmlResumen += `<tr style="border-bottom: 1px solid #E0DCD4;"><td style="padding: 4px 0; font-weight:700; color:#123F2C;">🌱 ${insumo.toUpperCase()}</td><td align="center">${dosis.toFixed(2)}</td><td align="right">${tConsumo.toFixed(2)} ${unidad}</td><td align="right" style="color:#1E6B4C; font-weight:800;">U$S ${tUSS.toFixed(2)}</td></tr>`;
            }
        });

        htmlResumen += `</tbody></table>`;
        const divVista = document.getElementById('vista-previa-insumos');
        if (divVista) divVista.innerHTML = costoInsumosTotal > 0 ? htmlResumen : '<span style="color:#6B6255; font-size:0.75rem; font-style:italic;">Cargue insumos para ver el detalle de consumo...</span>';

        const elTotIns = document.getElementById('rec_total_ins');
        if (elTotIns) elTotIns.value = costoInsumosTotal.toFixed(2);
        const elTotTodo = document.getElementById('rec_total_todo');
        if (elTotTodo) elTotTodo.value = (costoInsumosTotal + (supTotal * (moHa + apoyoHa))).toFixed(2);
    },

    m_agregarLoteALista: function(loteId) {
        if (!loteId) return;
        const campoActual = document.getElementById('rec_campo').value;
        const loteInfo = this.lotesActuales.find(l => String(l.lote) === String(loteId));
        
        if (this.lotesSeleccionados.find(l => String(l.lote) === String(loteId) && l.campo_nombre === campoActual)) return;

        this.lotesSeleccionados.push({ ...loteInfo, campo_nombre: campoActual });
        this.m_renderizarLotesSeleccionados();
    },

    m_quitarLote: function(loteId, campoNombre) {
        this.lotesSeleccionados = this.lotesSeleccionados.filter(l => !(String(l.lote) === String(loteId) && l.campo_nombre === campoNombre));
        this.m_renderizarLotesSeleccionados();
    },

    m_renderizarLotesSeleccionados: function() {
        const contenedor = document.getElementById('lista-lotes-badge');
        const inputSup = document.getElementById('rec_sup');
        let totalHas = 0;

        if (contenedor) {
            contenedor.innerHTML = this.lotesSeleccionados.map(l => {
                totalHas += parseFloat(l.sup || 0);
                return `<div class="lote-tag">${l.campo_nombre} | Lote ${l.lote} (${l.sup} ha) <span style="cursor:pointer; color:#E0342A;" onclick="ModuloOrdenes.m_quitarLote('${l.lote}', '${l.campo_nombre}')">&times;</span></div>`;
            }).join('');
        }

        if (inputSup) inputSup.value = totalHas.toFixed(2);
        this.m_recalcularTodo();
    },

    m_filtrarCampos: function(est) {
        const nombres = [...new Set(this.parametros.campos.filter(c => c.establecimiento === est).map(c => c.campo).filter(Boolean))];
        const elCampo = document.getElementById('rec_campo');
        if (elCampo) elCampo.innerHTML = '<option value="">Seleccione...</option>' + nombres.map(n => `<option value="${n}">${n}</option>`).join('');
    },

    m_filtrarLotes: async function(campoSel) {
        try {
            const res = await this.m_ejecutarSqlLocal(
                `SELECT lote, nombre_lote, sup FROM cuadros WHERE UPPER(TRIM(campo)) = ? ORDER BY lote ASC`,
                [campoSel.trim().toUpperCase()]
            );
            this.lotesActuales = res.data || res || [];
            const elCuadro = document.getElementById('rec_cuadro');
            if (elCuadro) elCuadro.innerHTML = '<option value="">Añadir Lote...</option>' + this.lotesActuales.map(l => `<option value="${l.lote}">${l.lote} - ${l.nombre_lote || ''}</option>`).join('');
        } catch (err) { console.error(err); }
    },

    m_agregarFilaProducto: function() {
        const container = document.getElementById('contenedor-productos');
        if (!container) return;
        
        const id = Date.now();
        const row = document.createElement('div');
        row.className = 'producto-row animated fadeIn';
        row.id = `fila-${id}`;
        
        const listaDepositos = this.m_obtenerListaDepositos();
        const depActual = listaDepositos[0];
        this.m_calcularStockPorDeposito(depActual);
        const insumosDisponibles = this.parametros.insumos.filter(i => (i.stock_actual || 0) > 0);

        row.innerHTML = `
            <div>
                <select class="p-deposito input-filtro-ot" onchange="ModuloOrdenes.m_cambiarDepositoFila(this)" style="font-weight:700; color:#0071E3;">
                    ${listaDepositos.map(d => `<option value="${d}">🏢 ${d}</option>`).join('')}
                </select>
            </div>
            <div>
                <select class="p-insumo input-filtro-ot" onchange="ModuloOrdenes.m_actualizarStockLabel(this); ModuloOrdenes.m_recalcularTodo()">
                    <option value="">Insumo...</option>
                    ${insumosDisponibles.map(i => {
                        return `<option value="${i.articulo}" data-stock="${i.stock_actual}" data-unidad="${i.unidad}">📦 ${i.articulo.toUpperCase()} (${i.stock_actual} ${i.unidad || 'u'})</option>`;
                    }).join('')}
                </select>
                <div class="stock-indicator" style="font-size: 0.63rem; color: #6E6E73; margin-top:2px;">Stock disp: -</div>
            </div>
            <div><input type="number" class="p-dosis input-filtro-ot" placeholder="Dosis/Ha" oninput="ModuloOrdenes.m_recalcularTodo()"></div>
            <div><input type="number" class="p-total-cons input-filtro-ot" readonly placeholder="Total" style="background:#F0F2F5;"></div>
            <div><input type="number" class="p-u-unit input-filtro-ot" placeholder="U$S Unit" oninput="ModuloOrdenes.m_recalcularTodo()"></div>
            <div><input type="number" class="p-u-total input-filtro-ot" readonly style="color:#1E6B4C; font-weight:800; background:#F0F2F5;" placeholder="0.00"></div>
            <button type="button" onclick="document.getElementById('fila-${id}').remove(); ModuloOrdenes.m_recalcularTodo(); ModuloOrdenes.m_actualizarBadgeInsumos();" style="background:rgba(224,52,42,0.1); color:#E0342A; border:none; padding:6px; border-radius:6px; cursor:pointer; font-weight:bold;">🗑️</button>
        `;
        container.appendChild(row);
        this.m_actualizarBadgeInsumos();
    },

    m_obtenerListaDepositos: function() {
        const lista = [...new Set(this.rawIngresos.map(i => (i.campo_depo || '').trim().toUpperCase()).filter(Boolean))].sort();
        return lista.length > 0 ? lista : ['DEB_CENTRAL'];
    },

    m_cambiarDepositoFila: function(selectElem) {
        const row = selectElem.closest('.producto-row');
        if (!row) return;

        const depoKey = (selectElem.value || 'DEB_CENTRAL').trim().toUpperCase();
        const selectInsumo = row.querySelector('.p-insumo');
        const valorInsumoActual = (selectInsumo ? selectInsumo.value : '').trim().toUpperCase();

        this.m_calcularStockPorDeposito(depoKey);
        const insumosDisponibles = this.parametros.insumos.filter(i => (i.stock_actual || 0) > 0);

        if (selectInsumo) {
            selectInsumo.innerHTML = `<option value="">Insumo...</option>` + insumosDisponibles.map(i => {
                const seleccionado = i.articulo.trim().toUpperCase() === valorInsumoActual ? 'selected' : '';
                return `<option value="${i.articulo}" data-stock="${i.stock_actual}" data-unidad="${i.unidad}" ${seleccionado}>📦 ${i.articulo.toUpperCase()} (${i.stock_actual} ${i.unidad || 'u'})</option>`;
            }).join('');
            this.m_actualizarStockLabel(selectInsumo);
        }

        this.m_recalcularTodo();
    },

    m_actualizarStockLabel: function(selectElem) {
        const selectedOption = selectElem.options[selectElem.selectedIndex];
        const stockIndicator = selectElem.parentElement.querySelector('.stock-indicator');
        if (!stockIndicator) return;
        
        if (selectedOption && selectedOption.value !== "") {
            const stock = selectedOption.getAttribute('data-stock');
            const unidad = selectedOption.getAttribute('data-unidad');
            stockIndicator.innerHTML = `Stock: <strong style="color: #1E6B4C;">${stock} ${unidad}</strong>`;
        } else {
            stockIndicator.innerHTML = `Stock disp: -`;
        }
    },

    m_toggleApoyo: function(show) {
        document.querySelectorAll('.div-apoyo').forEach(d => d.style.display = show ? 'block' : 'none');
        if (!show) {
            const elCost = document.getElementById('rec_costo_apoyo');
            if (elCost) elCost.value = 0;
            const elPers = document.getElementById('rec_pers_apoyo');
            if (elPers) elPers.value = '';
        }
        this.m_recalcularTodo();
    },

    m_guardarReceta: async function(e) {
    if (e) e.preventDefault();

    const orden_trab_raw = document.getElementById('rec_orden_cab')?.value;
    const orden_trab = orden_trab_raw ? parseInt(orden_trab_raw, 10) : null;
    
    const ref_orden_raw = document.getElementById('rec_ref_orden')?.value;
    const ref_orden = (ref_orden_raw && ref_orden_raw.trim() !== '') ? parseInt(ref_orden_raw, 10) : null;

    const fecha = document.getElementById('rec_fecha')?.value;
    const estado_ui = document.getElementById('rec_estado')?.value;
    const estado = (estado_ui && estado_ui.trim() !== "") ? estado_ui : "PENDIENTE";

    const est = document.getElementById('rec_est')?.value || '';
    const rubro = (document.getElementById('rec_rubro')?.value || '').toUpperCase();
    const labor = (document.getElementById('rec_tipo_app')?.value || '').toUpperCase();
    const cotizacion = parseFloat(document.getElementById('rec_cot')?.value) || 1200;

    const contratista = (document.getElementById('rec_contratista')?.value || '').toUpperCase();
    const mo_ha = parseFloat(document.getElementById('rec_mo')?.value) || 0;
    
    const requiereApoyo = document.getElementById('check_apoyo')?.checked || false;
    const costo_apoyo_ha = requiereApoyo ? (parseFloat(document.getElementById('rec_costo_apoyo')?.value) || 0) : 0;
    const ha_apoyo = requiereApoyo ? (parseFloat(document.getElementById('rec_ha_apoyo')?.value) || 0) : 0;
    const pers_apoyo = requiereApoyo ? (document.getElementById('rec_pers_apoyo')?.value || '') : '';
    const total_apoyo_global = costo_apoyo_ha * ha_apoyo;

    if (!orden_trab) return this.m_mostrarNotificacion("Ingrese un Número de Orden de Trabajo válido.", "error");
    if (!fecha || !est || !rubro || !labor) return this.m_mostrarNotificacion("Complete los datos requeridos de cabecera.", "error");
    if (!this.lotesSeleccionados || this.lotesSeleccionados.length === 0) return this.m_mostrarNotificacion("Debe añadir al menos un lote a la orden.", "error");

    const insumosList = [];
    document.querySelectorAll('.producto-row').forEach(row => {
        const insumo = row.querySelector('.p-insumo')?.value;
        const dosis = parseFloat(row.querySelector('.p-dosis')?.value) || 0;
        const u_unit = parseFloat(row.querySelector('.p-u-unit')?.value) || 0;
        const inputDepoRow = row.querySelector('.p-deposito');
        const deposito_origen_fila = inputDepoRow ? inputDepoRow.value : 'DEB_CENTRAL';

        if (insumo && dosis > 0) {
            insumosList.push({ insumo, dosis, u_unit, deposito_origen: deposito_origen_fila });
        }
    });

    if (insumosList.length === 0) return this.m_mostrarNotificacion("Agregue al menos un insumo con dosis mayor a 0.", "error");

    const btnGuardar = document.getElementById('btn-guardar-despacho-action');
    if (btnGuardar) {
        btnGuardar.innerText = "GUARDANDO...";
        btnGuardar.disabled = true;
    }

    try {
        // 29 Columnas explícitas (se omite 'id' para autoincremento de SQLite)
        const sqlInsert = `
            INSERT INTO egresos_insumos (
                reg_local, orden_trab, ref_orden, fecha, estado, establecimiento,
                campo, cuadro, sup_uso, tipo_labor, labor, insumo, dosis_ha,
                imp_uni, total_consumo, total_dolar, total_pesos, contratista,
                costo_ha, apoyo, ha_apoyo, total_apoyo, cotizacion, costo_final,
                costo_final_ha_dolar, tabla_origen, deposito_origen, centro_costo,
                comentario, sincronizado
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `;

        for (const lote of this.lotesSeleccionados) {
            const supLote = parseFloat(lote.sup || 0);

            for (const ins of insumosList) {
                const total_consumo_fila = parseFloat((supLote * ins.dosis).toFixed(4));
                const total_dolar_fila = parseFloat((total_consumo_fila * ins.u_unit).toFixed(4));
                const total_pesos_fila = parseFloat((total_dolar_fila * cotizacion).toFixed(4));

                const costo_mo_fila = parseFloat((supLote * mo_ha).toFixed(4));
                const costo_apoyo_fila = parseFloat((supLote * costo_apoyo_ha).toFixed(4)); 
                
                const costo_final_fila = parseFloat((total_dolar_fila + costo_mo_fila + costo_apoyo_fila).toFixed(4));
                const costo_final_ha_dolar = supLote > 0 ? parseFloat((costo_final_fila / supLote).toFixed(4)) : 0;
                const idUnicoFila = this.m_uniqueid('PROD-');

                // 29 Parámetros correspondientes
                await this.m_ejecutarSqlLocal(sqlInsert, [
                    idUnicoFila,
                    orden_trab,
                    ref_orden,
                    fecha,
                    estado,
                    est,
                    lote.campo_nombre || lote.campo || 'SIN CAMPO',
                    lote.lote || lote.cuadro || 'SIN CUADRO',
                    supLote,
                    rubro,
                    labor,
                    ins.insumo,
                    ins.dosis,
                    ins.u_unit,
                    total_consumo_fila,
                    total_dolar_fila,
                    total_pesos_fila,
                    contratista,
                    mo_ha,
                    pers_apoyo.toUpperCase(),
                    ha_apoyo,
                    parseFloat(total_apoyo_global.toFixed(4)),
                    cotizacion,
                    costo_final_fila,
                    costo_final_ha_dolar,
                    'ORDEN DE TRABAJO',
                    ins.deposito_origen,
                    rubro ? rubro.toUpperCase() : 'GENERAL',
                    'Fila autogenerada mediante receta técnica.'
                ]);
            }
        }

        this.m_mostrarNotificacion("¡Receta guardada exitosamente en base local!", "exito");
        
        const modalBox = document.getElementById('modal-agrosoft');
        if (modalBox) modalBox.style.display = 'none';
        
        await this.m_inicializar(); 

    } catch (err) {
        console.error("❌ Error al guardar receta local:", err);
        this.m_mostrarNotificacion("Error al guardar la orden local: " + err.message, "error");
    } finally {
        if (btnGuardar) {
            btnGuardar.innerText = "GUARDAR RECETA";
            btnGuardar.disabled = false;
        }
    }
},
        
    m_uniqueid: function(prefix = '') {
        const timestamp = Date.now().toString(36); 
        const randomPart = Math.random().toString(36).substring(2, 7).toUpperCase(); 
        return `${prefix}${timestamp}-${randomPart}`;
    },

    _m_descargarBlob: function(blob, nombreArchivo) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = nombreArchivo;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    m_exportarExcelGlobal: function() {
        let XLSX;
        try {
            XLSX = require('xlsx');
        } catch (e) {
            console.error(e);
            return this.m_mostrarNotificacion("La librería de exportación a Excel no está disponible.", "error");
        }

        const filasOT = this.parametros.ordenes.filter(o => (o.tabla_origen || '').trim().toUpperCase() === 'ORDEN DE TRABAJO');
        if (filasOT.length === 0) return this.m_mostrarNotificacion("No hay órdenes de trabajo para exportar.", "error");

        const numFmt = '#,##0.00';
        const dolarFmt = '"U$S" #,##0.00';
        const pesosFmt = '"$" #,##0.00';

        const gruposOT = this.m_obtenerGruposOrdenes(filasOT);

        const encabezadosHoja2 = ['OT', 'REF', 'ESTADO', 'FECHA', 'ESTABLECIMIENTO', 'CAMPO', 'LOTES', 'CENTRO DE COSTO', 'CONTRATISTA', 'SUP TOTAL (HA)', 'COSTO TOTAL (U$S)', 'COSTO TOTAL ($)'];
        const filasHoja2 = gruposOT.map(g => [
            g.orden_trab,
            g.ref_orden === 'SIN-REF' ? '' : g.ref_orden,
            g.estado,
            g.fecha,
            g.establecimiento,
            g.campo,
            g.cuadros.join(', '),
            g.tipo_labor,
            g.contratista,
            Number(g.sup_total || 0),
            Number(g.costo_final || 0),
            Number(g.costo_pesos || 0)
        ]);

        const sumaSupHoja2 = gruposOT.reduce((a, g) => a + (g.sup_total || 0), 0);
        const sumaCostoHoja2 = gruposOT.reduce((a, g) => a + (g.costo_final || 0), 0);
        const sumaPesosHoja2 = gruposOT.reduce((a, g) => a + (g.costo_pesos || 0), 0);
        const filaTotalesHoja2 = ['', '', '', '', '', '', '', '', 'TOTALES', sumaSupHoja2, sumaCostoHoja2, sumaPesosHoja2];

        const aoaHoja2 = [encabezadosHoja2, ...filasHoja2, filaTotalesHoja2];
        const wsHoja2 = XLSX.utils.aoa_to_sheet(aoaHoja2);
        wsHoja2['!cols'] = [
            { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 14 },
            { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 16 }
        ];
        wsHoja2['!autofilter'] = { ref: `A1:L${filasHoja2.length + 1}` };
        wsHoja2['!views'] = [{ state: 'frozen', ySplit: 1 }];
        for (let r = 2; r <= filasHoja2.length + 2; r++) {
            [['J', numFmt], ['K', dolarFmt], ['L', pesosFmt]].forEach(([col, fmt]) => {
                const celda = wsHoja2[`${col}${r}`];
                if (celda && typeof celda.v === 'number') celda.z = fmt;
            });
        }

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, wsHoja2, 'Ordenes de Trabajo');

        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/octet-stream' });
        this._m_descargarBlob(blob, `Salvucci_Ordenes_Trabajo_${Date.now()}.xlsx`);
        this.m_mostrarNotificacion("Reporte Excel generado con éxito.", "exito");
    },

    m_exportarPDFGlobal: function() {
        if (this.parametros.ordenes.length === 0) return this.m_mostrarNotificacion("No hay datos para emitir reporte.", "error");

        const filtros = this.m_obtenerFiltros();
        const gruposFiltrados = this.m_aplicarFiltros(filtros);
        if (gruposFiltrados.length === 0) return this.m_mostrarNotificacion("No hay registros para la combinación de filtros actual.", "error");

        const totalCosto = gruposFiltrados.reduce((acc, r) => acc + (parseFloat(r.costo_final) || 0), 0);
        const totalHas = gruposFiltrados.reduce((acc, r) => acc + (parseFloat(r.sup_total) || 0), 0);

        const win = window.open('', '_blank');
        win.document.write(`
            <html>
            <head>
                <title>Salvucci Gestión - Reporte de Órdenes de Trabajo</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap');
                    body { font-family: 'Roboto', sans-serif; color: #211C16; padding: 35px; margin: 0; background: #F5F4F1; }
                    .header-pdf-premium { border-bottom: 3px solid #1E6B4C; padding-bottom: 14px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; background:#FFFFFF; padding:18px; border-radius:12px; border:1px solid #E0DCD4; }
                    .logo-container-apple { width: 70px; height: 70px; display: flex; align-items: center; justify-content: center; margin-right: 15px; }
                    .logo-container-apple img { width: 100%; height: 100%; object-fit: contain; }
                    .titulos-reporte h1 { margin: 0; font-size: 18px; font-weight: 900; color: #123F2C; }
                    .titulos-reporte h2 { margin: 3px 0 0 0; font-size: 11px; color: #1E6B4C; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
                    .kpi-tile-top { background:rgba(30,107,76,0.08); border:1px solid rgba(30,107,76,0.25); padding:8px 14px; border-radius:8px; text-align:right; }
                    table { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 10px; background:#FFFFFF; border-radius:8px; overflow:hidden; }
                    th { background: #123F2C; color: #FFFFFF; text-align: left; padding: 8px; font-weight: 700; text-transform: uppercase; }
                    td { padding: 7px 8px; border-bottom: 1px solid #E0DCD4; color: #211C16; }
                    .footer-firma-fija { margin-top: 30px; border-top: 1px solid #E0DCD4; padding-top: 15px; display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: #6B6255; }
                </style>
            </head>
            <body>
                <div class="header-pdf-premium">
                    <div style="display:flex; align-items:center;">
                        <div class="logo-container-apple">
                            <img src="logo.png" onerror="this.style.display='none';" />
                        </div>
                        <div class="titulos-reporte">
                            <h2>SALVUCCI GESTIÓN · RECETAS AGRONÓMICAS</h2>
                            <h1>REPORTE DE ÓRDENES DE TRABAJO</h1>
                        </div>
                    </div>
                    <div class="kpi-tile-top">
                        <div style="font-size:9px; color:#6B6255; font-weight:700; text-transform:uppercase;">Inversión Total OTs</div>
                        <div style="font-size:16px; font-weight:900; color:#1E6B4C;">U$S ${totalCosto.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
                        <small style="font-size:9px; color:#6B6255;">Cobertura: ${totalHas.toFixed(1)} Has</small>
                    </div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>OT #</th>
                            <th>FECHA</th>
                            <th>ESTADO</th>
                            <th>ESTABLECIMIENTO</th>
                            <th>LOTES</th>
                            <th>LABOR</th>
                            <th style="text-align:right;">HAS</th>
                            <th style="text-align:right;">COSTO TOTAL (U$S)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${gruposFiltrados.map(o => `
                            <tr>
                                <td><b>#${o.orden_trab}</b></td>
                                <td>${o.fecha}</td>
                                <td><b>${o.estado}</b></td>
                                <td>${o.establecimiento} · <small style="color:#6B6255;">${o.campo}</small></td>
                                <td>${o.cuadros.join(', ') || '-'}</td>
                                <td>${o.tipo_labor}</td>
                                <td style="text-align:right;">${o.sup_total.toFixed(1)}</td>
                                <td style="text-align:right; font-weight:800; color:#1E6B4C;">U$S ${o.costo_final.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div class="footer-firma-fija"><span>Salvucci Gestión &bull; Ecosistema de Operaciones</span><span>Firma Responsable Técnico: ___________________________</span></div>
                <script>window.onload = function() { window.print(); setTimeout(() => window.close(), 500); }</script>
            </body>
            </html>
        `);
        win.document.close();
    },

    m_exportarVoucherOTExcel: function(ot, ref) {
        const registros = this.parametros.ordenes.filter(o => String(o.orden_trab) === String(ot) && (o.ref_orden || 'SIN-REF').toString() === ref.toString());
        if (registros.length === 0) return;

        let csv = "\uFEFFCUADRO;INSUMO;DOSIS_HA;CONSUMO_TOTAL;COSTO_USD\n";
        registros.forEach(r => {
            csv += `"${r.cuadro}";"${r.insumo}";${r.dosis_ha};${r.total_consumo};${r.total_dolar}\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.setAttribute("download", `Salvucci_Voucher_OT_${ot}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    m_imprimirVoucherOTPDF: function(ot, ref) {
        const registros = this.parametros.ordenes.filter(o => String(o.orden_trab) === String(ot) && (o.ref_orden || 'SIN-REF').toString() === ref.toString());
        if (registros.length === 0) return;

        const cab = registros[0];
        const totalCostoOT = registros.reduce((a,c)=>a+parseFloat(c.costo_final||0), 0);

        const win = window.open('', '_blank');
        win.document.write(`
            <html>
            <head>
                <title>Receta Trabajo OT #${ot}</title>
                <style>
                    body { font-family: 'Roboto', sans-serif; padding: 35px; color: #211C16; background:#FFF; }
                    .header { border-bottom: 3px solid #1E6B4C; padding-bottom: 12px; margin-bottom: 20px; display:flex; justify-content:space-between; }
                    table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 11px; }
                    th, td { padding: 8px; border-bottom: 1px solid #E0DCD4; text-align: left; }
                    th { background: #F8FAFC; font-weight:700; text-transform:uppercase; }
                </style>
            </head>
            <body>
                <div class="header">
                    <div>
                        <h2 style="margin:0; font-size:18px; color:#123F2C;">SALVUCCI GESTIÓN &bull; RECETA AGRONÓMICA</h2>
                        <h3 style="margin:4px 0 0 0; color:#1E6B4C; font-size:14px;">ORDEN DE TRABAJO N° ${cab.orden_trab} (REF: ${cab.ref_orden || 'N/A'})</h3>
                        <small style="color:#6B6255;">Establecimiento: ${cab.establecimiento} &bull; Labor: ${cab.tipo_labor} &bull; Fecha: ${cab.fecha}</small>
                    </div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>LOTE / CUADRO</th>
                            <th>INSUMO</th>
                            <th style="text-align:center;">DOSIS/HA</th>
                            <th style="text-align:right;">CONSUMO TOTAL</th>
                            <th style="text-align:right;">COSTO USD</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${registros.map(r => `
                            <tr>
                                <td>Lote ${r.cuadro} (${r.sup_uso} Ha)</td>
                                <td><b>🌱 ${r.insumo}</b></td>
                                <td align="center">${parseFloat(r.dosis_ha).toFixed(2)}</td>
                                <td align="right">${parseFloat(r.total_consumo).toFixed(1)}</td>
                                <td align="right" style="font-weight:700; color:#1E6B4C;">U$S ${parseFloat(r.total_dolar).toLocaleString('en-US', {minimumFractionDigits:2})}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <div style="text-align:right; margin-top:20px; font-size:15px; font-weight:800; color:#1E6B4C;">
                    TOTAL OT: U$S ${totalCostoOT.toLocaleString('en-US', {minimumFractionDigits:2})}
                </div>
                <script>window.onload = function() { window.print(); setTimeout(() => window.close(), 500); }</script>
            </body>
            </html>
        `);
        win.document.close();
    }
};

window.ModuloOrdenes = ModuloOrdenes;