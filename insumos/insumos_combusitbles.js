/**
 * ARCHIVO: modulo_combustible.js
 * Sistema: Salvucci Gestión · AgroSoft J&L
 * Descripción: Módulo Central de Combustibles y Cisternas integrado con SQLite IPC Local
 * Mode: "No me quites nada" + Regla Max(registro)+1 + Dynamic SQLite IPC + Sync Flag (sincronizado=0)
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
                <div id="modal-agrosoft" class="modal-overlay" style="display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(29, 29, 31, 0.4); backdrop-filter: blur(15px); -webkit-backdrop-filter: blur(15px); z-index: 99999; justify-content: center; align-items: center;">
                    <div class="modal-apple-content" style="background: #FFFFFF; border: 1px solid #E4E7EC; border-radius: 14px; padding: 25px; width: 95%; max-width: 1100px; color: #1D1D1F; box-shadow: 0 9px 21px rgba(20,26,36,0.25); display: flex; flex-direction: column;">
                        <div class="modal-header-apple" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid #E4E7EC; padding-bottom: 12px;">
                            <h3 id="modal-titulo" style="margin: 0; font-size: 1.2rem; font-weight: 700; font-family: 'Roboto', sans-serif; color: #0071E3; text-transform: uppercase; letter-spacing: 0.3px;">CONTROL DE COMBUSTIBLE</h3>
                            <button onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background: none; border: none; color: #6E6E73; font-size: 1.5rem; cursor: pointer; transition: opacity 0.2s;" onmouseover="this.style.opacity=0.6" onmouseout="this.style.opacity=1">&times;</button>
                        </div>
                        <div id="modal-formulario" style="max-height: 75vh; overflow-y: auto; padding-right: 5px;"></div>
                    </div>
                </div>`;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
        }
    },

    // ESTO LO MODIFIQUE: Carga 100% offline desde SQLite Local
    m_inicializar: async function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;
        visor.innerHTML = `<div class="loader-apple" style="font-family: 'Roboto', sans-serif; text-align: center; padding: 40px; color: #0071E3; font-weight: 500;">Cargando Central de Combustibles (Base Local)...</div>`;

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
            visor.innerHTML = `<div class="error-soft" style="color: #E0342A; padding: 20px; font-family: 'Roboto', sans-serif;">Error al cargar datos locales de combustible: ${err.message}</div>`;
        }
    },

    m_procesarSaldos: function() {
        const stock = {};
        this.datosIngresos.forEach(i => {
            const key = `${i.campo_cisterna}-${i.combustible}`;
            if (!stock[key]) stock[key] = { actual: 0, nombre: i.campo_cisterna, tipo: i.combustible, entradas: 0, salidas: 0 };
            stock[key].actual += Number(i.cantidad) || 0;
            stock[key].entradas += Number(i.cantidad) || 0;
        });
        this.datosConsumos.forEach(c => {
            const key = `${c.campo}-${c.combustible}`;
            if (!stock[key]) stock[key] = { actual: 0, nombre: c.campo, tipo: c.combustible, entradas: 0, salidas: 0 };
            stock[key].actual -= Number(c.cantidad) || 0;
            stock[key].salidas += Number(c.cantidad) || 0;
        });
        this.tanques = Object.values(stock);
    },

    m_dibujarTodo: function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;

        const tiposCombustiblesUnicos = [...new Set(this.tanques.map(t => t.tipo))].sort();

        visor.innerHTML = `
            <style>
                .combustibles-layout { font-family: 'Roboto', sans-serif; color: #1D1D1F; }
                .grid-tanques-apple { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; margin-bottom: 20px; }

                .card-tanque-comb { background: #FFFFFF; border: 1px solid #E4E7EC; border-radius: 16px; padding: 18px; display: flex; flex-direction: column; gap: 6px; box-shadow: 0 2px 8px rgba(20,26,36,0.06); position: relative; overflow: hidden; cursor: pointer; transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
                .card-tanque-comb:hover { border-color: rgba(0,113,227,0.35); transform: translateY(-2px); box-shadow: 0 6px 14px rgba(20,26,36,0.12); }
                .card-tanque-comb.active-filter { background: rgba(0,113,227,0.06); border-color: #0071E3; box-shadow: 0 8px 20px rgba(0,113,227,0.15); }

                .badge-comb-tipo { font-size: 0.65rem; font-weight: 700; padding: 2px 8px; border-radius: 14px; width: fit-content; text-transform: uppercase; }
                .level-indicator-bg { width: 100%; height: 6px; background: #F0F2F5; border-radius: 3px; overflow: hidden; margin-top: 6px; }
                .level-indicator-bar { height: 100%; border-radius: 3px; transition: width 0.5s ease; }

                .tabs-apple-bar { display: flex; background: #F0F2F5; padding: 4px; border-radius: 10px; border: 1px solid #E4E7EC; width: fit-content; }
                .tab-apple-btn { background: transparent; border: none; color: #6E6E73; padding: 6px 14px; font-size: 0.78rem; font-weight: 600; border-radius: 7px; cursor: pointer; transition: all 0.2s; }
                .tab-apple-btn.active { background: #FFFFFF; color: #1D1D1F; box-shadow: 0 2px 8px rgba(20,26,36,0.1); }

                .tabla-soft-comb { width: 100%; border-collapse: collapse; font-size: 0.8rem; text-align: left; }
                .tabla-soft-comb th { padding: 12px 10px; color: #6E6E73; font-weight: 600; border-bottom: 2px solid #E4E7EC; }
                .tabla-soft-comb td { padding: 14px 10px; border-bottom: 1px solid #EEF0F3; }

                .btn-action-apple { background: #FFFFFF; border: 1px solid #E4E7EC; color: #1D1D1F; padding: 5px 10px; font-size: 0.72rem; font-weight: bold; border-radius: 6px; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; gap: 4px; }
                .btn-action-apple.btn-edit:hover { border-color: rgba(0,113,227,0.4); background: rgba(0,113,227,0.08); color: #0071E3; }
                .btn-action-apple.btn-delete:hover { border-color: rgba(224,52,42,0.4); background: rgba(224,52,42,0.08); color: #E0342A; }

                .split-workspace-comb { display: grid; grid-template-columns: 1fr 340px; gap: 20px; align-items: start; }
                .top-filter-bar-comb { background: #F6F7F9; border: 1px solid #E4E7EC; border-radius: 12px; padding: 12px 16px; margin-bottom: 18px; display: flex; gap: 14px; align-items: center; }
                .top-filter-bar-comb input { background: #FFFFFF; border: 1px solid #DDE1E7; color: #1D1D1F; padding: 8px 12px; border-radius: 8px; font-size: 0.85rem; outline: none; flex: 1; font-family: 'Roboto', sans-serif; }
                .top-filter-bar-comb input:focus { border-color: #0071E3; box-shadow: 0 0 0 4px rgba(0,113,227,0.12); }
                .top-filter-bar-comb select { background: #FFFFFF; border: 1px solid #DDE1E7; color: #1D1D1F; padding: 8px 12px; border-radius: 8px; font-size: 0.85rem; outline: none; width: 200px; cursor: pointer; font-family: 'Roboto', sans-serif; }
                .top-filter-bar-comb select:focus { border-color: #0071E3; box-shadow: 0 0 0 4px rgba(0,113,227,0.12); }

                .btn-sync-soft:active, .btn-action-apple:active, .btn-soft-local-action:active { transform: scale(0.97); }
            </style>

            ${ComponentesUI.botonVolverHTML('INSUMOS')}
            <div class="combustibles-layout animated fadeIn">
                <div class="modulo-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 14px;">
                    <div>
                        <h2 style="margin:0; font-weight: 700; font-size: 1.4rem; letter-spacing: -0.5px; color:#1D1D1F;">Central de Combustibles</h2>
                        <p style="margin:4px 0 0 0; font-size:0.8rem; color:#6E6E73;">Gestión de cubicaje de cisternas por campos y órdenes analíticas de egreso</p>
                    </div>

                    <div style="display:flex; gap:10px; flex-wrap: wrap;">
                        <button class="btn-sync-soft" onclick="ModuloCombustible.m_exportarExcel()" style="background:#1FA958; color:#FFF; border:none; padding:10px 16px; border-radius:8px; font-weight:bold; cursor:pointer; box-shadow:0 4px 12px rgba(31,169,88,0.2);">📊 EXCEL</button>
                        <button class="btn-sync-soft" onclick="ModuloCombustible.m_exportarPDF()" style="background:#E0342A; color:#FFF; border:none; padding:10px 16px; border-radius:8px; font-weight:bold; cursor:pointer; box-shadow:0 4px 12px rgba(224,52,42,0.2);">📕 ANALYTICS PDF</button>
                        <button class="btn-sync-soft" onclick="ModuloCombustible.m_abrirModalTransferencia()" style="background:#0071E3; color:#FFF; border:none; padding:10px 18px; border-radius:8px; font-weight:bold; cursor:pointer; box-shadow:0 4px 12px rgba(0,113,227,0.2);">🔄 TRASLADO</button>
                        <button class="btn-sync-soft" onclick="ModuloCombustible.m_abrirModalIngreso()" style="background:#1FA958; color:#FFF; border:none; padding:10px 18px; border-radius:8px; font-weight:bold; cursor:pointer; box-shadow:0 4px 12px rgba(31,169,88,0.2);">📈 INGRESO</button>
                        <button class="btn-sync-soft" onclick="ModuloCombustible.m_abrirModalConsumo()" style="background:#E0342A; color:#FFF; border:none; padding:10px 18px; border-radius:8px; font-weight:bold; cursor:pointer; box-shadow:0 4px 12px rgba(224,52,42,0.2);">📉 CONSUMO</button>
                    </div>
                </div>

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
                                <span class="badge-comb-tipo" style="${badgeColor}">${t.tipo}</span>
                                <h4 style="margin:4px 0; font-size:1.05rem; font-weight:700; color:#1D1D1F;">🏢 ${t.nombre}</h4>
                                <div style="display:flex; justify-content:space-between; align-items:baseline; margin-top:4px;">
                                    <strong style="font-size:1.35rem; color:#1FA958;">${t.actual.toLocaleString('es-AR')} <span style="font-size:0.8rem; font-weight:500;">Lts</span></strong>
                                    <span style="font-size:0.7rem; color:#9AA0A6; font-weight:bold;">${pctLlenado}% Vol</span>
                                </div>
                                <div class="level-indicator-bg">
                                    <div class="level-indicator-bar" style="width: ${pctLlenado}%; background: ${barColor};"></div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>

                <div class="top-filter-bar-comb">
                    <div style="flex:1;">
                        <input type="text" id="busqueda-combustible" placeholder="🔍 Buscar por operario, máquina, remito o proveedor..." oninput="ModuloCombustible.m_onBusquedaInput(this.value)">
                    </div>
                    <div>
                        <select id="select-tipo-comb" onchange="ModuloCombustible.m_onTipoChange(this.value)">
                            <option value="TODO">🎛️ TODOS LOS RUBROS</option>
                            ${tiposCombustiblesUnicos.map(tipo => `<option value="${tipo}" ${this.filtroTipo === tipo ? 'selected' : ''}>${tipo}</option>`).join('')}
                        </select>
                    </div>
                    <button onclick="ModuloCombustible.m_limpiarFiltrosSistemas()" style="background:#EDEFF2; border:1px solid #E4E7EC; padding:8px 14px; border-radius:8px; color:#1D1D1F; font-size:0.8rem; cursor:pointer; font-weight:bold;">RESETEAR</button>
                </div>

                <div class="split-workspace-comb">
                    <div class="card-soft-main" style="background: #FFFFFF; border: 1px solid #E4E7EC; border-radius: 12px; padding: 18px; box-shadow: 0 2px 8px rgba(20,26,36,0.06); overflow:hidden;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                            <div class="tabs-apple-bar">
                                <button class="tab-apple-btn ${this.tabActiva === 'consumos' ? 'active' : ''}" onclick="ModuloCombustible.m_cambiarTab('consumos', this)">📉 CONSUMOS (EGRESOS)</button>
                                <button class="tab-apple-btn ${this.tabActiva === 'ingresos' ? 'active' : ''}" onclick="ModuloCombustible.m_cambiarTab('ingresos', this)">📈 INGRESOS (COMPRAS)</button>
                            </div>
                        </div>

                        <div id="contenedor-tablas" style="overflow-x:auto; max-height:55vh; overflow-y:auto;">
                            ${this.tabActiva === 'consumos' ? this.m_renderTablaConsumos(this.datosConsumos) : this.m_renderTablaIngresos(this.datosIngresos)}
                        </div>
                    </div>

                    <aside id="sidebar-analytics-comb" style="background: #F6F7F9; border: 1px solid #E4E7EC; border-radius: 12px; padding: 20px;">
                        ${this.m_renderSidebarDetalles()}
                    </aside>
                </div>
            </div>
        `;
    },

    m_renderTablaConsumos: function(dataset) {
        if(dataset.length === 0) return `<div style="padding:30px; text-align:center; color:#9AA0A6; font-size:0.85rem;">No se encontraron consumos con los filtros activos.</div>`;
        return `
            <table class="tabla-soft-comb">
                <thead>
                    <tr>
                        <th>FECHA</th>
                        <th>MAQUINARIA / OPERARIO</th>
                        <th>CISTERNA / PRODUCTO</th>
                        <th>VOLUMEN</th>
                        <th style="text-align:right;">ACCIONES</th>
                    </tr>
                </thead>
                <tbody>
                    ${dataset.map(c => `
                        <tr style="border-bottom:1px solid #EEF0F3; transition: background 0.15s;" onmouseover="this.style.background='#F6F7F9'" onmouseout="this.style.background='transparent'">
                            <td><span style="font-size:0.75rem; color:#6E6E73;">${c.fecha}</span></td>
                            <td><strong style="color:#1D1D1F; font-size:0.85rem;">${c.maquina}</strong><br><small style="color:#9AA0A6;">👤 ${c.operario}</small></td>
                            <td><span style="font-size:0.8rem; color:#1D1D1F;">📍 ${c.campo}</span><br><small style="color:#0071E3; font-weight:600;">${c.combustible}</small></td>
                            <td><span style="color:#E0342A; font-weight:bold; font-size:0.85rem; white-space:nowrap;">- ${Number(c.cantidad).toLocaleString('es-AR')} Lts</span></td>
                            <td style="text-align:right; white-space:nowrap; padding-top:12px;">
                                <button class="btn-action-apple btn-edit" onclick="ModuloCombustible.m_abrirModalConsumo('${c.reg_local}')" title="Editar">✏️</button>
                                <button class="btn-action-apple btn-delete" onclick="ModuloCombustible.m_borrarConsumo('${c.reg_local}')" title="Borrar">🗑️</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    },

    m_renderTablaIngresos: function(dataset) {
        if(dataset.length === 0) return `<div style="padding:30px; text-align:center; color:#9AA0A6; font-size:0.85rem;">No se encontraron ingresos con los filtros activos.</div>`;
        return `
            <table class="tabla-soft-comb">
                <thead>
                    <tr>
                        <th>FECHA</th>
                        <th>PROVEEDOR / REMITO</th>
                        <th>CISTERNA DESTINO</th>
                        <th>VOLUMEN</th>
                        <th style="text-align:right;">ACCIONES</th>
                    </tr>
                </thead>
                <tbody>
                    ${dataset.map(i => `
                        <tr style="border-bottom:1px solid #EEF0F3; transition: background 0.15s;" onmouseover="this.style.background='#F6F7F9'" onmouseout="this.style.background='transparent'">
                            <td><span style="font-size:0.75rem; color:#6E6E73;">${i.fecha}</span></td>
                            <td><strong style="color:#1D1D1F; font-size:0.85rem;">${i.proveedor}</strong><br><small style="color:#9AA0A6;">📄 Remito: ${i.remito || '-'}</small></td>
                            <td><span style="font-size:0.8rem; color:#1D1D1F;">🏢 ${i.campo_cisterna}</span><br><small style="color:#1FA958; font-weight:600;">${i.combustible}</small></td>
                            <td><span style="color:#1FA958; font-weight:bold; font-size:0.85rem; white-space:nowrap;">+ ${Number(i.cantidad).toLocaleString('es-AR')} Lts</span></td>
                            <td style="text-align:right; white-space:nowrap; padding-top:12px;">
                                <button class="btn-action-apple btn-edit" onclick="ModuloCombustible.m_abrirModalIngreso('${i.reg_local}')" title="Editar">✏️</button>
                                <button class="btn-action-apple btn-delete" onclick="ModuloCombustible.m_borrarIngreso('${i.reg_local}')" title="Borrar">🗑️</button>
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
            return `
                <div style="text-align:center; padding:15px 0;">
                    <div style="font-size: 2.2rem; margin-bottom: 5px;">📊</div>
                    <h3 style="margin:0 0 4px 0; font-size:1.1rem; font-weight:700; color:#1D1D1F;">Balance Energético</h3>
                    <p style="margin:0 0 15px 0; font-size:0.75rem; color:#6E6E73;">Resumen global de activos de la empresa</p>
                    <hr style="border:none; border-top:1px solid #E4E7EC; margin-bottom:15px;">
                    <div style="display:flex; flex-direction:column; gap:12px; text-align:left;">
                        <div style="background:#FFFFFF; border:1px solid #E4E7EC; padding:10px; border-radius:8px;">
                            <span style="font-size:0.65rem; color:#6E6E73; font-weight:bold; display:block;">STOCK DISPONIBLE CONSOLIDADO</span>
                            <strong style="font-size:1.2rem; color:#1FA958;">${globalLts.toLocaleString('es-AR')} Litros</strong>
                        </div>
                        <div style="background:#FFFFFF; border:1px solid #E4E7EC; padding:10px; border-radius:8px;">
                            <span style="font-size:0.65rem; color:#6E6E73; font-weight:bold; display:block;">HISTORIAL DE CONSUMO TOTAL</span>
                            <strong style="font-size:1.2rem; color:#E0342A;">${globalConsumos.toLocaleString('es-AR')} Litros</strong>
                        </div>
                    </div>
                </div>
            `;
        }

        const t = this.tanques.find(x => x.nombre === this.filtroTanque);
        if(!t) return `<div style="color:#6E6E73; font-size:0.8rem;">Seleccione una cisterna.</div>`;

        const consumosAsociados = this.datosConsumos.filter(c => c.campo === t.nombre);
        const totalPesosGastados = consumosAsociados.reduce((acc, c) => acc + (Number(c.total_pesos) || 0), 0);
        const maquinariaMasConsumidora = [...new Set(consumosAsociados.map(c => c.maquina))][0] || "Ninguna registrada";

        return `
            <div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                    <span style="font-size:0.65rem; font-weight:bold; color:#0071E3; background:rgba(0,113,227,0.1); padding:3px 8px; border-radius:6px;">AUDITORÍA CIS-LOG</span>
                    <button onclick="ModuloCombustible.m_onTanqueCardClick('TODO')" style="background:none; border:none; color:#E0342A; font-size:0.75rem; font-weight:bold; cursor:pointer;">CERRAR X</button>
                </div>
                <h3 style="margin:0 0 2px 0; font-size:1.15rem; font-weight:700; color:#1D1D1F;">${t.nombre}</h3>
                <p style="margin:0 0 15px 0; font-size:0.75rem; color:#6E6E73;">Tipo de combustible cargado: <strong>${t.tipo}</strong></p>
                <hr style="border:none; border-top:1px solid #E4E7EC; margin-bottom:15px;">
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <div style="display:flex; justify-content:space-between; background:#FFFFFF; border:1px solid #E4E7EC; padding:8px 12px; border-radius:8px;"><span style="font-size:0.75rem; color:#6E6E73;">Existencia Actual</span><strong style="color:#1FA958; font-size:0.9rem;">${t.actual.toLocaleString('es-AR')} Lts</strong></div>
                    <div style="display:flex; justify-content:space-between; background:#FFFFFF; border:1px solid #E4E7EC; padding:8px 12px; border-radius:8px;"><span style="font-size:0.75rem; color:#6E6E73;">Ingresos Totales</span><strong style="color:#1D1D1F; font-size:0.9rem;">+ ${t.entradas.toLocaleString('es-AR')} Lts</strong></div>
                    <div style="display:flex; justify-content:space-between; background:#FFFFFF; border:1px solid #E4E7EC; padding:8px 12px; border-radius:8px;"><span style="font-size:0.75rem; color:#6E6E73;">Egresos Totales</span><strong style="color:#E0342A; font-size:0.9rem;">- ${t.salidas.toLocaleString('es-AR')} Lts</strong></div>
                    <div style="display:flex; justify-content:space-between; background:#FFFFFF; border:1px solid #E4E7EC; padding:8px 12px; border-radius:8px;"><span style="font-size:0.75rem; color:#6E6E73;">Inversión Imputada</span><strong style="color:#E08600; font-size:0.9rem;">$ ${totalPesosGastados.toLocaleString('es-AR')}</strong></div>
                    <div style="background:#FFFFFF; border:1px solid #E4E7EC; padding:8px 12px; border-radius:8px;"><span style="font-size:0.65rem; color:#6E6E73; display:block;">Mayor Demanda Reciente</span><strong style="color:#1D1D1F; font-size:0.85rem; display:block; margin-top:2px;">🚜 ${maquinariaMasConsumidora}</strong></div>
                </div>
            </div>
        `;
    },

    m_aplicarFiltrosCombustible: function() {
        let consumosFiltrados = this.datosConsumos;
        let ingresosFiltrados = this.datosIngresos;

        if (this.filtroTanque !== 'TODO') {
            consumosFiltrados = consumosFiltrados.filter(c => c.campo === this.filtroTanque);
            ingresosFiltrados = ingresosFiltrados.filter(i => i.campo_cisterna === this.filtroTanque);
        }
        if (this.filtroTipo !== 'TODO') {
            consumosFiltrados = consumosFiltrados.filter(c => c.combustible === this.filtroTipo);
            ingresosFiltrados = ingresosFiltrados.filter(i => i.combustible === this.filtroTipo);
        }
        if (this.textoBusqueda) {
            const txt = this.textoBusqueda.toLowerCase();
            consumosFiltrados = consumosFiltrados.filter(c => c.maquina.toLowerCase().includes(txt) || c.operario.toLowerCase().includes(txt));
            ingresosFiltrados = ingresosFiltrados.filter(i => i.proveedor.toLowerCase().includes(txt) || (i.remito && i.remito.toLowerCase().includes(txt)));
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
    m_limpiarFiltrosSistemas: function() { this.filtroTanque = 'TODO'; this.filtroTipo = 'TODO'; this.textoBusqueda = ''; this.m_aplicarFiltrosCombustible(); },
    m_cambiarTab: function(tipo, btn) { document.querySelectorAll('.tab-apple-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); this.tabActiva = tipo; this.m_aplicarFiltrosCombustible(); },

    m_exportarExcel: function() {
        if (this.datosIngresos.length === 0 && this.datosConsumos.length === 0) {
            return window.ComponentesUI.notifica("No existen registros cargados en memoria para compilar.");
        }

        let templateXLS = `
            <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
            <head><meta charset="UTF-8">
            <style>
                table { border-collapse: collapse; font-family: 'Segoe UI', sans-serif; }
                .title-main { font-size: 16px; font-weight: bold; color: #0071E3; padding: 10px 0; }
                .header-ingresos { background-color: #1FA958; color: #FFFFFF; font-weight: bold; text-align: left; }
                .header-consumos { background-color: #E0342A; color: #FFFFFF; font-weight: bold; text-align: left; }
                th, td { padding: 8px; border: 1px solid #D6DAE1; font-size: 11px; }
            </style>
            </head>
            <body>
                <div class="title-main">AGROSOFT J&L - TABLA COMPLETA combustibles_ingresos (COMPRAS)</div>
                <table>
                    <thead>
                        <tr class="header-ingresos">
                            <th>REG_LOCAL</th><th>FECHA</th><th>CISTERNA DESTINO</th><th>COMBUSTIBLE / INSUMO</th><th>PROVEEDOR</th><th>REMITO</th><th>CANTIDAD (LTS)</th><th>PRECIO UNIT (ARS)</th><th>COTIZACIÓN</th><th>PRECIO UNIT (USD)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.datosIngresos.map(i => `
                            <tr>
                                <td>${i.reg_local}</td><td>${i.fecha}</td><td>${i.campo_cisterna}</td><td>${i.combustible}</td><td>${i.proveedor || ''}</td><td>${i.remito || ''}</td><td>${i.cantidad}</td><td>${i['imp uni_ars'] || i.imp_uni_ars || 0}</td><td>${i.cotizacion}</td><td>${i.imp_uni_usd || 0}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <br><br>
                <div class="title-main">AGROSOFT J&L - TABLA COMPLETA consumos_combustibles (EGRESOS)</div>
                <table>
                    <thead>
                        <tr class="header-consumos">
                            <th>REG_LOCAL</th><th>FECHA</th><th>MAQUINARIA / UNIDAD</th><th>OPERARIO</th><th>CISTERNA ORIGEN</th><th>COMBUSTIBLE</th><th>CANTIDAD (LTS)</th><th>LOTE / CUADRO</th><th>SUPERFICIE (HA)</th><th>LABOR</th><th>CENTRO COSTO</th><th>TOTAL PESOS</th><th>TOTAL DÓLAR</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.datosConsumos.map(c => `
                            <tr>
                                <td>${c.reg_local}</td><td>${c.fecha}</td><td>${c.maquina}</td><td>${c.operario}</td><td>${c.campo}</td><td>${c.combustible}</td><td>${c.cantidad}</td><td>${c.lote || ''}</td><td>${c.sup || 0}</td><td>${c.labor || ''}</td><td>${c.centro_costo || ''}</td><td>${c.total_pesos || 0}</td><td>${c.total_dolar || 0}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </body>
            </html>`;

        const blob = new Blob([templateXLS], { type: 'application/vnd.ms-excel;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.setAttribute("download", `AgroSoft_Dump_Combustibles_${new Date().toISOString().split('T')[0]}.xls`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    m_exportarPDF: function() {
        const ventanaPDF = window.open('', '_blank');
        
        const centrosAgrupados = {};
        this.datosConsumos.forEach(c => {
            const cc = (c.centro_costo || "GENERAL").trim().toUpperCase();
            if(!centrosAgrupados[cc]) centrosAgrupados[cc] = 0;
            centrosAgrupados[cc] += Number(c.cantidad) || 0;
        });

        const centrosArr = Object.entries(centrosAgrupados);
        const maxVol = centrosArr.length > 0 ? Math.max(...centrosArr.map(x => x[1])) : 1;

        const graficoBarrasSVG = centrosArr.map((c, index) => {
            const widthPct = ((c[1] / maxVol) * 100) * 4;
            const yPos = index * 45 + 20;
            return `
                <rect x="180" y="${yPos + 4}" width="${widthPct}" height="22" fill="rgba(20,26,36,0.08)" rx="4"/>
                <rect x="180" y="${yPos}" width="${widthPct}" height="22" fill="url(#gradienteApple)" rx="4"/>
                <rect x="180" y="${yPos}" width="${widthPct}" height="6" fill="rgba(255,255,255,0.25)" rx="2"/>
                <text x="10" y="${yPos + 15}" font-family="'Helvetica Neue', sans-serif" font-size="10" fill="#3A3A3C" font-weight="bold">${c[0]}</text>
                <text x="${widthPct + 190}" y="${yPos + 15}" font-family="sans-serif" font-size="10" fill="#0071E3" font-weight="bold">${c[1].toLocaleString('es-AR')} Lts</text>
            `;
        }).join('');

        ventanaPDF.document.write(`
            <html>
            <head>
                <title>Reporte Auditoría Combustibles - AgroSoft J&L</title>
                <style>
                    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1D1D1F; padding: 40px; margin: 0; background: #FFF; }
                    .header-report { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #0071E3; padding-bottom: 15px; margin-bottom: 25px; }
                    .header-report h1 { margin: 0; font-size: 22px; color: #0071E3; text-transform: uppercase; letter-spacing: -0.5px; }
                    .header-report span { font-size: 11px; color: #6E6E73; font-weight: bold; }

                    .grid-kpi { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 30px; }
                    .card-kpi { border: 1px solid #E4E7EC; background: #F6F7F9; border-radius: 12px; padding: 15px; }
                    .card-kpi span { font-size: 10px; color: #6E6E73; font-weight: bold; text-transform: uppercase; display: block; margin-bottom: 4px; }
                    .card-kpi strong { font-size: 18px; color: #1D1D1F; font-weight: bold; }

                    .section-title { font-size: 12px; font-weight: bold; color: #0071E3; text-transform: uppercase; margin: 25px 0 10px 0; letter-spacing: 0.5px; border-bottom: 1px solid #E4E7EC; padding-bottom: 4px; }
                    .tabla-pdf { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 20px; }
                    .tabla-pdf th { background: #F6F7F9; color: #1D1D1F; padding: 8px; font-weight: bold; border-bottom: 1px solid #D6DAE1; text-align: left; }
                    .tabla-pdf td { padding: 8px; border-bottom: 1px solid #E4E7EC; color: #3A3A3C; }
                    .monto-ingreso { color: #1FA958; font-weight: bold; }
                    .monto-egreso { color: #E0342A; font-weight: bold; }
                    @media print { button { display: none; } }
                </style>
            </head>
            <body>
                <div class="header-report">
                    <div>
                        <h1>AgroSoft J&L — Reporte Analítico de Combustibles</h1>
                        <p style="margin: 4px 0 0 0; font-size: 12px; color: #6E6E73;">Auditoría de Cisternas Energéticas, Consumos Contables y Asentamientos</p>
                    </div>
                    <div style="text-align: right;">
                        <span>EMITIDO: ${new Date().toLocaleDateString('es-AR')}</span>
                    </div>
                </div>

                <div class="grid-kpi">
                    <div class="card-kpi"><span>Cisternas Activas</span><strong>${this.tanques.length} Unidades</strong></div>
                    <div class="card-kpi"><span>Volumen Bruto Ingresado</span><strong style="color:#1FA958;">+ ${this.datosIngresos.reduce((a,c)=>a+Number(c.cantidad),0).toLocaleString('es-AR')} Lts</strong></div>
                    <div class="card-kpi"><span>Cubicaje Consumido Campo</span><strong style="color:#E0342A;">- ${this.datosConsumos.reduce((a,c)=>a+Number(c.cantidad),0).toLocaleString('es-AR')} Lts</strong></div>
                </div>

                <div class="section-title">📊 Matriz de Distribución de Energía por Centros de Costo (Gráfico de Impacto 3D)</div>
                <div style="text-align: center; background: #F6F7F9; padding: 15px; border-radius: 12px; border: 1px solid #E4E7EC; margin-bottom: 25px;">
                    <svg width="650" height="${centrosArr.length * 45 + 40}">
                        <defs>
                            <linearGradient id="gradienteApple" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stop-color="#0051A8" />
                                <stop offset="50%" stop-color="#0071E3" />
                                <stop offset="100%" stop-color="#42A5FF" />
                            </linearGradient>
                        </defs>
                        ${graficoBarrasSVG}
                    </svg>
                </div>

                <div class="section-title">📈 Detalle de Ingresos Recientes (Compras Logísticas)</div>
                <table class="tabla-pdf">
                    <thead>
                        <tr><th>FECHA</th><th>PROVEEDOR</th><th>CISTERNA DESTINO</th><th>COMBUSTIBLE</th><th>REMITO</th><th style="text-align:right;">VOLUMEN</th></tr>
                    </thead>
                    <tbody>
                        ${this.datosIngresos.slice(0, 10).map(i => `
                            <tr>
                                <td>${i.fecha}</td><td><b>${i.proveedor}</b></td><td>${i.campo_cisterna}</td><td>${i.combustible}</td><td>${i.remito || '-'}</td><td style="text-align:right;" class="monto-ingreso">+ ${Number(i.cantidad).toLocaleString('es-AR')} Lts</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div class="section-title">📉 Detalle de Egresos Recientes (Utilización en Campo)</div>
                <table class="tabla-pdf">
                    <thead>
                        <tr><th>FECHA</th><th>MAQUINARIA / UNIDAD</th><th>OPERARIO</th><th>CISTERNA ORIGEN</th><th>LABOR IMPUTADA</th><th style="text-align:right;">VOLUMEN RETIRADO</th></tr>
                    </thead>
                    <tbody>
                        ${this.datosConsumos.slice(0, 10).map(c => `
                            <tr>
                                <td>${c.fecha}</td><td><b>${c.maquina}</b></td><td>${c.operario}</td><td>${c.campo}</td><td>${c.labor || 'GENERAL'}</td><td style="text-align:right;" class="monto-egreso">- ${Number(c.cantidad).toLocaleString('es-AR')} Lts</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <script>
                    window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 800); }
                <\/script>
            </body>
            </html>
        `);
        ventanaPDF.document.close();
    },

    m_abrirModalIngreso: function(id = null) {
        this.m_asegurarModalBase();
        const reg = id ? this.datosIngresos.find(i => i.reg_local === id) : null;
        document.getElementById('modal-agrosoft').style.display = 'flex';
        document.getElementById('modal-titulo').innerText = reg ? "MODIFICAR INGRESO / COMPRA" : "REGISTRO DE INGRESO / COMPRA";

        const camposAgrupados = [...new Set(this.parametros.campos.map(c => c.campo).filter(Boolean))];

        const scriptCalculo = `
            <script>
                function m_recalcularPrecioUSD() {
                    const pesos = parseFloat(document.getElementById('com_imp_uni_p').value) || 0;
                    const coti = parseFloat(document.getElementById('com_coti').value) || 0;
                    const inputUSD = document.getElementById('com_imp_uni_u');
                    if (inputUSD) {
                        if (coti > 0) {
                            inputUSD.value = (pesos / coti).toFixed(3);
                        } else {
                            inputUSD.value = '0.000';
                        }
                    }
                }
            <\/script>
        `;

        document.getElementById('modal-formulario').innerHTML = `
            ${scriptCalculo}
            <div class="form-container-apple" style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:20px; padding:5px; font-family:'Roboto', sans-serif; color:#1D1D1F;">
                <div style="display:flex; flex-direction:column; gap:4px;"><label style="font-size:0.65rem; color:#6E6E73; text-transform:uppercase; font-weight:700;">Fecha</label>
                    <input type="date" id="com_fecha" value="${reg?.fecha || new Date().toISOString().split('T')[0]}" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:10px; border-radius:8px; color:#1D1D1F; outline:none;"></div>
                
                <div style="display:flex; flex-direction:column; gap:4px;"><label style="font-size:0.65rem; color:#6E6E73; text-transform:uppercase; font-weight:700;">Cisterna / Campo</label>
                    <select id="com_campo" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:10px; border-radius:8px; color:#1D1D1F; outline:none; cursor:pointer;">
                        <option value="">Seleccione Cisterna...</option>
                        ${camposAgrupados.map(cp => {
                            const isSelected = reg?.campo_cisterna && reg.campo_cisterna.trim().toUpperCase() === cp.trim().toUpperCase() ? 'selected' : '';
                            return `<option value="${cp.toUpperCase()}" ${isSelected}>${cp.toUpperCase()}</option>`;
                        }).join('')}
                    </select>
                </div>

                <div style="display:flex; flex-direction:column; gap:4px;"><label style="font-size:0.65rem; color:#6E6E73; text-transform:uppercase; font-weight:700;">Combustible</label>
                    <select id="com_tipo" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:10px; border-radius:8px; color:#1D1D1F; outline:none; cursor:pointer;">
                        <option value="">Seleccione Artículo...</option>
                        ${this.parametros.insumosComb.map(ins => {
                            const isSelected = reg?.combustible && reg.combustible.trim().toUpperCase() === ins.articulo.trim().toUpperCase() ? 'selected' : '';
                            return `<option value="${ins.articulo.toUpperCase()}" ${isSelected}>${ins.articulo.toUpperCase()} (${ins.rubro})</option>`;
                        }).join('')}
                    </select>
                </div>
                
                <div style="display:flex; flex-direction:column; gap:4px;"><label style="font-size:0.65rem; color:#6E6E73; text-transform:uppercase; font-weight:700;">Proveedor</label>
                    <input type="text" id="com_prov" value="${reg?.proveedor || ''}" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:10px; border-radius:8px; color:#1D1D1F; outline:none;"></div>
                <div style="display:flex; flex-direction:column; gap:4px;"><label style="font-size:0.65rem; color:#6E6E73; text-transform:uppercase; font-weight:700;">Remito N°</label>
                    <input type="text" id="com_remito" value="${reg?.remito || ''}" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:10px; border-radius:8px; color:#1D1D1F; outline:none;"></div>
                <div style="display:flex; flex-direction:column; gap:4px;"><label style="font-size:0.65rem; color:#1FA958; text-transform:uppercase; font-weight:700;">Cantidad (Lts)</label>
                    <input type="number" id="com_cant" value="${reg?.cantidad || ''}" style="width:100%; background:rgba(31,169,88,0.06); border:2px solid #1FA958 !important; padding:10px; border-radius:8px; color:#1D1D1F; font-weight:bold; outline:none;"></div>

                <div style="display:flex; flex-direction:column; gap:4px;"><label style="font-size:0.65rem; color:#6E6E73; text-transform:uppercase; font-weight:700;">Precio Unit. ($)</label>
                    <input type="number" id="com_imp_uni_p" oninput="m_recalcularPrecioUSD()" value="${reg?.['imp uni_ars'] || reg?.imp_uni_ars || ''}" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:10px; border-radius:8px; color:#1D1D1F; outline:none;"></div>
                <div style="display:flex; flex-direction:column; gap:4px;"><label style="font-size:0.65rem; color:#6E6E73; text-transform:uppercase; font-weight:700;">Cotización (1 U$S = ?)</label>
                    <input type="number" id="com_coti" oninput="m_recalcularPrecioUSD()" value="${reg?.cotizacion || ''}" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:10px; border-radius:8px; color:#1D1D1F; outline:none;"></div>
                <div style="display:flex; flex-direction:column; gap:4px;"><label style="font-size:0.65rem; color:#0071E3; text-transform:uppercase; font-weight:700;">Precio Unit. (U$S)</label>
                    <input type="number" id="com_imp_uni_u" step="0.001" readonly value="${reg?.imp_uni_usd || ''}" style="width:100%; background:rgba(0,113,227,0.06); border:1px solid rgba(0,113,227,0.25); padding:10px; border-radius:8px; color:#0071E3; font-weight:bold; outline:none;"></div>

                <div class="modal-apple-footer" style="grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #E4E7EC; padding-top: 18px; margin-top: 15px;">
                    <button class="btn-soft-local-action" onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background: #F0F2F5; color: #1D1D1F; border: 1px solid #E4E7EC; padding: 10px 20px; font-weight: bold; border-radius: 8px; font-size: 0.8rem; cursor: pointer;">CANCELAR</button>
                    <button class="btn-soft-local-action" id="btn-guardar-ingreso-local" style="background: #1FA958; color: #FFF; border: none; padding: 10px 24px; font-weight: bold; border-radius: 8px; font-size: 0.8rem; cursor: pointer;">
                        ${reg ? 'CONFIRMAR MODIFICACIÓN' : 'CONFIRMAR INGRESO'}
                    </button>
                </div>
            </div>`;

        document.getElementById('btn-guardar-ingreso-local').onclick = () => this.m_guardarIngreso(id);
    },

    m_abrirModalConsumo: function(id = null) {
        this.m_asegurarModalBase();
        const reg = id ? this.datosConsumos.find(c => c.reg_local === id) : null;
        document.getElementById('modal-agrosoft').style.display = 'flex';
        document.getElementById('modal-titulo').innerText = reg ? "MODIFICAR CONSUMO / EGRESO" : "REGISTRO DE CONSUMO / EGRESO";

        const cisternasConStock = this.tanques.filter(t => t.actual > 0 || id);

        document.getElementById('modal-formulario').innerHTML = `
            <div class="form-container-apple" style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:20px; padding:5px; font-family:'Roboto', sans-serif; color:#1D1D1F;">
                <div style="display:flex; flex-direction:column; gap:4px;"><label style="font-size:0.65rem; color:#6E6E73; text-transform:uppercase; font-weight:700;">Fecha</label>
                    <input type="date" id="c_fecha" value="${reg?.fecha || new Date().toISOString().split('T')[0]}" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:10px; border-radius:8px; color:#1D1D1F; outline:none;"></div>
                <div style="display:flex; flex-direction:column; gap:4px;"><label style="font-size:0.65rem; color:#6E6E73; text-transform:uppercase; font-weight:700;">Máquina / Unidad</label>
                    <input type="text" id="c_maq" value="${reg?.maquina || ''}" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:10px; border-radius:8px; color:#1D1D1F; outline:none;"></div>
                <div style="display:flex; flex-direction:column; gap:4px;"><label style="font-size:0.65rem; color:#6E6E73; text-transform:uppercase; font-weight:700;">Operario</label>
                    <input type="text" id="c_ope" value="${reg?.operario || ''}" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:10px; border-radius:8px; color:#1D1D1F; outline:none;"></div>
                
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <label style="font-size:0.65rem; color:#6E6E73; text-transform:uppercase; font-weight:700;">Origen (Stock Disponible)</label>
                    <select id="c_origen" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:10px; border-radius:8px; color:#1D1D1F; outline:none; font-weight:500; cursor:pointer;" onchange="ModuloCombustible.m_buscarUltimoPrecio()">
                        <option value="">Seleccionar origen...</option>
                        ${cisternasConStock.map(t => `
                            <option value="${t.nombre}|${t.tipo}" ${reg?.campo == t.nombre && reg?.combustible == t.tipo ? 'selected' : ''}>
                                ${t.nombre} - ${t.tipo} (${t.actual.toLocaleString('es-AR')} Lts)
                            </option>
                        `).join('')}
                    </select>
                </div>
                
                <div style="display:flex; flex-direction:column; gap:4px;"><label style="font-size:0.65rem; color:#6E6E73; text-transform:uppercase; font-weight:700;">Lote</label>
                    <input type="text" id="c_lote" value="${reg?.lote || ''}" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:10px; border-radius:8px; color:#1D1D1F; outline:none;"></div>
                <div style="display:flex; flex-direction:column; gap:4px;"><label style="font-size:0.65rem; color:#6E6E73; text-transform:uppercase; font-weight:700;">Superficie (Ha)</label>
                    <input type="number" id="c_sup" value="${reg?.sup || ''}" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:10px; border-radius:8px; color:#1D1D1F; outline:none;"></div>
                
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <label style="font-size:0.65rem; color:#6E6E73; text-transform:uppercase; font-weight:700;">Labor / Tarea Realizada</label>
                    <select id="c_labor" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:10px; border-radius:8px; color:#1D1D1F; outline:none; cursor:pointer;" onchange="ModuloCombustible.m_onLaborChange(this.value)">
                        <option value="">Seleccione labor...</option>
                        ${this.parametros.labores.map(l => `<option value="${l.labor}" ${reg?.labor === l.labor ? 'selected' : ''}>${l.labor}</option>`).join('')}
                    </select>
                </div>

                <div style="display:flex; flex-direction:column; gap:4px;">
                    <label style="font-size:0.65rem; color:#6E6E73; text-transform:uppercase; font-weight:700;">Centro de Costo / Rubro</label>
                    <div style="display:flex; gap:6px;">
                        <select id="c_centro" style="flex:1; background:#FFFFFF; border:1px solid #DDE1E7; padding:10px; border-radius:8px; color:#1D1D1F; outline:none; cursor:pointer;">
                            <option value="">Seleccione grupo...</option>
                            ${this.parametros.gastos.map(g => `<option value="${g.nombre_gasto}" ${reg?.centro_costo === g.nombre_gasto ? 'selected' : ''}>${g.nombre_gasto}</option>`).join('')}
                        </select>
                        <button class="btn-action-apple" onclick="ModuloCombustible.m_nuevoCentroCostoExpress()" title="Crear nuevo rubro contable" style="background:#0071E3; color:#FFF; border:none; width:42px; height:42px; border-radius:8px; display:inline-flex; align-items:center; justify-content:center; font-size:1.1rem;">+</button>
                    </div>
                </div>

                <div style="display:flex; flex-direction:column; gap:4px;"><label style="font-size:0.65rem; color:#E0342A; text-transform:uppercase; font-weight:700;">Cantidad (Lts)</label>
                    <input type="number" id="c_cant" value="${reg?.cantidad || ''}" style="width:100%; background:rgba(224,52,42,0.06); border:2px solid #E0342A !important; padding:10px; border-radius:8px; color:#1D1D1F; font-weight:bold; outline:none;"></div>
                
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <label style="font-size:0.65rem; color:#6E6E73; text-transform:uppercase; font-weight:700;">Precio Unit. ($)</label>
                    <input type="number" id="c_p_p" value="${reg?.imp_uni_pesos || ''}" placeholder="Autocompletado..." style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:10px; border-radius:8px; color:#1D1D1F; outline:none;">
                </div>
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <label style="font-size:0.65rem; color:#6E6E73; text-transform:uppercase; font-weight:700;">Precio Unit. (U$S)</label>
                    <input type="number" id="c_p_u" step="0.001" value="${reg?.imp_uni_dolar || ''}" placeholder="Autocompletado..." style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:10px; border-radius:8px; color:#1D1D1F; outline:none;">
                </div>

                <div class="modal-apple-footer" style="grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #E4E7EC; padding-top: 18px; margin-top: 15px;">
                    <button class="btn-soft-local-action" onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background: #F0F2F5; color: #1D1D1F; border: 1px solid #E4E7EC; padding: 10px 20px; font-weight: bold; border-radius: 8px; font-size: 0.8rem; cursor: pointer;">CANCELAR</button>
                    <button class="btn-soft-local-action" id="btn-guardar-consumo-local" style="background: #E0342A; color: #FFF; border: none; padding: 10px 24px; font-weight: bold; border-radius: 8px; font-size: 0.8rem; cursor: pointer;">
                        ${reg ? 'CONFIRMAR MODIFICACIÓN' : 'CONFIRMAR CONSUMO'}
                    </button>
                </div>
            </div>`;
        
        if(!reg) this.m_buscarUltimoPrecio(); 
        document.getElementById('btn-guardar-consumo-local').onclick = () => this.m_guardarConsumo(id);
    },

    m_abrirModalTransferencia: function() {
        this.m_asegurarModalBase();
        document.getElementById('modal-agrosoft').style.display = 'flex';
        document.getElementById('modal-titulo').innerText = "TRASLADO INTERNO DE COMBUSTIBLE";

        const cisternasConStock = this.tanques.filter(t => t.actual > 0);

        document.getElementById('modal-formulario').innerHTML = `
            <div class="form-container-apple" style="display:grid; grid-template-columns:1fr 1fr; gap:20px; padding:5px; font-family:'Roboto', sans-serif; color:#1D1D1F;">
                <div style="display:flex; flex-direction:column; gap:4px; grid-column:span 2;"><label style="font-size:0.65rem; color:#6E6E73; text-transform:uppercase; font-weight:700;">Fecha Traslado</label>
                    <input type="date" id="tr_fecha" value="${new Date().toISOString().split('T')[0]}" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:10px; border-radius:8px; color:#1D1D1F; outline:none;"></div>
                
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <label style="font-size:0.65rem; color:#E08600; text-transform:uppercase; font-weight:700;">Cisterna Origen (Retira)</label>
                    <select id="tr_origen" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:10px; border-radius:8px; color:#1D1D1F; outline:none; font-weight:500; cursor:pointer;">
                        <option value="">Seleccionar cisterna origen...</option>
                        ${cisternasConStock.map(t => `<option value="${t.nombre}|${t.tipo}">${t.nombre} - ${t.tipo} (${t.actual.toLocaleString('es-AR')} Lts)</option>`).join('')}
                    </select>
                </div>

                <div style="display:flex; flex-direction:column; gap:4px;">
                    <label style="font-size:0.65rem; color:#0071E3; text-transform:uppercase; font-weight:700;">Cisterna Destino (Recibe)</label>
                    <select id="tr_destino" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:10px; border-radius:8px; color:#1D1D1F; outline:none; font-weight:500; cursor:pointer;">
                        <option value="">Seleccionar cisterna destino...</option>
                        ${this.tanques.map(t => `<option value="${t.nombre}|${t.tipo}">${t.nombre} - ${t.tipo}</option>`).join('')}
                    </select>
                </div>

                <div style="display:flex; flex-direction:column; gap:4px; grid-column:span 2;"><label style="font-size:0.65rem; color:#1FA958; text-transform:uppercase; font-weight:700;">Volumen a Trasladar (Litros)</label>
                    <input type="number" id="tr_cant" placeholder="0" style="width:100%; background:rgba(31,169,88,0.06); border:2px solid #1FA958 !important; padding:10px; border-radius:8px; color:#1D1D1F; font-weight:bold; outline:none;"></div>

                <div class="modal-apple-footer" style="grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #E4E7EC; padding-top: 18px; margin-top: 15px;">
                    <button class="btn-soft-local-action" onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background: #F0F2F5; color: #1D1D1F; border: 1px solid #E4E7EC; padding: 10px 20px; font-weight: bold; border-radius: 8px; font-size: 0.8rem; cursor: pointer;">CANCELAR</button>
                    <button class="btn-soft-local-action" id="btn-confirmar-traslado" style="background: #0071E3; color: #FFF; border: none; padding: 10px 24px; font-weight: bold; border-radius: 8px; font-size: 0.8rem; cursor: pointer;">EJECUTAR TRASLADO SEGURO</button>
                </div>
            </div>`;

        document.getElementById('btn-confirmar-traslado').onclick = () => this.m_ejecutarTransferencia();
    },

    // ESTO LO MODIFIQUE / ACA ES LO NUEVO: Ejecución local en SQLite de contra-asientos por traslado
    m_ejecutarTransferencia: async function() {
        const origen = document.getElementById('tr_origen').value;
        const destino = document.getElementById('tr_destino').value;
        const cant = parseFloat(document.getElementById('tr_cant').value) || 0;
        const fecha = document.getElementById('tr_fecha').value;

        if(!origen || !destino) return window.ComponentesUI.notifica("⚠️ Especifique de manera obligatoria cisterna de origen y destino.");
        if(cant <= 0) return window.ComponentesUI.notifica("⚠️ Indique un volumen superior a cero.");
        if(origen === destino) return window.ComponentesUI.notifica("⚠️ No se puede trasladar stock hacia la misma cisterna.");

        const [oCampo, oTipo] = origen.split('|');
        const [dCampo, dTipo] = destino.split('|');

        if(oTipo !== dTipo) return window.ComponentesUI.notifica("⚠️ Incompatibilidad física: Las cisternas deben manejar el mismo tipo de combustible.");

        const cisternaSeleccionada = this.tanques.find(t => t.nombre === oCampo && t.tipo === oTipo);
        if(cisternaSeleccionada && cant > cisternaSeleccionada.actual) {
            return window.ComponentesUI.notifica(`⚠️ Volumen insuficiente. La cisterna de origen solo cuenta con ${cisternaSeleccionada.actual} litros disponibles.`);
        }

        const btn = document.getElementById('btn-confirmar-traslado');
        if(btn) { btn.disabled = true; btn.innerText = "PROCESANDO CONTRA-ASIENTOS..."; }

        try {
            // Calculo Max(registro)+1 para consumo local
            const resMaxC = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(REPLACE(reg_local, 'CONS-', '') AS INTEGER)) as max_val FROM consumos_combustibles`);
            const maxValC = (resMaxC.data && resMaxC.data[0] && resMaxC.data[0].max_val) ? Number(resMaxC.data[0].max_val) : 0;
            const nuevoIdConsumo = "CONS-" + (maxValC + 1);

            // Calculo Max(registro)+1 para ingreso local
            const resMaxI = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(REPLACE(reg_local, 'ING-', '') AS INTEGER)) as max_val FROM combustibles_ingresos`);
            const maxValI = (resMaxI.data && resMaxI.data[0] && resMaxI.data[0].max_val) ? Number(resMaxI.data[0].max_val) : 0;
            const nuevoIdIngreso = "ING-" + (maxValI + 1);

            const ultimoIngreso = this.datosIngresos.find(i => i.campo_cisterna === oCampo && i.combustible === oTipo);
            const p_p = ultimoIngreso ? (ultimoIngreso['imp uni_ars'] || ultimoIngreso.imp_uni_ars || 0) : 0;
            const p_u = ultimoIngreso ? (ultimoIngreso.imp_uni_usd || ultimoIngreso.imp_uni_dolar || 0) : 0;
            const coti = ultimoIngreso ? (ultimoIngreso.cotizacion || 1200) : 1200;

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
                    cantidad, imp_uni_ars, cotizacion, imp_uni_usd, usuario, sincronizado
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            await this.m_ejecutarSqlLocal(sqlIngreso, [
                nuevoIdIngreso, fecha, dCampo, dTipo, `TRASLADO DESDE ${oCampo}`, "AUTO-TR",
                cant, p_p, coti, p_u, "OPERADOR ADM", 0
            ]);

            document.getElementById('modal-agrosoft').style.display = 'none';
            await this.m_inicializar();
        } catch (e) {
            console.error("❌ Error en traslado local:", e);
            window.ComponentesUI.notifica("Error crítico en el traslado logístico local: " + e.message);
            if(btn) { btn.disabled = false; btn.innerText = "EJECUTAR TRASLADO SEGURO"; }
        }
    },

    // ESTO LO MODIFIQUE: Eliminación en cascada sobre SQLite Local
    m_borrarConsumo: async function(id) {
        if (!confirm("⚠️ ¿Está absolutamente seguro de eliminar este registro de consumo energético? Se descontará en caliente de todos los balances.")) return;
        try {
            await this.m_ejecutarSqlLocal(`DELETE FROM consumos_combustibles WHERE reg_local = ?`, [id]);
            
            const regLocalNumeric = parseInt(id.replace(/[^0-9]/g, ""));
            if (!isNaN(regLocalNumeric)) {
                await this.m_ejecutarSqlLocal(`DELETE FROM egresos_insumos WHERE reg_local = ? AND tabla_origen = 'COMBUSTIBLE'`, [regLocalNumeric]);
            }

            await this.m_inicializar();
        } catch (err) { 
            console.error(err);
            window.ComponentesUI.notifica("Error al intentar eliminar el consumo local: " + err.message); 
        }
    },

    // ESTO LO MODIFIQUE: Eliminación local de ingreso
    m_borrarIngreso: async function(id) {
        if (!confirm("⚠️ ¿Desea eliminar esta compra/ingreso de combustible? Esto afectará el cubicaje acumulado de la cisterna.")) return;
        try {
            await this.m_ejecutarSqlLocal(`DELETE FROM combustibles_ingresos WHERE reg_local = ?`, [id]);
            await this.m_inicializar();
        } catch (err) { 
            console.error(err);
            window.ComponentesUI.notifica("Error al eliminar el ingreso técnico local: " + err.message); 
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
                selectCentro.style.backgroundColor = 'rgba(0, 113, 227, 0.15)';
                setTimeout(() => { selectCentro.style.backgroundColor = ''; }, 800);
            }
        }
    },

    // ESTO LO MODIFIQUE: Registro express local de tipos_gastos
    m_nuevoCentroCostoExpress: function() {
        const container = document.getElementById('modal-formulario');
        if (!container) return;
        const formOriginal = container.innerHTML;

        container.innerHTML = `<div class="form-container-apple animated fadeIn" style="padding:15px; font-family:'Roboto', sans-serif; color:#1D1D1F;"><div class="info-banner-soft" style="background: rgba(0, 113, 227, 0.08); border-left: 4px solid #0071E3; padding: 15px; margin-bottom: 20px; border-radius: 8px;"><strong style="color: #0071E3;">NUEVA NOMENCLATURA EN TIPOS_GASTOS</strong></div><div class="group-soft" style="display:flex; flex-direction:column; gap:6px;"><label>Descripción del Rubro Contable</label><input type="text" id="txt_nuevo_rubro_comb" placeholder="Ej: LABORES CONTRATISTAS" style="text-transform: uppercase;"></div><div style="display: flex; gap: 10px; margin-top: 25px;"><button class="btn-cancelar-soft" id="btn-abortar-rubro">VOLVER</button><button class="btn-guardar-soft" id="btn-confirmar-rubro">REGISTRAR</button></div></div>`;
        document.getElementById('btn-abortar-rubro').onclick = () => { container.innerHTML = formOriginal; };
        document.getElementById('btn-confirmar-rubro').onclick = async () => {
            const nombre = document.getElementById('txt_nuevo_rubro_comb').value.trim().toUpperCase();
            if (!nombre) return window.ComponentesUI.notifica("Descripción mandatoria.");
            try {
                await this.m_ejecutarSqlLocal(`INSERT INTO tipos_gastos (nombre_gasto) VALUES (?)`, [nombre]);
                
                this.parametros.gastos.push({ nombre_gasto: nombre });
                container.innerHTML = formOriginal;
                const selectCentro = document.getElementById('c_centro');
                if (selectCentro) { selectCentro.add(new Option(nombre, nombre, true, true)); }
            } catch (err) { window.ComponentesUI.notifica(err.message); }
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

    // ESTO LO MODIFIQUE / ACA ES LO NUEVO: Guardado local de compra/ingreso con Max(registro)+1 y sincronizado = 0
    m_guardarIngreso: async function(id) {
        const btn = document.getElementById('btn-guardar-ingreso-local');
        let registroID = id;
        
        if (!registroID) {
            const resMax = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(REPLACE(reg_local, 'ING-', '') AS INTEGER)) as max_val FROM combustibles_ingresos`);
            const maxVal = (resMax.data && resMax.data[0] && resMax.data[0].max_val) ? Number(resMax.data[0].max_val) : 0;
            registroID = "ING-" + (maxVal + 1);
        }

        const fecha = document.getElementById('com_fecha').value;
        const campoCisterna = document.getElementById('com_campo').value.toUpperCase();
        const combustible = document.getElementById('com_tipo').value.toUpperCase();
        const proveedor = document.getElementById('com_prov').value;
        const remito = document.getElementById('com_remito').value;
        const cantidad = parseInt(document.getElementById('com_cant').value) || 0;
        const impUniArs = parseInt(document.getElementById('com_imp_uni_p').value) || 0;
        const cotizacion = parseInt(document.getElementById('com_coti').value) || 0;
        const impUniUsd = parseFloat(document.getElementById('com_imp_uni_u').value) || 0;

        if (btn) { btn.innerText = "GUARDANDO LOCAL..."; btn.disabled = true; }

        try {
            const sqlUpsert = `
                INSERT INTO combustibles_ingresos (
                    reg_local, fecha, campo_cisterna, combustible, proveedor, remito, 
                    cantidad, imp_uni_ars, cotizacion, imp_uni_usd, usuario, sincronizado
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(reg_local) DO UPDATE SET
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
                cantidad, impUniArs, cotizacion, impUniUsd, "OPERADOR ADM", 0
            ]);

            document.getElementById('modal-agrosoft').style.display = 'none';
            await this.m_inicializar();
        } catch (e) { 
            console.error("❌ Error al guardar ingreso local:", e);
            window.ComponentesUI.notifica(e.message); 
            if (btn) { btn.disabled = false; btn.innerText = "CONFIRMAR"; } 
        }
    },

    // ESTO LO MODIFIQUE / ACA ES LO NUEVO:
    // Guardado local de Consumo y duplicación automática en egresos_insumos
    m_guardarConsumo: async function(id) {
        const btn = document.getElementById('btn-guardar-consumo-local');
        const selectOrigen = document.getElementById('c_origen').value;
        if (!selectOrigen) return window.ComponentesUI.notifica("⚠️ Debe seleccionar una cisterna origen.");

        const [campo, tipo] = selectOrigen.split('|');
        const cant = parseFloat(document.getElementById('c_cant').value) || 0;
        const p_p = parseFloat(document.getElementById('c_p_p').value) || 0;
        const p_u = parseFloat(document.getElementById('c_p_u').value) || 0;

        let idRegistroUnico = id;
        if (!idRegistroUnico) {
            const resMaxC = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(REPLACE(reg_local, 'CONS-', '') AS INTEGER)) as max_val FROM consumos_combustibles`);
            const maxVal = (resMaxC.data && resMaxC.data[0] && resMaxC.data[0].max_val) ? Number(resMaxC.data[0].max_val) : 0;
            idRegistroUnico = "CONS-" + (maxVal + 1);
        }

        const regLocalNumeric = parseInt(idRegistroUnico.replace(/[^0-9]/g, "")) || Math.floor(Math.random() * 900000) + 100000;

        const fecha = document.getElementById('c_fecha').value;
        const maquina = document.getElementById('c_maq').value.toUpperCase();
        const operario = document.getElementById('c_ope').value;
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
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                lote, sup, labor, centroCosto, p_p, totalPesos, p_u, totalDolar, "ADM", 0
            ]);

            // 2. Trazabilidad espejo en egresos_insumos con regla Max(registro)+1
            const resMaxE = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(orden_trab AS INTEGER)) as max_ot FROM egresos_insumos`);
            const maxOrden = (resMaxE.data && resMaxE.data[0] && resMaxE.data[0].max_ot) ? Number(resMaxE.data[0].max_ot) : 0;
            const nuevaOT = String(maxOrden + 1);

            const sqlEgresos = `
                INSERT INTO egresos_insumos (
                    reg_local, tabla_origen, orden_trab, fecha, deposito_origen, insumo, 
                    establecimiento, campo, labor, tipo_labor, cuadro, sup_uso, total_consumo, 
                    imp_uni, total_dolar, total_pesos, centro_costo, comentario, estado, sincronizado
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(reg_local) DO UPDATE SET
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
                regLocalNumeric,
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
                'Activo', // ESTO LO MODIFIQUE: Siempre muestra estado Activo
                0        // ACA ES LO NUEVO: Flag local para sincronizar
            ]);

            document.getElementById('modal-agrosoft').style.display = 'none';
            await this.m_inicializar();
        } catch (e) { 
            console.error("❌ Error al guardar consumo local:", e);
            window.ComponentesUI.notifica(e.message); 
            if (btn) { btn.disabled = false; btn.innerText = "CONFIRMAR"; } 
        }
    }
};