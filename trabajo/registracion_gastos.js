/**
 * ModuloGastosAdm: Auditoría de Gastos y Tablas Maestras
 * AgroSoft J&L - "Apple Soft Studio" Edition / Tipografía Roboto
 * Mode: Local-First (Engine SQLite IPC) + "No me quites nada" + sincronizado = 0
 */
const ModuloGastosAdm = {
    datosEgresos: [],
    parametros: { 
        gastos: [],         // Datos locales de tipos_gastos
        campos: [],         // Datos de establecimientos mapeados y agrupados
        cuadros: [],        // Pool total de cuadros cargados para evitar desbordes de objetos
        cuadrosActuales: [] // Memoria caché temporal para cuadros del campo seleccionado
    },

    // ESTO LO MODIFIQUE / ACA ES LO NUEVO: Helper IPC para conectar con SQLite local
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
        const modalExistente = document.getElementById('modal-agrosoft');
        const tituloExistente = document.getElementById('modal-titulo');

        if (!modalExistente || !tituloExistente) {
            if (modalExistente) modalExistente.remove(); // Limpieza defensiva
            
            const modalHTML = `
                <div id="modal-agrosoft" class="modal-overlay" style="display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(20, 26, 36, 0.45); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); z-index: 99999; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box;">
                    <div id="modal-size-ctx" class="modal-apple-content" style="background: #FFFFFF; border: 1px solid #E4E7EC; border-radius: 14px; padding: 22px 26px; width: 92%; max-width: 600px; color: #1D1D1F; box-shadow: 0 7px 18px rgba(20,26,36,0.18); display: flex; flex-direction: column; transition: all 0.25s ease; position: relative;">
                        <div class="modal-header-apple" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid #E4E7EC; padding-bottom: 12px;">
                            <h3 id="modal-titulo" style="margin: 0; font-size: 1.1rem; font-weight: bold; font-family: 'Roboto', sans-serif; color: #0071E3;">REGISTRO</h3>
                            <button onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background: #F0F2F5; border: none; color: #1D1D1F; font-size: 1.2rem; cursor: pointer; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-weight: bold; transition: background 0.2s;">&times;</button>
                        </div>
                        <div id="modal-formulario" style="max-height: 78vh; overflow-y: auto; padding-right: 4px;" class="scroll-apple"></div>
                        <div class="modal-apple-footer" id="modal-footer-dinamico" style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; border-top: 1px solid #E4E7EC; padding-top: 14px;"></div>
                    </div>
                </div>`;
            document.body.insertAdjacentHTML('beforeend', modalHTML);

            const elModalCreated = document.getElementById('modal-agrosoft');
            if (elModalCreated) {
                elModalCreated.addEventListener('click', (e) => {
                    if (e.target === elModalCreated) {
                        elModalCreated.style.display = 'none';
                    }
                });
            }
        }
    },

    /**
     * ESTO LO MODIFIQUE: Carga 100% Offline desde SQLite local vía IPC
     */
    m_inicializar: async function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;
        visor.innerHTML = '<div class="loader-apple" style="font-family:\'Roboto\', sans-serif; text-align:center; padding:40px; color:#0071E3; font-weight:500;">Cargando Auditoría de Gastos desde base local...</div>';

        try {
            const [resEgresos, resTiposGastos, resCampos, resCuadros] = await Promise.all([
                this.m_ejecutarSqlLocal(`SELECT * FROM egresos_insumos WHERE tipo_labor = 'OTROS GASTOS ADM' ORDER BY fecha DESC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM tipos_gastos ORDER BY nombre_gasto`),
                this.m_ejecutarSqlLocal(`SELECT * FROM campos ORDER BY establecimiento`),
                this.m_ejecutarSqlLocal(`SELECT * FROM cuadros ORDER BY lote ASC`)
            ]);

            this.datosEgresos = resEgresos.data || resEgresos || [];
            this.parametros.gastos = resTiposGastos.data || resTiposGastos || [];
            this.parametros.cuadros = resCuadros.data || resCuadros || []; 

            const camposData = resCampos.data || resCampos || [];
            this.parametros.campos = camposData.map(c => ({
                deposito: c.establecimiento || c.campo || 'SIN ESPECIFICAR',
                grupo: c.empresa || c.zona || c.provincia || 'ESTABLECIMIENTOS PRINCIPALES'
            }));

            this.m_dibujarVistaPrincipal();
        } catch (e) { 
            console.error(e); 
            visor.innerHTML = `<div class="error-soft" style="color:#E0342A; background:rgba(224,52,42,0.09); border:1px solid rgba(224,52,42,0.25); border-radius:12px; padding:20px; font-family:'Roboto';">Error local en base de datos: ${e.message}</div>`;
        }
    },

    m_mostrarConfirmacion: function(titulo, mensaje) {
        return new Promise((resolve) => {
            const backdrop = document.createElement('div');
            backdrop.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(20, 26, 36, 0.45);
                backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); z-index: 101000;
                display: flex; align-items: center; justify-content: center; font-family: 'Roboto', sans-serif;
                opacity: 0; transition: opacity 0.3s ease;
            `;

            const modal = document.createElement('div');
            modal.style.cssText = `
                background: #FFFFFF; border: 1px solid #E4E7EC;
                border-radius: 14px; padding: 24px; width: 90%; max-width: 400px;
                box-shadow: 0 6px 14px rgba(20,26,36,0.16); transform: scale(0.9);
                transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1); text-align: center;
            `;

            modal.innerHTML = `
                <div style="display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; background: rgba(0, 113, 227, 0.1); border-radius: 50%; margin-bottom: 16px;">
                    <i data-lucide="help-circle" style="width: 24px; height: 24px; color: #0071E3;"></i>
                </div>
                <h3 style="margin: 0 0 8px 0; color: #1D1D1F; font-size: 1.1rem; font-weight: 600; letter-spacing: -0.01em;">${titulo.toUpperCase()}</h3>
                <p style="margin: 0 0 24px 0; color: #6E6E73; font-size: 0.85rem; line-height: 1.4;">${mensaje}</p>
                <div style="display: flex; gap: 12px; justify-content: center;">
                    <button id="btn-conf-cancelar" style="flex: 1; background: #F6F7F9; border: 1px solid #E4E7EC; color: #1D1D1F; padding: 12px; font-weight: bold; border-radius: 10px; font-size: 0.8rem; cursor: pointer;">CANCELAR</button>
                    <button id="btn-conf-aceptar" style="flex: 1; background: #0071E3; border: none; color: #FFF; padding: 12px; font-weight: bold; border-radius: 10px; font-size: 0.8rem; cursor: pointer; box-shadow: 0 4px 12px rgba(0,113,227,0.3);">CONFIRMAR</button>
                </div>
            `;

            backdrop.appendChild(modal);
            document.body.appendChild(backdrop);
            if (window.lucide) window.lucide.createIcons();

            requestAnimationFrame(() => {
                backdrop.style.opacity = '1';
                modal.style.transform = 'scale(1)';
            });

            const cerrarModal = (resultado) => {
                backdrop.style.opacity = '0';
                modal.style.transform = 'scale(0.9)';
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
        let contenedor = document.getElementById('notificaciones-container');
        if (!contenedor) {
            contenedor = document.createElement('div');
            contenedor.id = 'notificaciones-container';
            contenedor.style.cssText = `position: fixed; top: 20px; right: 20px; z-index: 100000; display: flex; flex-direction: column; gap: 10px; font-family: 'Roboto', sans-serif; pointer-events: none;`;
            document.body.appendChild(contenedor);
        }
        
        const esExito = tipo === 'exito';
        const colorBorde = esExito ? '#1FA958' : '#E0342A';
        const colorFondo = esExito ? 'rgba(31, 169, 88, 0.1)' : 'rgba(224, 52, 42, 0.09)';
        const iconoLucide = esExito ? 'check-circle' : 'alert-circle';

        const notificacion = document.createElement('div');
        notificacion.style.cssText = `
            min-width: 300px; max-width: 400px; background: #FFFFFF; backdrop-filter: blur(15px); -webkit-backdrop-filter: blur(15px);
            border: 1px solid #E4E7EC; border-left: 4px solid ${colorBorde}; padding: 14px 18px; border-radius: 12px; color: #1D1D1F;
            display: flex; align-items: center; gap: 12px; box-shadow: 0 6px 14px rgba(20,26,36,0.12); pointer-events: auto; transform: translateX(120%); transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease; opacity: 0;
        `;

        notificacion.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: ${colorFondo}; border-radius: 50%;">
                <i data-lucide="${iconoLucide}" style="width: 16px; height: 16px; color: ${colorBorde};"></i>
            </div>
            <div style="flex: 1; font-size: 0.8rem; font-weight: 500; line-height: 1.3; letter-spacing: -0.01em;">
                ${mensaje.toUpperCase()}
            </div>
        `;

        contenedor.appendChild(notificacion);
        if (window.lucide) window.lucide.createIcons();

        requestAnimationFrame(() => {
            notificacion.style.transform = 'translateX(0)';
            notificacion.style.opacity = '1';
        });

        setTimeout(() => {
            notificacion.style.transform = 'translateX(120%)';
            notificacion.style.opacity = '0';
            notificacion.addEventListener('transitionend', () => { notificacion.remove(); });
        }, 4000);
    },

    /* ACA ES LO NUEVO: Se incorpora el botón de Sincronización Global en la cabecera */
    m_dibujarVistaPrincipal: function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;

        const totalUSD = this.datosEgresos.reduce((acc, curr) => acc + (parseFloat(curr.total_dolar) || 0), 0);
        const totalPesos = this.datosEgresos.reduce((acc, curr) => acc + (parseFloat(curr.total_pesos) || 0), 0);

        visor.innerHTML = `
            <style>
                .egresos-layout { font-family: 'Roboto', sans-serif; color: #1D1D1F; }
                .grid-kpi-gastos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 25px; }
                .kpi-card-gast { background: #FFFFFF; border: 1px solid #E4E7EC; border-radius: 14px; padding: 18px; display: flex; flex-direction: column; gap: 4px; box-shadow: 0 2px 8px rgba(20,26,36,0.06); transition: box-shadow 0.2s, transform 0.2s; }
                .kpi-card-gast:hover { box-shadow: 0 6px 14px rgba(20,26,36,0.12); transform: translateY(-2px); }
                .kpi-card-gast span { font-size: 0.65rem; color: #6E6E73; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
                .kpi-card-gast strong { font-size: 1.4rem; font-weight: 700; color: #1D1D1F; }
                .kpi-card-gast.highlight-blue strong { color: #0071E3; }
                .kpi-card-gast.highlight-green strong { color: #1FA958; }

                .btn-export-apple-lab { background: #FFFFFF; border: 1px solid #E4E7EC; color: #1D1D1F; padding: 8px 14px; border-radius: 8px; font-size: 0.78rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.2s; }
                .btn-export-apple-lab:hover { background: #F6F7F9; border-color: #D6DAE1; }
                .btn-export-apple-lab:active, .btn-sync-soft:active, .btn-back-apple:active, .btn-edit-circle:active { transform: scale(0.96); }

                .tabla-soft { width: 100%; border-collapse: collapse; font-size: 0.8rem; text-align: left; }
                .tabla-soft th { padding: 12px 10px; color: #6E6E73; font-weight: 600; border-bottom: 2px solid #E4E7EC; }
                .tabla-soft td { padding: 12px 10px; border-bottom: 1px solid #EEF0F3; vertical-align: middle; }

                .badge-estado-activo { background: rgba(31, 169, 88, 0.1); color: #1FA958; border: 1px solid rgba(31, 169, 88, 0.25); padding: 3px 10px; border-radius: 14px; font-size: 0.68rem; font-weight: bold; }
                .btn-edit-circle { background: #FFFFFF; border: 1px solid #E4E7EC; color:#0071E3; width:30px; height:30px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; transition:all 0.2s; }
                .btn-edit-circle:hover { background: rgba(0,113,227,0.1); border-color: #0071E3; }
                .btn-back-apple { background:#FFFFFF; border:1px solid #E4E7EC; color:#1D1D1F; width:34px; height:34px; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition: all 0.2s; }
                .btn-back-apple:hover { background:#F6F7F9; border-color:#D6DAE1; }
            </style>

            <div class="egresos-layout animated fadeIn">
                <div class="modulo-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px;">
                    <div style="display:flex; align-items:center; gap:15px;">
                        <button class="btn-back-apple" onclick="if(window.ModuloRegistracion) ModuloRegistracion.m_dibujarSelectorInicial(); else ComponentesUI.irACategoria('LABORES');">
                            <i data-lucide="chevron-left"></i>
                        </button>

                        <div>
                            <h2 style="margin:0; font-weight: 700; font-size: 1.4rem; letter-spacing: -0.5px; color:#1D1D1F;">ADMINISTRACIÓN DE GASTOS ADM</h2>
                            <p style="margin:4px 0 0 0; font-size:0.8rem; color:#6E6E73;">Historial contable y liquidación de egresos administrativos e indirectos (base Local)</p>
                        </div>
                    </div>
                    <div style="display:flex; gap:12px; align-items:center;">
                        <button class="btn-export-apple-lab" onclick="ModuloGastosAdm.m_exportarPDFGlobal()" title="Imprimir Reporte Gráfico de Gastos">
                            <i data-lucide="file-text" style="color:#E0342A; width:14px; height:14px;"></i> PDF Reporte
                        </button>
                        <button class="btn-export-apple-lab" onclick="ModuloGastosAdm.m_exportarExcel()">
                            <i data-lucide="file-spreadsheet" style="color:#1FA958; width:14px; height:14px;"></i> EXPORTAR
                        </button>
                        <button class="btn-sync-soft" onclick="ModuloGastosAdm.m_abrirFormulario()" style="background:#0071E3; color:#FFF; border:none; padding:8px 18px; border-radius:8px; font-weight:bold; cursor:pointer; display:flex; align-items:center; gap:6px; box-shadow: 0 4px 12px rgba(0,113,227,0.25);">
                            <i data-lucide="plus-circle" style="width:14px; height:14px;"></i> NUEVO GASTO
                        </button>
                        <!-- ACA ES LO NUEVO: Botón de Sincronización Global -->
                        <button onclick="window.sincronizar_todo && window.sincronizar_todo()" style="background: #0071E3; color: #FFFFFF; border: none; padding: 8px 14px; border-radius: 8px; font-size: 0.78rem; font-weight: 700; cursor: pointer; display:flex; align-items:center; gap:6px; box-shadow: 0 4px 12px rgba(0,113,227,0.25); font-family:'Roboto';" title="Sincronizar todo con la base central">
                            ⚡ SINCRONIZAR ALL
                        </button>
                    </div>
                </div>

                <div class="grid-kpi-gastos">
                    <div class="kpi-card-gast highlight-green"><span>INVERSIÓN EN DÓLARES</span><strong>U$S ${totalUSD.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}</strong></div>
                    <div class="kpi-card-gast highlight-blue"><span>TOTAL CONSOLIDADO PESOS</span><strong>$ ${totalPesos.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}</strong></div>
                    <div class="kpi-card-gast"><span>GASTOS ASENTADOS</span><strong>${this.datosEgresos.length} Movimientos</strong></div>
                </div>

                <div class="card-glass-soft scroll-apple animated fadeInUp" style="background: #FFFFFF; border: 1px solid #E4E7EC; border-radius: 12px; padding: 15px; box-shadow: 0 2px 8px rgba(20,26,36,0.06);">
                    <table class="tabla-soft">
                        <thead>
                            <tr>
                                <th>FECHA</th>
                                <th>CONCEPTO GASTO</th>
                                <th>UBICACIÓN ESTABLECIMIENTO</th>
                                <th style="text-align:center;">SUP. (HA)</th>
                                <th style="text-align:right;">U$S UNIT.</th>
                                <th style="text-align:right;">TOTAL U$S</th>
                                <th>CENTRO COSTO / NOTA</th>
                                <th style="text-align:center;">ESTADO</th>
                                <th style="text-align:center; width:110px;">ACCIONES</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this.datosEgresos.length === 0 ?
                                `<tr><td colspan="9" align="center" style="color:#9AA0A6; padding:40px;">No se registran egresos administrativos.</td></tr>` :
                                this.datosEgresos.map(g => `
                                    <tr style="border-bottom:1px solid #EEF0F3; transition: background 0.15s;" onmouseover="this.style.background='#F6F7F9'" onmouseout="this.style.background='transparent'">
                                        <td style="font-size:0.85rem; color:#1D1D1F;"><b>${g.fecha}</b></td>
                                        <td><span class="text-highlight" style="background:#F0F2F5; color:#1D1D1F; padding:3px 6px; border-radius:4px; font-weight:600;">${g.insumo}</span></td>
                                        <td>
                                            <div class="location-cell" style="display:flex; flex-direction:column;">
                                                <strong style="color:#1D1D1F;">${g.establecimiento}</strong>
                                                <small style="color:#9AA0A6; font-size:0.7rem;">Cuadro: ${g.cuadro || '-'}</small>
                                            </div>
                                        </td>
                                        <td style="text-align:center; font-family:monospace; color:#1D1D1F;">${g.sup_uso || '0'}</td>
                                        <td style="text-align:right; color:#6E6E73; font-family:monospace;">${Number(g.imp_uni || 0).toFixed(2)}</td>
                                        <td style="text-align:right; font-weight:bold; color:#1FA958;">
                                            <span class="price-tag">U$S ${Number(g.total_dolar || 0).toLocaleString('es-AR', {minimumFractionDigits:2})}</span>
                                        </td>
                                        <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#6E6E73;">
                                            <small>${g.comentario || ''}</small>
                                        </td>
                                        <!-- ESTO LO MODIFIQUE: Siempre muestra del detalle el estado activo -->
                                        <td><span class="badge-estado-activo">ACTIVO</span></td>
                                        <td style="text-align:center; white-space:nowrap;">
                                            <button class="btn-edit-circle" style="color:#1FA958;" onclick="ModuloGastosAdm.m_verDetalleGastoVoucher('${g.id}')" title="Ver Voucher">
                                                <i data-lucide="eye" style="width:13px; height:13px;"></i>
                                            </button>
                                            <button class="btn-edit-circle" style="color:#E08600; margin-left:4px;" onclick="ModuloGastosAdm.m_abrirFormulario('${g.reg_local}')" title="Editar Gasto">
                                                <i data-lucide="edit-3" style="width:13px; height:13px;"></i>
                                            </button>
                                            <button class="btn-edit-circle" style="color:#E0342A; margin-left:4px;" onclick="ModuloGastosAdm.m_eliminarGasto('${g.id}')" title="Eliminar Gasto">
                                                <i data-lucide="trash-2" style="width:13px; height:13px;"></i>
                                            </button>
                                        </td>
                                    </tr>`).join('')
                            }
                        </tbody>
                    </table>
                </div>
            </div>`;
        if (window.lucide) lucide.createIcons();
    },

    m_eliminarGasto: async function(idRegistro) {
        const confirma = await this.m_mostrarConfirmacion(
            "Eliminar Gasto Administrativo",
            "¿Estás completamente seguro de eliminar este registro de gasto indirecto? El balance contable consolidado de AgroSoft se corregirá de inmediato en la base de datos local."
        );

        if (!confirma) return;

        try {
            await this.m_ejecutarSqlLocal(`DELETE FROM egresos_insumos WHERE id = ?`, [idRegistro]);

            this.m_mostrarNotificacion("Gasto purgado del ledger administrativo local.", "exito");
            await this.m_inicializar();
        } catch (err) {
            this.m_mostrarNotificacion("Error al purgar gasto: " + err.message, "error");
        }
    },

    m_abrirFormulario: function(id = null) {
        this.m_asegurarModalBase();
        
        const g = id ? this.datosEgresos.find(x => String(x.reg_local) === String(id)) : null;
        
        const sizeCtx = document.getElementById('modal-size-ctx');
        const modalBox = document.getElementById('modal-agrosoft');
        const titleCtx = document.getElementById('modal-titulo');
        const container = document.getElementById('modal-formulario');
        const footerCtx = document.getElementById('modal-footer-dinamico');

        if (sizeCtx) sizeCtx.style.maxWidth = "600px";
        if (modalBox) modalBox.style.display = 'flex';
        
        if (titleCtx) {
            titleCtx.innerHTML = `<i data-lucide="${g ? 'edit' : 'plus-square'}" size="18" style="vertical-align: middle; margin-right: 4px;"></i> ${g ? "EDITAR REGISTRO CONTABLE" : "NUEVO GASTO ADMINISTRATIVO"}`;
            titleCtx.style.color = '#0071E3';
        }

        const camposAgrupados = {};
        this.parametros.campos.forEach(c => {
            const grp = c.grupo || 'ESTABLECIMIENTOS PRINCIPALES';
            if (!camposAgrupados[grp]) camposAgrupados[grp] = [];
            if (!camposAgrupados[grp].includes(c.deposito)) {
                camposAgrupados[grp].push(c.deposito);
            }
        });

        const htmlCamposAgrupados = Object.entries(camposAgrupados).map(([nombreGrupo, listaEstablecimientos]) => `
            <optgroup label="🏢 ${nombreGrupo.toUpperCase()}">
                ${listaEstablecimientos.map(est => `<option value="${est}" ${g?.establecimiento == est ? 'selected' : ''}>${est}</option>`).join('')}
            </optgroup>
        `).join('');

        if (container) {
            container.innerHTML = `
                <style>
                    .admin-card-soft {
                        background: rgba(0, 113, 227, 0.02);
                        border: 1px solid rgba(0, 113, 227, 0.15);
                        border-radius: 12px;
                        padding: 14px;
                        display: grid;
                        grid-template-columns: repeat(2, 1fr);
                        gap: 12px;
                        margin-bottom: 12px;
                    }
                    .admin-card-title {
                        grid-column: 1 / -1;
                        font-size: 0.68rem;
                        color: #0071E3;
                        font-weight: 700;
                        letter-spacing: 0.6px;
                        text-transform: uppercase;
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        margin-bottom: 2px;
                    }
                    .group-soft label { font-size: 0.64rem; color: #6E6E73; text-transform: uppercase; font-weight: 700; display: block; margin-bottom: 4px; letter-spacing: 0.2px; }
                    .group-soft input, .group-soft select, .group-soft textarea { 
                        width: 100%; background: #FFFFFF; border: 1px solid #D6DAE1; padding: 8px 10px; border-radius: 8px; color: #1D1D1F; outline: none; font-family: 'Roboto', sans-serif; font-size: 0.84rem; transition: all 0.2s; 
                    }
                    .group-soft input:focus, .group-soft select:focus, .group-soft textarea:focus { border-color: #0071E3; box-shadow: 0 0 0 3px rgba(0,113,227,0.12); }
                    .dashboard-calculos-soft {
                        grid-column: 1 / -1;
                        background: rgba(0, 113, 227, 0.05);
                        border: 1px solid rgba(0, 113, 227, 0.18);
                        border-radius: 10px;
                        padding: 10px 14px;
                        display: flex;
                        align-items: center;
                        justify-content: space-around;
                    }
                    .valor-m-box { display:flex; flex-direction:column; align-items:center; }
                    .valor-m-box span { font-size:0.6rem; font-weight:700; text-transform:uppercase; color:#6E6E73; }
                    .valor-m-box strong { font-size:1.15rem; font-weight:800; }
                </style>
                
                <div class="form-container-apple animated fadeIn" style="font-family:'Roboto', sans-serif; color:#1D1D1F; padding:2px;">

                    <div class="admin-card-soft">
                        <div class="admin-card-title">📑 1. Imputación Primaria y Fecha</div>

                        <div class="group-soft">
                            <label>Fecha Imputación</label>
                            <input type="date" id="g_fecha" value="${g?.fecha || new Date().toISOString().split('T')[0]}">
                        </div>

                        <div class="group-soft">
                            <label>Concepto de Gasto</label>
                            <div style="display: flex; gap: 6px;">
                                <select id="g_insumo" style="flex: 1; cursor: pointer;">
                                    <option value="">Seleccione concepto...</option>
                                    ${this.parametros.gastos.map(tg => `<option value="${tg.nombre_gasto}" ${g?.insumo == tg.nombre_gasto ? 'selected' : ''}>${tg.nombre_gasto}</option>`).join('')}
                                </select>
                                <button class="btn-mini-soft" onclick="ModuloGastosAdm.m_nuevoConceptoGasto()" title="Agregar nuevo tipo de gasto" style="background:#0071E3; border:none; width:34px; height:34px; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                                    <i data-lucide="plus" style="color:white; width:14px;"></i>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div class="admin-card-soft">
                        <div class="admin-card-title">📍 2. Destino Técnico (Establecimientos Agrupados)</div>

                        <div class="group-soft">
                            <label>Establecimiento Afectado</label>
                            <select id="g_campo" onchange="ModuloGastosAdm.m_onCampoChange(this.value)" style="cursor: pointer;">
                                <option value="">Seleccione Establecimiento...</option>
                                ${htmlCamposAgrupados}
                            </select>
                        </div>

                        <div class="group-soft">
                            <label>Cuadro / Lote Reactivo</label>
                            <select id="g_lote" onchange="ModuloGastosAdm.m_onCuadroChange(this.value)" style="cursor: pointer;">
                                <option value="">Esperando establecimiento...</option>
                            </select>
                        </div>
                    </div>

                    <div class="admin-card-soft">
                        <div class="admin-card-title">📊 3. Matriz Económica e Índices Financieros</div>

                        <div class="group-soft"><label>Superficie Cobertura (HA)</label><input type="number" id="g_sup" oninput="ModuloGastosAdm.m_calcular()" step="0.01" value="${g?.sup_uso || 0}"></div>
                        <div class="group-soft"><label>U$S Valor Unitario</label><input type="number" id="g_imp_uni" oninput="ModuloGastosAdm.m_calcular()" step="0.01" value="${g?.imp_uni || 0}"></div>
                        <div class="group-soft" style="grid-column: 1 / -1;"><label>Cotización Divisa ($)</label><input type="number" id="g_coti" oninput="ModuloGastosAdm.m_calcular()" value="${g?.cotizacion || 1200}"></div>

                        <div class="dashboard-calculos-soft">
                            <div class="valor-m-box">
                                <span>TOTAL DÓLARES</span>
                                <strong id="disp_t_dolar" style="color:#1FA958;">U$S ${Number(g?.total_dolar || 0).toFixed(2)}</strong>
                                <input type="hidden" id="g_t_dolar" value="${g?.total_dolar || 0}">
                            </div>
                            <div style="width: 1px; height: 22px; background: rgba(0,113,227,0.2);"></div>
                            <div class="valor-m-box">
                                <span>TOTAL PESOS ($)</span>
                                <strong id="disp_t_pesos" style="color: #0071E3;">$ ${Number(g?.total_pesos || 0).toLocaleString('es-AR', {minimumFractionDigits:2})}</strong>
                                <input type="hidden" id="g_t_pesos" value="${g?.total_pesos || 0}">
                            </div>
                        </div>
                    </div>

                    <div class="group-soft" style="margin-top: 4px;">
                        <label>Comentarios / Centro de Costo Administrativo</label>
                        <textarea id="g_coment" rows="2" placeholder="Notas adicionales de auditoría e imputación..." style="resize: none;">${g?.comentario || ''}</textarea>
                    </div>

                </div>`;
        }

        if (footerCtx) {
            footerCtx.style.display = 'flex';
            footerCtx.innerHTML = `
                <button class="btn-cancel-soft" onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background: #F6F7F9; color: #1D1D1F; border: 1px solid #E4E7EC; padding: 10px 18px; font-weight: 700; border-radius: 8px; font-size: 0.8rem; cursor: pointer;">DESCARTAR</button>
                <button class="btn-save-soft" onclick="ModuloGastosAdm.m_guardarGasto('${id || ''}')" style="background: #1FA958; color: #FFF; border: none; padding: 10px 22px; font-weight: 700; border-radius: 8px; font-size: 0.8rem; cursor: pointer; display:flex; align-items:center; gap:6px; box-shadow: 0 4px 12px rgba(31,169,88,0.25);">
                    <i data-lucide="save" style="width:14px; height:14px;"></i> GUARDAR REGISTRO
                </button>
            `;
        }

        if (g && g.establecimiento) {
            this.m_onCampoChange(g.establecimiento, g.cuadro);
        }

        if (window.lucide) lucide.createIcons();
    },

    m_onCampoChange: function(campoSel, valorPreseleccionado = null) {
        const selectLote = document.getElementById('g_lote');
        if (!selectLote) return;

        if (!campoSel) {
            selectLote.innerHTML = '<option value="">Esperando establecimiento...</option>';
            return;
        }

        const cuadrosFiltrados = this.parametros.cuadros.filter(c => 
            c.establecimiento?.trim().toUpperCase() === campoSel.trim().toUpperCase() ||
            c.campo?.trim().toUpperCase() === campoSel.trim().toUpperCase()
        );

        this.parametros.cuadrosActuales = cuadrosFiltrados;

        if (cuadrosFiltrados.length === 0) {
            selectLote.innerHTML = '<option value="">Sin lotes mapeados en este campo</option>';
            return;
        }

        selectLote.innerHTML = '<option value="">Seleccione Lote / Cuadro...</option>' + 
            cuadrosFiltrados.map(l => {
                const valorLote = l.lote || l.nombre_lote;
                const etiqueta = l.nombre_lote ? `${l.lote} - ${l.nombre_lote} (${l.sup || 0} Ha)` : `Lote ${l.lote} (${l.sup || 0} Ha)`;
                const isSelected = valorPreseleccionado && String(valorLote).trim().toUpperCase() === String(valorPreseleccionado).trim().toUpperCase() ? 'selected' : '';
                return `<option value="${valorLote}" ${isSelected}>${etiqueta}</option>`;
            }).join('');

        if (valorPreseleccionado) {
            this.m_onCuadroChange(valorPreseleccionado);
        }
    },

    m_onCuadroChange: function(loteSel) {
        if (!loteSel || !this.parametros.cuadrosActuales) return;

        const cuadroEncontrado = this.parametros.cuadrosActuales.find(c => c.lote == loteSel || c.nombre_lote == loteSel);
        if (cuadroEncontrado) {
            const inputSup = document.getElementById('g_sup');
            if (inputSup && (parseFloat(inputSup.value) === 0 || inputSup.value === '')) {
                inputSup.value = cuadroEncontrado.sup || 0;
                inputSup.style.backgroundColor = 'rgba(31, 169, 88, 0.15)';
                setTimeout(() => { inputSup.style.backgroundColor = ''; }, 800);
                this.m_calcular();
            }
        }
    },

    m_nuevoConceptoGasto: function() {
        const container = document.getElementById('modal-formulario');
        if (!container) return;
        const formOriginal = container.innerHTML;

        container.innerHTML = `
            <div class="form-container-apple animated fadeIn" style="padding:5px; font-family:'Roboto';">
                <div class="info-banner-soft" style="background: rgba(0, 113, 227, 0.08); border-left: 4px solid #0071E3; padding: 15px; margin-bottom: 20px; border-radius: 8px;">
                    <strong style="color: #1D1D1F;">NUEVA NOMENCLATURA DE GASTO</strong>
                    <p style="font-size: 0.8rem; margin: 5px 0 0 0; color:#6E6E73;">Inserte la nomenclatura macro para clasificar egresos indirectos de administración.</p>
                </div>

                <div class="group-soft">
                    <label style="font-size:0.65rem; color:#6E6E73; font-weight:700;">NOMBRE DEL CONCEPTO</label>
                    <input type="text" id="nuevo_nombre_gasto" placeholder="Ej: REPARACION DE ALAMBRADO GENERAL" style="text-transform: uppercase; background:#FFFFFF; border:1px solid #D6DAE1; padding:10px; border-radius:8px; color:#1D1D1F; width:100%; outline:none;">
                </div>

                <div style="display: flex; gap: 10px; margin-top: 25px;">
                    <button class="btn-cancelar-soft" style="flex:1; background:#F6F7F9; color:#1D1D1F; border:1px solid #E4E7EC; padding:10px; border-radius:8px; cursor:pointer;" id="btn-abortar-gasto">VOLVER</button>
                    <button class="btn-guardar-soft" style="flex:1; background:#1FA958; color:white; border:none; padding:10px; border-radius:8px; font-weight:bold; cursor:pointer;" id="btn-confirmar-gasto">REGISTRAR</button>
                </div>
            </div>`;

        const inputNombre = document.getElementById('nuevo_nombre_gasto');
        if (inputNombre) inputNombre.focus();
        
        const footerCtx = document.getElementById('modal-footer-dinamico');
        if (footerCtx) footerCtx.style.display = 'none';

        document.getElementById('btn-abortar-gasto').onclick = () => {
            container.innerHTML = formOriginal;
            if (footerCtx) footerCtx.style.display = 'flex';
            if (window.lucide) lucide.createIcons();
        };

        document.getElementById('btn-confirmar-gasto').onclick = async () => {
            const nombre = document.getElementById('nuevo_nombre_gasto').value.trim().toUpperCase();
            if (!nombre) return this.m_mostrarNotificacion("Debe estipular un nombre válido para el concepto.", 'error');

            try {
                const nuevoId = 'tg_' + Date.now();
                await this.m_ejecutarSqlLocal(`INSERT INTO tipos_gastos (id, nombre_gasto, sincronizado) VALUES (?, ?, 0)`, [nuevoId, nombre]);

                this.parametros.gastos.push({ id: nuevoId, nombre_gasto: nombre });
                container.innerHTML = formOriginal;
                if (footerCtx) footerCtx.style.display = 'flex';
                
                const select = document.getElementById('g_insumo');
                if (select) {
                    const option = new Option(nombre, nombre, true, true);
                    select.add(option);
                }
                
                if (window.lucide) lucide.createIcons();
            } catch (err) {
                console.error(err);
                this.m_mostrarNotificacion("Error al guardar categoría local: " + err.message, 'error');
            }
        };
    },

    m_calcular: function() {
        const s = parseFloat(document.getElementById('g_sup').value) || 0;
        const u = parseFloat(document.getElementById('g_imp_uni').value) || 0;
        const c = parseFloat(document.getElementById('g_coti').value) || 1;
        
        const totalD = s * u;
        const totalP = totalD * c;

        const hDolar = document.getElementById('g_t_dolar');
        const hPesos = document.getElementById('g_t_pesos');
        const dDolar = document.getElementById('disp_t_dolar');
        const dPesos = document.getElementById('disp_t_pesos');

        if (hDolar) hDolar.value = totalD.toFixed(2);
        if (hPesos) hPesos.value = totalP.toFixed(2);

        if (dDolar) dDolar.innerText = `U$S ${totalD.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
        if (dPesos) dPesos.innerText = `$ ${totalP.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
    },

    m_uniqueid: function(prefix = '') {
        const timestamp = Date.now().toString(36); 
        const randomPart = Math.random().toString(36).substring(2, 7).toUpperCase(); 
        return `${prefix}${timestamp}-${randomPart}`;
    },

    /**
     * ESTO LO MODIFIQUE: Secuenciador Max(registro)+1 local, sincronizado = 0
     */
    m_guardarGasto: async function(regLocalId = '') {
    try {
        const isEdit = Boolean(regLocalId && String(regLocalId).trim() !== '');
        let finalRegLocal = String(regLocalId);
        let nuevaOrdenTrab = null;

        const resMax = await this.m_ejecutarSqlLocal(`
            SELECT 
                MAX(CAST(reg_local AS INTEGER)) AS max_reg,
                MAX(CAST(orden_trab AS INTEGER)) AS max_ot
            FROM egresos_insumos
        `);

        const row = (resMax.data && resMax.data[0]) || (resMax[0]) || {};
        const maxVal = parseInt(row.max_reg, 10) || 0;
        const maxOt = parseInt(row.max_ot, 10) || 0;

        if (!isEdit) {
            finalRegLocal = "REG-GAS-AD-" + Date.now();
            nuevaOrdenTrab = maxOt + 1;
        }

        // Lectura de valores y conversión segura a decimales
        const parseNum = (id) => {
            const el = document.getElementById(id);
            if (!el) return 0;
            const clean = String(el.value).replace(/,/g, '.').trim();
            return parseFloat(clean) || 0;
        };

        const totalDolarCalc = parseNum('g_t_dolar');
        const supUsoCalc = parseNum('g_sup');
        const impUniCalc = parseNum('g_imp_uni');
        const cotizacionCalc = parseNum('g_coti') || 1200;
        const totalPesosCalc = parseNum('g_t_pesos') || parseFloat((totalDolarCalc * cotizacionCalc).toFixed(4));
        const fechaVal = document.getElementById('g_fecha')?.value || new Date().toISOString().split('T')[0];
        const insumoVal = (document.getElementById('g_insumo')?.value || '').trim().toUpperCase();
        const campoVal = (document.getElementById('g_campo')?.value || '').trim().toUpperCase();
        const loteVal = (document.getElementById('g_lote')?.value || 'ADMINISTRATIVO').trim().toUpperCase();
        const comentVal = (document.getElementById('g_coment')?.value || '').trim();

        if (!campoVal || !insumoVal) {
            this.m_mostrarNotificacion("Los campos Concepto y Establecimiento son obligatorios.", 'error');
            return;
        }

        const costoFinalHaDolar = supUsoCalc > 0 ? parseFloat((totalDolarCalc / supUsoCalc).toFixed(4)) : 0;
        const costoFinal = supUsoCalc > 0 ? parseFloat((impUniCalc * supUsoCalc).toFixed(4)) : totalDolarCalc;

        if (isEdit) {
            const sqlUpdate = `
                UPDATE egresos_insumos SET 
                    fecha = ?, 
                    insumo = ?, 
                    establecimiento = ?, 
                    campo = ?, 
                    cuadro = ?, 
                    sup_uso = ?, 
                    imp_uni = ?, 
                    cotizacion = ?, 
                    total_dolar = ?, 
                    labor = ?, 
                    total_pesos = ?, 
                    costo_final_ha_dolar = ?, 
                    comentario = ?, 
                    costo_final = ?, 
                    estado = 'Activo', 
                    sincronizado = 0 
                WHERE reg_local = ?
            `;

            await this.m_ejecutarSqlLocal(sqlUpdate, [
                fechaVal, insumoVal, campoVal, campoVal, loteVal,
                supUsoCalc, impUniCalc, cotizacionCalc, totalDolarCalc,
                insumoVal, totalPesosCalc, costoFinalHaDolar, comentVal,
                costoFinal, finalRegLocal
            ]);
        } else {
            // OMITIMOS 'id' en la columna y en los VALUES para que SQLite use AUTOINCREMENT
            const sqlInsert = `
                INSERT INTO egresos_insumos (
                    reg_local, 
                    tabla_origen, 
                    tipo_labor, 
                    fecha, 
                    insumo, 
                    establecimiento, 
                    campo, 
                    cuadro, 
                    sup_uso, 
                    imp_uni, 
                    cotizacion, 
                    total_dolar, 
                    labor, 
                    total_pesos, 
                    costo_final_ha_dolar, 
                    centro_costo, 
                    comentario, 
                    costo_final, 
                    deposito_origen, 
                    estado, 
                    orden_trab, 
                    ref_orden, 
                    sincronizado
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
            `;

            await this.m_ejecutarSqlLocal(sqlInsert, [
                finalRegLocal,
                'GASTO_ADM',
                'OTROS GASTOS ADM',
                fechaVal,
                insumoVal,
                campoVal,
                campoVal,
                loteVal,
                supUsoCalc,
                impUniCalc,
                cotizacionCalc,
                totalDolarCalc,
                insumoVal,
                totalPesosCalc,
                costoFinalHaDolar,
                'OTROS GASTOS ADM',
                comentVal,
                costoFinal,
                'ADMINISTRACION',
                'ACTIVO',
                nuevaOrdenTrab,
                null
            ]);
        }

        this.m_mostrarNotificacion("Gasto administrativo registrado localmente.", "exito");

        const modalBox = document.getElementById('modal-agrosoft');
        if (modalBox) modalBox.style.display = 'none';

        await this.m_inicializar();

    } catch (err) {
        console.error("❌ Error en persistencia local de Gasto Administrativo:", err);
        this.m_mostrarNotificacion("Error al guardar en base local: " + err.message, 'error');
    }
},

    m_verDetalleGastoVoucher: function(identityId) {
        this.m_asegurarModalBase();
        const g = this.datosEgresos.find(item => String(item.id) === String(identityId));
        if (!g) return;

        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        const footerCtx = document.getElementById('modal-footer-dinamico');
        
        if (modal) modal.style.display = 'flex';
        if (footerCtx) footerCtx.style.display = 'none';

        if (container) {
            container.innerHTML = `
                <div style="background:#FFFFFF; color:#1D1D1F; border-radius:14px; padding:24px; font-family:'Roboto', sans-serif; box-shadow:0 2px 8px rgba(20,26,36,0.08); border:1px solid #E4E7EC;">
                    <div style="display:flex; justify-content:space-between; border-bottom:2px dashed #E4E7EC; padding-bottom:15px; margin-bottom:20px;">
                        <div style="display:flex; gap:15px; align-items:center;">
                            <!-- ESTO LO MODIFIQUE: Logo 3x3 -->
                            <div style="width:3in; height:3in; max-width:70px; max-height:70px; background:#F6F7F9; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:8px; font-weight:900; color:#6E6E73; border:1px solid #E4E7EC; text-align:center;">
                                AGROSOFT<br>J&L<br>3x3
                            </div>
                            <div>
                                <h3 style="margin:0; font-size:1.1rem; font-weight:900; color:#1D1D1F;">AGROSOFT J&L S.A.</h3>
                                <span style="font-size:0.7rem; color:#6E6E73; font-weight:bold; text-transform:uppercase;">Administrative Expense Ticket</span>
                            </div>
                        </div>
                        <div style="text-align:right;">
                            <!-- ESTO LO MODIFIQUE: Estado Activo -->
                            <span style="background:rgba(31,169,88,0.1); color:#1FA958; border:1px solid rgba(31,169,88,0.25); padding:3px 10px; border-radius:14px; font-size:0.68rem; font-weight: bold; display:inline-block; margin-bottom:6px;">ACTIVO</span>
                            <h4 style="margin:0; font-size:1.1rem; font-weight:900; color:#1D1D1F;">GASTO REF #ADM-${g.id}</h4>
                            <small style="color:#6E6E73;">Fecha Proceso: ${g.fecha}</small>
                        </div>
                    </div>

                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:20px; font-size:0.8rem;">
                        <div style="background:#F6F7F9; padding:12px; border-radius:10px; border:1px solid #E4E7EC;">
                            <span style="font-size:0.6rem; color:#6E6E73; font-weight:bold; display:block; margin-bottom:6px; text-transform:uppercase;">Destino Presupuestario</span>
                            <strong>Establecimiento:</strong> ${g.establecimiento}<br>
                            <strong>Cuadro / Sector Físico:</strong> Lote/Cuadro ${g.cuadro || 'General'}<br>
                            <strong>Superficie Equivalente:</strong> ${g.sup_uso} Hectáreas
                        </div>
                        <div style="background:#F6F7F9; padding:12px; border-radius:10px; border:1px solid #E4E7EC;">
                            <span style="font-size:0.6rem; color:#6E6E73; font-weight:bold; display:block; margin-bottom:6px; text-transform:uppercase;">Liquidación Cambiaria</span>
                            <strong>Registro Local ID:</strong> ${g.reg_local}<br>
                            <strong>Cotización Base:</strong> $ ${Number(g.cotizacion).toFixed(2)} ARS<br>
                            <!-- ESTO LO MODIFIQUE: Siempre mostrar del detalle el estado activo -->
                            <strong>Estado:</strong> <span class="badge-estado-activo">ACTIVO</span><br>
                            <strong>Centro de Costo / Notas:</strong> ${g.comentario || 'Sin observaciones.'}
                        </div>
                    </div>

                    <table style="width:100%; border-collapse:collapse; font-size:0.8rem; margin-bottom:20px; text-align:left;">
                        <thead>
                            <tr style="background:#F6F7F9; border-bottom:2px solid #E4E7EC;">
                                <th style="padding:10px;">DESCRIPCIÓN DEL GASTO ADMINISTRATIVO</th>
                                <th style="text-align:right; padding:10px;">PRECIO UNITARIO USD</th>
                                <th style="text-align:right; padding:10px;">TOTAL EN PESOS</th>
                                <th style="text-align:right; padding:10px;">TOTAL GENERAL USD</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr style="border-bottom:1px solid #E4E7EC;">
                                <td style="padding:12px 10px;">💼 <b>${g.insumo.toUpperCase()}</b></td>
                                <td style="text-align:right; padding:12px 10px; font-family:monospace;">U$S ${Number(g.imp_uni).toFixed(2)}</td>
                                <td style="text-align:right; padding:12px 10px; font-family:monospace; color:#0071E3;">$ ${Number(g.total_pesos).toLocaleString('es-AR')}</td>
                                <td style="text-align:right; padding:12px 10px; font-weight:900; color:#1FA958; font-size:0.85rem;">U$S ${Number(g.total_dolar).toLocaleString('es-AR', {minimumFractionDigits:2})}</td>
                            </tr>
                        </tbody>
                    </table>

                    <div style="display:flex; justify-content:flex-end; gap:10px;">
                        <button onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background:#0071E3; color:#FFF; border:none; padding:8px 16px; border-radius:6px; font-weight:bold; font-size:0.75rem; cursor:pointer;">CERRAR COMPROBANTE</button>
                    </div>
                </div>`;
        }
    },

    m_exportarExcel: function() {
        if (this.datosEgresos.length === 0) return this.m_mostrarNotificacion("No existen registros contables para exportar.", 'error');

        const headers = ["ID", "REG_LOCAL", "FECHA", "CONCEPTO GASTO", "ESTABLECIMIENTO", "CUADRO", "HA AFECTADAS", "U$S UNITARIO", "COTIZACION", "TOTAL USD", "TOTAL PESOS", "CENTRO COSTO", "ESTADO"];
        let csvContent = "\uFEFF" + headers.join(";") + "\n";

        this.datosEgresos.forEach(g => {
            const row = [
                g.id, g.reg_local, g.fecha, `"${g.insumo}"`, `"${g.establecimiento}"`, `"${g.cuadro || ''}"`,
                g.sup_uso, g.imp_uni, g.cotizacion, g.total_dolar, g.total_pesos, `"${g.centro_costo || ''}"`, `"ACTIVO"`
            ];
            csvContent += row.join(";") + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.setAttribute("download", `AgroSoft_Gastos_Administrativos_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    m_exportarPDFGlobal: function() {
        if (this.datosEgresos.length === 0) return this.m_mostrarNotificacion("Sábana de egresos vacía. No es posible consolidar gráficos.", 'error');

        const consolidadoConceptos = {};
        this.datosEgresos.forEach(g => {
            const cache = parseFloat(g.total_dolar || 0);
            consolidadoConceptos[g.insumo] = (consolidadoConceptos[g.insumo] || 0) + cache;
        });

        let svgGrafico3D = `<svg width="100%" height="160" style="background:#F6F7F9; border:1px solid #E4E7EC; border-radius:14px; padding:20px;">`;
        let yDelta = 35;
        Object.entries(consolidadoConceptos).slice(0, 4).forEach(([concepto, usd]) => {
            const maxW = 350;
            const barW = Math.max(15, Math.min((usd / 30000) * maxW, maxW));
            svgGrafico3D += `
                <text x="20" y="${yDelta + 13}" font-family="sans-serif" font-size="11" font-weight="700" fill="#1D1D1F">${concepto.toUpperCase().slice(0,18)}</text>
                <polygon points="${150},${yDelta} ${150 + barW},${yDelta} ${154 + barW},${yDelta - 5} ${154},${yDelta - 5}" fill="#0071E3" opacity="0.75" />
                <rect x="150" y="${yDelta}" width="${barW}" height="14" fill="#0071E3" />
                <polygon points="${150 + barW},${yDelta} ${154 + barW},${yDelta - 5} ${154 + barW},${yDelta + 9} ${150 + barW},${yDelta + 14}" fill="#0062C4" />
                <text x="${165 + barW}" y="${yDelta + 12}" font-family="sans-serif" font-size="11" font-weight="700" fill="#0071E3">U$S ${usd.toLocaleString('es-AR')}</text>
            `;
            yDelta += 32;
        });
        svgGrafico3D += `</svg>`;

        const ventanaImpresion = window.open('', '_blank');
        ventanaImpresion.document.write(`
            <html>
            <head>
                <title>AgroSoft J&L - Auditoría de Gastos</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap');
                    body { font-family: 'Roboto', sans-serif; padding: 40px; color: #1D1D1F; background:#FFFFFF; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    .header-pdf-premium { border-bottom: 3px solid #1FA958; padding-bottom: 15px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: flex-start; }
                    /* ESTO LO MODIFIQUE: Logo 3x3 pulgadas en margen superior izquierdo */
                    .logo-container-apple { width: 3in; height: 3in; border: 1px solid #E4E7EC; background: #F6F7F9; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #6E6E73; font-weight: bold; text-align: center; border-radius: 12px; margin-right: 20px; }
                    table { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 15px; }
                    th { background: #F6F7F9; padding: 8px; border-bottom: 2px solid #E4E7EC; text-align: left; }
                    td { padding: 8px; border-bottom: 1px solid #E4E7EC; }
                </style>
            </head>
            <body>
                <div class="header-pdf-premium">
                    <div class="logo-container-apple" id="logo-ctx-box">
                        AGROSOFT J&L<br>LOGO OFICIAL<br>3x3 PULGADAS
                    </div>
                    <div>
                        <small style="color:#6E6E73; font-weight:bold; letter-spacing:1px;">Ecosystem Ledger terminal (base Local)</small>
                        <h1 style="margin:5px 0 0 0; font-size:22px; font-weight:900;">Reporte Consolidado - Gastos Administrativos</h1>
                    </div>
                    <div style="text-align:right; font-size:11px;">
                        <strong>EMISIÓN:</strong> ${new Date().toLocaleDateString('es-AR')}<br>
                        <strong>INVERSIÓN TOTAL USD:</strong> U$S ${this.datosEgresos.reduce((a,c)=>a+parseFloat(c.total_dolar||0),0).toLocaleString('es-AR')}
                    </div>
                </div>

                <div style="margin-bottom:30px;">
                    <h4 style="font-size:11px; font-weight:800; text-transform:uppercase;">■ REPARTICIÓN ESTRATÉGICA POR CONCEPTO DE EGRESO (USD)</h4>
                    ${svgGrafico3D}
                </div>

                <h4>■ DETALLE CRONOLÓGICO DE GASTOS ASENTADOS</h4>
                <table>
                    <thead>
                        <tr>
                            <th>REG_LOCAL</th>
                            <th>FECHA</th>
                            <th>CONCEPTO GASTO</th>
                            <th>ESTABLECIMIENTO</th>
                            <th>CUADRO</th>
                            <th style="text-align:right;">TOTAL PESOS</th>
                            <th style="text-align:right;">TOTAL USD</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.datosEgresos.map(g => `
                            <tr>
                                <td>#${g.reg_local}</td>
                                <td>${g.fecha}</td>
                                <td><b>${g.insumo}</b></td>
                                <td>${g.establecimiento}</td>
                                <td>${g.cuadro || '---'}</td>
                                <td style="text-align:right; color:#0071E3;">$ ${Number(g.total_pesos).toLocaleString('es-AR')}</td>
                                <td style="text-align:right; font-weight:bold; color:#1FA958;">U$S ${Number(g.total_dolar).toLocaleString('es-AR', {minimumFractionDigits:2})}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>
                <script>window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); }</script>
            </body>
            </html>`);
        ventanaImpresion.document.close();
    }
};

window.ModuloGastosAdm = ModuloGastosAdm;