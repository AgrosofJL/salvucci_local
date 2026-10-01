/**
 * registracion_ordesnTra.js - Módulo de Recetas y Órdenes de Trabajo
 * Sistema: SALVUCCI / AgroSoft J&L
 * Mode: Local-First (Engine SQLite IPC) + "No me quites nada" + sincronizado = 0
 */

window.ModuloOrdenes = {
    parametros: {
        campos: [],
        cuadros: [],
        insumos: [],
        insumosMaestros: [],
        labores: [],
        ordenes: [],
        depositos: []
    },
    lotesSeleccionados: [],
    lotesActuales: [],
    rawIngresos: [],
    rawEgresos: [],
    _chartEstado: null,
    _chartInversion: null,
    vistaTabSuperior: 'ACTIVAS', // 'ACTIVAS' | 'TERMINADAS' | 'ESTADISTICAS'

    m_ejecutarSqlLocal: async function(sql, params = []) {
        if (window.apiLocal && window.apiLocal.query) {
            return await window.apiLocal.query({ sql, params });
        }
        if (window.electronAPI && window.electronAPI.invoke) {
            return await window.electronAPI.invoke('local-db-query', { sql, params });
        }
        if (typeof window.q === 'function') {
            return window.q(sql, ...params);
        }
        throw new Error("No se encontró el puente IPC con la base de datos local.");
    },

    m_asegurarModalBase: function() {
        let modal = document.getElementById('modal-agrosoft');
        if (!modal) {
            const modalHTML = `
                <div id="modal-agrosoft" class="modal-overlay" style="display: none; position: fixed; inset: 0; width: 100vw; height: 100vh; background: rgba(18, 22, 28, 0.45); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); z-index: 999999; justify-content: center; align-items: center; padding: 16px; box-sizing: border-box;">
                    <div class="modal-apple-content scroll-apple" style="background: #FFFFFF !important; border: 1.5px solid #D2D7D3; border-radius: 16px; padding: 20px; width: 96%; max-width: 920px; color: #1A211C; box-shadow: 0 16px 36px rgba(0,0,0,0.18); display: flex; flex-direction: column; position: relative; margin: auto; max-height: 90vh; overflow-y: auto;">
                        <div class="modal-header-apple" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid #E0DCD4; padding-bottom: 10px; background: #FFFFFF;">
                            <h3 id="modal-titulo" style="margin: 0; font-size: 1.05rem; font-weight: 800; font-family: 'Roboto', sans-serif; color: #104630; letter-spacing: -0.2px;">REGISTRO DE RECETA DE TRABAJO</h3>
                            <button onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background: none; border: none; color: #6B6255; font-size: 1.4rem; font-weight: bold; cursor: pointer; padding: 0 4px; line-height: 1;">&times;</button>
                        </div>
                        <div id="modal-formulario" style="max-height: 74vh; overflow-y: auto; padding-right: 4px; background: #FFFFFF;" class="scroll-apple"></div>
                        <div class="modal-apple-footer" id="modal-acciones-footer" style="display: none;"></div>
                    </div>
                </div>`;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
        }
    },

    m_inicializar: async function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;

        visor.innerHTML = '<div class="loader-apple" style="font-family:\'Roboto\', sans-serif; text-align:center; padding:50px; color:#1E6B4C; font-weight:700; letter-spacing:0.3px;">Sincronizando Tablero de Control de Órdenes y Recetas (base Local)...</div>';

        try {
            const [resCam, resCua, resIns, resLab, resOrd, resIng, resDep] = await Promise.all([
                this.m_ejecutarSqlLocal(`SELECT * FROM campos ORDER BY establecimiento ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM cuadros ORDER BY lote ASC`),
                this.m_ejecutarSqlLocal(`SELECT reg_local, articulo, rubro, sub_rubro, descripcion, unidad_medida FROM insumos ORDER BY articulo ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM tipos_labores ORDER BY labor ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM egresos_insumos ORDER BY id DESC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM insumos_ingresos`),
                this.m_ejecutarSqlLocal(`SELECT * FROM depositos ORDER BY deposito ASC`)
            ]);

            this.parametros.campos = resCam.data || resCam || [];
            this.parametros.cuadros = resCua.data || resCua || [];
            this.parametros.labores = resLab.data || resLab || [];
            this.parametros.insumosMaestros = resIns.data || resIns || [];
            this.rawIngresos = resIng.data || resIng || [];
            this.rawEgresos = resOrd.data || resOrd || [];
            this.parametros.depositos = resDep.data || resDep || [];

            const depInicial = (this.parametros.depositos.length > 0 && this.parametros.depositos[0].deposito)
                ? this.parametros.depositos[0].deposito
                : 'DEB_CENTRAL';

            this.m_calcularStockPorDeposito(depInicial);
            this.parametros.ordenes = this.rawEgresos;

            this.m_dibujarInterfaz();
            this.m_filtrarCascada();
        } catch (err) {
            console.error("Error al inicializar ModuloOrdenes Local:", err);
            visor.innerHTML = `<div style="color:#C62828; padding:20px; font-family:'Roboto'; border: 1px solid rgba(198,40,40,0.2); background: #FFEBEE; border-radius: 12px; font-weight: 700;">Error en ModuloOrdenes Local: ${err.message}</div>`;
        }
    },

    m_calcularStockPorDeposito: function(depositoId) {
        const consolidado = {};
        const norm = (t) => (t || '').toString().replace(/\s+/g, ' ').trim().toUpperCase();
        const depoKey = norm(depositoId);
        // Al editar una OT, su propio consumo vuelve al stock disponible
        const excl = this._otExcluida || null;

        const mapaMaestro = new Map();
        (this.parametros.insumosMaestros || []).forEach(m => {
            if (m.reg_local) mapaMaestro.set(String(m.reg_local).trim(), m);
            if (m.articulo) mapaMaestro.set(norm(m.articulo), m);
        });

        (this.rawIngresos || []).forEach(i => {
            const depoIngreso = norm(i.campo_depo);
            if (depoKey !== 'TODO' && depoIngreso !== depoKey) return;

            const codDirecto = (i.cod_articulo || '').trim();
            const artNombre = norm(i.articulo || "SIN ARTICULO");
            const maestro = (codDirecto && mapaMaestro.get(codDirecto)) || mapaMaestro.get(artNombre);
            const artKey = maestro?.reg_local || codDirecto || artNombre;

            if (!consolidado[artKey]) {
                consolidado[artKey] = {
                    cod_articulo: maestro?.reg_local || codDirecto || null,
                    reg_local: maestro?.reg_local || codDirecto || null,
                    articulo: maestro?.articulo || i.articulo,
                    descripcion: norm(maestro?.descripcion || i.descripcion || "GENERAL"),
                    tipo_insumos: norm(i.tipo_insumo || "GENERAL"),
                    entradas: 0,
                    salidas: 0,
                    unidad: maestro?.unidad_medida || i.unidad || 'LITROS'
                };
            }
            consolidado[artKey].entradas += Number(i.total || i.cant) || 0;
        });

        (this.rawEgresos || []).forEach(e => {
            if (norm(e.estado) === 'CANCELADO') return;
            if (excl && String(e.orden_trab) === String(excl.ot) && String(e.ref_orden || 'SIN-REF') === String(excl.ref)) return;
            const depoEgreso = norm(e.deposito_origen);
            if (depoKey !== 'TODO' && depoEgreso !== depoKey) return;

            const codDirecto = (e.cod_articulo || '').trim();
            const artNombre = norm(e.insumo || "SIN ARTICULO");
            const maestro = (codDirecto && mapaMaestro.get(codDirecto)) || mapaMaestro.get(artNombre);
            const artKey = maestro?.reg_local || codDirecto || artNombre;

            if (!consolidado[artKey]) {
                consolidado[artKey] = {
                    cod_articulo: maestro?.reg_local || codDirecto || null,
                    reg_local: maestro?.reg_local || codDirecto || null,
                    articulo: maestro?.articulo || e.insumo,
                    descripcion: norm(maestro?.descripcion || e.comentario || "GENERAL"),
                    tipo_insumos: norm(e.tipo_labor || "GENERAL"),
                    entradas: 0,
                    salidas: 0,
                    unidad: maestro?.unidad_medida || 'LITROS'
                };
            }
            consolidado[artKey].salidas += Number(e.total_consumo) || 0;
        });

        this.parametros.insumos = Object.values(consolidado).map(s => ({
            ...s,
            stock_actual: s.entradas - s.salidas
        })).sort((a, b) => (a.articulo || '').localeCompare(b.articulo || ''));
    },

    m_cambiarDeposito: function(depositoId) {
        const depoKey = (depositoId || "DEB_CENTRAL").trim().toUpperCase();

        document.querySelectorAll('.producto-row, .producto-row-c').forEach(row => {
            const selectInsumo = row.querySelector('.p-insumo');
            const inputDepoRow = row.querySelector('.p-deposito');
            
            if (!selectInsumo) return;
            if (selectInsumo.value !== "") return;

            if (inputDepoRow) inputDepoRow.value = depoKey;

            this.m_calcularStockPorDeposito(depoKey);
            const insumosDisponibles = this.parametros.insumos.filter(i => (i.stock_actual || 0) > 0);

            selectInsumo.innerHTML = `<option value="">Insumo...</option>` + insumosDisponibles.map(i => {
                return `<option value="${i.articulo}" data-cod="${i.cod_articulo || i.reg_local || ''}" data-stock="${i.stock_actual}" data-unidad="${i.unidad}">📦 ${i.articulo.toUpperCase()} (${i.stock_actual} ${i.unidad})</option>`;
            }).join('');

            this.m_actualizarStockLabel(selectInsumo);
        });

        this.m_recalcularTodo();
        this.m_mostrarNotificacion(`Depósito activo: ${depoKey}`, 'exito');
    },

    m_mostrarConfirmacion: function(titulo, mensaje) {
        return new Promise((resolve) => {
            const backdrop = document.createElement('div');
            backdrop.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(18, 22, 28, 0.45); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); z-index: 101000; display: flex; align-items: center; justify-content: center; font-family: 'Roboto', sans-serif; opacity: 0; transition: opacity 0.2s ease;`;

            const modal = document.createElement('div');
            modal.style.cssText = `background: #FFFFFF !important; border: 1.5px solid #D2D7D3; border-radius: 14px; padding: 22px; width: 90%; max-width: 400px; box-shadow: 0 12px 30px rgba(0,0,0,0.18); transform: scale(0.94); transition: transform 0.2s ease; text-align: center; margin: auto;`;

            modal.innerHTML = `
                <div style="display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; background: #FFFDE7; border: 1px solid #FFF9C4; border-radius: 50%; margin-bottom: 10px;">
                    <span style="font-size:1.3rem;">⚠️</span>
                </div>
                <h3 style="margin: 0 0 6px 0; color: #104630; font-size: 1.05rem; font-weight: 800;">${titulo.toUpperCase()}</h3>
                <p style="margin: 0 0 18px 0; color: #556358; font-size: 0.82rem; line-height: 1.4;">${mensaje}</p>
                <div style="display: flex; gap: 8px; justify-content: center;">
                    <button id="btn-conf-cancelar" style="flex: 1; background: #FFFDE7; border: 1px solid #FFF9C4; color: #F57F17; padding: 8px 12px; font-weight: 700; border-radius: 8px; font-size: 0.78rem; cursor: pointer;">CANCELAR</button>
                    <button id="btn-conf-aceptar" style="flex: 1; background: #1E6B4C; border: none; color: #FFFFFF; padding: 8px 12px; font-weight: 700; border-radius: 8px; font-size: 0.78rem; cursor: pointer; box-shadow: 0 3px 8px rgba(30,107,76,0.2);">CONFIRMAR</button>
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
                modal.style.transform = 'scale(0.94)';
                setTimeout(() => {
                    backdrop.remove();
                    resolve(resultado);
                }, 180);
            };

            backdrop.querySelector('#btn-conf-cancelar').onclick = () => cerrarModal(false);
            backdrop.querySelector('#btn-conf-aceptar').onclick = () => cerrarModal(true);
            backdrop.onclick = (e) => { if (e.target === backdrop) cerrarModal(false); };
        });
    },

    m_mostrarNotificacion: function(mensaje, tipo = 'exito') {
        const colorBorde = tipo === 'exito' ? '#2E7D32' : '#C62828';
        const bgFondo = tipo === 'exito' ? '#F1F9F4' : '#FFEBEE';
        const icono = tipo === 'exito' ? '✅' : '⚠️';

        const toastHTML = `
            <div id="apple-toast-premium" style="position: fixed; top: 22px; right: 22px; background: ${bgFondo}; border-left: 4px solid ${colorBorde}; border-top: 1px solid #D2D7D3; border-bottom: 1px solid #D2D7D3; border-right: 1px solid #D2D7D3; border-radius: 10px; padding: 10px 18px; display: flex; align-items: center; gap: 10px; color: #1A211C; font-family: 'Roboto', sans-serif; font-size: 0.82rem; font-weight: 700; box-shadow: 0 8px 20px rgba(20,26,36,0.12); z-index: 1000000; transform: translateY(-8px); opacity: 0; transition: all 0.25s ease;">
                <span style="font-size: 1rem;">${icono}</span>
                <div>${mensaje}</div>
            </div>
        `;
        document.getElementById('apple-toast-premium')?.remove();
        document.body.insertAdjacentHTML('beforeend', toastHTML);

        const el = document.getElementById('apple-toast-premium');
        requestAnimationFrame(() => {
            if (el) {
                el.style.opacity = "1";
                el.style.transform = "translateY(0)";
            }
        });

        setTimeout(() => {
            if (el) {
                el.style.opacity = "0";
                el.style.transform = "translateY(-10px)";
                setTimeout(() => el.remove(), 250);
            }
        }, 3400);
    },

    m_dibujarInterfaz: function() {
        const visor = document.getElementById('pantalla-dinamica') || document.getElementById('contenedor-principal');
        if (!visor) return;

        const estUnicos = [...new Set(this.parametros.campos.map(c => c.establecimiento))].filter(Boolean).sort();
        const rubrosUnicos = [...new Set(this.parametros.labores.map(l => l.rubro).filter(Boolean))].sort();

        const botonVolverHTML = (typeof ComponentesUI !== 'undefined' && ComponentesUI.botonVolverHTML)
            ? ComponentesUI.botonVolverHTML('LABORES')
            : `<button class="btn-pastel btn-pastel-amarillo" onclick="window.history.back()" style="margin-bottom:6px;">← Volver</button>`;

        visor.innerHTML = `
            <style>
                :root {
                    --color-bg: #F4F6F4;
                    --color-surface: #FFFFFF;
                    --color-text: #1A211C;
                    --color-text-secondary: #556358;
                    --color-border: #D2D7D3;
                    --color-plant: #1E6B4C;
                    --color-plant-dark: #104630;
                    --color-plant-soft: rgba(30, 107, 76, 0.08);

                    --pastel-menta-bg: #E8F5E9;
                    --pastel-menta-border: #C8E6C9;
                    --pastel-menta-text: #2E7D32;

                    --pastel-amarillo-bg: #FFFDE7;
                    --pastel-amarillo-border: #FFF9C4;
                    --pastel-amarillo-text: #F57F17;

                    --pastel-rojo-bg: #FFEBEE;
                    --pastel-rojo-border: #FFCDD2;
                    --pastel-rojo-text: #C62828;

                    --pastel-celeste-bg: #E1F5FE;
                    --pastel-celeste-border: #B3E5FC;
                    --pastel-celeste-text: #0277BD;

                    --radius-lg: 14px;
                    --radius-md: 8px;
                    --radius-sm: 6px;
                }

                .ordenes-master-container {
                    font-family: 'Roboto', -apple-system, BlinkMacSystemFont, sans-serif;
                    padding: 8px 16px 20px 16px;
                    color: var(--color-text);
                    width: 100% !important;
                    box-sizing: border-box;
                    height: calc(100vh - 60px);
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    gap: 6px;
                }

                .btn-pastel {
                    border-radius: var(--radius-sm); padding: 5px 11px; font-size: 11px; font-weight: 700;
                    cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: all 0.15s ease;
                    border: 1px solid transparent; text-decoration: none;
                }
                .btn-pastel:hover { transform: translateY(-1px); filter: brightness(0.97); }
                .btn-pastel-menta { background: var(--pastel-menta-bg); border-color: var(--pastel-menta-border); color: var(--pastel-menta-text); }
                .btn-pastel-celeste { background: var(--pastel-celeste-bg); border-color: var(--pastel-celeste-border); color: var(--pastel-celeste-text); }
                .btn-pastel-amarillo { background: var(--pastel-amarillo-bg); border-color: var(--pastel-amarillo-border); color: var(--pastel-amarillo-text); }
                .btn-pastel-rojo { background: var(--pastel-rojo-bg); border-color: var(--pastel-rojo-border); color: var(--pastel-rojo-text); }
                .btn-pastel-plant { background: var(--color-plant); color: #FFFFFF; }

                .tabs-header-archivero-main {
                    display: flex; gap: 6px; border-bottom: 2px solid var(--color-border); margin-bottom: 2px; align-items: flex-end; flex-shrink: 0;
                }
                .tab-main-archivero {
                    display: flex; align-items: center; gap: 6px; padding: 7px 14px; background: #E2E8F0;
                    border: 1px solid var(--color-border); border-bottom: none; border-radius: 8px 8px 0 0;
                    font-size: 11px; font-weight: 800; color: var(--color-text-secondary); cursor: pointer; transition: all 0.15s ease;
                    position: relative; bottom: -2px;
                }
                .tab-main-archivero:hover { background: #F1F5F9; color: var(--color-text); }
                .tab-main-archivero.active {
                    background: #FFFFFF; color: var(--color-plant-dark); border-color: var(--color-border); border-top: 3px solid var(--color-plant);
                    box-shadow: 0 -2px 6px rgba(0,0,0,0.03);
                }

                .grid-kpi-ot {
                    display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; flex-shrink: 0;
                }
                @media (max-width: 1100px) { .grid-kpi-ot { grid-template-columns: repeat(2, 1fr); } }

                .kpi-card-ot {
                    background: #FFFFFF; border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 8px 12px;
                    display: flex; flex-direction: column; justify-content: space-between; gap: 1px;
                    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02); cursor: pointer; transition: all 0.15s ease;
                }
                .kpi-card-ot:hover { border-color: var(--color-plant); transform: translateY(-1px); }
                .kpi-card-ot .kpi-label { font-size: 8.5px; color: var(--color-text-secondary); font-weight: 800; letter-spacing: 0.3px; text-transform: uppercase; }
                .kpi-card-ot .kpi-value { font-size: 1.15rem; font-weight: 900; color: var(--color-text); margin: 0; }
                .kpi-subtext { font-size: 9.5px; color: var(--color-text-secondary); font-weight: 600; display: block; margin-top: 1px; }

                .kpi-card-ot.accent-neutral { border-left: 4px solid #556358; }
                .kpi-card-ot.accent-orange { border-left: 4px solid #F57F17; }
                .kpi-card-ot.accent-green { border-left: 4px solid #2E7D32; }
                .kpi-card-ot.accent-blue { border-left: 4px solid #0277BD; }

                .grid-filtros-ot {
                    display: grid; grid-template-columns: 1.8fr repeat(4, 1fr); gap: 6px;
                    background: #F8FAFC; padding: 6px 10px; border-radius: var(--radius-sm); border: 1px solid var(--color-border);
                    align-items: center; flex-shrink: 0;
                }

                .input-filtro-ot {
                    background: #FFFFFF !important; border: 1px solid var(--color-border); padding: 5px 8px;
                    border-radius: var(--radius-sm); color: var(--color-text); font-size: 11px; outline: none; width: 100%;
                    box-sizing: border-box; font-family: inherit;
                }
                .input-filtro-ot:focus { border-color: var(--color-plant); background: #FFFFFF; }

                .panel-box-full {
                    background: #FFFFFF; border: 1px solid var(--color-border); border-radius: var(--radius-md);
                    padding: 10px; display: flex; flex-direction: column; gap: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);
                    flex: 1; overflow: hidden;
                }

                .wrapper-tabla-full {
                    flex: 1; overflow-y: auto; overflow-x: auto; border: 1px solid var(--color-border);
                    border-radius: var(--radius-sm); background: #FFFFFF; position: relative;
                }

                .tabla-ordenes-pro { width: 100%; border-collapse: collapse; font-size: 11px; text-align: left; }
                .tabla-ordenes-pro th {
                    background: #104630; color: #FFFFFF; font-weight: 800; font-size: 8.5px; text-transform: uppercase;
                    letter-spacing: 0.4px; padding: 7px 8px; position: sticky; top: 0; z-index: 10; white-space: nowrap;
                }
                .tabla-ordenes-pro td { padding: 6px 8px; border-bottom: 1px solid var(--color-border); color: var(--color-text); vertical-align: middle; white-space: nowrap; }
                .tabla-ordenes-pro tbody tr:hover { background: #FFFDE7; }

                .badge-ot-status { padding: 2px 6px; border-radius: 4px; font-size: 8.5px; font-weight: 800; display: inline-block; text-transform: uppercase; }
                .status-terminado, .status-finalizado { background: var(--pastel-menta-bg); color: var(--pastel-menta-text); border: 1px solid var(--pastel-menta-border); }
                .status-pendiente { background: var(--pastel-amarillo-bg); color: var(--pastel-amarillo-text); border: 1px solid var(--pastel-amarillo-border); }
                .status-en_proceso { background: var(--pastel-celeste-bg); color: var(--pastel-celeste-text); border: 1px solid var(--pastel-celeste-border); }

                .btn-accion-plant {
                    background: var(--color-plant-soft); border: 1px solid rgba(30,107,76,0.25); color: var(--color-plant);
                    padding: 3px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; cursor: pointer;
                    display: inline-flex; align-items: center; gap: 3px;
                }
                .btn-accion-plant:hover { background: rgba(30,107,76,0.18); }
                .lote-tag { background: var(--pastel-menta-bg); color: var(--pastel-menta-text); border: 1px solid var(--pastel-menta-border); padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 800; margin: 2px; }
            </style>

            <div class="ordenes-master-container animated fadeIn">
                ${botonVolverHTML}
                
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; flex-shrink:0;">
                    <div>
                        <h2 style="margin:0; font-weight:900; font-size:1.15rem; letter-spacing:-0.3px; color:var(--color-plant-dark);">Control de Órdenes y Recetas</h2>
                        <p style="margin:1px 0 0 0; font-size:10.5px; color:var(--color-text-secondary);">Planificación agronómica y trazabilidad de insumos por lote</p>
                    </div>
                    <div style="display:flex; gap:6px; align-items:center;">
                        <button class="btn-pastel btn-pastel-menta" onclick="ModuloOrdenes.m_exportarExcelGlobal()">
                            📊 Excel
                        </button>
                        <button class="btn-pastel btn-pastel-rojo" onclick="ModuloOrdenes.m_exportarPDFGlobal()">
                            📄 PDF Reporte
                        </button>
                        <button class="btn-pastel btn-pastel-plant" onclick="ModuloOrdenes.m_abrirFormulario()">
                            ➕ NUEVA RECETA
                        </button>
                    </div>
                </div>

                <div class="tabs-header-archivero-main">
                    <div class="tab-main-archivero ${this.vistaTabSuperior === 'ACTIVAS' ? 'active' : ''}" onclick="ModuloOrdenes.m_cambiarTabSuperior('ACTIVAS')">
                        <span>⏳ 1. ÓRDENES ACTIVAS</span>
                        <span class="badge-ot-status status-pendiente" id="tab-badge-ot-activas">0</span>
                    </div>
                    <div class="tab-main-archivero ${this.vistaTabSuperior === 'TERMINADAS' ? 'active' : ''}" onclick="ModuloOrdenes.m_cambiarTabSuperior('TERMINADAS')">
                        <span>✅ 2. ÓRDENES TERMINADAS</span>
                        <span class="badge-ot-status status-terminado" id="tab-badge-ot-terminadas">0</span>
                    </div>
                    <div class="tab-main-archivero ${this.vistaTabSuperior === 'ESTADISTICAS' ? 'active' : ''}" onclick="ModuloOrdenes.m_cambiarTabSuperior('ESTADISTICAS')">
                        <span>📊 3. ESTADÍSTICAS Y GRÁFICOS</span>
                    </div>
                </div>

                <div class="grid-kpi-ot">
                    <div class="kpi-card-ot accent-neutral" onclick="ModuloOrdenes.m_cambiarTabSuperior('ACTIVAS')">
                        <span class="kpi-label">TOTAL ÓRDENES EMITIDAS</span>
                        <h3 class="kpi-value" id="kpi_ot_total_cant">0 OTs</h3>
                        <span class="kpi-subtext" id="kpi_ot_total_has">0.00 Ha Cobertura</span>
                    </div>
                    <div class="kpi-card-ot accent-orange" onclick="ModuloOrdenes.m_cambiarTabSuperior('ACTIVAS')">
                        <span class="kpi-label">PENDIENTES DE LABOR</span>
                        <h3 class="kpi-value" style="color:#F57F17;" id="kpi_ot_pendientes">0</h3>
                        <span class="kpi-subtext">Por ejecutar en lote</span>
                    </div>
                    <div class="kpi-card-ot accent-green" onclick="ModuloOrdenes.m_cambiarTabSuperior('TERMINADAS')">
                        <span class="kpi-label">ÓRDENES FINALIZADAS</span>
                        <h3 class="kpi-value" style="color:#2E7D32;" id="kpi_ot_terminadas">0</h3>
                        <span class="kpi-subtext">Aplicadas con éxito</span>
                    </div>
                    <div class="kpi-card-ot accent-blue">
                        <span class="kpi-label">INVERSIÓN TOTAL EN RECETAS</span>
                        <h3 class="kpi-value" style="color:#0277BD;" id="kpi_ot_total_usd">U$S 0.00</h3>
                        <span class="kpi-subtext" id="kpi_ot_total_ars">$ 0.00 ARS</span>
                    </div>
                </div>

                ${this.vistaTabSuperior === 'ESTADISTICAS' ? this.m_renderVistaEstadisticas() : this.m_renderVistaTablas(estUnicos, rubrosUnicos)}
            </div>
        `;
    },

    m_renderVistaTablas: function(estUnicos, rubrosUnicos) {
        return `
            <div class="grid-filtros-ot">
                <div>
                    <input type="text" id="ot_filtro_texto" placeholder="🔍 Buscar OT, Ref, Insumo, Campo..." oninput="ModuloOrdenes.m_filtrarCascada()" class="input-filtro-ot">
                </div>
                <div>
                    <select id="ot_filtro_est" onchange="ModuloOrdenes.m_filtrarCascada()" class="input-filtro-ot">
                        <option value="">🏢 Todos los Establecimientos</option>
                        ${estUnicos.map(e => `<option value="${e}">${e}</option>`).join('')}
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

            <div class="panel-box-full">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
                    <span style="font-size: 11px; font-weight: 800; color: #104630; text-transform:uppercase; letter-spacing:0.3px;">
                        📋 ${this.vistaTabSuperior === 'ACTIVAS' ? 'Listado de Órdenes Pendientes y en Proceso' : 'Historial de Órdenes Concluidas'}
                    </span>
                    <span style="font-size: 10px; background: #F8FAFC; color: #556358; padding: 2px 7px; border-radius: 8px; font-weight: 800; border: 1px solid #D2D7D3;" id="lbl_ot_cant_registros">0 Órdenes</span>
                </div>

                <div class="wrapper-tabla-full scroll-apple">
                    <table class="tabla-ordenes-pro">
                        <thead>
                            <tr>
                                <th style="width: 100px;">Estado</th>
                                <th style="width: 110px;">OT / Ref</th>
                                <th style="width: 85px;">Fecha</th>
                                <th>Establecimiento & Campo</th>
                                <th>Lotes</th>
                                <th>Labor / CC</th>
                                <th style="text-align: right; width: 115px;">Costo Total U$S</th>
                                <th style="text-align: center; width: 75px;">Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="tbody_ot_principal"></tbody>
                        <tfoot>
                            <tr style="background:#FAF9F7;">
                                <td colspan="6" style="text-align:left; font-weight:800; padding:6px 8px;">TOTAL VISIBLE:</td>
                                <td id="ft_ot_usd" style="text-align:right; font-weight:900; color:#1E6B4C; font-family:monospace; padding:6px 8px;">U$S 0.00</td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        `;
    },

    m_renderVistaEstadisticas: function() {
        return `
            <div class="panel-box-full" style="display:flex; flex-direction:column; gap:10px; overflow-y:auto;">
                <span style="font-size:11px; font-weight:800; color:#104630; text-transform:uppercase;">📊 Panel Analítico y Métricas Gráficas</span>
                <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 10px; flex: 1;">
                    <div style="background:#F8FAFC; border:1px solid #D2D7D3; border-radius:10px; padding:12px; display:flex; flex-direction:column;">
                        <span style="font-size: 10.5px; font-weight: 800; color: #104630; text-transform:uppercase; margin-bottom:8px;">Estado de las Órdenes</span>
                        <div style="flex:1; min-height:240px; position:relative;">
                            <canvas id="chart_ot_estados"></canvas>
                        </div>
                    </div>
                    <div style="background:#F8FAFC; border:1px solid #D2D7D3; border-radius:10px; padding:12px; display:flex; flex-direction:column;">
                        <span style="font-size: 10.5px; font-weight: 800; color: #104630; text-transform:uppercase; margin-bottom:8px;">Inversión por Establecimiento (U$S)</span>
                        <div style="flex:1; min-height:240px; position:relative;">
                            <canvas id="chart_ot_inversion"></canvas>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    m_cambiarTabSuperior: function(tab) {
        this.vistaTabSuperior = tab;
        this.m_dibujarInterfaz();
        this.m_filtrarCascada();
    },

    m_obtenerGruposOrdenes: function(listaOrdenes) {
        const ordenesAgrupadas = [];
        const indice = new Map();
        (listaOrdenes || this.parametros.ordenes).forEach(o => {
            const otKey = o.orden_trab || 'SIN-OT';
            const refKey = o.ref_orden || 'SIN-REF';
            const clave = `${otKey}|${refKey}`;
            const apl = this.m_aplicacionDeFila(o);
            // La superficie se cuenta una vez por lote y por aplicación (no por cada insumo)
            const claveSup = `${apl.n}|${o.campo || ''}|${o.cuadro || ''}`;

            let existe = indice.get(clave);
            if (!existe) {
                existe = {
                    orden_trab: otKey,
                    ref_orden: refKey,
                    fecha: o.fecha || '-',
                    estado: (o.estado || 'PENDIENTE').toUpperCase(),
                    establecimiento: o.establecimiento || '-',
                    campo: o.campo || '-',
                    cuadros: [],
                    tipo_labor: o.tipo_labor || o.centro_costo || '-',
                    contratista: o.contratista || '-',
                    costo_final: 0,
                    costo_pesos: 0,
                    sup_total: 0,
                    aplicaciones: 1,
                    _sup: new Set(),
                    _fechaP1: null,
                    filasRaw: []
                };
                indice.set(clave, existe);
                ordenesAgrupadas.push(existe);
            }
            if (o.cuadro && !existe.cuadros.includes(o.cuadro)) existe.cuadros.push(o.cuadro);
            if (!existe._sup.has(claveSup)) {
                existe._sup.add(claveSup);
                existe.sup_total += parseFloat(o.sup_uso || 0);
            }
            existe.aplicaciones = Math.max(existe.aplicaciones, apl.total, apl.n);
            if (apl.n === 1 && o.fecha && (!existe._fechaP1 || o.fecha < existe._fechaP1)) existe._fechaP1 = o.fecha;
            existe.costo_final += parseFloat(o.costo_final || o.total_dolar || 0);
            existe.costo_pesos += parseFloat(o.total_pesos || 0);
            existe.filasRaw.push(o);
        });
        ordenesAgrupadas.forEach(g => {
            if (g._fechaP1) g.fecha = g._fechaP1;
            if (g.aplicaciones > 1) {
                const p1 = g.filasRaw.find(r => this.m_aplicacionDeFila(r).n === 1);
                if (p1) g.contratista = p1.contratista || g.contratista;
            }
            delete g._sup; delete g._fechaP1;
        });
        return ordenesAgrupadas;
    },

    m_obtenerFiltros: function() {
        return {
            texto: (document.getElementById('ot_filtro_texto')?.value || '').toLowerCase().trim(),
            est: (document.getElementById('ot_filtro_est')?.value || '').toLowerCase(),
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
                const insMatch = g.filasRaw.some(r => (r.insumo || '').toLowerCase().includes(f.texto) || (r.cod_articulo || '').toLowerCase().includes(f.texto));
                if (!otMatch && !refMatch && !estMatch && !campoMatch && !conMatch && !insMatch) return false;
            }
            if (f.est && !g.establecimiento.toLowerCase().includes(f.est)) return false;
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
            if (this.vistaTabSuperior === 'TERMINADAS') return terminado;
            return !terminado;
        });

        this.m_actualizarBadgesTabSuperior(datosGlobales);
        this.m_actualizarKPIs(datosGlobales);

        if (this.vistaTabSuperior === 'ESTADISTICAS') {
            this.m_renderizarGraficos(datosGlobales);
        } else {
            this.m_renderizarTabla(datosTabla);
        }
    },

    m_actualizarBadgesTabSuperior: function(datosGlobales) {
        const badgeActivas = document.getElementById('tab-badge-ot-activas');
        const badgeTerminadas = document.getElementById('tab-badge-ot-terminadas');
        if (badgeActivas) badgeActivas.innerText = datosGlobales.filter(g => !this.m_esGrupoTerminado(g)).length;
        if (badgeTerminadas) badgeTerminadas.innerText = datosGlobales.filter(g => this.m_esGrupoTerminado(g)).length;
    },

    m_renderizarTabla: function(datos) {
        const tbody = document.getElementById('tbody_ot_principal');
        if (!tbody) return;
        this.m_asegurarEstilosReceta();

        const lblCant = document.getElementById('lbl_ot_cant_registros');
        if (lblCant) lblCant.innerText = `${datos.length} Órdenes`;

        if (datos.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 30px; color: #556358; font-style:italic;">
                        No se encontraron órdenes para la solapa y filtros seleccionados.
                    </td>
                </tr>`;
            return;
        }

        tbody.innerHTML = datos.map(o => {
            const stClass = `status-${o.estado.toLowerCase().replace(' ', '_')}`;
            return `
                <tr style="cursor: pointer;" onclick="ModuloOrdenes.m_verDetalleFlotante('${o.orden_trab}', '${o.ref_orden}')">
                    <td><span class="badge-ot-status ${stClass}">${o.estado}</span></td>
                    <td>
                        <strong style="color:#0277BD; font-size:11px;">OT #${o.orden_trab}</strong>
                        <div style="font-size:9.5px; color:#556358;">Ref: ${o.ref_orden || '-'}</div>
                    </td>
                    <td style="color:#556358; font-weight:600;">${o.fecha}</td>
                    <td>
                        <strong>${o.establecimiento}</strong>
                        <div style="font-size:9.5px; color:#556358;">📍 ${o.campo}</div>
                    </td>
                    <td>
                        <span class="lote-tag">
                            Lotes: ${o.cuadros.join(', ') || 'Gral'}
                        </span>${o.aplicaciones > 1 ? `<span class="rx-badge-apl" title="La receta se hizo en ${o.aplicaciones} aplicaciones">${o.aplicaciones} aplic.</span>` : ''}
                    </td>
                    <td>
                        <span style="background:#F8FAFC; color:#1A211C; border:1px solid #D2D7D3; padding:2px 6px; border-radius:4px; font-weight:700; font-size:10px;">
                            ${o.tipo_labor}
                        </span>
                    </td>
                    <td style="text-align: right; font-weight: 800; color: #1E6B4C; font-family:monospace;">
                        U$S ${o.costo_final.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}
                    </td>
                    <td style="text-align: center;" onclick="event.stopPropagation();">
                        <button class="btn-accion-plant" onclick="ModuloOrdenes.m_verDetalleFlotante('${o.orden_trab}', '${o.ref_orden}')" title="Ver Receta y Consumos">
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

        const elFt = document.getElementById('ft_ot_usd');
        if (elFt) elFt.innerText = `U$S ${totalUsd.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
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
                        backgroundColor: ['#F57F17', '#0277BD', '#2E7D32'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { boxWidth: 10, font: { family: 'Roboto', size: 10 } } }
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

            this.m_asegurarEstilosReceta();
            registrosOT.sort((a, b) => (this.m_aplicacionDeFila(a).n - this.m_aplicacionDeFila(b).n) || ((Number(a.id) || 0) - (Number(b.id) || 0)));
            const infoCabecera = registrosOT.find(r => this.m_aplicacionDeFila(r).n === 1) || registrosOT[0];
            const container = document.getElementById('modal-formulario');
            const titulo = document.getElementById('modal-titulo');
            
            if (titulo) {
                titulo.innerText = `RECETA Y CONSUMO DE ORDEN DE TRABAJO N° ${ot}`;
            }
            const htmlAplicaciones = this.m_htmlResumenAplicaciones(registrosOT);

            let htmlDetalleInsumos = `
                <div style="margin-top: 10px; background: #F8FAFC; border: 1px solid var(--color-border); padding: 12px; border-radius: 10px;">
                    <span style="font-size:10.5px; font-weight:800; display:block; margin-bottom:6px; color:#104630; text-transform: uppercase;">
                        🧪 Receta Técnica de Insumos y Dosificación por Lote
                    </span>
                    <table style="width:100%; font-size:11px; border-collapse:collapse;">
                        <thead>
                            <tr style="border-bottom:2px solid var(--color-border); color:var(--color-text-secondary); font-size:8.5px; font-weight:800; text-transform:uppercase;">
                                <th align="left" style="padding:6px 4px;">CUADRO</th>
                                <th align="center" style="padding:6px 4px;">APLIC.</th>
                                <th align="left" style="padding:6px 4px;">CÓDIGO / INSUMO</th>
                                <th align="center" style="padding:6px 4px;">DOSIS/HA</th>
                                <th align="right" style="padding:6px 4px;">CONSUMO</th>
                                <th align="right" style="padding:6px 4px;">U$S TOTAL</th>
                                <th align="right" style="padding:6px 4px;">$ ARS TOTAL</th>
                                <th align="center" style="padding:6px 4px;">ESTADO</th>
                                <th align="center" style="padding:6px 4px; width:70px;">ACCIONES</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            registrosOT.forEach(r => {
                const estadoActivo = (r.estado || 'PENDIENTE').toUpperCase(); 
                htmlDetalleInsumos += `
                    <tr style="border-bottom:1px solid var(--color-border);">
                        <td style="padding:6px 4px; font-weight:700;">Lote ${r.cuadro} <small style="color:var(--color-text-secondary);">(${r.sup_uso} ha)</small></td>
                        <td align="center" style="padding:6px 4px;"><span class="rx-apl-n" style="width:20px; height:20px; font-size:10px;">${this.m_aplicacionDeFila(r).n}</span></td>
                        <td style="padding:6px 4px; color:#104630; font-weight:700;">
                            <div>🌱 ${r.insumo}</div>
                            ${r.cod_articulo ? `<div style="font-size:9.5px; color:#0277BD; font-family:monospace;">COD: ${r.cod_articulo} &bull; [${r.deposito_origen || 'S/D'}]</div>` : `<div style="font-size:9.5px; color:var(--color-text-secondary);">[${r.deposito_origen || 'S/D'}]</div>`}
                        </td>
                        <td align="center" style="padding:6px 4px;">${parseFloat(r.dosis_ha || 0).toFixed(2)}</td>
                        <td align="right" style="padding:6px 4px; color:#C62828; font-weight:700;">${parseFloat(r.total_consumo || 0).toFixed(2)}</td>
                        <td align="right" style="padding:6px 4px; color:#2E7D32; font-weight:800;">U$S ${parseFloat(r.total_dolar || 0).toFixed(2)}</td>
                        <td align="right" style="padding:6px 4px; font-weight:600;">$ ${parseFloat(r.total_pesos || 0).toFixed(0)}</td>
                        <td align="center" style="padding:6px 4px;"><span class="badge-ot-status status-${estadoActivo.toLowerCase().replace(' ', '_')}">${estadoActivo}</span></td>
                        <td align="center" style="padding:6px 4px;">
                            <div style="display:inline-flex; gap:3px;">
                                <button class="btn-pastel btn-pastel-amarillo" style="padding:2px 5px; font-size:9px;" onclick="ModuloOrdenes.m_editarFilaRegistro('${r.id}')" title="Editar insumo">✏️</button>
                                <button class="btn-pastel btn-pastel-rojo" style="padding:2px 5px; font-size:9px;" onclick="ModuloOrdenes.m_eliminarFilaRegistro('${r.id}', '${r.orden_trab}', '${r.ref_orden || 'SIN-REF'}')" title="Eliminar fila">🗑️</button>
                            </div>
                        </td>
                    </tr>
                `;
            });

            htmlDetalleInsumos += `</tbody></table></div>`;

            if (container) {
                container.innerHTML = `
                    <div style="display:flex; flex-direction:column; gap:10px; font-family:'Roboto', sans-serif;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-size:10px; font-weight:800; color:#104630; text-transform: uppercase;">📋 Cabecera de la Orden</span>
                            <button type="button" onclick="ModuloOrdenes.m_editarCabeceraForm('${ot}', '${ref}')" class="btn-pastel btn-pastel-celeste">
                                ⚙️ Editar Cabecera
                            </button>
                        </div>

                        <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:8px; background:#F8FAFC; padding:10px; border-radius:8px; border:1px solid var(--color-border); font-size:11px;">
                            <div><label style="color:var(--color-text-secondary); font-size:8.5px; font-weight:800; text-transform:uppercase;">Fecha Emisión</label><p style="margin:2px 0; font-weight:700;">${infoCabecera.fecha}</p></div>
                            <div><label style="color:var(--color-text-secondary); font-size:8.5px; font-weight:800; text-transform:uppercase;">Ref Orden</label><p style="margin:2px 0; font-weight:700; color:#0277BD;">#${infoCabecera.ref_orden || '-'}</p></div>
                            <div><label style="color:var(--color-text-secondary); font-size:8.5px; font-weight:800; text-transform:uppercase;">Establecimiento</label><p style="margin:2px 0; font-weight:700;">${infoCabecera.establecimiento}</p></div>
                            <div><label style="color:var(--color-text-secondary); font-size:8.5px; font-weight:800; text-transform:uppercase;">Estado</label><div style="margin:2px 0;"><span class="badge-ot-status status-${infoCabecera.estado.toLowerCase().replace(' ', '_')}">${infoCabecera.estado}</span></div></div>
                            <div><label style="color:var(--color-text-secondary); font-size:8.5px; font-weight:800; text-transform:uppercase;">Labor</label><p style="margin:2px 0; font-weight:700;">${infoCabecera.tipo_labor}</p></div>
                            <div><label style="color:var(--color-text-secondary); font-size:8.5px; font-weight:800; text-transform:uppercase;">Contratista</label><p style="margin:2px 0; font-weight:700;">${infoCabecera.contratista || '-'}</p></div>
                            <div><label style="color:var(--color-text-secondary); font-size:8.5px; font-weight:800; text-transform:uppercase;">Cotización</label><p style="margin:2px 0; font-weight:700; color:#0277BD;">$ ${infoCabecera.cotizacion}</p></div>
                            <div><label style="color:var(--color-text-secondary); font-size:8.5px; font-weight:800; text-transform:uppercase;">Inversión Total OT</label><p style="margin:2px 0; font-weight:900; color:#1E6B4C; font-size:1.05rem;">U$S ${registrosOT.reduce((a,c)=>a+parseFloat(c.costo_final||0),0).toFixed(2)}</p></div>
                        </div>

                        ${htmlAplicaciones}

                        ${htmlDetalleInsumos}

                        <div style="display:flex; gap:6px; justify-content:flex-end; align-items:center; border-top:1px solid var(--color-border); padding-top:10px; margin-top:6px; flex-wrap:wrap;">
                            <button class="btn-pastel btn-pastel-celeste" style="margin-right:auto;" onclick="ModuloOrdenes.m_duplicarOrden(${this.m_jsStr(ot)}, ${this.m_jsStr(ref)})" title="Copiar toda la orden con otro N° de OT">
                                📄 Duplicar orden
                            </button>
                            <button class="btn-pastel btn-pastel-amarillo" onclick="ModuloOrdenes.m_editarRecetaCompleta(${this.m_jsStr(ot)}, ${this.m_jsStr(ref)})" title="Editar lotes, receta y aplicaciones (por ej. dividir en 2 aplicaciones)">
                                🧪 Editar receta y aplicaciones
                            </button>
                            <button class="btn-pastel btn-pastel-menta" onclick="ModuloOrdenes.m_exportarVoucherOTExcel('${ot}', '${ref}')">
                                📊 Excel OT
                            </button>
                            <button class="btn-pastel btn-pastel-plant" onclick="ModuloOrdenes.m_imprimirVoucherOTPDF('${ot}', '${ref}')">
                                🖨️ Imprimir Receta (PDF)
                            </button>
                            ${infoCabecera.estado !== 'TERMINADO' ? `
                                <button class="btn-pastel btn-pastel-celeste" onclick="ModuloOrdenes.m_finalizarProcesoCompleto('${ot}', '${ref}')">
                                    ✅ Finalizar Orden
                                </button>
                            ` : ''}
                            <button class="btn-pastel btn-pastel-amarillo" onclick="document.getElementById('modal-agrosoft').style.display = 'none';">
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
                <div style="display:flex; flex-direction:column; gap:10px; font-family:'Roboto', sans-serif;">
                    <div style="background:var(--color-plant-soft); border-left:4px solid var(--color-plant); padding:8px 10px; border-radius:6px; font-size:11px;">
                        El cambio impactará en las <strong>${registrosOT.length} filas</strong> de insumos asociadas a esta OT.
                    </div>

                    <div style="background:#F8FAFC; border:1px solid var(--color-border); padding:10px; border-radius:8px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <div>
                            <label style="font-size:9px; color:var(--color-text-secondary); font-weight:800; text-transform:uppercase;">Fecha Planificación</label>
                            <input type="date" id="cab_edit_fecha" value="${infoCabecera.fecha || ''}" class="input-filtro-ot">
                        </div>
                        <div>
                            <label style="font-size:9px; color:var(--color-text-secondary); font-weight:800; text-transform:uppercase;">Ref Orden</label>
                            <input type="number" id="cab_edit_ref_orden" value="${infoCabecera.ref_orden || ''}" class="input-filtro-ot">
                        </div>
                    </div>

                    <div style="background:#F8FAFC; border:1px solid var(--color-border); padding:10px; border-radius:8px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <div>
                            <label style="font-size:9px; color:var(--color-text-secondary); font-weight:800; text-transform:uppercase;">Establecimiento</label>
                            <select id="cab_edit_establecimiento" class="input-filtro-ot">
                                <option value="">Seleccione...</option>
                                ${estUnicos.map(e => `<option value="${e.toUpperCase()}" ${e.toUpperCase() === (infoCabecera.establecimiento || '').trim().toUpperCase() ? 'selected' : ''}>🏢 ${e.toUpperCase()}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label style="font-size:9px; color:var(--color-text-secondary); font-weight:800; text-transform:uppercase;">Estado General</label>
                            <select id="cab_edit_estado" class="input-filtro-ot" style="font-weight:700; color:#F57F17;">
                                <option value="PENDIENTE" ${infoCabecera.estado === 'PENDIENTE' ? 'selected' : ''}>⏳ PENDIENTE</option>
                                <option value="EN PROCESO" ${infoCabecera.estado === 'EN PROCESO' ? 'selected' : ''}>🚜 EN PROCESO</option>
                                <option value="TERMINADO" ${infoCabecera.estado === 'TERMINADO' ? 'selected' : ''}>✅ TERMINADO</option>
                            </select>
                        </div>
                    </div>

                    <div style="background:#F8FAFC; border:1px solid var(--color-border); padding:10px; border-radius:8px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <div>
                            <label style="font-size:9px; color:var(--color-text-secondary); font-weight:800; text-transform:uppercase;">Labor Principal / CC</label>
                            <select id="cab_edit_tipo_labor" class="input-filtro-ot">
                                <option value="">Seleccione...</option>
                                ${rubrosUnicos.map(r => `<option value="${r.toUpperCase()}" ${r.toUpperCase() === (infoCabecera.tipo_labor || '').trim().toUpperCase() ? 'selected' : ''}>🛠️ ${r.toUpperCase()}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label style="font-size:9px; color:#0277BD; font-weight:800; text-transform:uppercase;">Cotización ($)</label>
                            <input type="number" id="cab_edit_cotizacion" value="${infoCabecera.cotizacion || 1200}" class="input-filtro-ot" style="color:#0277BD; font-weight:700;">
                        </div>
                    </div>

                    <div>
                        <label style="font-size:9px; color:var(--color-text-secondary); font-weight:800; text-transform:uppercase;">Contratista Aplicador</label>
                        <input type="text" id="cab_edit_contratista" value="${infoCabecera.contratista || ''}" class="input-filtro-ot" style="text-transform:uppercase;">
                    </div>

                    <div style="display:flex; justify-content:flex-end; gap:8px; border-top:1px solid var(--color-border); padding-top:10px; margin-top:4px;">
                        <button type="button" onclick="ModuloOrdenes.m_verDetalleFlotante('${ot}', '${ref}')" class="btn-pastel btn-pastel-amarillo">CANCELAR</button>
                        <button type="button" onclick="ModuloOrdenes.m_guardarCabeceraCompleta('${ot}', '${ref}', this)" class="btn-pastel btn-pastel-plant">
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
                    fecha = CASE WHEN IFNULL(comentario,'') GLOB 'APLICACIÓN [0-9]* de *' AND IFNULL(comentario,'') NOT GLOB 'APLICACIÓN 1 de *' THEN fecha ELSE ? END, 
                    ref_orden = ?, 
                    establecimiento = ?, 
                    estado = ?,
                    tipo_labor = ?, 
                    centro_costo = ?, 
                    contratista = CASE WHEN IFNULL(comentario,'') GLOB 'APLICACIÓN [0-9]* de *' AND IFNULL(comentario,'') NOT GLOB 'APLICACIÓN 1 de *' THEN contratista ELSE ? END, 
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
            console.error("Error al guardar cabecera:", err);
            this.m_mostrarNotificacion("Error al actualizar cambios locales: " + err.message, "error");
        }
    },

    m_editarFilaRegistro: async function(idRegistro) {
        const reg = this.parametros.ordenes.find(o => String(o.id) === String(idRegistro) || String(o.reg_local) === String(idRegistro));
        if (!reg) return;
        this._otExcluida = null;

        this.m_asegurarModalBase();

        const modalTitulo = document.getElementById('modal-titulo');
        const modalForm = document.getElementById('modal-formulario');
        const modalOverlay = document.getElementById('modal-agrosoft');

        if (modalTitulo) modalTitulo.innerText = "MODIFICAR CONTROL DE INSUMO";

        const deppsIngresosUnicos = this.m_obtenerListaDepositos();
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
                <div style="display:flex; flex-direction:column; gap:10px; font-family:'Roboto', sans-serif;">
                    <div style="background:var(--color-plant-soft); padding:8px 10px; border-radius:6px; font-size:11px; color: #104630;">
                        <strong>Ubicación:</strong> ${reg.establecimiento.toUpperCase()} &rsaquo; ${reg.campo.toUpperCase()}
                    </div>
                    
                    <div style="background:#F8FAFC; border:1px solid var(--color-border); padding:10px; border-radius:8px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <div>
                            <label style="font-size:9px; color:var(--color-text-secondary); font-weight:800; text-transform:uppercase;">OT N°</label>
                            <input type="number" id="edit_orden_trab" value="${reg.orden_trab}" class="input-filtro-ot" style="font-weight:700; color:#0277BD;">
                        </div>
                        <div>
                            <label style="font-size:9px; color:var(--color-text-secondary); font-weight:800; text-transform:uppercase;">REF N°</label>
                            <input type="number" id="edit_ref_orden" value="${reg.ref_orden || ''}" class="input-filtro-ot">
                        </div>
                    </div>

                    <div style="background:#F8FAFC; border:1px solid var(--color-border); padding:10px; border-radius:8px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <div>
                            <label style="font-size:9px; color:var(--color-text-secondary); font-weight:800; text-transform:uppercase;">Fecha</label>
                            <input type="date" id="edit_fecha" value="${reg.fecha || ''}" class="input-filtro-ot">
                        </div>
                        <div>
                            <label style="font-size:9px; color:var(--color-text-secondary); font-weight:800; text-transform:uppercase;">Cotización Divisa ($)</label>
                            <input type="number" id="edit_cotizacion" value="${reg.cotizacion || 1200}" class="input-filtro-ot">
                        </div>
                    </div>

                    <div style="background:#F8FAFC; border:1px solid var(--color-border); padding:10px; border-radius:8px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <div>
                            <label style="font-size:9px; color:var(--color-text-secondary); font-weight:800; text-transform:uppercase;">Depósito</label>
                            <select id="edit_deposito_select" class="input-filtro-ot">${opcionesDepoHtml}</select>
                        </div>
                        <div>
                            <label style="font-size:9px; color:var(--color-text-secondary); font-weight:800; text-transform:uppercase;">Tipo Labor</label>
                            <select id="edit_tipo_labor_select" class="input-filtro-ot">${opcionesRubroHtml}</select>
                        </div>
                    </div>

                    <div style="background:#F8FAFC; border:1px solid var(--color-border); padding:10px; border-radius:8px;">
                        <label style="font-size:9px; color:#104630; font-weight:800; text-transform:uppercase;">Cuadro / Lote Asignado</label>
                        <select id="edit_cuadro_select" class="input-filtro-ot" style="font-weight:700;">
                            ${opcionesCuadrosHtml}
                        </select>
                    </div>

                    <div style="background:#F8FAFC; border:1px solid var(--color-border); padding:10px; border-radius:8px;">
                        <label style="font-size:9px; color:var(--color-text-secondary); font-weight:800; text-transform:uppercase;">Insumo Recetado</label>
                        <select id="edit_insumo_select" onchange="ModuloOrdenes.m_actualizarStockLabel(this)" class="input-filtro-ot">
                            <option value="">Insumo...</option>
                            ${opcionesInsumosHtml}
                        </select>
                        <div style="display: flex; justify-content: space-between; margin-top: 3px; padding: 0 2px;">
                            <div class="stock-indicator" style="font-size: 9.5px; color: var(--color-text-secondary);">Stock disponible: -</div>
                            <div id="edit_depo_badge" style="font-size: 9.5px; color: #1E6B4C; font-weight: 700;">🏢 ${depActual}</div>
                        </div>
                    </div>

                    <div style="background:#F8FAFC; border:1px solid var(--color-border); padding:10px; border-radius:8px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <div>
                            <label style="font-size:9px; color:var(--color-text-secondary); font-weight:800; text-transform:uppercase;">Dosis por Ha</label>
                            <input type="number" id="edit_dosis_ha_input" value="${reg.dosis_ha}" step="0.01" min="0" class="input-filtro-ot">
                        </div>
                        <div>
                            <label style="font-size:9px; color:var(--color-text-secondary); font-weight:800; text-transform:uppercase;">Precio Unitario (U$S)</label>
                            <input type="number" id="edit_imp_uni_input" value="${reg.imp_uni}" step="0.001" min="0" class="input-filtro-ot">
                        </div>
                    </div>

                    <div style="display:flex; justify-content:flex-end; gap:6px; border-top:1px solid var(--color-border); padding-top:10px; margin-top:4px;">
                        <button type="button" onclick="ModuloOrdenes.m_verDetalleFlotante('${reg.orden_trab}', '${reg.ref_orden || 'SIN-REF'}')" class="btn-pastel btn-pastel-amarillo">CANCELAR</button>
                        <button type="button" id="btn_confirmar_dosis_update" class="btn-pastel btn-pastel-plant">APLICAR CAMBIOS</button>
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
                // Mismo lote: se respetan las hectáreas de la fila (puede ser parte de una aplicación). Lote nuevo: su superficie.
                const supLote = (String(nuevoCuadro) === String(reg.cuadro) || !opcionCuadroSeleccionada)
                    ? parseFloat(reg.sup_uso)
                    : parseFloat(opcionCuadroSeleccionada.getAttribute('data-sup'));

                if (!otNum || !nuevaFecha || !nuevoInsumo || isNaN(nuevaDosis) || isNaN(nuevoValorUss) || !nuevoCuadro) {
                    return this.m_mostrarNotificacion("Verifique los datos ingresados.", "error");
                }

                btnGuardar.disabled = true;
                btnGuardar.innerText = "GUARDANDO...";

                const nuevoConsumo = supLote * nuevaDosis;
                const nuevoTotalDolar = nuevoConsumo * nuevoValorUss; 
                const nuevoTotalPesos = nuevoTotalDolar * cotizacionNum;
                const tieneApoyo = parseFloat(reg.ha_apoyo) > 0;
                const marcaApl = /APLICACI[ÓO]N\s+\d+\s+de\s+\d+(\s+·\s+(CON|SIN) APOYO)?/i.exec(reg.comentario || '');
                const supAnterior = parseFloat(reg.sup_uso) || 0;
                // Filas nuevas: el apoyo cargado se prorratea por hectáreas; filas viejas: costo/ha × ha
                const apoyoFilaDolar = !tieneApoyo ? 0 : (marcaApl && supAnterior > 0
                    ? (parseFloat(reg.total_apoyo) || 0) * supLote / supAnterior
                    : (supLote * (parseFloat(reg.total_apoyo) / parseFloat(reg.ha_apoyo))));
                const costoMoOriginal = supLote * (parseFloat(reg.costo_ha) || 0);
                const costoFinalFila = nuevoTotalDolar + costoMoOriginal + apoyoFilaDolar;
                const costoFinalHaDolar = supLote > 0 ? (costoFinalFila / supLote) : 0;

                try {
                    const matchInsumo = (ModuloOrdenes.parametros.insumosMaestros || []).find(m => (m.articulo || '').trim().toUpperCase() === nuevoInsumo.toUpperCase())
                                     || (ModuloOrdenes.parametros.insumos || []).find(m => (m.articulo || '').trim().toUpperCase() === nuevoInsumo.toUpperCase());
                    const codArtActualizado = matchInsumo?.reg_local || matchInsumo?.cod_articulo || reg.cod_articulo || null;

                    const sqlUpdate = `
                        UPDATE egresos_insumos SET
                            orden_trab = ?, ref_orden = ?, fecha = ?, deposito_origen = ?,
                            tipo_labor = ?, centro_costo = ?, cuadro = ?, sup_uso = ?,
                            insumo = ?, imp_uni = ?, dosis_ha = ?, cotizacion = ?,
                            total_consumo = ?, total_dolar = ?, total_pesos = ?,
                            costo_final = ?, costo_final_ha_dolar = ?, comentario = ?,
                            cod_articulo = ?, total_apoyo = CASE WHEN IFNULL(ha_apoyo, 0) > 0 AND ? = 1 THEN ? ELSE total_apoyo END, sincronizado = 0
                        WHERE id = ? AND reg_local = ?
                    `;

                    await this.m_ejecutarSqlLocal(sqlUpdate, [
                        otNum, refNum, nuevaFecha, nuevoDeposito,
                        nuevoTipoLabor, nuevoTipoLabor, nuevoCuadro, supLote,
                        nuevoInsumo, nuevoValorUss, nuevaDosis, cotizacionNum,
                        nuevoConsumo, nuevoTotalDolar, nuevoTotalPesos,
                        costoFinalFila, costoFinalHaDolar, `${marcaApl ? marcaApl[0] + ' · ' : ''}Modificado desde panel de control. Lote: ${nuevoCuadro}.`,
                        codArtActualizado, marcaApl ? 1 : 0, parseFloat(apoyoFilaDolar.toFixed(4)), reg.id, reg.reg_local
                    ]);
                    
                    this.m_mostrarNotificacion("Registro actualizado con éxito en base local.", "exito");
                    await this.m_inicializar();
                    this.m_verDetalleFlotante(otNum, refNum || 'SIN-REF');
                } catch (err) {
                    console.error("Error al guardar edición de insumo:", err);
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
            console.error("Error al finalizar OT:", err);
            this.m_mostrarNotificacion("Error al finalizar proceso local: " + err.message, 'error');
        }
    },

    // opciones: { modo: 'NUEVA' | 'DUPLICAR' | 'EDITAR', ot, ref }
    m_abrirFormulario: function(opciones = {}) {
        setTimeout(() => this.m_construirFormulario(opciones || {}), 10);
    },

    m_modalNuevaLabor: function() {
        const container = document.getElementById('modal-formulario');
        const form = document.getElementById('rx-form');
        if (!container || !form) return;
        const e = this.m_esc;

        const rubroActual = document.getElementById('rec_rubro')?.value || '';
        const rubrosUnicos = [...new Set(this.parametros.labores.map(l => l.rubro).filter(Boolean))];

        // El formulario se oculta (no se destruye): al volver conserva todo lo cargado
        form.style.display = 'none';
        const sub = document.createElement('div');
        sub.className = 'rx';
        sub.id = 'rx-sub-labor';
        sub.innerHTML = `
            <div class="rx-aviso azul"><b>Alta de nueva labor técnica.</b> Se guarda en la tabla maestra de labores.</div>
            <div class="rx-sec">
                <div class="rx-grid">
                    <div class="rx-c req" style="grid-column:span 6;"><label>Rubro operativo</label>
                        <input type="text" id="nl_rubro" list="dl-rubros-nueva-labor" value="${e(rubroActual)}" placeholder="Ej: PULVERIZACIÓN" style="text-transform:uppercase;">
                        <datalist id="dl-rubros-nueva-labor">${rubrosUnicos.map(r => `<option value="${e(r)}">`).join('')}</datalist></div>
                    <div class="rx-c req" style="grid-column:span 6;"><label>Nombre de la labor</label>
                        <input type="text" id="nl_labor" placeholder="Ej: DESECACIÓN" style="text-transform:uppercase; font-weight:700;"></div>
                </div>
            </div>
            <div class="rx-pie" style="justify-content:flex-end;">
                <button type="button" class="rx-btn" id="btn-cancelar-nueva-labor">Volver a la receta</button>
                <button type="button" class="rx-btn prim" id="btn-confirmar-nueva-labor">Registrar labor</button>
            </div>`;
        container.appendChild(sub);
        setTimeout(() => document.getElementById('nl_labor')?.focus(), 30);

        const volver = () => { sub.remove(); form.style.display = ''; };
        document.getElementById('btn-cancelar-nueva-labor').onclick = volver;
        document.getElementById('btn-confirmar-nueva-labor').onclick = async () => {
            const rubro = document.getElementById('nl_rubro').value.trim().toUpperCase();
            const labor = document.getElementById('nl_labor').value.trim().toUpperCase();
            if (!rubro || !labor) return this.m_mostrarNotificacion('Indicá el rubro y el nombre de la labor.', 'error');
            if (this.parametros.labores.some(l => (l.rubro || '').toUpperCase() === rubro && (l.labor || '').toUpperCase() === labor)) {
                return this.m_mostrarNotificacion('Esa labor ya existe en ese rubro.', 'error');
            }
            try {
                const resMax = await ModuloOrdenes.m_ejecutarSqlLocal(`SELECT MAX(CAST(id_labor AS INTEGER)) as max_val FROM tipos_labores`);
                const maxVal = (resMax.data && resMax.data[0] && resMax.data[0].max_val) ? Number(resMax.data[0].max_val) : 0;
                const nuevoId = maxVal + 1;
                await ModuloOrdenes.m_ejecutarSqlLocal(`INSERT INTO tipos_labores (id_labor, rubro, labor, sincronizado) VALUES (?, ?, ?, 0)`, [nuevoId, rubro, labor]);
                ModuloOrdenes.parametros.labores.push({ id_labor: nuevoId, rubro, labor });

                volver();
                const selRubro = document.getElementById('rec_rubro');
                if (selRubro) {
                    const op = [...selRubro.options].find(o => o.value.toUpperCase() === rubro);
                    if (op) selRubro.value = op.value; else selRubro.add(new Option(rubro, rubro, true, true));
                }
                ModuloOrdenes.m_filtrarLaboresPorRubro(selRubro ? selRubro.value : rubro);
                const selLabor = document.getElementById('rec_tipo_app');
                if (selLabor) selLabor.value = labor;
                ModuloOrdenes.m_validarEstadoBotonGuardar();
                ModuloOrdenes.m_mostrarNotificacion(`Labor ${labor} registrada.`, 'exito');
            } catch (err) {
                console.error("Error al registrar nueva labor:", err);
                ModuloOrdenes.m_mostrarNotificacion("Error al guardar labor en base local: " + err.message, 'error');
            }
        };
    },

    m_cambiarTabReceta: function(numTab) {
        document.querySelectorAll('.rx-tab, .tab-receta-arch').forEach(btn => {
            const activa = Number(btn.getAttribute('data-tab')) === numTab;
            btn.classList.toggle('activa', activa);
            btn.classList.toggle('active', activa);
        });
        document.querySelectorAll('.tab-panel-receta').forEach(panel => {
            panel.style.display = Number(panel.getAttribute('data-panel')) === numTab ? 'block' : 'none';
        });
    },

    m_actualizarBadgeInsumos: function() {
        const badge = document.getElementById('tab-badge-insumos');
        if (badge) badge.innerText = document.querySelectorAll('.producto-row, .producto-row-c').length;
    },

    m_filtrarLaboresPorRubro: function(rubroSel) {
        const selectLabor = document.getElementById('rec_tipo_app');
        if (!selectLabor) return;
        if (!rubroSel) {
            selectLabor.innerHTML = '<option value="">Primero elegí el rubro…</option>';
            return;
        }
        const r = String(rubroSel).trim().toUpperCase();
        const laboresFiltradas = this.parametros.labores.filter(l => (l.rubro || '').trim().toUpperCase() === r);
        selectLabor.innerHTML = laboresFiltradas.length === 0
            ? '<option value="">Sin labores — creá una con +</option>'
            : '<option value="">Seleccioná labor…</option>' + laboresFiltradas.map(l => `<option value="${this.m_esc(l.labor)}">${this.m_esc(l.labor)}</option>`).join('');
    },

    m_recalcularTodo: function() {
        const supTotal = this.m_supTotalLotes();
        const elSup = document.getElementById('rec_sup');
        if (elSup) elSup.value = supTotal.toFixed(2);
        const fmt = (n, d = 2) => (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
        const setTxt = (id, t) => { const el = document.getElementById(id); if (el) el.innerText = t; };

        // 1. Receta: consumo y total por renglón + control de stock por insumo/depósito
        const insumos = this.m_leerInsumosReceta();
        const consumoPorStock = new Map();
        insumos.forEach(x => {
            const k = `${x.deposito}|${x.insumo}`;
            consumoPorStock.set(k, (consumoPorStock.get(k) || 0) + supTotal * x.dosis);
        });
        let costoInsumos = 0;
        document.querySelectorAll('.producto-row, .producto-row-c').forEach(row => {
            const dosis = parseFloat(row.querySelector('.p-dosis')?.value) || 0;
            const uUnit = parseFloat(row.querySelector('.p-u-unit')?.value) || 0;
            const tConsumo = supTotal * dosis;
            const tUSS = tConsumo * uUnit;
            const inputConsumo = row.querySelector('.p-total-cons');
            if (inputConsumo) inputConsumo.value = tConsumo.toFixed(2);
            const inputTotal = row.querySelector('.p-u-total');
            if (inputTotal) inputTotal.value = tUSS.toFixed(2);

            const sel = row.querySelector('.p-insumo');
            const op = sel && sel.selectedOptions[0];
            const ind = row.querySelector('.stock-indicator');
            if (ind) {
                if (op && op.value) {
                    const stock = parseFloat(op.getAttribute('data-stock')) || 0;
                    const uni = op.getAttribute('data-unidad') || '';
                    const dep = (row.querySelector('.p-deposito')?.value || '').toUpperCase();
                    const usado = consumoPorStock.get(`${dep}|${op.value}`) || 0;
                    const falta = usado > stock + 1e-9;
                    ind.className = 'stock-indicator rx-stock' + (falta ? ' mal' : '');
                    ind.innerHTML = falta
                        ? `Stock ${fmt(stock)} ${this.m_esc(uni)} · faltan ${fmt(usado - stock)}`
                        : `Stock ${fmt(stock)} ${this.m_esc(uni)}`;
                } else {
                    ind.className = 'stock-indicator rx-stock';
                    ind.innerHTML = 'Stock: —';
                }
            }
            if (sel && sel.value && dosis > 0) costoInsumos += tUSS;
        });

        // 2. Aplicaciones
        const apls = this._aplicaciones || [];
        let costoMo = 0, costoApoyo = 0;
        apls.forEach((a, i) => {
            const ha = this.m_haTotalApl(i);
            const haAp = this.m_haApoyoApl(i);
            const mo = ha * (parseFloat(a.mo) || 0);
            const ap = haAp * (parseFloat(a.costoApoyo) || 0);
            const ins = insumos.reduce((s, x) => s + ha * x.dosis * x.u_unit, 0);
            costoMo += mo; costoApoyo += ap;
            setTxt(`rx-apl-ha-${i}`, `${fmt(ha)} ha`);
            setTxt(`rx-apl-costo-${i}`, `U$S ${fmt(ins + mo + ap)}`);
            const inpHaAp = document.getElementById(`rx-apl-haap-${i}`);
            if (inpHaAp && (a.haApoyo === null || a.haApoyo === '')) inpHaAp.placeholder = fmt(ha);
        });
        this.lotesSeleccionados.forEach(l => {
            const key = this.m_claveLote(l);
            const resto = this.m_haApl(0, key, true);
            const el = document.getElementById(`rx-resto-${this.m_idSeguro(key)}`);
            if (el) {
                el.innerText = fmt(resto);
                el.classList.toggle('mal', resto < -1e-9);
            }
        });
        this.m_renderConsumoAplicaciones(insumos);

        // 3. Totales
        const total = costoInsumos + costoMo + costoApoyo;
        setTxt('rx-sup-txt', `${fmt(supTotal)} ha`);
        setTxt('rx-t-sup', `${fmt(supTotal)} ha`);
        setTxt('rx-t-ins', `U$S ${fmt(costoInsumos)}`);
        setTxt('rx-t-mo', `U$S ${fmt(costoMo)}`);
        setTxt('rx-t-apoyo', `U$S ${fmt(costoApoyo)}`);
        setTxt('rx-t-ha', supTotal > 0 ? fmt(total / supTotal) : '0');
        setTxt('rx-t-total', `U$S ${fmt(total)}`);
        setTxt('rx-tb-3', String(apls.length));
        const elTotIns = document.getElementById('rec_total_ins');
        if (elTotIns) elTotIns.value = costoInsumos.toFixed(2);
        const elTotTodo = document.getElementById('rec_total_todo');
        if (elTotTodo) elTotTodo.value = total.toFixed(2);

        this.m_validarEstadoBotonGuardar();
    },

    m_validarEstadoBotonGuardar: function() {
        const btnGuardar = document.getElementById('btn-guardar-despacho-action');
        if (!btnGuardar) return;
        const motivo = this.m_motivoNoGuardar();
        btnGuardar.disabled = !!motivo;
        if (motivo) btnGuardar.setAttribute('title', motivo); else btnGuardar.removeAttribute('title');
        const lbl = document.getElementById('rx-motivo');
        if (lbl) lbl.innerText = motivo || '';

        // Indicadores de las pestañas
        const v = id => (document.getElementById(id)?.value || '').trim();
        const tb1 = document.getElementById('rx-tb-1');
        if (tb1) {
            const ok1 = v('rec_orden_cab') && v('rec_fecha') && v('rec_est') && v('rec_rubro') && v('rec_tipo_app') && this.lotesSeleccionados.length > 0;
            tb1.innerText = ok1 ? '✓' : '!';
            tb1.className = 'rx-tab-b ' + (ok1 ? 'ok' : 'mal');
        }
        const tb2 = document.getElementById('tab-badge-insumos');
        if (tb2) {
            const n = this.m_leerInsumosReceta().length;
            tb2.innerText = n;
            tb2.className = 'rx-tab-b ' + (n > 0 ? 'ok' : 'mal');
        }
        const tb3 = document.getElementById('rx-tb-3');
        if (tb3) tb3.className = 'rx-tab-b ' + (this.m_problemaAplicaciones() ? 'mal' : 'ok');
    },

    m_agregarLoteALista: function(loteId) {
        if (!loteId) return;
        const campoActual = document.getElementById('rec_campo')?.value || '';
        const loteInfo = this.lotesActuales.find(l => String(l.lote) === String(loteId));
        if (!loteInfo) return;
        if (this.lotesSeleccionados.find(l => String(l.lote) === String(loteId) && l.campo_nombre === campoActual)) {
            return this.m_mostrarNotificacion(`El lote ${loteId} ya está en la orden.`, 'error');
        }
        this.lotesSeleccionados.push({ ...loteInfo, sup: parseFloat(loteInfo.sup) || 0, campo_nombre: campoActual });
        this.m_renderizarLotesSeleccionados();
    },

    m_quitarLote: function(loteId, campoNombre) {
        this.lotesSeleccionados = this.lotesSeleccionados.filter(l => !(String(l.lote) === String(loteId) && l.campo_nombre === campoNombre));
        const key = `${campoNombre}|${loteId}`;
        (this._aplicaciones || []).forEach(a => { delete a.ha[key]; });
        this.m_renderizarLotesSeleccionados();
    },

    m_renderizarLotesSeleccionados: function() {
        const contenedor = document.getElementById('lista-lotes-badge');
        const e = this.m_esc;
        if (contenedor) {
            contenedor.innerHTML = this.lotesSeleccionados.length === 0
                ? `<div class="rx-vacio">Elegí establecimiento, campo y agregá los lotes de la orden.</div>`
                : this.lotesSeleccionados.map(l => `
                    <span class="rx-lote">${e(l.campo_nombre)} · <b>Lote ${e(l.lote)}</b>${l.nombre_lote ? ` <i>${e(l.nombre_lote)}</i>` : ''} · ${(parseFloat(l.sup) || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })} ha
                        <button type="button" title="Quitar lote" onclick="ModuloOrdenes.m_quitarLote(${this.m_jsStr(l.lote)}, ${this.m_jsStr(l.campo_nombre)})">&times;</button>
                    </span>`).join('');
        }
        this.m_renderAplicaciones();
    },

    m_filtrarCampos: function(est) {
        const e = this.m_esc;
        const nombres = [...new Set(this.parametros.campos.filter(c => (c.establecimiento || '').trim().toUpperCase() === String(est || '').trim().toUpperCase()).map(c => c.campo).filter(Boolean))].sort();
        const elCampo = document.getElementById('rec_campo');
        if (elCampo) elCampo.innerHTML = '<option value="">Seleccioná…</option>' + nombres.map(n => `<option value="${e(n)}">${e(n)}</option>`).join('');
        const elCuadro = document.getElementById('rec_cuadro');
        if (elCuadro) elCuadro.innerHTML = '<option value="">Elegí el campo…</option>';
    },

    m_filtrarLotes: async function(campoSel) {
        try {
            const res = await this.m_ejecutarSqlLocal(
                `SELECT lote, nombre_lote, sup FROM cuadros WHERE UPPER(TRIM(campo)) = ? ORDER BY CAST(lote AS INTEGER), lote ASC`,
                [String(campoSel || '').trim().toUpperCase()]
            );
            this.lotesActuales = res.data || res || [];
            const e = this.m_esc;
            const elCuadro = document.getElementById('rec_cuadro');
            if (elCuadro) elCuadro.innerHTML = '<option value="">Añadir lote…</option>' + this.lotesActuales.map(l =>
                `<option value="${e(l.lote)}">Lote ${e(l.lote)}${l.nombre_lote ? ' · ' + e(l.nombre_lote) : ''} (${e(l.sup)} ha)</option>`).join('');
        } catch (err) { console.error(err); }
    },

    // pref (opcional): { deposito, insumo, cod, dosis, u_unit } para precargar al duplicar/editar
    m_agregarFilaProducto: function(pref = null) {
        const container = document.getElementById('contenedor-productos');
        if (!container) return;
        const e = this.m_esc;

        const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const row = document.createElement('div');
        row.className = 'producto-row-c';
        row.id = `fila-${id}`;

        const listaDepositos = this.m_obtenerListaDepositos();
        const depPref = pref && pref.deposito ? String(pref.deposito).trim().toUpperCase() : null;
        if (depPref && !listaDepositos.includes(depPref)) listaDepositos.push(depPref);
        const depActual = depPref || listaDepositos[0];

        row.innerHTML = `
            <select class="p-deposito" onchange="ModuloOrdenes.m_cambiarDepositoFila(this)" style="font-weight:700; color:#0277BD;">
                ${listaDepositos.map(d => `<option value="${e(d)}" ${d === depActual ? 'selected' : ''}>${e(d)}</option>`).join('')}
            </select>
            <div style="min-width:0;">
                <select class="p-insumo" onchange="ModuloOrdenes.m_actualizarStockLabel(this); ModuloOrdenes.m_recalcularTodo()"></select>
                <div class="stock-indicator rx-stock">Stock: —</div>
            </div>
            <input type="number" class="p-dosis rx-num" placeholder="0" step="any" min="0" oninput="ModuloOrdenes.m_recalcularTodo()" value="${pref ? e(pref.dosis) : ''}">
            <input type="number" class="p-total-cons rx-num" readonly placeholder="0.00">
            <input type="number" class="p-u-unit rx-num" placeholder="0.00" step="any" min="0" oninput="ModuloOrdenes.m_recalcularTodo()" value="${pref ? e(pref.u_unit) : ''}">
            <input type="number" class="p-u-total rx-num" readonly placeholder="0.00" style="color:#1E6B4C; font-weight:800;">
            <button type="button" class="rx-x" title="Quitar insumo" onclick="document.getElementById('fila-${id}').remove(); ModuloOrdenes.m_recalcularTodo(); ModuloOrdenes.m_actualizarBadgeInsumos();">&times;</button>
        `;
        container.appendChild(row);
        this.m_llenarOpcionesInsumo(row, depActual, pref ? pref.insumo : '', pref ? pref.cod : '');
        this.m_actualizarBadgeInsumos();
        this.m_recalcularTodo();
    },

    m_obtenerListaDepositos: function() {
        const norm = (t) => (t || '').toString().replace(/\s+/g, ' ').trim().toUpperCase();

        const desdeTablaMaestra = (this.parametros.depositos || [])
            .map(d => norm(d.deposito))
            .filter(Boolean);

        const desdeIngresos = (this.rawIngresos || [])
            .map(i => norm(i.campo_depo))
            .filter(Boolean);

        const desdeEgresos = (this.rawEgresos || [])
            .map(e => norm(e.deposito_origen))
            .filter(Boolean);

        const combinados = [...new Set([...desdeTablaMaestra, ...desdeIngresos, ...desdeEgresos])].sort();
        return combinados.length > 0 ? combinados : ['DEB_CENTRAL'];
    },

    m_cambiarDepositoFila: function(selectElem) {
        const row = selectElem.closest('.producto-row, .producto-row-c');
        if (!row) return;
        const depoKey = (selectElem.value || 'DEB_CENTRAL').trim().toUpperCase();
        const selectInsumo = row.querySelector('.p-insumo');
        const actual = selectInsumo ? selectInsumo.value : '';
        this.m_llenarOpcionesInsumo(row, depoKey, actual, selectInsumo?.selectedOptions[0]?.getAttribute('data-cod') || '');
        // si en el depósito nuevo no hay stock de ese insumo, se deja vacío para elegir otro
        const op = selectInsumo?.selectedOptions[0];
        if (op && op.textContent.includes('(sin stock)') && !this._otOrigen) selectInsumo.value = '';
        this.m_recalcularTodo();
    },

    m_actualizarStockLabel: function(selectElem) {
        const selectedOption = selectElem.options[selectElem.selectedIndex];
        const stockIndicator = selectElem.parentElement.querySelector('.stock-indicator');
        if (!stockIndicator) return;
        if (selectedOption && selectedOption.value !== "") {
            const stock = Number(selectedOption.getAttribute('data-stock')) || 0;
            const unidad = selectedOption.getAttribute('data-unidad') || '';
            stockIndicator.innerHTML = `Stock ${stock.toLocaleString('es-AR', { maximumFractionDigits: 2 })} ${this.m_esc(unidad)}`;
        } else {
            stockIndicator.innerHTML = `Stock: —`;
        }
    },

    // Compatibilidad: el apoyo ahora se define en cada aplicación
    m_toggleApoyo: function(show) {
        if (this._aplicaciones && this._aplicaciones[0]) this.m_setApl(0, 'apoyo', !!show, true);
    },

    m_guardarReceta: async function(e) {
        if (e) e.preventDefault();
        const motivo = this.m_motivoNoGuardar();
        if (motivo) return this.m_mostrarNotificacion(motivo, 'error');

        const modo = this._modoReceta || 'NUEVA';
        const orden_trab = parseInt(document.getElementById('rec_orden_cab')?.value, 10) || null;
        const ref_orden_raw = document.getElementById('rec_ref_orden')?.value;
        const ref_orden = (ref_orden_raw && ref_orden_raw.trim() !== '') ? parseInt(ref_orden_raw, 10) : null;
        const estado = (document.getElementById('rec_estado')?.value || 'PENDIENTE').trim() || 'PENDIENTE';
        const est = document.getElementById('rec_est')?.value || '';
        const rubro = (document.getElementById('rec_rubro')?.value || '').toUpperCase();
        const labor = (document.getElementById('rec_tipo_app')?.value || '').toUpperCase();
        const cotizacion = parseFloat(document.getElementById('rec_cot')?.value) || 1200;
        const insumosList = this.m_leerInsumosReceta();
        const apls = this._aplicaciones || [this.m_nuevaAplicacion()];
        const N = apls.length;
        const refClave = String(ref_orden ?? 'SIN-REF');

        // Filas actuales de la OT que se edita (se reemplazan al final, sólo si el alta salió bien)
        const filasViejas = modo === 'EDITAR' && this._otOrigen
            ? this.parametros.ordenes.filter(o => String(o.orden_trab) === this._otOrigen.ot && String(o.ref_orden || 'SIN-REF') === this._otOrigen.ref)
            : [];
        const idsViejos = new Set(filasViejas.map(o => String(o.id)));

        // ¿Ya existe otra OT con ese número + ref?
        const choca = this.parametros.ordenes.some(o => String(o.orden_trab) === String(orden_trab) && String(o.ref_orden || 'SIN-REF') === refClave && !idsViejos.has(String(o.id)));
        if (choca) {
            const ok = await this.m_mostrarConfirmacion('OT existente', `La OT N° ${orden_trab}${ref_orden !== null ? ' / Ref ' + ref_orden : ''} ya existe. Si seguís, estos insumos se suman a esa orden. ¿Continuar?`);
            if (!ok) return;
        }

        const btnGuardar = document.getElementById('btn-guardar-despacho-action');
        const textoBtn = btnGuardar ? btnGuardar.innerText : '';
        if (btnGuardar) { btnGuardar.innerText = "Guardando…"; btnGuardar.disabled = true; }

        try {
            const resMaxId = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(id AS INTEGER)) as max_id FROM egresos_insumos`);
            let currentId = (resMaxId.data && resMaxId.data[0] && resMaxId.data[0].max_id) ? Number(resMaxId.data[0].max_id) : 0;
            const r4 = (n) => parseFloat((Number(n) || 0).toFixed(4));

            const columnas = `reg_local, id, orden_trab, ref_orden, fecha, estado, establecimiento,
                    campo, cuadro, sup_uso, tipo_labor, labor, insumo, dosis_ha,
                    imp_uni, total_consumo, total_dolar, total_pesos, contratista,
                    costo_ha, apoyo, ha_apoyo, total_apoyo, cotizacion, costo_final,
                    costo_final_ha_dolar, tabla_origen, deposito_origen, centro_costo,
                    comentario, cod_articulo, sincronizado`;
            const filas = [];

            apls.forEach((a, i) => {
                const haApl = this.m_haTotalApl(i);
                const haApoyoApl = this.m_haApoyoApl(i);
                const mo_ha = parseFloat(a.mo) || 0;
                const costo_apoyo_ha = a.apoyo ? (parseFloat(a.costoApoyo) || 0) : 0;
                const contratista = (a.contratista || '').trim().toUpperCase();
                const personal = a.apoyo ? (a.personal || '').trim().toUpperCase() : '';
                const marca = `APLICACIÓN ${i + 1} de ${N}${N > 1 ? (a.apoyo ? ' · CON APOYO' : ' · SIN APOYO') : ''}`;

                this.lotesSeleccionados.forEach(lote => {
                    const supLote = r4(this.m_haApl(i, this.m_claveLote(lote)));
                    if (supLote <= 0) return;
                    // apoyo repartido según las hectáreas de este lote en la aplicación
                    const haApoyoLote = a.apoyo && haApl > 0 ? r4(haApoyoApl * supLote / haApl) : 0;

                    insumosList.forEach((ins, k) => {
                        currentId++;
                        const primero = k === 0;   // la labor y el apoyo se cargan una vez por lote (no por cada insumo)
                        const total_consumo_fila = r4(supLote * ins.dosis);
                        const total_dolar_fila = r4(total_consumo_fila * ins.u_unit);
                        const total_pesos_fila = r4(total_dolar_fila * cotizacion);
                        const costo_mo_fila = primero ? r4(supLote * mo_ha) : 0;
                        const costo_apoyo_fila = primero ? r4(haApoyoLote * costo_apoyo_ha) : 0;
                        const costo_final_fila = r4(total_dolar_fila + costo_mo_fila + costo_apoyo_fila);

                        filas.push([
                            this.m_uniqueid('PROD-'), currentId, orden_trab, ref_orden, a.fecha, estado, est,
                            lote.campo_nombre || lote.campo || 'SIN CAMPO', lote.lote || lote.cuadro || 'SIN CUADRO', supLote,
                            rubro, labor, ins.insumo, ins.dosis,
                            ins.u_unit, total_consumo_fila, total_dolar_fila, total_pesos_fila, contratista,
                            primero ? mo_ha : 0, personal, primero ? haApoyoLote : 0, costo_apoyo_fila, cotizacion, costo_final_fila,
                            supLote > 0 ? r4(costo_final_fila / supLote) : 0, 'ORDEN DE TRABAJO', ins.deposito, rubro || 'GENERAL',
                            `${marca} · Fila autogenerada mediante receta técnica.`, ins.cod_articulo || null
                        ]);
                    });
                });
            });

            if (!filas.length) throw new Error('No hay filas para guardar (revisá hectáreas e insumos).');

            // Un solo INSERT por tanda: se guarda toda la receta o nada
            const marcador = '(' + new Array(31).fill('?').join(', ') + ', 0)';
            const TANDA = 800;
            for (let d = 0; d < filas.length; d += TANDA) {
                const parte = filas.slice(d, d + TANDA);
                await this.m_ejecutarSqlLocal(
                    `INSERT INTO egresos_insumos (${columnas}) VALUES ${parte.map(() => marcador).join(', ')}`,
                    parte.flat()
                );
            }

            if (filasViejas.length) {
                const ids = filasViejas.map(o => o.id);
                await this.m_ejecutarSqlLocal(
                    `DELETE FROM egresos_insumos WHERE id IN (${ids.map(() => '?').join(', ')})`, ids
                );
            }

            this._otExcluida = null;
            this.m_mostrarNotificacion(
                modo === 'EDITAR' ? `OT N° ${orden_trab} actualizada (${N} aplicación/es).`
                : `Receta guardada: OT N° ${orden_trab}${N > 1 ? ` en ${N} aplicaciones` : ''}.`, "exito");

            const modalBox = document.getElementById('modal-agrosoft');
            if (modalBox) modalBox.style.display = 'none';
            await this.m_inicializar();
        } catch (err) {
            console.error("Error al guardar receta local:", err);
            this.m_mostrarNotificacion("Error al guardar la orden local: " + err.message, "error");
        } finally {
            if (btnGuardar) { btnGuardar.innerText = textoBtn || 'Guardar receta'; btnGuardar.disabled = false; }
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

    m_exportarExcelGlobal: async function() {
        const filasOT = (this.parametros && this.parametros.ordenes ? this.parametros.ordenes : [])
            .filter(o => (o.tabla_origen || '').trim().toUpperCase() === 'ORDEN DE TRABAJO');
        
        if (filasOT.length === 0) {
            return this.m_mostrarNotificacion ? this.m_mostrarNotificacion("No hay órdenes de trabajo para exportar.", "error") : alert("No hay órdenes de trabajo.");
        }

        const gruposOT = this.m_obtenerGruposOrdenes(filasOT);
        const esElectron = typeof require === 'function' && typeof process !== 'undefined';
        const folio = typeof window.generarFolio === 'function' ? window.generarFolio('OT') : `OT-${Date.now().toString().slice(-6)}`;
        const hoyStr = ModuloOrdenes.m_hoyLocal();
        const operario = (typeof operarioName !== 'undefined' ? operarioName : (window.operarioGlobal || 'ADMINISTRADOR')).toUpperCase();

        let ExcelJS = null;
        if (typeof window !== 'undefined' && window.ExcelJS) {
            ExcelJS = window.ExcelJS;
        } else if (typeof require === 'function') {
            try { ExcelJS = require('exceljs'); } catch (e) { ExcelJS = null; }
        }

        const columnas = [
            { header: 'OT N°', key: 'ot', width: 12, halign: 'center' },
            { header: 'REF', key: 'ref', width: 10, halign: 'center' },
            { header: 'ESTADO', key: 'estado', width: 14, halign: 'center' },
            { header: 'FECHA', key: 'fecha', width: 13, halign: 'center' },
            { header: 'ESTABLECIMIENTO', key: 'establecimiento', width: 22 },
            { header: 'CAMPO', key: 'campo', width: 16 },
            { header: 'LOTES / CUADROS', key: 'lotes', width: 24 },
            { header: 'CENTRO DE COSTO / LABOR', key: 'labor', width: 24 },
            { header: 'CONTRATISTA', key: 'contratista', width: 20 },
            { header: 'APLIC.', key: 'n_apl', width: 8, halign: 'center' },
            { header: 'DETALLE DE APLICACIONES (FECHA · HA · APOYO)', key: 'det_apl', width: 60, wrap: true },
            { header: 'SUP TOTAL (HA)', key: 'sup_total', width: 16, halign: 'right', numero: true },
            { header: 'COSTO TOTAL (U$S)', key: 'costo_usd', width: 18, halign: 'right', numero: true, monedaUsd: true },
            { header: 'COSTO TOTAL ($)', key: 'costo_ars', width: 18, halign: 'right', numero: true, monedaArs: true }
        ];

        let sumaSup = 0, sumaUsd = 0, sumaArs = 0, totalAplicaciones = 0, aplicacionesConApoyo = 0;
        const filasProcesadas = gruposOT.map(g => {
            const sup = Number(g.sup_total || 0);
            const usd = Number(g.costo_final || 0);
            const ars = Number(g.costo_pesos || 0);
            sumaSup += sup;
            sumaUsd += usd;
            sumaArs += ars;
            const apls = this.m_resumenAplicacionesOT(g.filasRaw);
            totalAplicaciones += apls.length;
            aplicacionesConApoyo += apls.filter(x => x.conApoyo).length;

            return {
                n_apl: apls.length,
                det_apl: apls.map(x => this.m_textoAplicacion(x)).join('\n'),
                ot: g.orden_trab,
                ref: g.ref_orden === 'SIN-REF' ? '' : g.ref_orden,
                estado: (g.estado || 'PENDIENTE').toUpperCase(),
                fecha: this.m_fechaAR(g.fecha),
                establecimiento: g.establecimiento || '-',
                campo: g.campo || '-',
                lotes: (g.cuadros || []).join(', ') || '-',
                labor: g.tipo_labor || '-',
                contratista: g.contratista || '-',
                sup_total: sup,
                costo_usd: usd,
                costo_ars: ars
            };
        });

        const confTema = window.SALVUCCI_CONF || {
            argbDark: 'FF123F2C',
            argbTema: 'FF1E6B4C',
            empresaRazon: 'SALVUCCI GESTIÓN · AGROSOFT J&L',
            empresaDomicilio: 'Auditoría Central de Prescripciones y Labores'
        };

        if (ExcelJS) {
            try {
                const wb = new ExcelJS.Workbook();
                wb.creator = 'Salvucci Gestión · AgroSoft J&L';
                wb.created = new Date();

                const ws = wb.addWorksheet('Órdenes de Trabajo', {
                    views: [{ state: 'frozen', ySplit: 5 }],
                    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
                });

                ws.columns = columnas.map(c => ({ header: c.header, key: c.key, width: c.width }));
                filasProcesadas.forEach(f => ws.addRow(f));

                ws.spliceRows(1, 0, [], [], [], []);
                const nCols = columnas.length;

                ws.getRow(1).height = 32;
                ws.getRow(2).height = 16;
                ws.getRow(3).height = 15;
                ws.getRow(4).height = 15;

                ws.mergeCells(1, 1, 1, nCols);
                ws.mergeCells(2, 1, 2, nCols);
                ws.mergeCells(3, 1, 3, nCols);
                ws.mergeCells(4, 1, 4, nCols);

                const cTitulo = ws.getCell(1, 1);
                cTitulo.value = 'SALVUCCI GESTIÓN — LIBRO MAESTRO DE ÓRDENES DE TRABAJO';
                cTitulo.font = { bold: true, size: 14, color: { argb: confTema.argbDark } };
                cTitulo.alignment = { vertical: 'middle', horizontal: 'left' };

                const cSub = ws.getCell(2, 1);
                cSub.value = 'Consolidado general de prescripciones agronómicas, coberturas y costos';
                cSub.font = { italic: true, size: 9.5, color: { argb: 'FF556358' } };
                cSub.alignment = { vertical: 'middle', horizontal: 'left' };

                const cEmpresa = ws.getCell(3, 1);
                cEmpresa.value = `${confTema.empresaRazon} — ${confTema.empresaDomicilio}`;
                cEmpresa.font = { size: 8.5, color: { argb: 'FF556358' } };
                cEmpresa.alignment = { vertical: 'middle', horizontal: 'left' };

                const cMeta = ws.getCell(4, 1);
                cMeta.value = `Folio: ${folio}   ·   Emitido: ${new Date().toLocaleString('es-AR')}   ·   Operador: ${operario}   ·   Órdenes: ${gruposOT.length}`;
                cMeta.font = { bold: true, size: 8.5, color: { argb: confTema.argbTema } };
                cMeta.alignment = { vertical: 'middle', horizontal: 'left' };

                const filaHead = ws.getRow(5);
                filaHead.height = 24;
                filaHead.eachCell({ includeEmpty: true }, cell => {
                    cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: confTema.argbTema } };
                    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                    cell.border = { bottom: { style: 'thin', color: { argb: confTema.argbDark } } };
                });

                const primeraFila = 6;
                const ultimaFila = primeraFila + filasProcesadas.length - 1;

                for (let r = primeraFila; r <= ultimaFila; r++) {
                    const fila = ws.getRow(r);
                    columnas.forEach((c, i) => {
                        const cell = fila.getCell(i + 1);
                        cell.alignment = { vertical: 'middle', horizontal: c.halign || 'left', wrapText: !!c.wrap };
                        cell.font = { size: 9 };
                        cell.border = {
                            top: { style: 'hair', color: { argb: 'FFE0DCD4' } },
                            bottom: { style: 'hair', color: { argb: 'FFE0DCD4' } }
                        };
                        if (c.numero && !c.monedaUsd && !c.monedaArs) cell.numFmt = '#,##0.00';
                        if (c.monedaUsd) cell.numFmt = '"U$S" #,##0.00';
                        if (c.monedaArs) cell.numFmt = '"$" #,##0.00';
                        if (c.key === 'estado') {
                            const est = String(cell.value || '');
                            cell.font = { size: 8.5, bold: true, color: { argb: est === 'APLICADO' || est === 'FINALIZADO' || est === 'TERMINADO' ? 'FF1E6B4C' : 'FFC62828' } };
                        }
                    });
                    const nApl = Number(fila.getCell(columnas.findIndex(c => c.key === 'n_apl') + 1).value) || 1;
                    if (nApl > 1) fila.height = 14 * nApl;
                    if ((r - primeraFila) % 2 === 1) {
                        fila.eachCell({ includeEmpty: true }, cell => {
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FBF9' } };
                        });
                    }
                }

                const filaTot = ws.getRow(ultimaFila + 2);
                filaTot.height = 20;
                columnas.forEach((c, i) => {
                    const cell = filaTot.getCell(i + 1);
                    if (i === 0) cell.value = 'TOTALES';
                    else if (c.numero) {
                        const colLetra = cell.address.replace(/\d+$/, '');
                        cell.value = { formula: `SUM(${colLetra}${primeraFila}:${colLetra}${ultimaFila})` };
                        if (c.monedaUsd) cell.numFmt = '"U$S" #,##0.00';
                        else if (c.monedaArs) cell.numFmt = '"$" #,##0.00';
                        else cell.numFmt = '#,##0.00';
                    }
                    cell.font = { bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: confTema.argbDark } };
                    cell.alignment = { vertical: 'middle', horizontal: c.halign || 'left' };
                });

                const wsRes = wb.addWorksheet('Resumen de Inversión');
                wsRes.columns = [{ header: 'INDICADOR', key: 'label', width: 34 }, { header: 'VALOR', key: 'valor', width: 24 }];
                wsRes.getRow(1).eachCell(cell => {
                    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: confTema.argbTema } };
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                });
                wsRes.getRow(1).height = 22;

                const resumenKpi = [
                    { label: 'Órdenes de Trabajo Totales', valor: String(gruposOT.length) },
                    { label: 'Superficie Total Cubierta (Has)', valor: sumaSup.toLocaleString('es-AR', { minimumFractionDigits: 2 }) },
                    { label: 'Aplicaciones Totales', valor: String(totalAplicaciones) },
                    { label: 'Aplicaciones con Apoyo', valor: String(aplicacionesConApoyo) },
                    { label: 'Órdenes en más de una aplicación', valor: String(filasProcesadas.filter(f => f.n_apl > 1).length) },
                    { label: 'Inversión Total Dólar (U$S)', valor: `U$S ${sumaUsd.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` },
                    { label: 'Inversión Total Pesos ($)', valor: `$ ${sumaArs.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` },
                    { label: 'Folio de Auditoría', valor: folio },
                    { label: 'Fecha de Emisión', valor: new Date().toLocaleString('es-AR') },
                    { label: 'Operador Responsable', valor: operario }
                ];
                resumenKpi.forEach(r => wsRes.addRow({ label: r.label, valor: r.valor }));

                // Detalle completo de cada aplicación y su consumo
                this.m_xlsHojasAplicaciones(wb, gruposOT, confTema, `Folio: ${folio}  ·  Emitido: ${new Date().toLocaleString('es-AR')}  ·  Operador: ${operario}`);

                const nombreArchivo = `Salvucci_Ordenes_Trabajo_${hoyStr}.xlsx`;
                const buffer = await wb.xlsx.writeBuffer();

                if (esElectron && typeof window.guardarEnDescargas === 'function') {
                    window.guardarEnDescargas(nombreArchivo, Buffer.from(buffer));
                } else if (typeof window.descargarNativoBlob === 'function') {
                    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                    window.descargarNativoBlob(blob, nombreArchivo);
                }

                if (this.m_mostrarNotificacion) this.m_mostrarNotificacion(`✓ Reporte Excel generado: ${nombreArchivo}`, "exito");
                return;
            } catch (err) {
                console.warn("Fallo exportación ExcelJS, usando fallback:", err);
            }
        }

        let csv = "\uFEFFOT;REF;ESTADO;FECHA;ESTABLECIMIENTO;CAMPO;LOTES;CENTRO_COSTO;CONTRATISTA;APLICACIONES;DETALLE_APLICACIONES;SUP_TOTAL_HA;COSTO_TOTAL_USD;COSTO_TOTAL_ARS\n";
        filasProcesadas.forEach(g => {
            csv += `"${g.ot}";"${g.ref}";"${g.estado}";"${g.fecha}";"${g.establecimiento}";"${g.campo}";"${g.lotes}";"${g.labor}";"${g.contratista}";${g.n_apl};"${g.det_apl.replace(/\n/g, ' | ')}";${g.sup_total.toFixed(2)};${g.costo_usd.toFixed(2)};${g.costo_ars.toFixed(2)}\n`;
        });
        csv += `TOTALES;;;;;;;;;${totalAplicaciones};;${sumaSup.toFixed(2)};${sumaUsd.toFixed(2)};${sumaArs.toFixed(2)}\n`;
        csv += `\nOT;APLICACION;FECHA;HECTAREAS;LOTES;CONTRATISTA;APOYO;PERSONAL_APOYO;HA_APOYO;INSUMOS_USD;LABOR_USD;APOYO_USD;TOTAL_USD\n`;
        gruposOT.forEach(g => this.m_resumenAplicacionesOT(g.filasRaw).forEach(x => {
            csv += `"${g.orden_trab}";"${x.etiqueta}";"${x.fechaAR}";${x.ha.toFixed(2)};"${x.lotesTxt}";"${x.contratista}";"${x.conApoyo ? 'SI' : 'NO'}";"${x.personal}";${x.haApoyo.toFixed(2)};${x.insumosUsd.toFixed(2)};${x.laborUsd.toFixed(2)};${x.apoyoUsd.toFixed(2)};${x.totalUsd.toFixed(2)}\n`;
        }));

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        if (typeof window.descargarNativoBlob === 'function') {
            window.descargarNativoBlob(blob, `Salvucci_Ordenes_Trabajo_${hoyStr}.csv`);
        }
        if (this.m_mostrarNotificacion) this.m_mostrarNotificacion("Reporte CSV compatible con Excel descargado.", "exito");
    },

    m_exportarPDFGlobal: function() {
        if (!this.parametros || !this.parametros.ordenes || this.parametros.ordenes.length === 0) {
            return this.m_mostrarNotificacion ? this.m_mostrarNotificacion("No hay datos para emitir reporte.", "error") : alert("No hay datos.");
        }

        const filtros = this.m_obtenerFiltros();
        const gruposFiltrados = this.m_aplicarFiltros(filtros);
        if (gruposFiltrados.length === 0) {
            return this.m_mostrarNotificacion ? this.m_mostrarNotificacion("No hay registros para la combinación de filtros actual.", "error") : alert("Sin registros.");
        }

        const esElectron = typeof require === 'function' && typeof process !== 'undefined';
        const folio = typeof window.generarFolio === 'function' ? window.generarFolio('OT') : `OT-${Date.now().toString().slice(-6)}`;
        const hoyStr = ModuloOrdenes.m_hoyLocal();
        const emitido = new Date().toLocaleString('es-AR');
        const operario = (typeof operarioName !== 'undefined' ? operarioName : (window.operarioGlobal || 'ADMINISTRADOR')).toUpperCase();

        const totalCosto = gruposFiltrados.reduce((acc, r) => acc + (parseFloat(r.costo_final) || 0), 0);
        const totalHas = gruposFiltrados.reduce((acc, r) => acc + (parseFloat(r.sup_total) || 0), 0);

        let jsPDFClass = null;
        let autoTableFunc = null;

        if (typeof window !== 'undefined' && window.jspdf) {
            jsPDFClass = window.jspdf.jsPDF;
            autoTableFunc = (doc, opts) => doc.autoTable ? doc.autoTable(opts) : (window.jspdf.autoTable ? window.jspdf.autoTable(doc, opts) : null);
        } else if (esElectron) {
            try {
                jsPDFClass = require('jspdf').jsPDF;
                autoTableFunc = (doc, opts) => {
                    const at = require('jspdf-autotable');
                    return (typeof at === 'function') ? at(doc, opts) : (at.default ? at.default(doc, opts) : doc.autoTable(opts));
                };
            } catch (e) {
                console.warn("Fallo import jsPDF:", e);
            }
        }

        const confTema = window.SALVUCCI_CONF || {
            rgbTema: [30, 107, 76],
            rgbTemaDark: [18, 63, 44],
            empresaDomicilio: 'Auditoría Central de Prescripciones y Labores',
            pieInstitucional: 'Sistemas de Gestión Agrosoft J&L - Chimpay R.N.'
        };

        if (jsPDFClass) {
            try {
                const doc = new jsPDFClass({ unit: 'mm', format: 'a4', orientation: 'landscape' });
                const pageW = doc.internal.pageSize.getWidth();
                const pageH = doc.internal.pageSize.getHeight();
                const margen = 12;
                const ALTO_HEADER = 38;
                const ALTO_PIE = 14;
                const logoBase64 = typeof window.cargarLogoBase64 === 'function' ? window.cargarLogoBase64() : null;

                function dibujarEncabezado(data) {
                    const pagina = data && data.pageNumber ? data.pageNumber : 1;

                    doc.setFillColor(...confTema.rgbTema);
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
                    doc.setFontSize(14);
                    doc.setTextColor(...confTema.rgbTemaDark);
                    doc.text('SALVUCCI GESTIÓN · RECETAS Y LABORES AGRÍCOLAS', xTexto, 12.5);

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(8);
                    doc.setTextColor(85, 99, 88);
                    doc.text(confTema.empresaDomicilio, xTexto, 17);

                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(10.5);
                    doc.setTextColor(...confTema.rgbTema);
                    doc.text('REPORTE CONSOLIDADO DE ÓRDENES DE TRABAJO', xTexto, 24.5);

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(7.5);
                    doc.setTextColor(110, 120, 115);
                    doc.text('Prescripciones ejecutadas, cuadros asignados, costos por labor e inversión total', xTexto, 29);

                    const anchoCb = 64;
                    const xCb = pageW - margen - anchoCb;
                    if (typeof window.dibujarCodigoBarrasPdf === 'function') {
                        window.dibujarCodigoBarrasPdf(doc, folio, xCb, 6.5, anchoCb, 10);
                    }

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(7.2);
                    doc.setTextColor(90, 100, 95);
                    doc.text(`Emitido: ${emitido}`, pageW - margen, 24, { align: 'right' });
                    doc.text(`Operador: ${operario}`, pageW - margen, 28, { align: 'right' });
                    doc.text(`Órdenes: ${gruposFiltrados.length}   ·   Hoja ${pagina}`, pageW - margen, 32, { align: 'right' });

                    doc.setDrawColor(...confTema.rgbTema);
                    doc.setLineWidth(0.5);
                    doc.line(margen, ALTO_HEADER - 2, pageW - margen, ALTO_HEADER - 2);
                }

                const columnasPdf = [
                    { header: 'OT #', dataKey: 'ot', cellWidth: 16, halign: 'center' },
                    { header: 'FECHA', dataKey: 'fecha', cellWidth: 19, halign: 'center' },
                    { header: 'ESTADO', dataKey: 'estado', cellWidth: 21, halign: 'center' },
                    { header: 'ESTABLECIMIENTO / CAMPO', dataKey: 'establecimiento', cellWidth: 38 },
                    { header: 'LOTES', dataKey: 'lotes', cellWidth: 24 },
                    { header: 'LABOR / TRATAMIENTO', dataKey: 'labor', cellWidth: 32 },
                    { header: 'APLICACIONES (FECHA · HA · APOYO)', dataKey: 'apl', cellWidth: 70 },
                    { header: 'HA', dataKey: 'has', cellWidth: 20, halign: 'right' },
                    { header: 'COSTO TOTAL (U$S)', dataKey: 'costo', cellWidth: 31, halign: 'right' }
                ];

                const filasPdf = gruposFiltrados.map(o => ({
                    apl: this.m_resumenAplicacionesOT(o.filasRaw).map(x => this.m_textoAplicacion(x)).join('\n'),
                    ot: `#${o.orden_trab}`,
                    fecha: this.m_fechaAR(o.fecha),
                    estado: (o.estado || 'PENDIENTE').toUpperCase(),
                    establecimiento: `${o.establecimiento || '-'} · ${o.campo || '-'}`,
                    lotes: (o.cuadros || []).join(', ') || '-',
                    labor: o.tipo_labor || '-',
                    has: Number(o.sup_total || 0).toFixed(1),
                    costo: `U$S ${Number(o.costo_final || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                }));

                const autoTableOpts = {
                    startY: ALTO_HEADER + 3,
                    margin: { left: margen, right: margen, top: ALTO_HEADER + 3, bottom: ALTO_PIE + 6 },
                    columns: columnasPdf,
                    body: filasPdf,
                    headStyles: {
                        fillColor: confTema.rgbTema,
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
                        apl: { fontSize: 6.8, cellPadding: 1.6 },
                        ot: { fontStyle: 'bold', textColor: confTema.rgbTemaDark },
                        costo: { fontStyle: 'bold', textColor: confTema.rgbTema }
                    },
                    didParseCell: function(data) {
                        if (data.section === 'body' && data.column.dataKey === 'apl' && /CON APOYO/.test(String(data.cell.raw || ''))) {
                            data.cell.styles.fillColor = [255, 247, 230];
                        }
                        if (data.section === 'body' && data.column.dataKey === 'estado') {
                            const est = String(data.cell.raw || '');
                            if (est === 'APLICADO' || est === 'FINALIZADO' || est === 'TERMINADO') {
                                data.cell.styles.textColor = [30, 107, 76];
                                data.cell.styles.fontStyle = 'bold';
                            } else {
                                data.cell.styles.textColor = [198, 40, 40];
                                data.cell.styles.fontStyle = 'bold';
                            }
                        }
                    },
                    theme: 'grid',
                    didDrawPage: dibujarEncabezado
                };

                if (doc.autoTable) doc.autoTable(autoTableOpts);
                else autoTableFunc(doc, autoTableOpts);

                let y = ((doc.lastAutoTable && doc.lastAutoTable.finalY) || ALTO_HEADER + 4) + 6;
                const altoBloque = 42;
                if (y + altoBloque > pageH - ALTO_PIE) {
                    doc.addPage();
                    dibujarEncabezado({ pageNumber: doc.internal.getNumberOfPages() });
                    y = ALTO_HEADER + 6;
                }

                const anchoPanel = pageW - margen * 2;
                doc.setFillColor(248, 250, 248);
                doc.setDrawColor(220, 225, 222);
                doc.setLineWidth(0.25);
                doc.roundedRect(margen, y, anchoPanel, 19, 2, 2, 'FD');

                doc.setFont('helvetica', 'bold');
                doc.setFontSize(7.8);
                doc.setTextColor(...confTema.rgbTema);
                doc.text('RESUMEN DE INVERSIÓN EN CAMPO', margen + 5, y + 5);

                const resApl = gruposFiltrados.map(o => this.m_resumenAplicacionesOT(o.filasRaw));
                const itemsRes = [
                    { label: 'ÓRDENES EJECUTADAS', val: String(gruposFiltrados.length) },
                    { label: 'APLICACIONES', val: String(resApl.reduce((s, l) => s + l.length, 0)) },
                    { label: 'APLICACIONES CON APOYO', val: String(resApl.reduce((s, l) => s + l.filter(x => x.conApoyo).length, 0)) },
                    { label: 'COBERTURA TOTAL', val: `${totalHas.toFixed(1)} HAS` },
                    { label: 'INVERSIÓN TOTAL DÓLAR', val: `U$S ${totalCosto.toLocaleString('en-US', { minimumFractionDigits: 2 })}` }
                ];

                const anchoItem = (anchoPanel - 10) / itemsRes.length;
                itemsRes.forEach((it, idx) => {
                    const xi = margen + 5 + anchoItem * idx;
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(6.4);
                    doc.setTextColor(110, 120, 115);
                    doc.text(it.label, xi, y + 10.5);
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(10);
                    doc.setTextColor(...confTema.rgbTemaDark);
                    doc.text(it.val, xi, y + 15.5);
                });

                const yFirma = y + 32;
                doc.setDrawColor(120, 130, 125);
                doc.setLineWidth(0.25);
                doc.line(margen + 25, yFirma, margen + 95, yFirma);
                doc.line(pageW - margen - 95, yFirma, pageW - margen - 25, yFirma);

                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7.4);
                doc.setTextColor(90, 100, 95);
                doc.text('Responsable Técnico / Asesor Agronómico', margen + 60, yFirma + 4, { align: 'center' });
                doc.text('Administración / Auditoría Central', pageW - margen - 60, yFirma + 4, { align: 'center' });

                const totalPaginas = doc.internal.getNumberOfPages();
                for (let i = 1; i <= totalPaginas; i++) {
                    doc.setPage(i);
                    doc.setDrawColor(220, 225, 222);
                    doc.setLineWidth(0.2);
                    doc.line(margen, pageH - 10, pageW - margen, pageH - 10);

                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(7);
                    doc.setTextColor(90, 100, 95);
                    doc.text(confTema.pieInstitucional, margen, pageH - 6);

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(6.8);
                    doc.text(`Folio ${folio}   ·   Página ${i} de ${totalPaginas}`, pageW - margen, pageH - 6, { align: 'right' });
                }

                const nombre = `Salvucci_Ordenes_Trabajo_${hoyStr}.pdf`;
                if (esElectron && typeof window.guardarEnDescargas === 'function') {
                    window.guardarEnDescargas(nombre, Buffer.from(doc.output('arraybuffer')));
                    if (this.m_mostrarNotificacion) this.m_mostrarNotificacion(`✓ PDF guardado en Descargas: ${nombre}`, "exito");
                } else {
                    doc.save(nombre);
                }
                return;
            } catch (err) {
                console.warn("Fallo jsPDF, usando ventana de impresión:", err);
            }
        }

        const cbWebBase64 = typeof window.codigoBarrasPngBase64 === 'function' ? window.codigoBarrasPngBase64(folio, 320, 50) : '';
        const win = window.open('', '_blank');
        win.document.write(`
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Reporte de Órdenes de Trabajo - Salvucci Gestión</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap');
                    @page { size: landscape; margin: 10mm; }
                    body { font-family: 'Roboto', sans-serif; color: #1A211C; padding: 15px; margin: 0; background: #FFFFFF; font-size: 11px; }
                    .header-pdf-premium { border-bottom: 2.5px solid #1E6B4C; padding: 14px 18px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; background: #F8FAF8; border-radius: 8px; border: 1px solid #D2D7D3; }
                    .logo-box { width: 55px; height: 55px; display: flex; align-items: center; justify-content: center; margin-right: 14px; }
                    .logo-box img { width: 100%; height: 100%; object-fit: contain; }
                    .titulos h1 { margin: 0; font-size: 16px; font-weight: 900; color: #123F2C; letter-spacing: 0.3px; }
                    .titulos h2 { margin: 2px 0 0 0; font-size: 10px; color: #1E6B4C; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
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
                            <h2>SALVUCCI GESTIÓN · RECETAS Y LABORES AGRÍCOLAS</h2>
                            <h1>REPORTE CONSOLIDADO DE ÓRDENES DE TRABAJO</h1>
                            <p>${confTema.empresaDomicilio} · Operador: ${operario}</p>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:16px;">
                        ${cbWebBase64 ? `<img src="${cbWebBase64}" style="height:38px;" />` : ''}
                        <div class="kpi-tile-top">
                            <div style="font-size:8.5px; color:#556358; font-weight:700; text-transform:uppercase;">Inversión Total OTs</div>
                            <div style="font-size:15px; font-weight:900; color:#1E6B4C;">U$S ${totalCosto.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                            <small style="font-size:8px; color:#556358;">Cobertura: ${totalHas.toFixed(1)} Has</small>
                        </div>
                    </div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>OT #</th>
                            <th>FECHA</th>
                            <th>ESTADO</th>
                            <th>ESTABLECIMIENTO / CAMPO</th>
                            <th>LOTES</th>
                            <th>LABOR</th>
                            <th>APLICACIONES (FECHA · HA · APOYO)</th>
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
                                <td>${o.establecimiento} · <small style="color:#556358;">${o.campo}</small></td>
                                <td>${(o.cuadros || []).join(', ') || '-'}</td>
                                <td>${o.tipo_labor}</td>
                                <td style="font-size:8.5px; line-height:1.45;">${this.m_resumenAplicacionesOT(o.filasRaw).map(x => this.m_esc(this.m_textoAplicacion(x))).join('<br>')}</td>
                                <td style="text-align:right;">${Number(o.sup_total || 0).toFixed(1)}</td>
                                <td style="text-align:right; font-weight:800; color:#1E6B4C;">U$S ${Number(o.costo_final || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div class="pie-pag">
                    <div>${confTema.pieInstitucional}</div>
                    <div>Folio: ${folio} · Emitido: ${emitido}</div>
                </div>

                <script>window.onload = function() { setTimeout(() => { window.print(); window.close(); }, 500); };</script>
            </body>
            </html>
        `);
        win.document.close();
    },

    m_exportarVoucherOTExcel: async function(ot, ref) {
        const registros = (this.parametros && this.parametros.ordenes ? this.parametros.ordenes : [])
            .filter(o => String(o.orden_trab) === String(ot) && (o.ref_orden || 'SIN-REF').toString() === ref.toString())
            .sort((a, b) => (this.m_aplicacionDeFila(a).n - this.m_aplicacionDeFila(b).n) || ((Number(a.id) || 0) - (Number(b.id) || 0)));
        if (registros.length === 0) return;

        const apls = this.m_resumenAplicacionesOT(registros);
        const cab = registros.find(r => this.m_aplicacionDeFila(r).n === 1) || registros[0];
        const esElectron = typeof require === 'function' && typeof process !== 'undefined';
        const folio = typeof window.generarFolio === 'function' ? window.generarFolio(`OT${ot}`) : `OT${ot}-${Date.now().toString().slice(-6)}`;
        const hoyStr = ModuloOrdenes.m_hoyLocal();
        const textoApl = apls.map(a => this.m_textoAplicacion(a)).join('  |  ');

        let ExcelJS = null;
        if (typeof window !== 'undefined' && window.ExcelJS) {
            ExcelJS = window.ExcelJS;
        } else if (typeof require === 'function') {
            try { ExcelJS = require('exceljs'); } catch (e) { ExcelJS = null; }
        }

        const columnas = [
            { header: 'APLICACIÓN', key: 'aplicacion', width: 17, halign: 'center', negrita: true },
            { header: 'FECHA', key: 'fecha', width: 12, halign: 'center' },
            { header: 'APOYO', key: 'apoyo', width: 9, halign: 'center' },
            { header: 'CONTRATISTA', key: 'contratista', width: 18 },
            { header: 'LOTE / CUADRO', key: 'cuadro', width: 16 },
            { header: 'SUPERFICIE (HA)', key: 'sup', width: 14, halign: 'right', numero: true },
            { header: 'CÓDIGO ARTÍCULO', key: 'codigo', width: 14, halign: 'center' },
            { header: 'INSUMO PRESCRITO', key: 'insumo', width: 30, negrita: true },
            { header: 'DEPÓSITO', key: 'deposito', width: 16 },
            { header: 'DOSIS / HA', key: 'dosis', width: 11, halign: 'right', numero: true },
            { header: 'CONSUMO TOTAL', key: 'consumo', width: 14, halign: 'right', numero: true, sumar: true },
            { header: 'INSUMO (U$S)', key: 'costo', width: 14, halign: 'right', monedaUsd: true, sumar: true },
            { header: 'COSTO FINAL FILA (U$S)', key: 'costo_final', width: 16, halign: 'right', monedaUsd: true, sumar: true }
        ];

        let totalConsumo = 0, totalCosto = 0;
        let alterna = false;
        const filasProcesadas = [];
        apls.forEach(a => {
            alterna = !alterna;
            a.filas.forEach(r => {
                const consumo = Number(r.total_consumo || 0);
                const costo = Number(r.total_dolar || 0);
                totalConsumo += consumo;
                totalCosto += costo;
                filasProcesadas.push({
                    _alterna: alterna,
                    aplicacion: a.etiqueta,
                    fecha: this.m_fechaAR(r.fecha),
                    apoyo: a.conApoyo ? 'SI' : 'NO',
                    contratista: r.contratista || '-',
                    cuadro: `Lote ${r.cuadro || '-'}`,
                    sup: Number(r.sup_uso || 0),
                    codigo: r.cod_articulo || '-',
                    insumo: r.insumo || '-',
                    deposito: r.deposito_origen || '-',
                    dosis: Number(r.dosis_ha || 0),
                    consumo,
                    costo,
                    costo_final: Number(r.costo_final || r.total_dolar || 0)
                });
            });
        });

        const confTema = window.SALVUCCI_CONF || {
            argbDark: 'FF123F2C',
            argbTema: 'FF1E6B4C',
            empresaRazon: 'SALVUCCI GESTIÓN · AGROSOFT J&L',
            empresaDomicilio: 'Auditoría Central de Prescripciones y Labores'
        };

        if (ExcelJS) {
            try {
                const wb = new ExcelJS.Workbook();
                wb.creator = 'Salvucci Gestión · AgroSoft J&L';
                wb.created = new Date();

                const subtitulo = `Establecimiento: ${cab.establecimiento || '-'}  ·  Labor: ${cab.tipo_labor || '-'}${cab.labor ? ' / ' + cab.labor : ''}  ·  Estado: ${cab.estado || '-'}  ·  Folio: ${folio}  ·  Emitido: ${new Date().toLocaleString('es-AR')}`;

                // 1. Receta por aplicación, lote e insumo
                const ws = this.m_xlsHojaTabla(wb, `OT #${ot}`,
                    `SALVUCCI GESTIÓN — RECETA AGRONÓMICA OT #${cab.orden_trab}${cab.ref_orden ? ' (REF ' + cab.ref_orden + ')' : ''}`,
                    subtitulo, columnas, filasProcesadas, confTema);
                // Línea con el resumen de aplicaciones debajo de los totales
                const filaInfo = ws.rowCount + 2;
                ws.mergeCells(filaInfo, 1, filaInfo, columnas.length);
                ws.getCell(filaInfo, 1).value = `Aplicaciones: ${textoApl}`;
                ws.getCell(filaInfo, 1).font = { bold: true, size: 9, color: { argb: confTema.argbTema } };
                ws.getCell(filaInfo, 1).alignment = { wrapText: true, vertical: 'top' };
                ws.getRow(filaInfo).height = Math.max(18, 15 * apls.length);

                // 2. Una fila por aplicación (fecha, hectáreas, apoyo, costos) y 3. consumo por lote
                this.m_xlsHojasAplicaciones(wb, [{
                    orden_trab: cab.orden_trab, ref_orden: cab.ref_orden || 'SIN-REF', estado: cab.estado || '-',
                    establecimiento: cab.establecimiento || '-', filasRaw: registros
                }], confTema, subtitulo);

                const nombreArchivo = `Voucher_OT_${ot}_${hoyStr}.xlsx`;
                const buffer = await wb.xlsx.writeBuffer();

                if (esElectron && typeof window.guardarEnDescargas === 'function') {
                    window.guardarEnDescargas(nombreArchivo, Buffer.from(buffer));
                } else if (typeof window.descargarNativoBlob === 'function') {
                    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                    window.descargarNativoBlob(blob, nombreArchivo);
                }

                if (this.m_mostrarNotificacion) this.m_mostrarNotificacion(`✓ Voucher Excel guardado: ${nombreArchivo}`, "exito");
                return;
            } catch (err) {
                console.warn("Fallo exportación voucher ExcelJS, usando fallback:", err);
            }
        }

        let csv = "﻿APLICACION;FECHA;APOYO;CONTRATISTA;CUADRO;SUP_HA;COD_ARTICULO;INSUMO;DEPOSITO;DOSIS_HA;CONSUMO_TOTAL;COSTO_USD;COSTO_FINAL_USD\n";
        filasProcesadas.forEach(r => {
            csv += `"${r.aplicacion}";"${r.fecha}";"${r.apoyo}";"${r.contratista}";"${r.cuadro}";${r.sup.toFixed(2)};"${r.codigo}";"${r.insumo}";"${r.deposito}";${r.dosis.toFixed(2)};${r.consumo.toFixed(2)};${r.costo.toFixed(2)};${r.costo_final.toFixed(2)}\n`;
        });
        csv += `TOTAL;;;;;;;;;;${totalConsumo.toFixed(2)};${totalCosto.toFixed(2)};${filasProcesadas.reduce((a, r) => a + r.costo_final, 0).toFixed(2)}\n`;
        csv += `\nAPLICACION;FECHA;HECTAREAS;LOTES;CONTRATISTA;APOYO;PERSONAL_APOYO;HA_APOYO;INSUMOS_USD;LABOR_USD;APOYO_USD;TOTAL_USD\n`;
        apls.forEach(a => {
            csv += `"${a.etiqueta}";"${a.fechaAR}";${a.ha.toFixed(2)};"${a.lotesTxt}";"${a.contratista}";"${a.conApoyo ? 'SI' : 'NO'}";"${a.personal}";${a.haApoyo.toFixed(2)};${a.insumosUsd.toFixed(2)};${a.laborUsd.toFixed(2)};${a.apoyoUsd.toFixed(2)};${a.totalUsd.toFixed(2)}\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        if (typeof window.descargarNativoBlob === 'function') {
            window.descargarNativoBlob(blob, `Voucher_OT_${ot}.csv`);
        }
    },

    m_imprimirVoucherOTPDF: function(ot, ref) {
        const registros = (this.parametros && this.parametros.ordenes ? this.parametros.ordenes : [])
            .filter(o => String(o.orden_trab) === String(ot) && (o.ref_orden || 'SIN-REF').toString() === ref.toString())
            .sort((a, b) => (this.m_aplicacionDeFila(a).n - this.m_aplicacionDeFila(b).n) || ((Number(a.id) || 0) - (Number(b.id) || 0)));
        if (registros.length === 0) return;

        const e = this.m_esc;
        const apls = this.m_resumenAplicacionesOT(registros);
        const cab = registros.find(r => this.m_aplicacionDeFila(r).n === 1) || registros[0];
        const folio = typeof window.generarFolio === 'function' ? window.generarFolio(`OT${ot}`) : `OT${ot}-${Date.now().toString().slice(-6)}`;
        const emitido = new Date().toLocaleString('es-AR');
        const operario = (typeof operarioName !== 'undefined' ? operarioName : (window.operarioGlobal || 'ADMINISTRADOR')).toUpperCase();
        const totalCostoOT = registros.reduce((a, c) => a + (parseFloat(c.costo_final || c.total_dolar) || 0), 0);
        const totalInsumosOT = registros.reduce((a, c) => a + (parseFloat(c.total_dolar) || 0), 0);
        const totalHa = apls.reduce((a, x) => a + x.ha, 0);
        const fechas = apls.map(a => a.fecha).filter(f => f && f !== '-').sort();
        const rangoFechas = fechas.length > 1 && fechas[0] !== fechas[fechas.length - 1]
            ? `${this.m_fechaAR(fechas[0])} al ${this.m_fechaAR(fechas[fechas.length - 1])}` : this.m_fechaAR(fechas[0]);
        const f2 = n => (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const cbWebBase64 = typeof window.codigoBarrasPngBase64 === 'function' ? window.codigoBarrasPngBase64(folio, 280, 44) : '';
        const confTema = window.SALVUCCI_CONF || { pieInstitucional: 'Sistemas de Gestión Agrosoft J&L - Chimpay R.N.' };

        const win = window.open('', '_blank');
        if (!win) return this.m_mostrarNotificacion('El sistema bloqueó la ventana de impresión.', 'error');
        win.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Receta de Trabajo OT #${e(ot)} - Salvucci Gestión</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap');
                    @page { size: landscape; margin: 10mm; }
                    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    body { font-family: 'Roboto', sans-serif; padding: 8px; color: #1A211C; background: #FFFFFF; font-size: 10.5px; }
                    .header { border-bottom: 2.5px solid #1E6B4C; padding-bottom: 10px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: flex-start; }
                    .header-titulos h2 { margin: 0; font-size: 10.5px; color: #1E6B4C; text-transform: uppercase; font-weight: 800; letter-spacing: 0.5px; }
                    .header-titulos h1 { margin: 3px 0 0 0; font-size: 17px; color: #123F2C; font-weight: 900; }
                    .header-titulos p { margin: 4px 0 0 0; color: #556358; font-size: 9.5px; line-height: 1.5; }
                    .box-ot-badge { border: 1.5px solid #1E6B4C; background: #F8FAF8; padding: 8px 14px; border-radius: 6px; text-align: right; }
                    .kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 6px; }
                    .kpi { border: 1px solid #D2D7D3; border-radius: 6px; padding: 6px 10px; background: #FAFBFA; }
                    .kpi span { display: block; font-size: 7.5px; font-weight: 800; color: #556358; text-transform: uppercase; }
                    .kpi b { font-size: 13px; color: #123F2C; }
                    .sec-rep { margin: 14px 0 4px; font-size: 10px; color: #1E6B4C; text-transform: uppercase; letter-spacing: 0.4px; border-left: 3px solid #1E6B4C; padding-left: 6px; }
                    table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
                    th, td { padding: 5px 6px; border-bottom: 1px solid #E2E8F0; text-align: left; vertical-align: middle; }
                    th { background: #1E6B4C; color: #FFFFFF; font-weight: 800; text-transform: uppercase; font-size: 7.5px; }
                    th small { font-weight: 500; text-transform: none; opacity: .9; }
                    tbody tr:nth-child(even) { background: #FAFBFA; }
                    tfoot td { background: #123F2C; color: #FFFFFF; font-weight: 800; }
                    tr.con-apoyo td { background: #FFF8EA !important; }
                    tr.sep-apl td { background: #E8F3EC !important; color: #104630; font-weight: 900; font-size: 9px; text-transform: uppercase; }
                    tr.sep-apl.apoyo td { background: #FFEFD2 !important; color: #8A5300; }
                    .chip-apoyo { display: inline-block; padding: 1px 7px; border-radius: 8px; font-size: 8px; font-weight: 800; background: #EEF1EE; color: #556358; }
                    .chip-apoyo.si { background: #FFE2B0; color: #8A5300; }
                    .totales-bar { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding: 10px 14px; background: #F8FAF8; border: 1px solid #C8E6C9; border-radius: 6px; }
                    .firmas-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 30px; margin-top: 40px; }
                    .firma-box { border-top: 1px solid #718096; text-align: center; padding-top: 6px; font-size: 8.5px; color: #556358; font-weight: 600; }
                    .pie-pag { margin-top: 20px; border-top: 1px solid #D2D7D3; padding-top: 8px; display: flex; justify-content: space-between; font-size: 8px; color: #556358; }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="header-titulos">
                        <h2>SALVUCCI GESTIÓN · RECETA AGRONÓMICA</h2>
                        <h1>ORDEN DE TRABAJO #${e(cab.orden_trab)} ${cab.ref_orden && cab.ref_orden !== 'SIN-REF' ? `(REF: ${e(cab.ref_orden)})` : ''}</h1>
                        <p>
                            Establecimiento: <b>${e(cab.establecimiento || '-')}</b> · Campo: <b>${e([...new Set(registros.map(r => r.campo).filter(Boolean))].join(', ') || '-')}</b><br>
                            Labor / Prescripción: <b>${e(cab.tipo_labor || '-')}${cab.labor ? ' / ' + e(cab.labor) : ''}</b> · Estado: <b>${e(cab.estado || '-')}</b> · Fecha${apls.length > 1 ? 's' : ''}: <b>${e(rangoFechas)}</b><br>
                            Cotización: <b>$ ${e(cab.cotizacion || '-')}</b> · Operador: <b>${e(operario)}</b>
                        </p>
                    </div>
                    <div style="display:flex; flex-direction:column; align-items:flex-end; gap:8px;">
                        ${cbWebBase64 ? `<img src="${cbWebBase64}" style="height:36px;" />` : ''}
                        <div class="box-ot-badge">
                            <span style="font-size:8px; font-weight:700; color:#556358; text-transform:uppercase;">Inversión Total OT</span>
                            <div style="font-size:16px; font-weight:900; color:#1E6B4C;">U$S ${f2(totalCostoOT)}</div>
                        </div>
                    </div>
                </div>

                <div class="kpis">
                    <div class="kpi"><span>Aplicaciones</span><b>${apls.length}</b></div>
                    <div class="kpi"><span>Con apoyo</span><b>${apls.filter(a => a.conApoyo).length}</b></div>
                    <div class="kpi"><span>Superficie total</span><b>${f2(totalHa)} ha</b></div>
                    <div class="kpi"><span>Insumos</span><b>U$S ${f2(totalInsumosOT)}</b></div>
                    <div class="kpi"><span>Labor + apoyo</span><b>U$S ${f2(totalCostoOT - totalInsumosOT)}</b></div>
                </div>

                ${this.m_htmlAplicacionesReporte(registros)}

                <h3 class="sec-rep">Detalle por aplicación, lote e insumo</h3>
                <table>
                    <thead>
                        <tr>
                            <th>LOTE / CUADRO</th>
                            <th style="text-align:right;">SUP (HA)</th>
                            <th>CÓDIGO</th>
                            <th>INSUMO APLICADO</th>
                            <th>DEPÓSITO</th>
                            <th style="text-align:center;">DOSIS / HA</th>
                            <th style="text-align:right;">CONSUMO TOTAL</th>
                            <th style="text-align:right;">INSUMO (U$S)</th>
                            <th style="text-align:right;">COSTO FINAL (U$S)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${apls.map(a => `
                            <tr class="sep-apl ${a.conApoyo ? 'apoyo' : ''}"><td colspan="9">
                                ${e(a.etiqueta)} · ${e(a.fechaAR)} · ${f2(a.ha)} ha · Contratista: ${e(a.contratista)} ·
                                ${a.conApoyo ? `CON APOYO${a.personal ? ' (' + e(a.personal) + ')' : ''} · ${f2(a.haApoyo)} ha a U$S ${f2(a.costoApoyoHa)}/ha` : 'SIN APOYO'}
                            </td></tr>
                            ${a.filas.map(r => `
                            <tr>
                                <td><b>Lote ${e(r.cuadro || '-')}</b></td>
                                <td style="text-align:right;">${f2(r.sup_uso)}</td>
                                <td><code>${e(r.cod_articulo || '-')}</code></td>
                                <td><b>${e(r.insumo || '-')}</b></td>
                                <td>${e(r.deposito_origen || '-')}</td>
                                <td align="center">${f2(r.dosis_ha)}</td>
                                <td align="right"><b>${f2(r.total_consumo)}</b></td>
                                <td align="right">U$S ${f2(r.total_dolar)}</td>
                                <td align="right" style="font-weight:800; color:#1E6B4C;">U$S ${f2(r.costo_final || r.total_dolar)}</td>
                            </tr>`).join('')}
                        `).join('')}
                    </tbody>
                </table>

                <div class="totales-bar">
                    <span style="font-weight:700; color:#123F2C; font-size:10px;">TOTALES DE LA ORDEN</span>
                    <div style="display:flex; gap:20px; align-items:center;">
                        <span>Superficie: <b>${f2(totalHa)} ha</b></span>
                        <span>Insumos: <b>U$S ${f2(totalInsumosOT)}</b></span>
                        <span style="font-size:12px; font-weight:900; color:#1E6B4C;">TOTAL OT: U$S ${f2(totalCostoOT)}</span>
                    </div>
                </div>

                <div class="firmas-grid">
                    <div class="firma-box">Responsable Técnico / Asesor Agronómico</div>
                    <div class="firma-box">Operador Aplicador / Contratista</div>
                    <div class="firma-box">Apoyo / Logística de carga</div>
                </div>

                <div class="pie-pag">
                    <div>${e(confTema.pieInstitucional)}</div>
                    <div>Folio: ${e(folio)} · Emitido: ${e(emitido)}</div>
                </div>

                <script>window.onload = function() { setTimeout(() => { window.print(); window.close(); }, 500); };</script>
            </body>
            </html>
        `);
        win.document.close();
    },

    m_construirFormulario: async function(opciones) {
        const modo = (opciones.modo || 'NUEVA').toUpperCase();
        this.m_asegurarModalBase();
        this.m_asegurarEstilosReceta();

        const modalContent = document.querySelector('#modal-agrosoft .modal-apple-content') || document.querySelector('.modal-apple-content');
        if (modalContent) {
            modalContent.style.maxWidth = '1080px';
            modalContent.style.width = '96%';
            modalContent.style.padding = '16px 20px 14px 20px';
            modalContent.style.display = 'flex';
            modalContent.style.flexDirection = 'column';
            modalContent.style.overflow = 'hidden';
        }

        this._modoReceta = modo;
        this._otOrigen = (modo !== 'NUEVA') ? { ot: String(opciones.ot), ref: String(opciones.ref ?? 'SIN-REF') } : null;
        this._otExcluida = modo === 'EDITAR' ? this._otOrigen : null;
        this.lotesSeleccionados = [];
        this._aplicaciones = [this.m_nuevaAplicacion()];

        const container = document.getElementById('modal-formulario');
        const titulo = document.getElementById('modal-titulo');
        if (titulo) {
            titulo.innerText = modo === 'EDITAR' ? `EDITAR RECETA Y APLICACIONES · OT N° ${opciones.ot}`
                : modo === 'DUPLICAR' ? `DUPLICAR ORDEN DE TRABAJO N° ${opciones.ot}`
                : 'CONFECCIÓN DE RECETA DE APLICACIÓN';
        }

        const e = this.m_esc;
        const estUnicos = [...new Set(this.parametros.campos.map(c => c.establecimiento).filter(Boolean))].sort();
        const rubrosUnicos = [...new Set(this.parametros.labores.map(l => l.rubro).filter(Boolean))].sort();
        const hoy = ModuloOrdenes.m_hoyLocal();

        const avisoModo = modo === 'DUPLICAR'
            ? `<div class="rx-aviso azul">Copia de la OT <b>#${e(opciones.ot)}</b>: se copió todo (lotes, receta, aplicaciones y costos). Cambiá el <b>N° de orden</b> y revisá las fechas antes de guardar.</div>`
            : modo === 'EDITAR'
            ? `<div class="rx-aviso ambar">Estás editando la OT <b>#${e(opciones.ot)}</b> completa. Al guardar se reemplazan sus filas por las de esta receta (el consumo propio de la OT ya está devuelto al stock disponible).</div>`
            : '';

        if (container) {
            container.innerHTML = `
                <div class="rx" id="rx-form">
                    ${avisoModo}
                    <div class="rx-tabs">
                        <button type="button" class="rx-tab activa" data-tab="1" onclick="ModuloOrdenes.m_cambiarTabReceta(1)">1 · Orden y lotes <span class="rx-tab-b" id="rx-tb-1"></span></button>
                        <button type="button" class="rx-tab" data-tab="2" onclick="ModuloOrdenes.m_cambiarTabReceta(2)">2 · Receta de insumos <span class="rx-tab-b" id="tab-badge-insumos">0</span></button>
                        <button type="button" class="rx-tab" data-tab="3" onclick="ModuloOrdenes.m_cambiarTabReceta(3)">3 · Aplicaciones y costos <span class="rx-tab-b" id="rx-tb-3">1</span></button>
                    </div>

                    <div class="rx-viewport scroll-apple">
                        <!-- 1. ORDEN Y LOTES -->
                        <div class="tab-panel-receta activo" data-panel="1">
                            <div class="rx-sec">
                                <div class="rx-sec-t">Orden de trabajo</div>
                                <div class="rx-grid">
                                    <div class="rx-c req" style="grid-column:span 2;"><label>N° Orden (OT)</label>
                                        <input type="number" id="rec_orden_cab" oninput="ModuloOrdenes.m_validarEstadoBotonGuardar()" placeholder="4500" style="font-weight:800; color:#0277BD;"></div>
                                    <div class="rx-c" style="grid-column:span 2;"><label>Ref. orden</label>
                                        <input type="number" id="rec_ref_orden" placeholder="102"></div>
                                    <div class="rx-c req" style="grid-column:span 3;"><label>Fecha planificación</label>
                                        <input type="date" id="rec_fecha" value="${hoy}" onchange="ModuloOrdenes.m_alCambiarFechaPlanif(this.value)"></div>
                                    <div class="rx-c" style="grid-column:span 3;"><label>Estado</label>
                                        <select id="rec_estado" style="font-weight:700;">
                                            <option value="PENDIENTE">⏳ PENDIENTE</option>
                                            <option value="EN PROCESO">🚜 EN PROCESO</option>
                                            <option value="TERMINADO">✅ TERMINADO</option>
                                        </select></div>
                                    <div class="rx-c" style="grid-column:span 2;"><label>Cotización ($)</label>
                                        <input type="number" id="rec_cot" value="1200" oninput="ModuloOrdenes.m_recalcularTodo()"></div>

                                    <div class="rx-c req" style="grid-column:span 5;"><label>Rubro operativo</label>
                                        <select id="rec_rubro" onchange="ModuloOrdenes.m_filtrarLaboresPorRubro(this.value); ModuloOrdenes.m_validarEstadoBotonGuardar();">
                                            <option value="">Seleccioná rubro…</option>
                                            ${rubrosUnicos.map(r => `<option value="${e(r)}">${e(r)}</option>`).join('')}
                                        </select></div>
                                    <div class="rx-c req" style="grid-column:span 7;"><label>Labor</label>
                                        <div style="display:flex; gap:6px;">
                                            <select id="rec_tipo_app" onchange="ModuloOrdenes.m_validarEstadoBotonGuardar();" style="flex:1;">
                                                <option value="">Primero elegí el rubro…</option>
                                            </select>
                                            <button type="button" class="rx-btn" style="width:32px; padding:0;" title="Crear nueva labor" onclick="ModuloOrdenes.m_modalNuevaLabor()">+</button>
                                        </div></div>
                                </div>
                            </div>

                            <div class="rx-sec">
                                <div class="rx-sec-t">Lotes a tratar <span class="rx-sec-meta">Superficie total: <b id="rx-sup-txt">0,00 ha</b></span></div>
                                <div class="rx-grid">
                                    <div class="rx-c req" style="grid-column:span 4;"><label>Establecimiento</label>
                                        <select id="rec_est" onchange="ModuloOrdenes.m_filtrarCampos(this.value); ModuloOrdenes.m_validarEstadoBotonGuardar();">
                                            <option value="">Seleccioná…</option>
                                            ${estUnicos.map(x => `<option value="${e(x)}">${e(x)}</option>`).join('')}
                                        </select></div>
                                    <div class="rx-c" style="grid-column:span 4;"><label>Campo / sector</label>
                                        <select id="rec_campo" onchange="ModuloOrdenes.m_filtrarLotes(this.value); ModuloOrdenes.m_validarEstadoBotonGuardar();">
                                            <option value="">—</option>
                                        </select></div>
                                    <div class="rx-c req" style="grid-column:span 4;"><label>Añadir lote</label>
                                        <select id="rec_cuadro" onchange="ModuloOrdenes.m_agregarLoteALista(this.value); this.value='';">
                                            <option value="">Elegí el campo…</option>
                                        </select></div>
                                </div>
                                <input type="hidden" id="rec_sup" value="0">
                                <div id="lista-lotes-badge" class="rx-lotes"></div>
                            </div>
                        </div>

                        <!-- 2. RECETA -->
                        <div class="tab-panel-receta" data-panel="2" style="display:none;">
                            <div class="rx-sec">
                                <div class="rx-sec-t">Insumos por hectárea
                                    <button type="button" class="rx-btn azul chico" onclick="ModuloOrdenes.m_agregarFilaProducto()">+ Agregar insumo</button>
                                </div>
                                <div class="rx-prod-cab">
                                    <span>Depósito</span><span>Insumo</span><span class="rx-num">Dosis/ha</span><span class="rx-num">Consumo total</span><span class="rx-num">U$S unit.</span><span class="rx-num">Total U$S</span><span></span>
                                </div>
                                <div id="contenedor-productos"></div>
                                <div class="rx-nota">El consumo total es <b>superficie total × dosis</b>. Si la orden se hace en varias aplicaciones, ese mismo consumo se reparte entre ellas (pestaña 3).</div>
                            </div>
                        </div>

                        <!-- 3. APLICACIONES Y COSTOS -->
                        <div class="tab-panel-receta" data-panel="3" style="display:none;">
                            <div class="rx-sec">
                                <div class="rx-sec-t">Aplicaciones de la receta
                                    <button type="button" class="rx-btn azul chico" onclick="ModuloOrdenes.m_agregarAplicacion()">+ Agregar aplicación</button>
                                </div>
                                <div id="rx-apl"></div>
                            </div>
                            <div class="rx-sec" id="rx-matriz-sec" style="display:none;">
                                <div class="rx-sec-t">Hectáreas por lote en cada aplicación
                                    <span class="rx-sec-meta">La aplicación 1 toma lo que falta de cada lote</span></div>
                                <div id="rx-matriz"></div>
                            </div>
                            <div class="rx-sec">
                                <div class="rx-sec-t">Consumo por aplicación <span class="rx-sec-meta">El total siempre es igual a la receta</span></div>
                                <div id="rx-consumo"></div>
                            </div>
                        </div>
                    </div>

                    <div class="rx-pie">
                        <div class="rx-tot">
                            <div><span>Superficie</span><b id="rx-t-sup">0 ha</b></div>
                            <div><span>Insumos</span><b id="rx-t-ins">U$S 0</b></div>
                            <div><span>Labor</span><b id="rx-t-mo">U$S 0</b></div>
                            <div><span>Apoyo</span><b id="rx-t-apoyo">U$S 0</b></div>
                            <div><span>U$S / ha</span><b id="rx-t-ha">0</b></div>
                            <div class="fuerte"><span>Total OT</span><b id="rx-t-total">U$S 0</b></div>
                        </div>
                        <input type="hidden" id="rec_total_ins" value="0">
                        <input type="hidden" id="rec_total_todo" value="0">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span class="rx-motivo" id="rx-motivo"></span>
                            <button type="button" class="rx-btn" onclick="ModuloOrdenes.m_cerrarFormularioReceta()">Cancelar</button>
                            <button type="button" id="btn-guardar-despacho-action" class="rx-btn prim" disabled>${modo === 'EDITAR' ? 'Guardar cambios' : 'Guardar receta'}</button>
                        </div>
                    </div>
                </div>
            `;
        }

        const btnGuardar = document.getElementById('btn-guardar-despacho-action');
        if (btnGuardar) btnGuardar.onclick = (ev) => ModuloOrdenes.m_guardarReceta(ev);

        document.getElementById('modal-agrosoft').style.display = 'flex';

        if (modo === 'NUEVA') {
            this.m_agregarFilaProducto();
            this.m_renderizarLotesSeleccionados();
        } else {
            await this.m_cargarOTEnFormulario(this._otOrigen.ot, this._otOrigen.ref, modo);
        }
        this.m_recalcularTodo();
    },

    m_cerrarFormularioReceta: function() {
        this._otExcluida = null;
        const m = document.getElementById('modal-agrosoft');
        if (m) m.style.display = 'none';
    },

    // Carga una OT existente en el formulario (para duplicarla o editarla)
    m_cargarOTEnFormulario: async function(ot, ref, modo) {
        const filas = this.parametros.ordenes
            .filter(o => String(o.orden_trab) === String(ot) && String(o.ref_orden || 'SIN-REF') === String(ref))
            .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
        if (!filas.length) return this.m_mostrarNotificacion('No se encontró la orden a copiar.', 'error');

        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
        const elegir = (id, valor) => {
            const sel = document.getElementById(id);
            if (!sel || !valor) return;
            const v = String(valor).trim().toUpperCase();
            const op = [...sel.options].find(o => o.value.trim().toUpperCase() === v);
            if (op) sel.value = op.value;
            else { sel.add(new Option(valor, valor, true, true)); }
        };
        const p0 = filas[0];
        const hoy = ModuloOrdenes.m_hoyLocal();

        // Cabecera
        if (modo === 'DUPLICAR') {
            const maxOt = Math.max(0, ...this.parametros.ordenes.map(o => parseInt(o.orden_trab, 10) || 0));
            set('rec_orden_cab', maxOt + 1);
            set('rec_estado', 'PENDIENTE');
        } else {
            set('rec_orden_cab', p0.orden_trab);
            elegir('rec_estado', (p0.estado || 'PENDIENTE').toUpperCase());
        }
        set('rec_ref_orden', p0.ref_orden ?? '');
        set('rec_cot', p0.cotizacion || 1200);
        elegir('rec_rubro', p0.tipo_labor || p0.centro_costo);
        this.m_filtrarLaboresPorRubro(document.getElementById('rec_rubro')?.value || '');
        elegir('rec_tipo_app', p0.labor);
        elegir('rec_est', p0.establecimiento);
        this.m_filtrarCampos(document.getElementById('rec_est')?.value || '');
        elegir('rec_campo', p0.campo);
        if (document.getElementById('rec_campo')?.value) await this.m_filtrarLotes(document.getElementById('rec_campo').value);

        // Aplicaciones, lotes y hectáreas
        const porApl = new Map();      // n -> filas
        filas.forEach(r => {
            const n = this.m_aplicacionDeFila(r).n;
            if (!porApl.has(n)) porApl.set(n, []);
            porApl.get(n).push(r);
        });
        const nums = [...porApl.keys()].sort((a, b) => a - b);
        const lotes = new Map();       // key -> lote
        const haPorApl = nums.map(() => ({}));
        nums.forEach((n, i) => {
            const vistos = new Set();
            porApl.get(n).forEach(r => {
                const key = `${r.campo || ''}|${r.cuadro || ''}`;
                if (vistos.has(key)) return;
                vistos.add(key);
                const ha = parseFloat(r.sup_uso) || 0;
                haPorApl[i][key] = ha;
                if (!lotes.has(key)) {
                    const info = this.parametros.cuadros.find(c => String(c.lote) === String(r.cuadro) && (c.campo || '').trim().toUpperCase() === (r.campo || '').trim().toUpperCase());
                    lotes.set(key, { lote: r.cuadro, nombre_lote: info?.nombre_lote || '', campo_nombre: r.campo || '', sup: 0 });
                }
                lotes.get(key).sup += ha;
            });
        });
        this.lotesSeleccionados = [...lotes.values()].map(l => ({ ...l, sup: parseFloat(l.sup.toFixed(4)) }));

        this._aplicaciones = nums.map((n, i) => {
            const rows = porApl.get(n);
            const conMarca = rows.some(r => this.m_aplicacionDeFila(r).marcada);
            const mo = Math.max(0, ...rows.map(r => parseFloat(r.costo_ha) || 0));
            const conApoyo = rows.filter(r => (parseFloat(r.ha_apoyo) || 0) > 0);
            let costoApoyo = 0, haApoyo = null;
            if (conApoyo.length) {
                const r = conApoyo[0];
                costoApoyo = (parseFloat(r.total_apoyo) || 0) / (parseFloat(r.ha_apoyo) || 1);
                if (conMarca) {
                    const vistos = new Set();
                    haApoyo = 0;
                    conApoyo.forEach(x => { const k = `${x.campo}|${x.cuadro}`; if (!vistos.has(k)) { vistos.add(k); haApoyo += parseFloat(x.ha_apoyo) || 0; } });
                    haApoyo = parseFloat(haApoyo.toFixed(4));
                }
            }
            const ha = {};
            if (i > 0) Object.assign(ha, haPorApl[i]);
            return {
                fecha: modo === 'DUPLICAR' ? hoy : (rows[0].fecha || hoy),
                contratista: rows[0].contratista || '',
                mo: parseFloat(mo.toFixed(4)),
                apoyo: conApoyo.length > 0,
                costoApoyo: parseFloat(costoApoyo.toFixed(4)),
                haApoyo,
                personal: rows.find(r => r.apoyo)?.apoyo || '',
                ha
            };
        });
        if (!this._aplicaciones.length) this._aplicaciones = [this.m_nuevaAplicacion()];
        set('rec_fecha', this._aplicaciones[0].fecha);

        // Receta: un renglón por insumo + depósito (dosis y precio de su primera fila)
        const recetas = new Map();
        filas.forEach(r => {
            const k = `${(r.deposito_origen || '').toUpperCase()}|${(r.cod_articulo || r.insumo || '').toString().toUpperCase()}`;
            if (!recetas.has(k)) recetas.set(k, { deposito: r.deposito_origen, insumo: r.insumo, cod: r.cod_articulo, dosis: parseFloat(r.dosis_ha) || 0, u_unit: parseFloat(r.imp_uni) || 0 });
        });
        const cont = document.getElementById('contenedor-productos');
        if (cont) cont.innerHTML = '';
        recetas.forEach(p => this.m_agregarFilaProducto(p));

        this.m_renderizarLotesSeleccionados();
        this.m_renderAplicaciones();
        if (modo === 'DUPLICAR') setTimeout(() => { const el = document.getElementById('rec_orden_cab'); if (el) { el.focus(); el.select(); } }, 60);
    },

    m_motivoNoGuardar: function() {
        const v = id => (document.getElementById(id)?.value || '').trim();
        if (!v('rec_orden_cab')) return 'Falta el N° de orden.';
        if (!v('rec_fecha')) return 'Falta la fecha.';
        if (!v('rec_rubro') || !v('rec_tipo_app')) return 'Falta rubro y labor.';
        if (!v('rec_est')) return 'Falta el establecimiento.';
        if (!this.lotesSeleccionados || this.lotesSeleccionados.length === 0) return 'Agregá al menos un lote.';
        if (this.m_leerInsumosReceta().length === 0) return 'Cargá al menos un insumo con dosis.';
        return this.m_problemaAplicaciones() || '';
    },

    m_problemaAplicaciones: function() {
        const apls = this._aplicaciones || [];
        for (let i = 0; i < apls.length; i++) {
            if (!apls[i].fecha) return `Falta la fecha de la aplicación ${i + 1}.`;
            if (i > 0 && this.m_haTotalApl(i) <= 0) return `La aplicación ${i + 1} no tiene hectáreas.`;
        }
        for (const l of this.lotesSeleccionados) {
            if (this.m_haApl(0, this.m_claveLote(l), true) < -1e-9) return `En el lote ${l.lote} las aplicaciones suman más que su superficie.`;
        }
        if (apls.length > 1 && this.m_haTotalApl(0) <= 1e-9) return 'La aplicación 1 quedó sin hectáreas: quitá una aplicación o repartí distinto.';
        return '';
    },

    // Opciones de insumo con stock en el depósito; si viene uno precargado sin stock, se agrega igual (marcado)
    m_llenarOpcionesInsumo: function(row, deposito, insumoSel = '', codSel = '') {
        const e = this.m_esc;
        const selectInsumo = row.querySelector('.p-insumo');
        if (!selectInsumo) return;
        this.m_calcularStockPorDeposito(deposito);
        const sel = String(insumoSel || '').trim().toUpperCase();
        const lista = this.parametros.insumos.filter(i => (i.stock_actual || 0) > 0 || (sel && (i.articulo || '').trim().toUpperCase() === sel));
        let html = `<option value="">Insumo…</option>` + lista.map(i => {
            const esSel = sel && (i.articulo || '').trim().toUpperCase() === sel;
            return `<option value="${e(i.articulo)}" data-cod="${e(i.cod_articulo || i.reg_local || '')}" data-stock="${i.stock_actual}" data-unidad="${e(i.unidad || '')}" ${esSel ? 'selected' : ''}>${e((i.articulo || '').toUpperCase())} (${(Number(i.stock_actual) || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })} ${e(i.unidad || 'u')})</option>`;
        }).join('');
        if (sel && !lista.some(i => (i.articulo || '').trim().toUpperCase() === sel)) {
            html += `<option value="${e(insumoSel)}" data-cod="${e(codSel || '')}" data-stock="0" data-unidad="" selected>${e(sel)} (sin stock)</option>`;
        }
        selectInsumo.innerHTML = html;
        this.m_actualizarStockLabel(selectInsumo);
    },

    m_nuevaAplicacion: function(base = null) {
        return {
            fecha: base?.fecha || ModuloOrdenes.m_hoyLocal(),
            contratista: base?.contratista || '',
            mo: base?.mo || 0,
            apoyo: false,
            costoApoyo: base?.costoApoyo || 0,
            haApoyo: null,
            personal: '',
            ha: {}
        };
    },

    m_claveLote: function(l) { return `${l.campo_nombre}|${l.lote}`; },

    m_idSeguro: function(txt) { return String(txt).replace(/[^A-Za-z0-9_-]/g, '_'); },

    m_supTotalLotes: function() {
        return (this.lotesSeleccionados || []).reduce((a, l) => a + (parseFloat(l.sup) || 0), 0);
    },

    // Hectáreas de la aplicación i en un lote. La 1 es "lo que falta" del lote.
    m_haApl: function(i, key, permitirNegativo = false) {
        const apls = this._aplicaciones || [];
        if (i > 0) return Math.max(0, parseFloat(apls[i]?.ha?.[key]) || 0);
        const lote = (this.lotesSeleccionados || []).find(l => this.m_claveLote(l) === key);
        const sup = parseFloat(lote?.sup) || 0;
        const otras = apls.slice(1).reduce((a, x) => a + (Math.max(0, parseFloat(x.ha[key]) || 0)), 0);
        const resto = sup - otras;
        return permitirNegativo ? resto : Math.max(0, resto);
    },

    m_haTotalApl: function(i) {
        return (this.lotesSeleccionados || []).reduce((a, l) => a + this.m_haApl(i, this.m_claveLote(l)), 0);
    },

    m_haApoyoApl: function(i) {
        const a = (this._aplicaciones || [])[i];
        if (!a || !a.apoyo) return 0;
        if (a.haApoyo === null || a.haApoyo === '' || isNaN(parseFloat(a.haApoyo))) return this.m_haTotalApl(i);
        return Math.max(0, parseFloat(a.haApoyo));
    },

    m_alCambiarFechaPlanif: function(valor) {
        if (this._aplicaciones && this._aplicaciones[0]) {
            this._aplicaciones[0].fecha = valor;
            const el = document.getElementById('rx-apl-fecha-0');
            if (el) el.value = valor;
        }
        this.m_validarEstadoBotonGuardar();
    },

    m_agregarAplicacion: function() {
        if (!this.lotesSeleccionados.length) {
            this.m_mostrarNotificacion('Primero agregá los lotes de la orden (pestaña 1).', 'error');
            return this.m_cambiarTabReceta(1);
        }
        const apls = this._aplicaciones;
        const nueva = this.m_nuevaAplicacion(apls[apls.length - 1]);
        // Propuesta: la nueva aplicación toma la mitad de lo que hoy hace la aplicación 1 en cada lote
        this.lotesSeleccionados.forEach(l => {
            const key = this.m_claveLote(l);
            const resto = this.m_haApl(0, key);
            if (resto > 0) nueva.ha[key] = parseFloat((resto / 2).toFixed(2));
        });
        apls.push(nueva);
        this.m_renderAplicaciones();
        this.m_mostrarNotificacion(`Aplicación ${apls.length} agregada: ajustá las hectáreas y si lleva apoyo.`, 'exito');
    },

    m_quitarAplicacion: function(i) {
        if (i <= 0) return;
        this._aplicaciones.splice(i, 1);   // sus hectáreas vuelven a la aplicación 1
        this.m_renderAplicaciones();
    },

    m_setApl: function(i, campo, valor, redibujar = false) {
        const a = (this._aplicaciones || [])[i];
        if (!a) return;
        if (['mo', 'costoApoyo'].includes(campo)) a[campo] = parseFloat(valor) || 0;
        else if (campo === 'haApoyo') a.haApoyo = (valor === '' || valor === null) ? null : (parseFloat(valor) || 0);
        else if (campo === 'apoyo') a.apoyo = !!valor;
        else a[campo] = valor;
        if (campo === 'fecha' && i === 0) {
            const f = document.getElementById('rec_fecha');
            if (f) f.value = valor;
        }
        if (redibujar) this.m_renderAplicaciones(); else this.m_recalcularTodo();
    },

    m_setHaLote: function(i, key, valor) {
        const a = (this._aplicaciones || [])[i];
        if (!a || i === 0) return;
        a.ha[key] = Math.max(0, parseFloat(valor) || 0);
        this.m_recalcularTodo();
    },

    m_renderAplicaciones: function() {
        const cont = document.getElementById('rx-apl');
        if (!cont) { this.m_recalcularTodo(); return; }
        const e = this.m_esc;
        const apls = this._aplicaciones || [];
        const unLote = this.lotesSeleccionados.length === 1;
        const key1 = unLote ? this.m_claveLote(this.lotesSeleccionados[0]) : null;

        cont.innerHTML = `
            <table class="rx-t">
                <thead><tr>
                    <th style="width:34px;">#</th><th style="width:128px;">Fecha</th><th class="rx-num" style="width:96px;">Hectáreas</th>
                    <th>Contratista</th><th class="rx-num" style="width:92px;">M.O. U$S/ha</th>
                    <th style="width:78px;">Apoyo</th><th class="rx-num" style="width:96px;">Apoyo U$S/ha</th><th class="rx-num" style="width:86px;">Ha apoyo</th>
                    <th>Personal apoyo</th><th class="rx-num" style="width:110px;">Costo</th><th style="width:28px;"></th>
                </tr></thead>
                <tbody>${apls.map((a, i) => `
                    <tr class="${a.apoyo ? 'rx-con-apoyo' : ''}">
                        <td><span class="rx-apl-n">${i + 1}</span></td>
                        <td><input type="date" id="rx-apl-fecha-${i}" value="${e(a.fecha)}" onchange="ModuloOrdenes.m_setApl(${i}, 'fecha', this.value)"></td>
                        <td class="rx-num">${i > 0 && unLote
                            ? `<input type="number" class="rx-num" step="any" min="0" value="${e(a.ha[key1] ?? '')}" oninput="ModuloOrdenes.m_setHaLote(${i}, ${this.m_jsStr(key1)}, this.value)">`
                            : `<b id="rx-apl-ha-${i}">0 ha</b>${i === 0 && apls.length > 1 ? '<div class="rx-mini">resto</div>' : ''}`}
                            ${i > 0 && unLote ? `<span id="rx-apl-ha-${i}" style="display:none;"></span>` : ''}</td>
                        <td><input type="text" value="${e(a.contratista)}" placeholder="Propio / tercero" style="text-transform:uppercase;" oninput="ModuloOrdenes.m_setApl(${i}, 'contratista', this.value)"></td>
                        <td><input type="number" class="rx-num" step="any" min="0" value="${e(a.mo || '')}" placeholder="0.00" oninput="ModuloOrdenes.m_setApl(${i}, 'mo', this.value)"></td>
                        <td><label class="rx-switch"><input type="checkbox" ${a.apoyo ? 'checked' : ''} onchange="ModuloOrdenes.m_setApl(${i}, 'apoyo', this.checked, true)"><span>${a.apoyo ? 'Con' : 'Sin'}</span></label></td>
                        <td><input type="number" class="rx-num" step="any" min="0" value="${e(a.costoApoyo || '')}" placeholder="0.00" ${a.apoyo ? '' : 'disabled'} oninput="ModuloOrdenes.m_setApl(${i}, 'costoApoyo', this.value)"></td>
                        <td><input type="number" class="rx-num" id="rx-apl-haap-${i}" step="any" min="0" value="${a.haApoyo === null ? '' : e(a.haApoyo)}" ${a.apoyo ? '' : 'disabled'} title="Vacío = todas las hectáreas de la aplicación" oninput="ModuloOrdenes.m_setApl(${i}, 'haApoyo', this.value)"></td>
                        <td><input type="text" value="${e(a.personal)}" placeholder="Chofer / equipo" ${a.apoyo ? '' : 'disabled'} style="text-transform:uppercase;" oninput="ModuloOrdenes.m_setApl(${i}, 'personal', this.value)"></td>
                        <td class="rx-num"><b id="rx-apl-costo-${i}">U$S 0</b></td>
                        <td>${i > 0 ? `<button type="button" class="rx-x" title="Quitar aplicación" onclick="ModuloOrdenes.m_quitarAplicacion(${i})">&times;</button>` : ''}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
            ${apls.length === 1 ? `<div class="rx-nota">Se aplica todo en una vez. Si se hace en dos (por ejemplo, una parte sola y el resto con apoyo), tocá <b>+ Agregar aplicación</b>.</div>` : ''}`;

        // Matriz lotes × aplicaciones (sólo con varias aplicaciones y varios lotes)
        const secM = document.getElementById('rx-matriz-sec');
        const contM = document.getElementById('rx-matriz');
        const verMatriz = apls.length > 1 && this.lotesSeleccionados.length > 1;
        if (secM) secM.style.display = verMatriz ? '' : 'none';
        if (contM) {
            contM.innerHTML = !verMatriz ? '' : `
                <table class="rx-t">
                    <thead><tr><th>Lote</th><th class="rx-num">Superficie</th>
                        ${apls.map((a, i) => `<th class="rx-num">Aplic. ${i + 1}${i === 0 ? ' (resto)' : ''}</th>`).join('')}</tr></thead>
                    <tbody>${this.lotesSeleccionados.map(l => {
                        const key = this.m_claveLote(l);
                        return `<tr>
                            <td><b>Lote ${e(l.lote)}</b> <span class="rx-mini">${e(l.campo_nombre)}</span></td>
                            <td class="rx-num">${(parseFloat(l.sup) || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}</td>
                            ${apls.map((a, i) => i === 0
                                ? `<td class="rx-num rx-resto" id="rx-resto-${this.m_idSeguro(key)}">0</td>`
                                : `<td><input type="number" class="rx-num" step="any" min="0" value="${e(a.ha[key] ?? '')}" placeholder="0" oninput="ModuloOrdenes.m_setHaLote(${i}, ${this.m_jsStr(key)}, this.value)"></td>`).join('')}
                        </tr>`;
                    }).join('')}</tbody>
                </table>`;
        }
        this.m_recalcularTodo();
    },

    m_renderConsumoAplicaciones: function(insumos) {
        const cont = document.getElementById('rx-consumo');
        if (!cont) return;
        const e = this.m_esc;
        const apls = this._aplicaciones || [];
        if (!insumos.length || !this.lotesSeleccionados.length) {
            cont.innerHTML = `<div class="rx-vacio">Cargá lotes e insumos para ver el consumo de cada aplicación.</div>`;
            return;
        }
        const fmt = (n) => (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const has = apls.map((a, i) => this.m_haTotalApl(i));
        const supTotal = this.m_supTotalLotes();
        cont.innerHTML = `
            <table class="rx-t">
                <thead><tr><th>Insumo</th><th class="rx-num">Dosis/ha</th>
                    ${apls.map((a, i) => `<th class="rx-num">Aplic. ${i + 1}<div class="rx-mini">${fmt(has[i])} ha${a.apoyo ? ' · c/apoyo' : ''}</div></th>`).join('')}
                    <th class="rx-num">Total</th><th class="rx-num">Receta</th></tr></thead>
                <tbody>${insumos.map(x => {
                    const porApl = has.map(h => h * x.dosis);
                    const total = porApl.reduce((a, b) => a + b, 0);
                    const receta = supTotal * x.dosis;
                    const ok = Math.abs(total - receta) < 0.005;
                    return `<tr><td><b>${e(x.insumo)}</b> <span class="rx-mini">${e(x.deposito)}</span></td>
                        <td class="rx-num">${fmt(x.dosis)}</td>
                        ${porApl.map(c => `<td class="rx-num">${fmt(c)} ${e(x.unidad)}</td>`).join('')}
                        <td class="rx-num"><b>${fmt(total)} ${e(x.unidad)}</b></td>
                        <td class="rx-num ${ok ? 'rx-ok' : 'rx-mal'}">${fmt(receta)} ${ok ? '✓' : '≠'}</td></tr>`;
                }).join('')}</tbody>
            </table>`;
    },

    m_leerInsumosReceta: function() {
        const lista = [];
        document.querySelectorAll('.producto-row, .producto-row-c').forEach(row => {
            const sel = row.querySelector('.p-insumo');
            const insumo = (sel?.value || '').trim();
            const dosis = parseFloat(row.querySelector('.p-dosis')?.value) || 0;
            if (!insumo || dosis <= 0) return;
            const op = sel.selectedOptions[0];
            let cod = op?.getAttribute('data-cod') || '';
            if (!cod || cod === 'null' || cod === 'undefined') {
                const m = (this.parametros.insumosMaestros || []).find(x => (x.articulo || '').trim().toUpperCase() === insumo.toUpperCase());
                cod = m?.reg_local || '';
            }
            lista.push({
                insumo,
                cod_articulo: cod || null,
                dosis,
                u_unit: parseFloat(row.querySelector('.p-u-unit')?.value) || 0,
                deposito: (row.querySelector('.p-deposito')?.value || 'DEB_CENTRAL').trim().toUpperCase(),
                unidad: op?.getAttribute('data-unidad') || ''
            });
        });
        return lista;
    },

    // "APLICACIÓN 2 de 3 · ..." en comentario. Filas viejas sin marca = aplicación 1 de 1.
    m_aplicacionDeFila: function(r) {
        const m = /APLICACI[ÓO]N\s+(\d+)\s+de\s+(\d+)/i.exec((r && r.comentario) || '');
        return m ? { n: parseInt(m[1], 10) || 1, total: parseInt(m[2], 10) || 1, marcada: true } : { n: 1, total: 1, marcada: false };
    },

    m_duplicarOrden: function(ot, ref) {
        this.m_abrirFormulario({ modo: 'DUPLICAR', ot, ref });
    },

    m_editarRecetaCompleta: function(ot, ref) {
        this.m_abrirFormulario({ modo: 'EDITAR', ot, ref });
    },

    m_hoyLocal: function() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    m_esc: function(v) {
        return (v === null || v === undefined ? '' : String(v))
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    // Literal JS seguro para usar dentro de onclick="..."
    m_jsStr: function(v) {
        return this.m_esc(JSON.stringify(v === null || v === undefined ? '' : String(v)));
    },

    m_asegurarEstilosReceta: function() {
        if (document.getElementById('rx-estilos')) return;
        const st = document.createElement('style');
        st.id = 'rx-estilos';
        st.textContent = `
            .rx { display:flex; flex-direction:column; gap:8px; font-family:'Roboto',sans-serif; color:#1A211C; }
            .rx *, .rx *::before, .rx *::after { box-sizing:border-box; }
            .rx-tabs { display:flex; gap:2px; border-bottom:1px solid #D2D7D3; flex-shrink:0; }
            .rx-tab { display:inline-flex; align-items:center; gap:7px; padding:8px 14px 9px; border:none; background:none; border-bottom:2px solid transparent; margin-bottom:-1px;
                      font:800 11.5px 'Roboto',sans-serif; color:#556358; cursor:pointer; white-space:nowrap; }
            .rx-tab:hover { color:#1A211C; }
            .rx-tab.activa { color:#104630; border-bottom-color:#1E6B4C; }
            .rx-tab-b { min-width:18px; padding:1px 6px; border-radius:9px; background:#EEF1EE; color:#556358; font-size:10px; text-align:center; }
            .rx-tab-b.ok { background:#E3F1E8; color:#1E6B4C; }
            .rx-tab-b.mal { background:#FDECEA; color:#C62828; }
            .rx-viewport { height:min(470px, 58vh); overflow-y:auto; padding:2px 2px 2px 0; }
            .rx-sec { border:1px solid #E3E6E3; border-radius:10px; padding:10px 12px; background:#FBFCFB; margin-bottom:8px; }
            .rx-sec-t { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:8px;
                        font:900 10px 'Roboto',sans-serif; text-transform:uppercase; letter-spacing:.4px; color:#1E6B4C; }
            .rx-sec-meta { font-weight:600; text-transform:none; letter-spacing:0; color:#556358; font-size:11px; }
            .rx-grid { display:grid; grid-template-columns:repeat(12, 1fr); gap:8px 10px; }
            .rx-c { min-width:0; }
            .rx-c label { display:block; font:800 9.5px 'Roboto',sans-serif; text-transform:uppercase; color:#556358; margin-bottom:3px; letter-spacing:.2px; }
            .rx-c.req label::after { content:' *'; color:#C62828; }
            .rx input:not([type=checkbox]), .rx select { width:100%; height:30px; padding:4px 8px; border:1px solid #D2D7D3; border-radius:7px; background:#FFFFFF;
                      font:600 12px 'Roboto',sans-serif; color:#1A211C; outline:none; transition:border-color .15s, box-shadow .15s; }
            .rx input:focus, .rx select:focus { border-color:#1E6B4C; box-shadow:0 0 0 3px rgba(30,107,76,.12); }
            .rx input[readonly] { background:#F4F6F4; color:#3D4A40; }
            .rx input:disabled { background:#F1F2F1; color:#A0A8A2; }
            .rx .rx-num { text-align:right; font-variant-numeric:tabular-nums; }
            .rx-lotes { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; min-height:30px; }
            .rx-lote { display:inline-flex; align-items:center; gap:6px; padding:4px 6px 4px 10px; border-radius:16px; background:#E8F3EC; color:#104630;
                       border:1px solid #CFE6D7; font:600 11.5px 'Roboto',sans-serif; }
            .rx-lote i { color:#556358; font-style:normal; font-weight:500; }
            .rx-lote button { width:20px; height:20px; border-radius:50%; border:none; background:#FFFFFF; color:#C62828; cursor:pointer; font-weight:900; line-height:1; }
            .rx-vacio { width:100%; text-align:center; padding:12px; border:1px dashed #D2D7D3; border-radius:8px; color:#556358; font-size:11.5px; background:#FFFFFF; }
            .rx-nota { margin-top:8px; font-size:11px; color:#556358; line-height:1.4; }
            .rx-prod-cab, .rx .producto-row-c { display:grid; grid-template-columns:150px minmax(0,1fr) 80px 100px 86px 100px 28px; gap:6px; align-items:start; }
            .rx-prod-cab { font:800 9px 'Roboto',sans-serif; text-transform:uppercase; color:#556358; padding:0 6px 5px; border-bottom:1px solid #E3E6E3; margin-bottom:5px; }
            .rx .producto-row-c { background:#FFFFFF; border:1px solid #E3E6E3; border-radius:8px; padding:5px 6px; margin-bottom:5px; }
            .rx-stock { font-size:9.5px; color:#556358; margin-top:2px; padding-left:2px; }
            .rx-stock.mal { color:#C62828; font-weight:800; }
            .rx-x { width:28px; height:28px; border-radius:7px; border:1px solid #F3C7C3; background:#FFF5F4; color:#C62828; cursor:pointer; font-weight:900; font-size:14px; line-height:1; }
            .rx-btn { height:32px; padding:0 16px; border-radius:8px; border:1px solid #D2D7D3; background:#FFFFFF; color:#1A211C; cursor:pointer;
                      font:800 11.5px 'Roboto',sans-serif; white-space:nowrap; }
            .rx-btn:hover { background:#F4F6F4; }
            .rx-btn.prim { background:#1E6B4C; border-color:#1E6B4C; color:#FFFFFF; box-shadow:0 3px 10px rgba(30,107,76,.22); }
            .rx-btn.prim:hover { background:#185C40; }
            .rx-btn.prim:disabled { background:#CBD5CF; border-color:#CBD5CF; color:#6B7770; box-shadow:none; cursor:not-allowed; }
            .rx-btn.azul { background:#E3F2FD; border-color:#BBDEFB; color:#0277BD; }
            .rx-btn.chico { height:26px; padding:0 10px; font-size:10.5px; text-transform:none; letter-spacing:0; }
            .rx-t { width:100%; border-collapse:collapse; font-size:11.5px; background:#FFFFFF; border:1px solid #E3E6E3; border-radius:8px; overflow:hidden; }
            .rx-t th { background:#EEF1EE; color:#556358; font:800 9px 'Roboto',sans-serif; text-transform:uppercase; padding:6px 6px; text-align:left; vertical-align:bottom; }
            .rx-t td { padding:4px 6px; border-top:1px solid #EDF0ED; vertical-align:middle; }
            .rx-t td input, .rx-t td select { height:28px; }
            .rx-t tr.rx-con-apoyo td { background:#FFFBF0; }
            .rx-apl-n { display:inline-flex; width:22px; height:22px; border-radius:50%; align-items:center; justify-content:center; background:#1E6B4C; color:#FFF; font-weight:900; font-size:11px; }
            .rx-mini { font-size:9.5px; color:#6B776F; font-weight:600; }
            .rx-resto { background:#F4F6F4; color:#3D4A40; font-weight:800; }
            .rx-resto.mal, .rx-mal { color:#C62828 !important; font-weight:900; }
            .rx-ok { color:#1E6B4C; font-weight:800; }
            .rx-switch { display:inline-flex; align-items:center; gap:5px; cursor:pointer; font-weight:800; font-size:11px; color:#556358; }
            .rx-switch input { accent-color:#E08600; width:15px; height:15px; }
            .rx-con-apoyo .rx-switch { color:#E08600; }
            .rx-aviso { padding:8px 11px; border-radius:8px; font-size:11.5px; line-height:1.4; border-left:3px solid #1E6B4C; background:#EEF6F1; }
            .rx-aviso.azul { border-left-color:#0277BD; background:#EAF4FC; }
            .rx-aviso.ambar { border-left-color:#E08600; background:#FFF7E6; }
            .rx-pie { display:flex; justify-content:space-between; align-items:center; gap:10px; border-top:1px solid #D2D7D3; padding-top:9px; flex-shrink:0; flex-wrap:wrap; }
            .rx-tot { display:flex; align-items:center; flex-wrap:wrap; }
            .rx-tot div { padding:0 12px; border-right:1px solid #E3E6E3; }
            .rx-tot div:first-child { padding-left:0; }
            .rx-tot div:last-child { border-right:none; }
            .rx-tot span { display:block; font:800 8.5px 'Roboto',sans-serif; text-transform:uppercase; color:#6B776F; letter-spacing:.3px; }
            .rx-tot b { font:900 12.5px 'Roboto',sans-serif; font-variant-numeric:tabular-nums; color:#1A211C; }
            .rx-tot .fuerte b { font-size:16px; color:#1E6B4C; }
            .rx-motivo { font-size:10.5px; color:#C62828; font-weight:700; max-width:260px; text-align:right; }
            /* Detalle de la OT */
            .rx-det-apl { display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:8px; }
            .rx-det-card { border:1px solid #E3E6E3; border-radius:10px; padding:9px 11px; background:#FFFFFF; font-size:11px; line-height:1.5; }
            .rx-det-card.apoyo { border-color:#F5D9A6; background:#FFFBF0; }
            .rx-det-card .t { display:flex; justify-content:space-between; align-items:center; font-weight:900; color:#104630; margin-bottom:3px; }
            .rx-chip-apoyo { padding:1px 7px; border-radius:9px; font-size:9.5px; font-weight:800; background:#EEF1EE; color:#556358; }
            .rx-chip-apoyo.si { background:#FFF0D6; color:#B26A00; }
            .rx-badge-apl { display:inline-block; margin-left:4px; padding:1px 6px; border-radius:8px; background:#E3F2FD; color:#0277BD; font-size:9.5px; font-weight:800; }
        `;
        document.head.appendChild(st);
    },

    // Detalle de la OT: una tarjeta por aplicación y el consumo de cada insumo repartido entre ellas
    m_htmlResumenAplicaciones: function(registrosOT) {
        const e = this.m_esc;
        const fmt = (n, d = 2) => (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
        const grupos = new Map();
        registrosOT.forEach(r => {
            const n = this.m_aplicacionDeFila(r).n;
            if (!grupos.has(n)) grupos.set(n, []);
            grupos.get(n).push(r);
        });
        const nums = [...grupos.keys()].sort((a, b) => a - b);
        const apl = nums.map(n => {
            const rows = grupos.get(n);
            const lotes = new Map();
            rows.forEach(r => { const k = `${r.campo}|${r.cuadro}`; if (!lotes.has(k)) lotes.set(k, parseFloat(r.sup_uso) || 0); });
            const ha = [...lotes.values()].reduce((a, b) => a + b, 0);
            const ins = rows.reduce((a, r) => a + (parseFloat(r.total_dolar) || 0), 0);
            const total = rows.reduce((a, r) => a + (parseFloat(r.costo_final) || parseFloat(r.total_dolar) || 0), 0);
            const conApoyo = rows.some(r => (parseFloat(r.ha_apoyo) || 0) > 0) || /CON APOYO/i.test(rows[0].comentario || '');
            return { n, rows, ha, ins, labor: total - ins, total, conApoyo,
                     fecha: rows[0].fecha || '-', contratista: rows[0].contratista || '-', personal: rows.find(r => r.apoyo)?.apoyo || '' };
        });

        const tarjetas = apl.map(a => `
            <div class="rx-det-card ${a.conApoyo ? 'apoyo' : ''}">
                <div class="t"><span>Aplicación ${a.n}${apl.length > 1 ? ` de ${apl.length}` : ''}</span>
                    <span class="rx-chip-apoyo ${a.conApoyo ? 'si' : ''}">${a.conApoyo ? 'Con apoyo' : 'Sin apoyo'}</span></div>
                <div>📅 ${e(a.fecha)} · <b>${fmt(a.ha)} ha</b></div>
                <div>👷 ${e(a.contratista)}${a.conApoyo && a.personal ? ` · Apoyo: ${e(a.personal)}` : ''}</div>
                <div>Insumos U$S ${fmt(a.ins)} · Labor/apoyo U$S ${fmt(a.labor)}</div>
                <div style="font-weight:900; color:#1E6B4C;">Total U$S ${fmt(a.total)}</div>
            </div>`).join('');

        // Consumo por insumo en cada aplicación
        const insumos = new Map();
        registrosOT.forEach(r => {
            const k = `${(r.insumo || '').toUpperCase()}|${(r.deposito_origen || '').toUpperCase()}`;
            if (!insumos.has(k)) insumos.set(k, { insumo: r.insumo, deposito: r.deposito_origen, porApl: {}, total: 0 });
            const x = insumos.get(k);
            const n = this.m_aplicacionDeFila(r).n;
            const c = parseFloat(r.total_consumo) || 0;
            x.porApl[n] = (x.porApl[n] || 0) + c;
            x.total += c;
        });
        const tablaConsumo = apl.length < 2 ? '' : `
            <table class="rx-t" style="margin-top:8px;">
                <thead><tr><th>Insumo</th>${apl.map(a => `<th class="rx-num">Aplic. ${a.n}</th>`).join('')}<th class="rx-num">Consumo total</th></tr></thead>
                <tbody>${[...insumos.values()].map(x => `
                    <tr><td><b>${e(x.insumo)}</b> <span class="rx-mini">${e(x.deposito || '')}</span></td>
                        ${apl.map(a => `<td class="rx-num">${fmt(x.porApl[a.n] || 0)}</td>`).join('')}
                        <td class="rx-num"><b>${fmt(x.total)}</b></td></tr>`).join('')}
                </tbody>
            </table>`;

        return `
            <div style="background:#F8FAFC; border:1px solid var(--color-border, #D2D7D3); padding:10px 12px; border-radius:10px;">
                <span style="font-size:10.5px; font-weight:800; display:block; margin-bottom:6px; color:#104630; text-transform:uppercase;">
                    🚜 ${apl.length > 1 ? `Receta ejecutada en ${apl.length} aplicaciones` : 'Aplicación'}
                </span>
                <div class="rx-det-apl">${tarjetas}</div>
                ${tablaConsumo}
            </div>`;
    },

    m_fechaAR: function(f) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f || '');
        return m ? `${m[3]}/${m[2]}/${m[1]}` : (f || '-');
    },

    // Resumen de cada aplicación de una OT (sirve para pantalla y reportes).
    // Filas viejas sin marca = una sola aplicación.
    m_resumenAplicacionesOT: function(registros) {
        const grupos = new Map();
        (registros || []).forEach(r => {
            const n = this.m_aplicacionDeFila(r).n;
            if (!grupos.has(n)) grupos.set(n, []);
            grupos.get(n).push(r);
        });
        const nums = [...grupos.keys()].sort((a, b) => a - b);
        const N = nums.length;

        return nums.map(n => {
            const rows = grupos.get(n).slice().sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
            const marcada = rows.some(r => this.m_aplicacionDeFila(r).marcada);
            const lotes = new Map();
            rows.forEach(r => {
                const k = `${r.campo || ''}|${r.cuadro || ''}`;
                if (!lotes.has(k)) lotes.set(k, { campo: r.campo || '', lote: r.cuadro || '', ha: parseFloat(r.sup_uso) || 0 });
            });
            const ha = [...lotes.values()].reduce((a, l) => a + l.ha, 0);
            const insumosUsd = rows.reduce((a, r) => a + (parseFloat(r.total_dolar) || 0), 0);
            const laborUsd = rows.reduce((a, r) => a + (parseFloat(r.sup_uso) || 0) * (parseFloat(r.costo_ha) || 0), 0);
            const totalUsd = rows.reduce((a, r) => a + (parseFloat(r.costo_final) || parseFloat(r.total_dolar) || 0), 0);
            const totalArs = rows.reduce((a, r) => a + (parseFloat(r.total_pesos) || 0), 0);
            const apoyoUsd = Math.max(0, totalUsd - insumosUsd - laborUsd);
            const conApoyoFilas = rows.filter(r => (parseFloat(r.ha_apoyo) || 0) > 0);
            const conApoyo = conApoyoFilas.length > 0 || /CON APOYO/i.test(rows[0].comentario || '');
            let haApoyo = 0;
            if (conApoyoFilas.length) {
                if (marcada) {
                    const vistos = new Set();
                    conApoyoFilas.forEach(r => { const k = `${r.campo}|${r.cuadro}`; if (!vistos.has(k)) { vistos.add(k); haApoyo += parseFloat(r.ha_apoyo) || 0; } });
                } else {
                    haApoyo = parseFloat(conApoyoFilas[0].ha_apoyo) || 0;   // formato anterior: ha de apoyo global
                }
            }
            const fechas = rows.map(r => r.fecha).filter(Boolean).sort();
            const consumo = new Map();
            rows.forEach(r => {
                const k = `${(r.insumo || '').toUpperCase()}|${(r.deposito_origen || '').toUpperCase()}`;
                if (!consumo.has(k)) consumo.set(k, { insumo: r.insumo || '-', cod: r.cod_articulo || '', deposito: r.deposito_origen || '', dosis: parseFloat(r.dosis_ha) || 0, unitario: parseFloat(r.imp_uni) || 0, consumo: 0, usd: 0 });
                const x = consumo.get(k);
                x.consumo += parseFloat(r.total_consumo) || 0;
                x.usd += parseFloat(r.total_dolar) || 0;
            });
            return {
                n, total: N,
                etiqueta: N > 1 ? `Aplicación ${n} de ${N}` : 'Aplicación única',
                fecha: fechas[0] || '-',
                fechaAR: this.m_fechaAR(fechas[0]),
                lotes: [...lotes.values()],
                lotesTxt: [...lotes.values()].map(l => `Lote ${l.lote} (${l.ha.toLocaleString('es-AR', { maximumFractionDigits: 2 })} ha)`).join(', '),
                ha,
                contratista: rows.find(r => r.contratista)?.contratista || '-',
                moHa: Math.max(0, ...rows.map(r => parseFloat(r.costo_ha) || 0)),
                conApoyo,
                personal: rows.find(r => r.apoyo)?.apoyo || '',
                haApoyo,
                costoApoyoHa: haApoyo > 0 ? apoyoUsd / haApoyo : 0,
                insumosUsd, laborUsd, apoyoUsd, totalUsd, totalArs,
                consumo: [...consumo.values()],
                filas: rows
            };
        });
    },

    // Una línea por aplicación para tablas de reportes
    m_textoAplicacion: function(a) {
        const ha = a.ha.toLocaleString('es-AR', { maximumFractionDigits: 2 });
        return `${a.total > 1 ? `Aplic. ${a.n}` : 'Única'}: ${a.fechaAR} · ${ha} ha · ${a.conApoyo ? `CON APOYO${a.personal ? ' (' + a.personal + ')' : ''}` : 'SIN APOYO'}`;
    },

    // Hoja de Excel con título, encabezado verde, formatos y totales (columnas con sumar: true)
    m_xlsHojaTabla: function(wb, nombreHoja, titulo, subtitulo, columnas, filas, confTema) {
        const ws = wb.addWorksheet(nombreHoja, { views: [{ state: 'frozen', ySplit: 3 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
        const nCols = columnas.length;
        ws.columns = columnas.map(c => ({ key: c.key, width: c.width }));
        ws.mergeCells(1, 1, 1, nCols);
        ws.mergeCells(2, 1, 2, nCols);
        ws.getCell(1, 1).value = titulo;
        ws.getCell(1, 1).font = { bold: true, size: 13, color: { argb: confTema.argbDark } };
        ws.getRow(1).height = 26;
        ws.getCell(2, 1).value = subtitulo;
        ws.getCell(2, 1).font = { italic: true, size: 9, color: { argb: 'FF556358' } };

        const head = ws.getRow(3);
        head.height = 30;
        columnas.forEach((c, i) => {
            const cell = head.getCell(i + 1);
            cell.value = c.header;
            cell.font = { bold: true, size: 8.5, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: confTema.argbTema } };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        });

        const fmt = c => c.monedaUsd ? '"U$S" #,##0.00' : c.monedaArs ? '"$" #,##0.00' : (c.numero ? '#,##0.00' : null);
        filas.forEach((f, k) => {
            const row = ws.addRow(columnas.map(c => f[c.key] ?? ''));
            row.eachCell({ includeEmpty: true }, (cell, i) => {
                const c = columnas[i - 1];
                if (!c) return;
                cell.font = { size: 9, bold: !!c.negrita };
                cell.alignment = { vertical: 'middle', horizontal: c.halign || 'left', wrapText: !!c.wrap };
                cell.border = { bottom: { style: 'hair', color: { argb: 'FFE0DCD4' } } };
                const nf = fmt(c);
                if (nf) cell.numFmt = nf;
                if (c.key === 'apoyo') {
                    const si = String(cell.value || '').startsWith('SI');
                    cell.font = { size: 9, bold: true, color: { argb: si ? 'FFB26A00' : 'FF556358' } };
                    if (si) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4DE' } };
                } else if (f._alterna) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F8F5' } };
                }
            });
        });

        if (filas.length && columnas.some(c => c.sumar)) {
            const pri = 4, ult = 3 + filas.length;
            const tot = ws.getRow(ult + 1);
            tot.height = 20;
            columnas.forEach((c, i) => {
                const cell = tot.getCell(i + 1);
                if (i === 0) cell.value = 'TOTALES';
                else if (c.sumar) {
                    const letra = ws.getColumn(i + 1).letter;
                    cell.value = { formula: `SUM(${letra}${pri}:${letra}${ult})` };
                    const nf = fmt(c); if (nf) cell.numFmt = nf;
                }
                cell.font = { bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: confTema.argbDark } };
                cell.alignment = { vertical: 'middle', horizontal: c.halign || 'left' };
            });
        }
        return ws;
    },

    // Agrega al libro: "Aplicaciones" (una fila por OT y aplicación) y "Consumo por aplicación" (lote × insumo)
    m_xlsHojasAplicaciones: function(wb, gruposOT, confTema, subtitulo) {
        const colsApl = [
            { header: 'OT N°', key: 'ot', width: 9, halign: 'center', negrita: true },
            { header: 'REF', key: 'ref', width: 8, halign: 'center' },
            { header: 'ESTADO', key: 'estado', width: 13, halign: 'center' },
            { header: 'APLICACIÓN', key: 'aplicacion', width: 17, halign: 'center', negrita: true },
            { header: 'FECHA', key: 'fecha', width: 12, halign: 'center' },
            { header: 'ESTABLECIMIENTO', key: 'establecimiento', width: 20 },
            { header: 'CAMPO', key: 'campo', width: 16 },
            { header: 'LOTES (HA)', key: 'lotes', width: 30, wrap: true },
            { header: 'LABOR', key: 'labor', width: 20 },
            { header: 'HECTÁREAS', key: 'ha', width: 12, halign: 'right', numero: true, sumar: true },
            { header: 'CONTRATISTA', key: 'contratista', width: 18 },
            { header: 'M.O. U$S/HA', key: 'mo_ha', width: 12, halign: 'right', numero: true },
            { header: 'APOYO', key: 'apoyo', width: 9, halign: 'center' },
            { header: 'PERSONAL APOYO', key: 'personal', width: 18 },
            { header: 'HA APOYO', key: 'ha_apoyo', width: 11, halign: 'right', numero: true, sumar: true },
            { header: 'APOYO U$S/HA', key: 'apoyo_ha', width: 12, halign: 'right', numero: true },
            { header: 'INSUMOS U$S', key: 'insumos', width: 14, halign: 'right', monedaUsd: true, sumar: true },
            { header: 'LABOR U$S', key: 'labor_usd', width: 13, halign: 'right', monedaUsd: true, sumar: true },
            { header: 'APOYO U$S', key: 'apoyo_usd', width: 13, halign: 'right', monedaUsd: true, sumar: true },
            { header: 'TOTAL U$S', key: 'total', width: 14, halign: 'right', monedaUsd: true, sumar: true, negrita: true },
            { header: 'TOTAL $', key: 'total_ars', width: 16, halign: 'right', monedaArs: true, sumar: true }
        ];
        const colsCons = [
            { header: 'OT N°', key: 'ot', width: 9, halign: 'center', negrita: true },
            { header: 'APLICACIÓN', key: 'aplicacion', width: 17, halign: 'center' },
            { header: 'FECHA', key: 'fecha', width: 12, halign: 'center' },
            { header: 'APOYO', key: 'apoyo', width: 9, halign: 'center' },
            { header: 'CAMPO', key: 'campo', width: 16 },
            { header: 'LOTE', key: 'lote', width: 10, halign: 'center' },
            { header: 'HA', key: 'ha', width: 10, halign: 'right', numero: true },
            { header: 'CÓDIGO', key: 'codigo', width: 10, halign: 'center' },
            { header: 'INSUMO', key: 'insumo', width: 28, negrita: true },
            { header: 'DEPÓSITO', key: 'deposito', width: 18 },
            { header: 'DOSIS/HA', key: 'dosis', width: 11, halign: 'right', numero: true },
            { header: 'CONSUMO', key: 'consumo', width: 13, halign: 'right', numero: true, sumar: true },
            { header: 'U$S UNIT.', key: 'unit', width: 11, halign: 'right', numero: true },
            { header: 'INSUMO U$S', key: 'usd', width: 14, halign: 'right', monedaUsd: true, sumar: true }
        ];

        const filasApl = [], filasCons = [];
        let alterna = false;
        gruposOT.forEach(g => {
            alterna = !alterna;
            this.m_resumenAplicacionesOT(g.filasRaw).forEach(a => {
                const p0 = a.filas[0];
                filasApl.push({
                    _alterna: alterna,
                    ot: g.orden_trab, ref: g.ref_orden === 'SIN-REF' ? '' : g.ref_orden, estado: g.estado,
                    aplicacion: a.etiqueta, fecha: a.fechaAR,
                    establecimiento: p0.establecimiento || g.establecimiento, campo: [...new Set(a.lotes.map(l => l.campo))].join(', '),
                    lotes: a.lotesTxt, labor: `${p0.tipo_labor || ''}${p0.labor ? ' / ' + p0.labor : ''}`,
                    ha: a.ha, contratista: a.contratista, mo_ha: a.moHa,
                    apoyo: a.conApoyo ? 'SI' : 'NO', personal: a.conApoyo ? a.personal : '',
                    ha_apoyo: a.conApoyo ? a.haApoyo : 0, apoyo_ha: a.conApoyo ? a.costoApoyoHa : 0,
                    insumos: a.insumosUsd, labor_usd: a.laborUsd, apoyo_usd: a.apoyoUsd, total: a.totalUsd, total_ars: a.totalArs
                });
                a.filas.forEach(r => filasCons.push({
                    _alterna: alterna,
                    ot: g.orden_trab, aplicacion: a.etiqueta, fecha: this.m_fechaAR(r.fecha), apoyo: a.conApoyo ? 'SI' : 'NO',
                    campo: r.campo || '', lote: r.cuadro || '', ha: parseFloat(r.sup_uso) || 0,
                    codigo: r.cod_articulo || '', insumo: r.insumo || '', deposito: r.deposito_origen || '',
                    dosis: parseFloat(r.dosis_ha) || 0, consumo: parseFloat(r.total_consumo) || 0,
                    unit: parseFloat(r.imp_uni) || 0, usd: parseFloat(r.total_dolar) || 0
                }));
            });
        });

        this.m_xlsHojaTabla(wb, 'Aplicaciones', 'DETALLE DE APLICACIONES POR ORDEN DE TRABAJO', subtitulo, colsApl, filasApl, confTema);
        this.m_xlsHojaTabla(wb, 'Consumo por aplicación', 'CONSUMO DE INSUMOS POR APLICACIÓN Y LOTE', subtitulo, colsCons, filasCons, confTema);
    },

    // Bloque HTML para los PDF/impresiones: tabla de aplicaciones + consumo por aplicación
    m_htmlAplicacionesReporte: function(registros) {
        const e = this.m_esc;
        const f2 = n => (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const apl = this.m_resumenAplicacionesOT(registros);
        const insumos = new Map();
        apl.forEach(a => a.consumo.forEach(x => {
            const k = `${x.insumo}|${x.deposito}`;
            if (!insumos.has(k)) insumos.set(k, { insumo: x.insumo, deposito: x.deposito, dosis: x.dosis, por: {}, total: 0 });
            const y = insumos.get(k);
            y.por[a.n] = (y.por[a.n] || 0) + x.consumo;
            y.total += x.consumo;
        }));
        const tot = apl.reduce((s, a) => ({ ha: s.ha + a.ha, ins: s.ins + a.insumosUsd, lab: s.lab + a.laborUsd, apo: s.apo + a.apoyoUsd, tot: s.tot + a.totalUsd }), { ha: 0, ins: 0, lab: 0, apo: 0, tot: 0 });

        return `
            <h3 class="sec-rep">${apl.length > 1 ? `Receta ejecutada en ${apl.length} aplicaciones` : 'Aplicación'}</h3>
            <table class="tabla-apl">
                <thead><tr>
                    <th>Aplicación</th><th>Fecha</th><th>Lotes (ha)</th><th style="text-align:right;">Hectáreas</th><th>Contratista</th>
                    <th style="text-align:right;">M.O. U$S/ha</th><th style="text-align:center;">Apoyo</th><th>Personal apoyo</th>
                    <th style="text-align:right;">Ha apoyo</th><th style="text-align:right;">Apoyo U$S/ha</th>
                    <th style="text-align:right;">Insumos U$S</th><th style="text-align:right;">Labor U$S</th><th style="text-align:right;">Apoyo U$S</th><th style="text-align:right;">Total U$S</th>
                </tr></thead>
                <tbody>${apl.map(a => `
                    <tr class="${a.conApoyo ? 'con-apoyo' : ''}">
                        <td><b>${e(a.etiqueta)}</b></td>
                        <td>${e(a.fechaAR)}</td>
                        <td>${e(a.lotesTxt)}</td>
                        <td style="text-align:right;"><b>${f2(a.ha)}</b></td>
                        <td>${e(a.contratista)}</td>
                        <td style="text-align:right;">${f2(a.moHa)}</td>
                        <td style="text-align:center;"><span class="chip-apoyo ${a.conApoyo ? 'si' : ''}">${a.conApoyo ? 'SÍ' : 'NO'}</span></td>
                        <td>${a.conApoyo ? e(a.personal || '-') : '-'}</td>
                        <td style="text-align:right;">${a.conApoyo ? f2(a.haApoyo) : '-'}</td>
                        <td style="text-align:right;">${a.conApoyo ? f2(a.costoApoyoHa) : '-'}</td>
                        <td style="text-align:right;">${f2(a.insumosUsd)}</td>
                        <td style="text-align:right;">${f2(a.laborUsd)}</td>
                        <td style="text-align:right;">${f2(a.apoyoUsd)}</td>
                        <td style="text-align:right;"><b>${f2(a.totalUsd)}</b></td>
                    </tr>`).join('')}
                </tbody>
                <tfoot><tr>
                    <td colspan="3">TOTAL OT</td><td style="text-align:right;">${f2(tot.ha)}</td><td colspan="6"></td>
                    <td style="text-align:right;">${f2(tot.ins)}</td><td style="text-align:right;">${f2(tot.lab)}</td><td style="text-align:right;">${f2(tot.apo)}</td><td style="text-align:right;">${f2(tot.tot)}</td>
                </tr></tfoot>
            </table>

            <h3 class="sec-rep">Consumo de insumos por aplicación</h3>
            <table class="tabla-apl">
                <thead><tr><th>Insumo</th><th>Depósito</th><th style="text-align:right;">Dosis/ha</th>
                    ${apl.map(a => `<th style="text-align:right;">${a.total > 1 ? `Aplic. ${a.n}` : 'Consumo'}<br><small>${e(a.fechaAR)} · ${a.conApoyo ? 'c/apoyo' : 's/apoyo'}</small></th>`).join('')}
                    ${apl.length > 1 ? '<th style="text-align:right;">Total</th>' : ''}</tr></thead>
                <tbody>${[...insumos.values()].map(x => `
                    <tr><td><b>${e(x.insumo)}</b></td><td>${e(x.deposito)}</td><td style="text-align:right;">${f2(x.dosis)}</td>
                        ${apl.map(a => `<td style="text-align:right;">${f2(x.por[a.n] || 0)}</td>`).join('')}
                        ${apl.length > 1 ? `<td style="text-align:right;"><b>${f2(x.total)}</b></td>` : ''}</tr>`).join('')}
                </tbody>
            </table>`;
    },
};

/* =======================================================================
   DECLARACIONES GLOBALES COMPARTIDAS (ANTI-COLISIÓN DE SCRIPTS)
   ======================================================================= */

window.SALVUCCI_CONF = window.SALVUCCI_CONF || {
    pieInstitucional: 'Sistemas de Gestión Agrosoft J&L - Chimpay R.N. - Contacto: jsosa190585@gmail.com',
    empresaRazon: 'SALVUCCI GESTIÓN · AGROSOFT J&L',
    empresaDomicilio: 'Auditoría Central de Prescripciones y Labores',
    rgbTema: [30, 107, 76],
    rgbTemaDark: [18, 63, 44],
    argbTema: 'FF1E6B4C',
    argbDark: 'FF123F2C'
};

window.CODE128_PATRONES = window.CODE128_PATRONES || [
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

window.code128Modulos = window.code128Modulos || function(texto) {
    const limpio = String(texto == null ? '' : texto).replace(/[^\x20-\x7E]/g, '').slice(0, 40) || ' ';
    const valores = [];
    for (let i = 0; i < limpio.length; i++) valores.push(limpio.charCodeAt(i) - 32);
    let suma = 104;
    valores.forEach((v, i) => { suma += v * (i + 1); });
    const indices = [104].concat(valores, [suma % 103, 106]);
    const trama = indices.map(i => window.CODE128_PATRONES[i]).join('');
    const elementos = [];
    let totalModulos = 0;
    for (let i = 0; i < trama.length; i++) {
        const ancho = parseInt(trama.charAt(i), 10);
        elementos.push({ barra: i % 2 === 0, ancho: ancho });
        totalModulos += ancho;
    }
    return { elementos: elementos, totalModulos: totalModulos, texto: limpio };
};

window.dibujarCodigoBarrasPdf = window.dibujarCodigoBarrasPdf || function(doc, texto, x, y, ancho, alto) {
    const cb = window.code128Modulos(texto);
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
};

window.codigoBarrasPngBase64 = window.codigoBarrasPngBase64 || function(texto, anchoPx, altoPx) {
    try {
        const cb = window.code128Modulos(texto);
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
};

window.cargarLogoBase64 = window.cargarLogoBase64 || function() {
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
};

window.generarFolio = window.generarFolio || function(prefijo) {
    const f = new Date();
    const d = f.getFullYear() + String(f.getMonth() + 1).padStart(2, '0') + String(f.getDate()).padStart(2, '0');
    return `${prefijo}-${d}-${Date.now().toString().slice(-5)}`;
};

window.guardarEnDescargas = window.guardarEnDescargas || function(nombreArchivo, buffer) {
    const os = require('os');
    const pathMod = require('path');
    const fs = require('fs');
    const carpeta = pathMod.join(os.homedir(), 'Downloads');
    if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });
    const ruta = pathMod.join(carpeta, nombreArchivo);
    fs.writeFileSync(ruta, buffer);
    return ruta;
};

window.descargarNativoBlob = window.descargarNativoBlob || function(blob, nombreArchivo) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', nombreArchivo);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};