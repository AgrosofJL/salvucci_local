
/**
 * ARCHIVO: pagina_baja_insumos.js
 * Sistema: Salvucci Gestión · AgroSoft J&L
 * Descripción: Módulo de Control de Inventario y Baja de Insumos integrado con SQLite IPC Local
 * Mode: "No me quites nada" + Regla Max(registro)+1 + Dynamic SQLite IPC + Sync Flag (sincronizado=0)
 */

const PaginaBajaInsumos = {
    datosStock: [], // Matriz procesada: { articulo, unidad, ingresos, egresos, disponible }
    parametros: {
        campos: [],
        articulosUnicos: []
    },

    // ESTO LO MODIFIQUE: Helper genérico para ejecutar consultas SQL locales mediante IPC
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
        if (!document.getElementById('modal-agrosoft')) {
            const modalHTML = `
                <div id="modal-agrosoft" class="modal-overlay" style="display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(29, 29, 31, 0.45); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); z-index: 99999; justify-content: center; align-items: center;">
                    <div id="modal-size-ctx" class="modal-apple-content" style="background: #FFFFFF; border: 1px solid #E4E7EC; border-radius: 12px; padding: 25px; width: 95%; max-width: 750px; color: #1D1D1F; box-shadow: 0 6px 14px rgba(20,26,36,0.16); display: flex; flex-direction: column;">
                        <div class="modal-header-apple" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid #E4E7EC; padding-bottom: 12px;">
                            <h3 id="modal-titulo" style="margin: 0; font-size: 1.2rem; font-weight: 700; font-family: 'Roboto', sans-serif; color: #0071E3;">AJUSTE DE INVENTARIO</h3>
                            <button onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background: none; border: none; color: #9AA0A6; font-size: 1.5rem; cursor: pointer; line-height: 1;">&times;</button>
                        </div>
                        <div id="modal-formulario" style="max-height: 60vh; overflow-y: auto; padding-right: 5px;"></div>
                        <div class="modal-apple-footer" id="modal-footer-dinamico" style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 25px; border-top: 1px solid #E4E7EC; padding-top: 15px;"></div>
                    </div>
                </div>`;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
        }
    },

    // ESTO LO MODIFIQUE: Carga local desde SQLite mediante IPC local en lugar de Supabase
    m_inicializar: async function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;
        visor.innerHTML = '<div class="loader-apple" style="font-family:\'Roboto\', sans-serif; text-align:center; padding:40px; color:#0071E3; font-weight:500;">Calculando balances de stock físico en depósitos (Base Local)...</div>';

        try {
            const [resIngresos, resEgresos, resCampos] = await Promise.all([
                this.m_ejecutarSqlLocal(`SELECT * FROM insumos_ingresos`),
                this.m_ejecutarSqlLocal(`SELECT * FROM egresos_insumos WHERE LOWER(estado) = 'activo' OR estado IS NULL`),
                this.m_ejecutarSqlLocal(`SELECT * FROM campos ORDER BY establecimiento ASC`)
            ]);

            const datosIngresos = resIngresos.data || resIngresos || [];
            const datosEgresos = resEgresos.data || resEgresos || [];
            const datosCampos = resCampos.data || resCampos || [];

            this.parametros.campos = datosCampos;
            
            this.m_procesarStock(datosIngresos, datosEgresos);
            this.m_dibujarVistaPrincipal();

        } catch (e) {
            console.error("❌ Error en Insumos Local AgroSoft:", e);
            visor.innerHTML = `<div class="error-soft" style="color:#E0342A; padding:20px; font-family:'Roboto', sans-serif;">Error al cubicar inventario local: ${e.message}</div>`;
        }
    },

    m_procesarStock: function(ingresos, egresos) {
        const balance = {};

        ingresos.forEach(i => {
            const artKey = i.articulo ? i.articulo.trim().toUpperCase() : 'SIN NOMBRE';
            if (!balance[artKey]) {
                balance[artKey] = { articulo: artKey, unidad: i.unidad || 'U', ingresos: 0, egresos: 0 };
            }
            balance[artKey].ingresos += parseFloat(i.total || i.cant || 0);
        });

        egresos.forEach(e => {
            const artKey = e.insumo ? e.insumo.trim().toUpperCase() : '';
            if (artKey && balance[artKey]) {
                balance[artKey].egresos += parseFloat(e.sup_uso || e.total_consumo || 0);
            }
        });

        this.datosStock = Object.values(balance).map(item => {
            return {
                ...item,
                disponible: Math.max(0, item.ingresos - item.egresos)
            };
        });

        this.parametros.articulosUnicos = this.datosStock.filter(a => a.disponible > 0);
    },

    m_dibujarVistaPrincipal: function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;

        const totalItemsKpi = this.datosStock.length;
        const totalAlertasKpi = this.datosStock.filter(a => a.disponible <= 5).length;

        visor.innerHTML = `
            <style>
                .stock-layout { font-family: 'Roboto', sans-serif; color: #1D1D1F; }
                .grid-kpi-stock { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 25px; }
                .kpi-card-stk { background: #FFFFFF; border: 1px solid #E4E7EC; border-radius: 14px; padding: 18px; display: flex; flex-direction: column; gap: 4px; box-shadow: 0 2px 8px rgba(20,26,36,0.06); transition: box-shadow 0.2s, transform 0.2s; }
                .kpi-card-stk:hover { box-shadow: 0 6px 14px rgba(20,26,36,0.12); transform: translateY(-1px); }
                .kpi-card-stk span { font-size: 0.65rem; color: #6E6E73; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
                .kpi-card-stk strong { font-size: 1.4rem; font-weight: 700; color: #1D1D1F; }
                .kpi-card-stk.alert-orange strong { color: #E08600; }

                .btn-sync-soft, .btn-export-apple-stk { background: #0071E3; color: #FFF; border: none; padding: 8px 18px; border-radius: 8px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.2s; }
                .btn-export-apple-stk { background: #FFFFFF; border: 1px solid #D6DAE1; color: #1D1D1F; }
                .btn-export-apple-stk:hover { background: #F6F7F9; }
                .btn-sync-soft:hover { background: #C22A22; }

                .btn-sync-soft:active, .btn-export-apple-stk:active, .btn-action-baja:active { transform: scale(0.96); }

                .tabla-soft-stk { width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left; }

                .tabla-soft-stk th {
                    position: sticky;
                    top: 0;
                    background: #F6F7F9;
                    z-index: 10;
                    padding: 14px 10px;
                    color: #6E6E73;
                    font-weight: 600;
                    border-bottom: 1px solid #E4E7EC;
                }

                .tabla-soft-stk td { padding: 14px 10px; border-bottom: 1px solid #EEF0F3; vertical-align: middle; }

                .badge-stk-ok { background: rgba(31,169,88,0.1); color: #1FA958; border: 1px solid rgba(31,169,88,0.25); padding: 3px 10px; border-radius: 14px; font-size: 0.68rem; font-weight: bold; }
                .badge-stk-low { background: rgba(224,134,0,0.1); color: #E08600; border: 1px solid rgba(224,134,0,0.25); padding: 3px 10px; border-radius: 14px; font-size: 0.68rem; font-weight: bold; }
                .btn-action-baja { background: #FFFFFF; border: 1px solid rgba(224,52,42,0.3); color: #E0342A; padding: 6px 12px; border-radius: 6px; font-weight: bold; font-size: 0.72rem; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; gap: 4px; }
                .btn-action-baja:hover { background: #E0342A; color: #FFF; border-color: #E0342A; }
            </style>

            ${ComponentesUI.botonVolverCustomHTML("if(window.ModuloRegistracion) ModuloRegistracion.m_dibujarSelectorInicial(); else ComponentesUI.irACategoria('LABORES');", 'Volver al panel de Registración')}
            <div class="stock-layout animated fadeIn">
                <div class="modulo-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px;">
                    <div>
                        <h2 style="margin:0; font-weight: 700; font-size: 1.4rem; letter-spacing: -0.5px; color:#1D1D1F;">Control de Inventario y Baja de Insumos</h2>
                        <p style="margin:4px 0 0 0; font-size:0.8rem; color:#6E6E73;">Consulta de existencias netas y declaración de mermas o descartes</p>
                    </div>

                    <div style="display:flex; gap:10px; align-items:center;">
                        <button class="btn-export-apple-stk" onclick="PaginaBajaInsumos.m_exportarExcel()" title="Exportar Inventario a Excel">
                            <i data-lucide="file-spreadsheet" style="color:#1FA958; width:14px; height:14px;"></i> Descargar Stock
                        </button>
                        <button class="btn-sync-soft" onclick="PaginaBajaInsumos.m_abrirFormulario()" style="background:#E0342A;">
                            <i data-lucide="minus-circle" style="width:14px; height:14px;"></i> DECLARAR BAJA / AJUSTE
                        </button>
                    </div>
                </div>

                <div class="grid-kpi-stock">
                    <div class="kpi-card-stk"><span>ARTÍCULOS EN DEPÓSITO</span><strong>${totalItemsKpi} Variedades</strong></div>
                    <div class="kpi-card-stk alert-orange"><span>INSUMOS CRÍTICOS (CRITERIO <= 5)</span><strong>${totalAlertasKpi} Alertas</strong></div>
                </div>

                <div class="card-soft-main" style="background: #FFFFFF; border: 1px solid #E4E7EC; border-radius: 12px; padding: 22px; box-shadow: 0 2px 8px rgba(20,26,36,0.06);">

                    <div style="overflow-x:auto; max-height: 52vh; overflow-y:auto; padding-right: 4px;">
                        <table class="tabla-soft-stk">
                            <thead>
                                <tr>
                                    <th>CÓDIGO / ARTÍCULO</th>
                                    <th style="text-align:right;">TOTAL INGRESOS</th>
                                    <th style="text-align:right;">TOTAL CONSUMIDO</th>
                                    <th style="text-align:right;">STOCK DISPONIBLE</th>
                                    <th style="text-align:center;">UNIDAD</th>
                                    <th style="text-align:center;">ESTADO STOCK</th>
                                    <th style="text-align:right;">ACCIONES CORRECCIÓN</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${this.datosStock.length === 0 ?
                                    `<tr><td colspan="7" align="center" style="opacity:0.6; padding:40px; color:#9AA0A6;">No se registran movimientos de insumos en el sistema.</td></tr>` :
                                    this.datosStock.map(s => `
                                        <tr style="border-bottom:1px solid #EEF0F3; transition: background 0.15s;" onmouseover="this.style.background='#F6F7F9'" onmouseout="this.style.background='transparent'">
                                            <td><strong style="color:#1D1D1F; font-size:0.9rem;">${s.articulo}</strong></td>
                                            <td style="text-align:right; font-family:monospace; color:#6E6E73;">${s.ingresos.toLocaleString('es-AR')}</td>
                                            <td style="text-align:right; font-family:monospace; color:#6E6E73;">${s.egresos.toLocaleString('es-AR')}</td>
                                            <td style="text-align:right; font-family:monospace; font-weight:bold; font-size:1rem; color:${s.disponible <= 5 ? '#E08600' : '#1FA958'};">
                                                ${s.disponible.toLocaleString('es-AR')}
                                            </td>
                                            <td style="text-align:center; color:#6E6E73;"><span style="background:#F0F2F5; padding:2px 6px; border-radius:4px; font-weight:bold; font-size:0.7rem;">${s.unidad}</span></td>
                                            <td style="text-align:center;">
                                                <span class="${s.disponible <= 5 ? 'badge-stk-low' : 'badge-stk-ok'}">
                                                    ${s.disponible <= 5 ? 'STOCK CRÍTICO' : 'DISPONIBLE'}
                                                </span>
                                            </td>
                                            <td style="text-align:right;">
                                                <button class="btn-action-baja" onclick="PaginaBajaInsumos.m_abrirFormulario('${s.articulo}')">
                                                    <i data-lucide="scissors" style="width:11px; height:11px;"></i> Forzar Ajuste
                                                </button>
                                            </td>
                                        </tr>`).join('')
                                }
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
    },

    m_abrirFormulario: function(articuloPreseleccionado = '') {
        this.m_asegurarModalBase();

        const container = document.getElementById('modal-formulario');
        const footerCtx = document.getElementById('modal-footer-dinamico');
        const sizeCtx = document.getElementById('modal-size-ctx');
        
        if (sizeCtx) sizeCtx.style.maxWidth = "750px";
        document.getElementById('modal-titulo').innerText = 'DECLARACIÓN DE AJUSTE / BAJA DE INSUMO';

        const estUnicos = [...new Set(this.parametros.campos.map(c => c.establecimiento))];

        if (container) {
            container.innerHTML = `
                <style>
                    .grid-bajas { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; font-family:'Roboto', sans-serif; }
                    .full-row { grid-column: span 2; }
                    .display-stk-indicator { background: #FBF3E7; border: 1px solid rgba(224,134,0,0.25); border-radius: 12px; padding: 12px; text-align: center; }
                    .group-soft label { font-size:0.68rem; color:#6E6E73; display:block; margin-bottom:6px; text-transform:uppercase; font-weight:bold; letter-spacing:0.3px; }
                    .group-soft select, .group-soft input, .group-soft textarea { width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:10px; border-radius:8px; color:#1D1D1F; outline:none; font-family:'Roboto', sans-serif; font-size:0.95rem; }
                    .group-soft select:focus, .group-soft input:focus, .group-soft textarea:focus { border-color: #E0342A; box-shadow: 0 0 0 3px rgba(224,52,42,0.12); }
                </style>

                <div class="grid-bajas animated fadeIn">
                    <div class="group-soft full-row">
                        <label><i data-lucide="package"></i> SELECCIONE EL INSUMO A DAR DE BAJA</label>
                        <select id="b_articulo" onchange="PaginaBajaInsumos.m_onArticuloChange(this.value)">
                            <option value="">Seleccione un insumo...</option>
                            ${this.parametros.articulosUnicos.map(a => `
                                <option value="${a.articulo}" ${articuloPreseleccionado === a.articulo ? 'selected' : ''}>
                                    ${a.articulo} — (Disponibles: ${a.disponible} ${a.unidad})
                                </option>
                            `).join('')}
                        </select>
                    </div>

                    <div class="group-soft full-row display-stk-indicator" id="wrapper-stk-real-time">
                        <small style="color: #E08600; font-weight:bold; font-size:0.65rem; letter-spacing:0.5px; text-transform:uppercase;">CUBICAJE MÁXIMO PERMITIDO</small>
                        <h3 id="lbl_limite_stk" style="margin:4px 0 0 0; color:#1D1D1F; font-size:1.2rem; font-weight:900;">0.00 Unidades</h3>
                    </div>

                    <div class="group-soft">
                        <label><i data-lucide="map-pin"></i> DEPOSITADO EN (ESTABLECIMIENTO)</label>
                        <select id="b_est" onchange="PaginaBajaInsumos.m_cargarCuadros(this.value)">
                            <option value="">Seleccione...</option>
                            ${estUnicos.map(e => `<option value="${e}">${e}</option>`).join('')}
                        </select>
                    </div>

                    <div class="group-soft">
                        <label><i data-lucide="layers"></i> SECTOR / CUADRO AFECTADO (OPCIONAL)</label>
                        <select id="b_cuadro">
                            <option value="">Esperando establecimiento...</option>
                        </select>
                    </div>

                    <div class="group-soft">
                        <label><i data-lucide="calendar"></i> FECHA DE SALIDA / AJUSTE</label>
                        <input type="date" id="b_fecha" value="${new Date().toISOString().split('T')[0]}">
                    </div>

                    <div class="group-soft">
                        <label><i data-lucide="hash"></i> CANTIDAD MERMA / BAJA</label>
                        <input type="number" step="0.01" id="b_cant" placeholder="0.00">
                    </div>

                    <div class="group-soft full-row">
                        <label><i data-lucide="alert-triangle"></i> MOTIVO DE LA BAJA / COMENTARIO DE RENDICIÓN</label>
                        <textarea id="b_obs" rows="2" placeholder="Ej: Vencimiento de lote de producto, derrame accidental, descarte técnico..."></textarea>
                    </div>
                </div>
            `;
        }

        if (footerCtx) {
            footerCtx.innerHTML = `
                <button class="btn-cancel-soft" onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background: #F0F2F5; color: #1D1D1F; border: 1px solid #E4E7EC; padding: 10px 20px; font-weight: bold; border-radius: 8px; font-size: 0.8rem; cursor: pointer;">CANCELAR</button>
                <button class="btn-save-soft" onclick="PaginaBajaInsumos.m_guardarBaja()" style="background: #E0342A; color: #FFF; border: none; padding: 10px 20px; font-weight: bold; border-radius: 8px; font-size: 0.8rem; cursor: pointer; display:flex; align-items:center; gap:6px;">
                    <i data-lucide="check-circle" style="width:14px; height:14px;"></i> EJECUTAR BAJA
                </button>
            `;
        }

        if (articuloPreseleccionado) {
            this.m_onArticuloChange(articuloPreseleccionado);
        }

        document.getElementById('modal-agrosoft').style.display = 'flex';
        if (window.lucide) lucide.createIcons();
    },

    m_onArticuloChange: function(artSel) {
        const lbl = document.getElementById('lbl_limite_stk');
        if (!lbl) return;
        
        const item = this.datosStock.find(a => a.articulo === artSel);
        if (item) {
            lbl.innerText = `${item.disponible.toLocaleString('es-AR')} ${item.unidad}`;
            lbl.style.color = item.disponible <= 5 ? '#E08600' : '#1FA958';
        } else {
            lbl.innerText = '0.00 Unidades';
            lbl.style.color = '#1D1D1F';
        }
    },

    // ESTO LO MODIFIQUE: Consulta de cuadros filtrados por establecimiento en SQLite Local
    m_cargarCuadros: async function(estSel) {
        const selectCuadro = document.getElementById('b_cuadro');
        if (!selectCuadro) return;

        if (!estSel) {
            selectCuadro.innerHTML = '<option value="">Esperando establecimiento...</option>';
            return;
        }

        selectCuadro.innerHTML = '<option value="">Cargando sectores...</option>';

        try {
            const resCuadros = await this.m_ejecutarSqlLocal(
                `SELECT lote, nombre_lote, campo FROM cuadros WHERE LOWER(campo) = LOWER(?) ORDER BY lote ASC`,
                [estSel.trim()]
            );

            const data = resCuadros.data || resCuadros || [];

            if (!data || data.length === 0) {
                selectCuadro.innerHTML = '<option value="">Sin cuadros indexados</option>';
                return;
            }

            selectCuadro.innerHTML = '<option value="">Seleccione Cuadro...</option>' + 
                data.map(l => `<option value="${l.lote}">${l.lote} - ${l.nombre_lote || 'Cuadro'}</option>`).join('');

        } catch (err) {
            console.error("❌ Error al cargar cuadros locales:", err);
            selectCuadro.innerHTML = '<option value="">General (Sin sectorizar)</option>';
        }
    },

    // ESTO LO MODIFIQUE / ACA ES LO NUEVO:
    // Regla Max(registro)+1 + Insert Local SQLite con sincronizado = 0 y estado Activo
    m_guardarBaja: async function() {
    const articulo = document.getElementById('b_articulo').value;
    const cantidadBaja = parseFloat(document.getElementById('b_cant').value) || 0;
    const establecimiento = document.getElementById('b_est').value;
    const cuadroSel = document.getElementById('b_cuadro').value;
    const comentario = document.getElementById('b_obs').value;
    const fecha = document.getElementById('b_fecha').value;

    if (!articulo || cantidadBaja <= 0 || !establecimiento) {
        return window.ComponentesUI.notifica("Por favor complete el Insumo, Establecimiento y una Cantidad mayor a cero.");
    }

    const itemStock = this.datosStock.find(a => a.articulo === articulo);
    if (itemStock && cantidadBaja > itemStock.disponible) {
        return window.ComponentesUI.notifica(`Operación cancelada: No se puede dar de baja una cantidad (${cantidadBaja}) superior al stock disponible (${itemStock.disponible}).`);
    }

    try {
        // Generación dinámica de reg_local con Prefijo + Timestamp
        const finalRegLocal = "REG-BAJA-" + Date.now();

        // Inserción local en SQLite con sincronizado = 0 y estado Activo
        const sqlInsert = `
            INSERT INTO egresos_insumos (
                reg_local, tabla_origen, tipo_labor, fecha, insumo, 
                establecimiento, cuadro, sup_uso, total_consumo, imp_uni, 
                total_dolar, comentario, centro_costo, estado, sincronizado
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const paramsInsert = [
            finalRegLocal,
            'BAJA',
            'BAJA DE STOCK',
            fecha,
            articulo,
            establecimiento,
            cuadroSel || 'GENERAL',
            cantidadBaja,
            cantidadBaja,
            0,
            0,
            `Ajuste por Baja: ${comentario}`,
            'BAJA DE STOCK AUTOMÁTICA',
            'ACTIVO',
            0
        ];

        await this.m_ejecutarSqlLocal(sqlInsert, paramsInsert);

        window.ComponentesUI.notifica(`Baja de stock de ${articulo} procesada correctamente en almacenamiento local.`);
        document.getElementById('modal-agrosoft').style.display = 'none';
        this.m_inicializar(); 

    } catch (err) {
        console.error("❌ Error al guardar baja local:", err);
        window.ComponentesUI.notifica("Error al registrar movimiento de baja local: " + err.message);
    }
},

    m_exportarExcel: function() {
        if (this.datosStock.length === 0) return window.ComponentesUI.notifica("Inventario vacío.");

        const headers = ["ARTICULO", "UNIDAD", "TOTAL INGRESOS", "TOTAL EGRESOS / CONSUMOS", "STOCK DISPONIBLE NETO"];
        let csvContent = "\uFEFF" + headers.join(";") + "\n";

        this.datosStock.forEach(s => {
            const row = [`"${s.articulo}"`, `"${s.unidad}"`, s.ingresos, s.egresos, s.disponible];
            csvContent += row.join(";") + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.setAttribute("download", `AgroSoft_Balance_Stock_Disponible_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
};