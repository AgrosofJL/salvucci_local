/**
 * ModuloLabores: Gestión y Auditoría de Siembra, Aplicaciones y Cosecha
 * Basado en tabla física: public.egresos_insumos
 * AgroSoft J&L - Mode "No me quites nada" + Full Sequential Ledger calculations (SQLite Local-First Engine)
 */
const ModuloLabores = {
    parametros: {
        campos: [],   // Datos locales de campos
        cuadros: [],  // Caché local para cuadros e hidratación de superficies
        insumos: [],  // Datos de stock/insumos
        labores: [],  // Datos locales de tipos_labores
        egresos: []   // Historial local de egresos_insumos (Filtrado por tabla_origen = 'LABOR')
    },

    // ESTO LO MODIFIQUE / ACA ES LO NUEVO: Helper IPC para conectar con SQLite local
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
        const modalExistente = document.getElementById('modal-agrosoft');
        const tituloExistente = document.getElementById('modal-titulo');

        if (!modalExistente || !tituloExistente) {
            if (modalExistente) modalExistente.remove(); // Limpieza defensiva de nodos huérfanos
            
            const modalHTML = `
                <div id="modal-agrosoft" class="modal-overlay" style="display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(18, 22, 28, 0.48); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); z-index: 99999; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box;">
                    <div class="modal-apple-content" style="background: #FFFFFF; border: 1px solid rgba(0,113,227,0.2); border-radius: 14px; padding: 25px; width: 95%; max-width: 850px; color: #1D1D1F; box-shadow: 0 9px 21px rgba(20,26,36,0.25); display: flex; flex-direction: column; position: relative;">
                        <div class="modal-header-apple" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid rgba(0,113,227,0.15); padding-bottom: 12px;">
                            <h3 id="modal-titulo" style="margin: 0; font-size: 1.2rem; font-weight: 800; font-family: 'Roboto', sans-serif; color: #0071E3; letter-spacing: -0.3px;">REGISTRO DE OPERACIÓN</h3>
                            <button onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background: #F0F2F5; border: none; color: #1D1D1F; font-size: 1.2rem; cursor: pointer; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-weight: bold; transition: background 0.2s;">&times;</button>
                        </div>
                        <div id="modal-formulario" style="max-height: 70vh; overflow-y: auto; padding-right: 5px;" class="scroll-apple"></div>
                        <div class="modal-apple-footer" id="modal-acciones-footer" style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 25px; border-top: 1px solid rgba(0,113,227,0.15); padding-top: 15px;">
                            <button class="btn-cancel-soft" onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background: #F0F2F5; color: #1D1D1F; border: none; padding: 10px 20px; font-weight: 700; border-radius: 8px; font-size: 0.8rem; cursor: pointer; font-family: 'Roboto';">CANCELAR</button>
                            <button class="btn-save-soft" id="btn-guardar-despacho-action" style="background: #0071E3; color: #FFFFFF; border: none; padding: 10px 20px; font-weight: 700; border-radius: 8px; font-size: 0.8rem; cursor: pointer; font-family: 'Roboto'; box-shadow: 0 4px 12px rgba(0,113,227,0.25);">GUARDAR OPERACIÓN</button>
                        </div>
                    </div>
                </div>`;
            document.body.insertAdjacentHTML('beforeend', modalHTML);

            // ACA ES LO NUEVO: Cierre intuitivo al hacer clic fuera del contenido del modal
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
     * ESTO LO MODIFIQUE: Carga 100% Offline desde SQLite Local vía IPC
     */
    m_inicializar: async function() {
        let visor = document.getElementById('pantalla-dinamica') || document.getElementById('contenedor-principal');
        if (!visor) {
            visor = document.createElement('div');
            visor.id = 'pantalla-dinamica';
            document.body.appendChild(visor);
        }
        visor.innerHTML = '<div class="loader-apple" style="font-family:\'Roboto\', sans-serif; text-align:center; padding:50px; color:#0071E3; font-weight:600; letter-spacing:0.3px;">Cargando Estructura de Datos y Sábana Operativa desde base Local...</div>';

        try {
            const [resCampos, resLabores, resEgresos, resCuadros] = await Promise.all([
                this.m_ejecutarSqlLocal(`SELECT * FROM campos ORDER BY establecimiento ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM tipos_labores ORDER BY labor ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM egresos_insumos WHERE tabla_origen = 'LABOR' ORDER BY id DESC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM cuadros ORDER BY lote ASC`) // Caché local de cuadros y superficies
            ]);

            this.parametros.campos = resCampos.data || resCampos || [];
            this.parametros.labores = resLabores.data || resLabores || [];
            this.parametros.egresos = resEgresos.data || resEgresos || [];
            this.parametros.cuadros = resCuadros.data || resCuadros || [];

            this.m_dibujarInterfaz();
        } catch (err) {
            console.error("Error en ModuloLabores Local:", err);
            visor.innerHTML = `<div class="error-soft" style="color:#E0342A; padding:20px; font-family:'Roboto'; border: 1px solid rgba(224,52,42,0.2); background: rgba(224,52,42,0.04); border-radius: 12px;">Error al cargar datos locales: ${err.message}</div>`;
        }
    },

    m_mostrarConfirmacion: function(titulo, mensaje) {
        return new Promise((resolve) => {
            const backdrop = document.createElement('div');
            backdrop.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(18, 22, 28, 0.48); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); z-index: 101000; display: flex; align-items: center; justify-content: center; font-family: 'Roboto', sans-serif; opacity: 0; transition: opacity 0.25s ease;`;

            const modal = document.createElement('div');
            modal.style.cssText = `background: #FFFFFF; border: 1px solid rgba(0,113,227,0.25); border-radius: 14px; padding: 24px; width: 90%; max-width: 420px; box-shadow: 0 7px 18px rgba(20,26,36,0.25); transform: scale(0.92); transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1); text-align: center;`;

            modal.innerHTML = `
                <div style="display: inline-flex; align-items: center; justify-content: center; width: 50px; height: 50px; background: rgba(0,113,227,0.08); border-radius: 50%; margin-bottom: 14px; border: 1px solid rgba(0,113,227,0.2);">
                    <span style="font-size:1.5rem; color:#0071E3;">❓</span>
                </div>
                <h3 style="margin: 0 0 8px 0; color: #0071E3; font-size: 1.1rem; font-weight: 800; letter-spacing: -0.3px;">${titulo.toUpperCase()}</h3>
                <p style="margin: 0 0 22px 0; color: #6E6E73; font-size: 0.85rem; line-height: 1.4; font-weight: 500;">${mensaje}</p>
                <div style="display: flex; gap: 10px; justify-content: center;">
                    <button id="btn-conf-cancelar" style="flex: 1; background: #F0F2F5; border: 1px solid #E4E7EC; color: #1D1D1F; padding: 11px; font-weight: 700; border-radius: 10px; font-size: 0.8rem; cursor: pointer; font-family:'Roboto';">CANCELAR</button>
                    <button id="btn-conf-aceptar" style="flex: 1; background: #0071E3; border: none; color: #FFFFFF; padding: 11px; font-weight: 700; border-radius: 10px; font-size: 0.8rem; cursor: pointer; box-shadow: 0 4px 12px rgba(0,113,227,0.25); font-family:'Roboto';">CONFIRMAR</button>
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
        let contenedor = document.getElementById('notificaciones-container');
        if (!contenedor) {
            contenedor = document.createElement('div');
            contenedor.id = 'notificaciones-container';
            contenedor.style.cssText = `position: fixed; top: 20px; right: 20px; z-index: 100000; display: flex; flex-direction: column; gap: 10px; font-family: 'Roboto', sans-serif; pointer-events: none;`;
            document.body.appendChild(contenedor);
        }
        
        const esExito = tipo === 'exito';
        const colorBorde = esExito ? '#1FA958' : '#E0342A'; 
        const colorFondo = esExito ? 'rgba(31,169,88,0.08)' : 'rgba(224,52,42,0.08)';
        const icono = esExito ? '✅' : '⚠️';

        const notificacion = document.createElement('div');
        notificacion.style.cssText = `min-width: 280px; max-width: 380px; background: #FFFFFF; border: 1px solid #E4E7EC; border-left: 4px solid ${colorBorde}; padding: 12px 16px; border-radius: 12px; color: #1D1D1F; display: flex; align-items: center; gap: 10px; box-shadow: 0 4px 10px rgba(20,26,36,0.15); pointer-events: auto; transform: translateX(120%); transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease; opacity: 0;`;

        notificacion.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: ${colorFondo}; border-radius: 50%; font-size:0.85rem;">
                ${icono}
            </div>
            <div style="flex: 1; font-size: 0.78rem; font-weight: 700; line-height: 1.3;">
                ${mensaje.toUpperCase()}
            </div>
        `;

        contenedor.appendChild(notificacion);

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

    /* ACA ES LO NUEVO: Se incorpora el botón de Sincronización Global en la esquina superior derecha */
    m_dibujarInterfaz: function() {
        const visor = document.getElementById('pantalla-dinamica') || document.getElementById('contenedor-principal');
        if (!visor) return;

        const totalInversion = this.parametros.egresos.reduce((acc, curr) => acc + (parseFloat(curr.total_dolar) || 0), 0);
        const totalHectareas = this.parametros.egresos.reduce((acc, curr) => acc + (parseFloat(curr.sup_uso) || 0), 0);

        visor.innerHTML = `
            <style>
                .egresos-layout { 
                    font-family: 'Roboto', sans-serif; 
                    color: #1D1D1F; 
                    padding: 10px 15px 40px 15px; 
                    width: 100%; 
                    box-sizing: border-box; 
                    max-height: calc(100vh - 70px); 
                    overflow-y: auto; 
                }
                .grid-kpi-labores { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 20px; }
                .kpi-card-lab { background: #FFFFFF; border: 1px solid #E4E7EC; border-radius: 14px; padding: 16px; display: flex; flex-direction: column; gap: 4px; box-shadow: 0 2px 8px rgba(20,26,36,0.04); transition: box-shadow 0.2s, transform 0.2s; }
                .kpi-card-lab:hover { box-shadow: 0 4px 10px rgba(20,26,36,0.08); transform: translateY(-2px); }
                .kpi-card-lab span { font-size: 0.65rem; color: #6E6E73; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
                .kpi-card-lab strong { font-size: 1.35rem; font-weight: 800; color: #1D1D1F; }
                .kpi-card-lab.highlight-green strong { color: #1FA958; }

                .btn-export-apple-lab { background: #FFFFFF; border: 1px solid #E4E7EC; color: #1D1D1F; padding: 7px 12px; border-radius: 8px; font-size: 0.75rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; font-family:'Roboto'; transition: all 0.2s; }
                .btn-export-apple-lab:hover { background: #F6F7F9; border-color: rgba(224,134,0,0.35); color: #E08600; }
                .btn-export-apple-lab:active, .btn-action-apple-lab:active { transform: scale(0.96); }

                .btn-action-apple-lab { background: #F0F2F5; border: 1px solid #E4E7EC; color: #1D1D1F; width: 28px; height: 28px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; font-size: 0.8rem; transition: all 0.2s; margin-right: 2px; }
                .btn-action-apple-lab:hover { border-color: rgba(0,113,227,0.4); background: rgba(0,113,227,0.1); }

                .tabla-soft-lab { width: 100%; border-collapse: collapse; font-size: 0.78rem; text-align: left; }
                .tabla-soft-lab th { padding: 10px 8px; color: #6E6E73; font-weight: 700; font-size: 0.68rem; letter-spacing: 0.5px; border-bottom: 2px solid #E4E7EC; background: #F6F7F9; text-transform: uppercase; }
                .tabla-soft-lab td { padding: 10px 8px; border-bottom: 1px solid #EEF0F3; vertical-align: middle; }

                .badge-estado-activo { background: rgba(31, 169, 88, 0.1); color: #1FA958; border: 1px solid rgba(31, 169, 88, 0.25); padding: 3px 8px; border-radius: 12px; font-size: 0.65rem; font-weight: 800; text-transform: uppercase; }
            </style>

            ${ComponentesUI.botonVolverCustomHTML("if(window.ModuloRegistracion) ModuloRegistracion.m_dibujarSelectorInicial(); else ComponentesUI.irACategoria('LABORES');", 'Volver al panel de Registración')}
            <div class="egresos-layout scroll-apple animated fadeIn">
                <div class="modulo-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap:wrap; gap:10px;">
                    <div>
                        <h2 style="margin:0; font-weight: 800; font-size: 1.35rem; letter-spacing: -0.5px; color:#1D1D1F;">🚜 Labores e Intervenciones de Campo</h2>
                        <p style="margin:3px 0 0 0; font-size:0.78rem; color:#6E6E73;">Administración financiera de siembras, trillas y servicios mecánicos por cuadro (base Local)</p>
                    </div>

                    <div style="display:flex; gap:8px; align-items:center;">
                        <button class="btn-export-apple-lab" onclick="ModuloLabores.m_exportarExcelGlobal()" title="Exportar Sábana Completa de Labores a Excel">
                            🗂️ Excel
                        </button>
                        <button class="btn-export-apple-lab" onclick="ModuloLabores.m_exportarPDFGlobal()" title="Imprimir Estadísticas Isométricas de Labores">
                            📊 PDF Reporte
                        </button>
                        
                        <button onclick="ModuloLabores.m_abrirFormulario()" style="background:#0071E3; color:#FFFFFF; border:none; padding:8px 16px; border-radius:8px; font-weight:700; cursor:pointer; box-shadow:0 4px 12px rgba(0,113,227,0.25); display:flex; align-items:center; gap:6px; font-family:'Roboto'; font-size:0.78rem;">
                            ⚙️ REGISTRAR LABOR
                        </button>
                    </div>
                </div>

                <div class="grid-kpi-labores">
                    <div class="kpi-card-lab"><span>VOLUMEN OPERADO</span><strong>${totalHectareas.toLocaleString('es-AR', {maximumFractionDigits:1})} Ha/Kg</strong></div>
                    <div class="kpi-card-lab highlight-green"><span>INVERSIÓN GENERAL LABORES</span><strong>U$S ${totalInversion.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</strong></div>
                    <div class="kpi-card-lab"><span>LABORES INDEXADAS</span><strong>${this.parametros.egresos.length} Registros</strong></div>
                </div>

                <div class="card-soft-main" style="background: #FFFFFF; border: 1px solid #E4E7EC; border-radius: 14px; padding: 16px; box-shadow: 0 2px 6px rgba(20,26,36,0.03);">
                    <div style="overflow-x:auto;">
                        <table class="tabla-soft-lab">
                            <thead>
                                <tr>
                                    <th>FECHA OPERACIÓN</th>
                                    <th>ESTABLECIMIENTO</th>
                                    <th>CAMPO / SECTOR</th>
                                    <th>LOTE / CUADRO</th>
                                    <th>CONCEPTO LABOR</th>
                                    <th style="text-align:right;">CANTIDAD (HA/KG)</th>
                                    <th style="text-align:right;">UNITARIO USD</th>
                                    <th style="text-align:right;">TOTAL INVERSIÓN</th>
                                    <th style="text-align:center;">ESTADO</th>
                                    <th style="text-align:center; width:110px;">ACCIONES</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${this.parametros.egresos.length === 0 ?
                                    `<tr><td colspan="10" align="center" style="padding:40px; color:#9AA0A6; font-weight:500;">No se registran labores operativas en esta campaña. Haga clic en Registrar Labor.</td></tr>` :
                                    this.parametros.egresos.map(l => `
                                        <tr style="border-bottom:1px solid #EEF0F3; color:#1D1D1F; transition: background 0.15s;" onmouseover="this.style.background='#F9FAFB'" onmouseout="this.style.background='transparent'">
                                            <td><b>${l.fecha}</b></td>
                                            <td><strong>${l.establecimiento}</strong></td>
                                            <td>${l.campo || '---'}</td>
                                            <td><span style="background:rgba(0,113,227,0.1); color:#0071E3; padding:2px 6px; border-radius:4px; font-weight:700; font-size:0.72rem;">Lote ${l.cuadro}</span></td>
                                            <td><span style="background:#F0F2F5; color:#1D1D1F; padding:3px 6px; border-radius:4px; font-weight:700; font-size:0.72rem; border:1px solid #E4E7EC;">${l.tipo_labor || l.labor || 'S/D'}</span></td>
                                            <td style="text-align:right; font-weight:600;">${Number(l.sup_uso).toLocaleString('es-AR')}</td>
                                            <td style="text-align:right; color:#6E6E73;">U$S ${Number(l.imp_uni).toFixed(2)}</td>
                                            <td style="text-align:right; font-weight:800; color:#1FA958;">U$S ${Number(l.total_dolar).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                                            <!-- ESTO LO MODIFIQUE: Siempre muestra del detalle el estado activo -->
                                            <td style="text-align:center;"><span class="badge-estado-activo">ACTIVO</span></td>
                                            <td style="text-align:center; white-space:nowrap;">
                                                <button class="btn-action-apple-lab" style="color:#0071E3;" onclick="ModuloLabores.m_verDetalleLaborVoucher('${l.id}')" title="Ver Certificación Digital">👁️</button>
                                                <button class="btn-action-apple-lab" style="color:#E08600;" onclick="ModuloLabores.m_editarFilaRegistro('${l.id}')" title="Editar este registro">✏️</button>
                                                <button class="btn-action-apple-lab" style="color:#E0342A;" onclick="ModuloLabores.m_eliminarFilaRegistro('${l.id}')" title="Eliminar este registro">🗑️</button>
                                            </td>
                                        </tr>
                                    `).join('')
                                }
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    },

    /* ESTO LO MODIFIQUE: Eliminación local directa en SQLite */
    m_eliminarFilaRegistro: async function(idRegistro) {
        const confirma = await this.m_mostrarConfirmacion(
            "Eliminar Labor de Campo",
            "¿Estás completamente seguro de eliminar esta labor operativa? Los balances financieros e historiales de hectáreas se corregirán de inmediato en la base local."
        );

        if (!confirma) return;

        try {
            await this.m_ejecutarSqlLocal(`DELETE FROM egresos_insumos WHERE id = ? OR reg_local = ?`, [idRegistro, idRegistro]);

            this.m_mostrarNotificacion("Labor purgada del historial contable local con éxito.", "exito");
            await this.m_inicializar(); // Hot-reload local unificado
        } catch (err) {
            this.m_mostrarNotificacion("Error al eliminar labor local: " + err.message, "error");
        }
    },

    m_editarFilaRegistro: async function(idRegistro) {
        const reg = this.parametros.egresos.find(e => String(e.id) === String(idRegistro) || String(e.reg_local) === String(idRegistro));
        if (!reg) return;

        this.m_asegurarModalBase();

        const modalTitulo = document.getElementById('modal-titulo');
        const modalForm = document.getElementById('modal-formulario');
        const modalOverlay = document.getElementById('modal-agrosoft');
        const footerAcciones = document.getElementById('modal-acciones-footer');

        if (footerAcciones) {
            footerAcciones.style.display = 'none';
        }

        if (modalTitulo) modalTitulo.innerText = "MODIFICAR REGISTRO DE LABOR OPERATIVA";
        
        const modalContent = document.querySelector('.modal-apple-content');
        if (modalContent) {
            modalContent.style.maxWidth = '600px';
            modalContent.style.border = '1px solid rgba(0,113,227,0.2)';
        }

        const estUnicos = [...new Set(this.parametros.campos.map(c => c.establecimiento).filter(Boolean))];
        const camposDelEst = this.parametros.campos.filter(c => c.establecimiento === reg.establecimiento);
        const cuadrosDelCampo = this.parametros.cuadros.filter(c => (c.campo || '').trim().toUpperCase() === (reg.campo || '').trim().toUpperCase());

        if (modalForm) {
            modalForm.innerHTML = `
                <div style="font-family:'Roboto', sans-serif; display:flex; flex-direction:column; gap:14px; padding:2px;">

                    <div style="background:rgba(0,113,227,0.04); padding:12px 14px; border-radius:12px; font-size:0.8rem; color:#1D1D1F; border-left:4px solid #0071E3; line-height:1.4;">
                        <strong>Auditoría de Servicios Hidratada:</strong> Registro Interno #${reg.id}<br>
                        <span style="opacity:0.8; color:#6E6E73;">Modificar el lote alterará automáticamente la superficie operativa asignada al subtotal.</span>
                    </div>

                    <div style="background: #F6F7F9; border: 1px solid #E4E7EC; padding: 14px; border-radius: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <div class="group-soft-c" style="display:flex; flex-direction:column; gap:5px;">
                            <label style="font-size:0.63rem; color:#6E6E73; font-weight:700; text-transform:uppercase;">Fecha Ejecución</label>
                            <input type="date" id="edit_l_fecha" value="${reg.fecha || ''}" class="input-filtro-ot" style="padding:8px;">
                        </div>
                        <div class="group-soft-c" style="display:flex; flex-direction:column; gap:5px;">
                            <label style="font-size:0.63rem; color:#6E6E73; font-weight:700; text-transform:uppercase;">Nomenclatura Labor / Concepto</label>
                            <select id="edit_l_labor" class="input-filtro-ot" style="padding:8px; cursor:pointer;">
                                ${this.parametros.labores.map(lab => `<option value="${lab.labor}" ${lab.labor.toUpperCase() === (reg.labor || '').toUpperCase() ? 'selected' : ''}>🛠️ ${lab.labor}</option>`).join('')}
                            </select>
                        </div>
                    </div>

                    <div style="background: #F6F7F9; border: 1px solid #E4E7EC; padding: 14px; border-radius: 12px; display: flex; flex-direction: column; gap: 12px;">
                        <div class="group-soft-c" style="display:flex; flex-direction:column; gap:5px;">
                            <label style="font-size:0.63rem; color:#6E6E73; font-weight:700; text-transform:uppercase;">Establecimiento</label>
                            <select id="edit_l_est" class="input-filtro-ot" style="padding:8px; cursor:pointer;">
                                ${estUnicos.map(e => `<option value="${e}" ${e === reg.establecimiento ? 'selected' : ''}>🏢 ${e}</option>`).join('')}
                            </select>
                        </div>

                        <div class="group-soft-c" style="display:flex; flex-direction:column; gap:5px;">
                            <label style="font-size:0.63rem; color:#6E6E73; font-weight:700; text-transform:uppercase;">Campo / Sector</label>
                            <select id="edit_l_campo" class="input-filtro-ot" style="padding:8px; cursor:pointer;">
                                ${[...new Set(camposDelEst.map(c => c.campo).filter(Boolean))].map(n => `<option value="${n}" ${n === reg.campo ? 'selected' : ''}>🗺️ ${n}</option>`).join('')}
                            </select>
                        </div>

                        <div class="group-soft-c" style="display:flex; flex-direction:column; gap:5px;">
                            <label style="font-size:0.63rem; color:#0071E3; font-weight:700; text-transform:uppercase;">Cuadro / Lote Indexado</label>
                            <select id="edit_l_lote" class="input-filtro-ot" style="padding:8px; font-weight:700; border-color:rgba(0,113,227,0.35); cursor:pointer;">
                                ${cuadrosDelCampo.map(c => `<option value="${c.lote}" data-sup="${c.sup}" ${c.lote.toString() === (reg.cuadro || '').toString() ? 'selected' : ''}>🌾 LOTE N° ${c.lote} (${c.sup} Ha)</option>`).join('')}
                            </select>
                        </div>
                    </div>

                    <div style="background: #F6F7F9; border: 1px solid #E4E7EC; padding: 14px; border-radius: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <div class="group-soft-c" style="display:flex; flex-direction:column; gap:5px;">
                            <label style="font-size:0.63rem; color:#6E6E73; font-weight:700; text-transform:uppercase;">Cantidad Realizada (Ha/Kg)</label>
                            <input type="number" step="0.01" id="edit_l_cant" value="${reg.sup_uso}" class="input-filtro-ot" style="padding:8px;">
                        </div>
                        <div class="group-soft-c" style="display:flex; flex-direction:column; gap:5px;">
                            <label style="font-size:0.63rem; color:#6E6E73; font-weight:700; text-transform:uppercase;">Precio Tarifa Tarjeta (U$S)</label>
                            <input type="number" step="0.01" id="edit_l_precio" value="${reg.imp_uni}" class="input-filtro-ot" style="padding:8px;">
                        </div>
                    </div>

                    <div class="group-soft-c" style="display:flex; flex-direction:column; gap:5px;">
                        <label style="font-size:0.63rem; color:#6E6E73; font-weight:700; text-transform:uppercase;">Observaciones / Historial</label>
                        <textarea id="edit_l_obs" rows="2" class="input-filtro-ot" style="padding:8px; font-family:'Roboto';">${reg.comentario || ''}</textarea>
                    </div>

                    <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px; border-top:1px solid #E4E7EC; padding-top:14px;">
                        <button type="button" onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background:#F0F2F5; font-size:0.75rem; border-radius:8px; padding:8px 16px; color:#1D1D1F; border:none; cursor:pointer; font-weight:700; font-family:'Roboto';">CANCELAR</button>
                        <button type="button" id="btn_confirmar_labor_update" style="background:#0071E3; font-size:0.75rem; border-radius:8px; padding:8px 20px; color:#FFFFFF; border:none; cursor:pointer; font-weight:700; font-family:'Roboto'; box-shadow:0 4px 12px rgba(0,113,227,0.25);">APLICAR CAMBIOS</button>
                    </div>
                </div>
            `;
        }

        if (modalOverlay) modalOverlay.style.display = 'flex';

        // Listeners interactivos en cascada
        const editEst = document.getElementById('edit_l_est');
        const editCampo = document.getElementById('edit_l_campo');
        const editLote = document.getElementById('edit_l_lote');
        const editCant = document.getElementById('edit_l_cant');

        if (editEst) {
            editEst.addEventListener('change', () => {
                const filtrados = this.parametros.campos.filter(c => c.establecimiento === editEst.value);
                const nombres = [...new Set(filtrados.map(c => c.campo).filter(Boolean))];
                editCampo.innerHTML = nombres.map(n => `<option value="${n}">${n}</option>`).join('');
                editCampo.dispatchEvent(new Event('change'));
            });
        }

        if (editCampo) {
            editCampo.addEventListener('change', () => {
                const cuadros = this.parametros.cuadros.filter(c => (c.campo || '').trim().toUpperCase() === editCampo.value.trim().toUpperCase());
                editLote.innerHTML = cuadros.map(c => `<option value="${c.lote}" data-sup="${c.sup}">🌾 LOTE N° ${c.lote} (${c.sup} Ha)</option>`).join('');
                editLote.dispatchEvent(new Event('change'));
            });
        }

        if (editLote) {
            editLote.addEventListener('change', () => {
                const optSel = editLote.options[editLote.selectedIndex];
                if (optSel && editCant) {
                    editCant.value = optSel.getAttribute('data-sup');
                }
            });
        }

        const btnGuardar = document.getElementById('btn_confirmar_labor_update');
        if (btnGuardar) {
            btnGuardar.onclick = async () => {
                const fechaVal = document.getElementById('edit_l_fecha').value;
                const laborVal = document.getElementById('edit_l_labor').value;
                const estVal = document.getElementById('edit_l_est').value;
                const campoVal = document.getElementById('edit_l_campo').value;
                const loteVal = document.getElementById('edit_l_lote').value;
                const cantVal = parseFloat(document.getElementById('edit_l_cant').value) || 0;
                const precioVal = parseFloat(document.getElementById('edit_l_precio').value) || 0;
                const obsVal = document.getElementById('edit_l_obs').value;

                if (!fechaVal || !laborVal || !estVal || !loteVal) {
                    return this.m_mostrarNotificacion("Verifique los campos obligatorios.", "error");
                }

                btnGuardar.disabled = true;
                btnGuardar.innerText = "ACTUALIZANDO LOCAL...";

                const nuevoTotalDolar = cantVal * precioVal;
                const cotizacionFija = reg.cotizacion || 1200;
                const nuevoTotalPesos = nuevoTotalDolar * cotizacionFija;

                try {
                    // ESTO LO MODIFIQUE / ACA ES LO NUEVO: UPDATE local SQLite con sincronizado = 0 y estado Activo
                    const sqlUpdate = `
                        UPDATE egresos_insumos SET
                            fecha = ?, labor = ?, tipo_labor = ?, centro_costo = ?,
                            establecimiento = ?, campo = ?, cuadro = ?, sup_uso = ?,
                            imp_uni = ?, total_dolar = ?, total_pesos = ?, costo_final = ?,
                            costo_final_ha_dolar = ?, comentario = ?, estado = 'Activo',
                            sincronizado = 0
                        WHERE id = ? OR reg_local = ?
                    `;

                    const paramsUpdate = [
                        fechaVal, laborVal, laborVal, laborVal ? laborVal.toUpperCase() : 'GENERAL',
                        estVal, campoVal, loteVal, cantVal, precioVal, nuevoTotalDolar,
                        parseFloat(nuevoTotalPesos.toFixed(4)), parseFloat(nuevoTotalDolar.toFixed(4)),
                        precioVal, obsVal, reg.id, reg.reg_local
                    ];

                    await this.m_ejecutarSqlLocal(sqlUpdate, paramsUpdate);

                    this.m_mostrarNotificacion("Operación de labor editada con éxito.", "exito");
                    if (modalOverlay) modalOverlay.style.display = 'none';
                    await this.m_inicializar();
                } catch (err) {
                    console.error("❌ Error al guardar edición local:", err);
                    this.m_mostrarNotificacion("Error al resguardar la edición local: " + err.message, "error");
                    btnGuardar.disabled = false;
                    btnGuardar.innerText = "APLICAR CAMBIOS";
                }
            };
        }
    },

    m_abrirFormulario: function() {
        this.m_asegurarModalBase();
        
        const container = document.getElementById('modal-formulario');
        const footerAcciones = document.getElementById('modal-acciones-footer');
        const tituloComponente = document.getElementById('modal-titulo');
        
        if (tituloComponente) {
            tituloComponente.innerText = 'REGISTRO DE LABOR OPERATIVA EN LOTE';
            tituloComponente.style.color = '#123F2C';
        }
        
        const modalContent = document.querySelector('.modal-apple-content');
        // Ancho optimizado para evitar espacios vacíos innecesarios
        if (modalContent) modalContent.style.maxWidth = '680px';

        if (footerAcciones) {
            footerAcciones.style.display = 'none';
        }
        
        const estUnicos = [...new Set(this.parametros.campos.map(c => c.establecimiento).filter(Boolean))];

        if (container) {
            container.innerHTML = `
                <div class="form-container-apple animated fadeIn" style="padding:2px; font-family:'Roboto', sans-serif;">
                    <style>
                        .grid-labores-compacta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
                        .full-row-lab { grid-column: span 2; }
                        .display-calculo-lab {
                            background: rgba(30, 107, 76, 0.08); border: 1px solid rgba(30, 107, 76, 0.25);
                            border-radius: 10px; padding: 10px; text-align: center;
                        }
                        .group-soft-lab label {
                            font-size: 0.65rem; color: #6B6255; display: block; margin-bottom: 4px;
                            text-transform: uppercase; font-weight: 700; letter-spacing: 0.3px;
                        }
                        .input-filtro-lab {
                            width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid #E0DCD4;
                            font-size: 0.82rem; background: #FFFFFF; color: #1D1D1F; outline: none;
                            box-sizing: border-box; font-family: 'Roboto', sans-serif;
                            transition: border-color 0.2s ease;
                        }
                        .input-filtro-lab:focus { border-color: #1E6B4C; }
                    </style>

                    <div style="background:#F8FAFC; border:1px solid #E0DCD4; padding:14px; border-radius:12px; margin-bottom:10px;">
                        <div class="grid-labores-compacta">
                            <div class="group-soft-lab">
                                <label>📍 Establecimiento</label>
                                <select id="l_est" onchange="ModuloLabores.m_cargarCampos(this.value)" class="input-filtro-lab">
                                    <option value="">Seleccione...</option>
                                    ${estUnicos.map(e => `<option value="${e}">${e}</option>`).join('')}
                                </select>
                            </div>

                            <div class="group-soft-lab">
                                <label>🧭 Campo / Sector</label>
                                <select id="l_campo" onchange="ModuloLabores.m_cargarLotes(this.value)" class="input-filtro-lab">
                                    <option value="">Esperando establecimiento...</option>
                                </select>
                            </div>

                            <div class="group-soft-lab">
                                <label>🌾 Lote / Cuadro Indexado</label>
                                <select id="l_lote" onchange="ModuloLabores.m_autoRellenarSuperficie(this)" class="input-filtro-lab">
                                    <option value="">Esperando campo...</option>
                                </select>
                            </div>

                            <div class="group-soft-lab">
                                <label>📅 Fecha Ejecución</label>
                                <input type="date" id="l_fecha" value="${new Date().toISOString().split('T')[0]}" class="input-filtro-lab">
                            </div>
                        </div>
                    </div>

                    <div style="background:#F8FAFC; border:1px solid #E0DCD4; padding:14px; border-radius:12px; margin-bottom:10px;">
                        <div class="grid-labores-compacta">
                            <div class="group-soft-lab full-row-lab">
                                <label>Tipo de Labor Operativa</label>
                                <div style="display:flex; gap:6px;">
                                    <select id="l_tipo_labor" style="flex:1;" class="input-filtro-lab">
                                        <option value="">Seleccione labor...</option>
                                        ${this.parametros.labores.map(lab => `<option value="${lab.labor}">${lab.labor}</option>`).join('')}
                                    </select>
                                    <button type="button" onclick="ModuloLabores.m_nuevoTipoLabor()" style="background:#1E6B4C; color:white; border:none; width:34px; height:34px; border-radius:8px; font-weight:900; font-size:1.1rem; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0;" title="Añadir nuevo tipo de labor">+</button>
                                </div>
                            </div>

                            <div class="group-soft-lab">
                                <label>Superficie / Cantidad (Ha / Kg)</label>
                                <input type="number" step="0.01" id="l_cant" placeholder="0.00" oninput="ModuloLabores.m_calcular()" class="input-filtro-lab" style="font-weight:700; color:#123F2C;">
                            </div>

                            <div class="group-soft-lab">
                                <label>Precio Unitario Tarifa (U$S)</label>
                                <input type="number" step="0.01" id="l_precio" placeholder="0.00" oninput="ModuloLabores.m_calcular()" class="input-filtro-lab">
                            </div>
                        </div>
                    </div>

                    <div class="display-calculo-lab" style="margin-bottom:10px;">
                        <small style="color:#1E6B4C; text-transform:uppercase; font-size:0.62rem; font-weight:800; letter-spacing:0.5px; display:block; margin-bottom:2px;">Valorización Total Liquidada</small>
                        <h2 id="l_total_display" style="color:#1E6B4C; margin:0; font-size:1.35rem; font-weight:900; font-family:monospace;">U$S 0.00</h2>
                        <input type="hidden" id="l_total_val" value="0">
                    </div>

                    <div class="group-soft-lab full-row-lab">
                        <label>Observaciones / Trazabilidad de la Labor</label>
                        <textarea id="l_obs" rows="2" placeholder="Ej: Condiciones climáticas, pulverización con boquillas antideriva..." class="input-filtro-lab" style="resize:vertical;"></textarea>
                    </div>

                    <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:14px; border-top:1px solid #E0DCD4; padding-top:12px;">
                        <button type="button" id="btn-cancelar-operacion-local" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:8px 18px; font-weight:700; border-radius:8px; font-size:0.78rem; cursor:pointer;">CANCELAR</button>
                        <button type="button" id="btn-guardar-operacion-local" style="background:#1E6B4C; color:#FFFFFF; border:none; padding:8px 22px; font-weight:700; border-radius:8px; font-size:0.78rem; cursor:pointer; box-shadow:0 4px 12px rgba(30,107,76,0.25);">GUARDAR OPERACIÓN</button>
                    </div>
                </div>
            `;
        }

        const btnCancelLocal = document.getElementById('btn-cancelar-operacion-local');
        const btnSaveLocal = document.getElementById('btn-guardar-operacion-local');

        if (btnCancelLocal) {
            btnCancelLocal.onclick = () => document.getElementById('modal-agrosoft').style.display = 'none';
        }
        if (btnSaveLocal) {
            btnSaveLocal.onclick = () => ModuloLabores.m_guardar();
        }

        const modalBox = document.getElementById('modal-agrosoft');
        if (modalBox) modalBox.style.display = 'flex';
    },

    m_autoRellenarSuperficie: function(selectElem) {
        const opt = selectElem.options[selectElem.selectedIndex];
        const inputCant = document.getElementById('l_cant');
        if (opt && opt.getAttribute('data-sup') && inputCant) {
            inputCant.value = opt.getAttribute('data-sup');
            this.m_calcular();
        }
    },

    m_cargarCampos: function(estSel) {
        const selectCampo = document.getElementById('l_campo');
        if (!selectCampo) return;
        const filtrados = this.parametros.campos.filter(c => c.establecimiento === estSel);
        const nombres = [...new Set(filtrados.map(c => c.campo).filter(Boolean))];

        selectCampo.innerHTML = '<option value="">Seleccione Campo...</option>' + 
            nombres.map(n => `<option value="${n}">${n}</option>`).join('');
        
        const selectLote = document.getElementById('l_lote');
        if (selectLote) selectLote.innerHTML = '<option value="">Esperando campo...</option>';
    },

    m_cargarLotes: async function(campoSel) {
        const selectLote = document.getElementById('l_lote');
        if (!selectLote) return;

        selectLote.innerHTML = '<option value="">Cargando lotes...</option>';

        try {
            if (!campoSel) {
                selectLote.innerHTML = '<option value="">Seleccione un campo primero...</option>';
                return;
            }
            
            const campoLimpio = campoSel.trim();
            const losCuadrosFiltrados = this.parametros.cuadros.filter(c => (c.campo || '').trim().toUpperCase() === campoLimpio.toUpperCase());

            if (losCuadrosFiltrados.length === 0) {
                selectLote.innerHTML = '<option value="">Sin lotes en este campo</option>';
                return;
            }

            selectLote.innerHTML = '<option value="">Seleccione Lote...</option>' + 
                losCuadrosFiltrados.map(l => {
                    const etiqueta = l.nombre_lote ? `${l.lote} - ${l.nombre_lote}` : `Lote ${l.lote} (Ha. ${l.sup || 0})`;
                    return `<option value="${l.lote}" data-sup="${l.sup}">${etiqueta}</option>`;
                }).join('');

        } catch (err) {
            console.error("Error al filtrar cuadros:", err);
            selectLote.innerHTML = '<option value="">Error de conexión</option>';
        }
    },

    m_calcular: function() {
        const c = parseFloat(document.getElementById('l_cant').value) || 0;
        const p = parseFloat(document.getElementById('l_precio').value) || 0;
        const total = c * p;
        
        const display = document.getElementById('l_total_display');
        const valHidden = document.getElementById('l_total_val');
        
        if (display) display.innerText = `U$S ${total.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
        if (valHidden) valHidden.value = total;
    },
    
    // ESTO LO MODIFIQUE: Creación local en SQLite para tipos_labores
    m_nuevoTipoLabor: function() {
        const container = document.getElementById('modal-formulario');
        if (!container) return;
        
        const formOriginal = container.innerHTML;
        const rubrosExistentes = [...new Set(this.parametros.labores.map(l => l.rubro).filter(Boolean))];

        container.innerHTML = `
            <div class="form-container-apple animated fadeIn" style="padding:4px; font-family:'Roboto', sans-serif;">
                <div style="background:rgba(30,107,76,0.08); border-left:4px solid #1E6B4C; padding:12px 14px; margin-bottom:14px; border-radius:8px;">
                    <strong style="color:#123F2C; font-size:0.85rem;">NUEVA CATEGORÍA OPERATIVA (BASE LOCAL)</strong>
                    <p style="font-size:0.72rem; margin:3px 0 0 0; color:#6B6255;">El registro se guardará directamente en la tabla maestra <b>tipos_labores</b>.</p>
                </div>
                
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Rubro General (Grupo Cosecha / Siembra / Pulverización)</label>
                        <input type="text" id="input_nuevo_rubro" list="lista-rubros-lab" placeholder="Ej: PULVERIZACIÓN" class="input-filtro-lab" style="text-transform:uppercase;">
                        <datalist id="lista-rubros-lab">
                            ${rubrosExistentes.map(r => `<option value="${r}"></option>`).join('')}
                        </datalist>
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#123F2C; font-weight:800; text-transform:uppercase; display:block; margin-bottom:4px;">Nombre Específico de la Labor</label>
                        <input type="text" id="input_nueva_labor" placeholder="Ej: APLICACIÓN HERBICIDA TOTAL" class="input-filtro-lab" style="text-transform:uppercase; border:1.5px solid #1E6B4C; font-weight:bold;">
                    </div>
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px; border-top:1px solid #E0DCD4; padding-top:12px;">
                    <button type="button" id="btn_cancelar_alta_lab" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:8px 16px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer;">VOLVER</button>
                    <button type="button" id="btn_confirmar_alta_lab" style="background:#1E6B4C; color:#FFFFFF; border:none; padding:8px 18px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer; box-shadow:0 4px 12px rgba(30,107,76,0.25);">CONFIRMAR ALTA</button>
                </div>
            </div>
        `;

        document.getElementById('btn_cancelar_alta_lab').onclick = () => {
            container.innerHTML = formOriginal;
            const btnCancelLocal = document.getElementById('btn-cancelar-operacion-local');
            const btnSaveLocal = document.getElementById('btn-guardar-operacion-local');
            if (btnCancelLocal) btnCancelLocal.onclick = () => document.getElementById('modal-agrosoft').style.display = 'none';
            if (btnSaveLocal) btnSaveLocal.onclick = () => ModuloLabores.m_guardar();
        };

        document.getElementById('btn_confirmar_alta_lab').onclick = async () => {
            const rubro = document.getElementById('input_nuevo_rubro').value.trim().toUpperCase();
            const labor = document.getElementById('input_nueva_labor').value.trim().toUpperCase();

            if (!rubro || !labor) {
                return alert("⚠️ Ambos campos (Rubro y Labor) son obligatorios.");
            }

            try {
                // Regla Max(id_labor) + 1 para tipos_labores en SQLite
                const resMax = await ModuloLabores.m_ejecutarSqlLocal(`SELECT MAX(CAST(id_labor AS INTEGER)) as max_val FROM tipos_labores`);
                const maxVal = (resMax.data && resMax.data[0] && resMax.data[0].max_val) 
                    ? Number(resMax.data[0].max_val) 
                    : (resMax[0] && resMax[0].max_val ? Number(resMax[0].max_val) : 0);
                
                const nuevoIdLabor = maxVal + 1;

                await ModuloLabores.m_ejecutarSqlLocal(
                    `INSERT INTO tipos_labores (id_labor, rubro, labor, sincronizado) VALUES (?, ?, ?, 0)`,
                    [nuevoIdLabor, rubro, labor]
                );

                ModuloLabores.parametros.labores.push({ id_labor: nuevoIdLabor, rubro: rubro, labor: labor });
                
                // Restaurar vista previa y reenganchar eventos
                container.innerHTML = formOriginal;
                const btnCancelLocal = document.getElementById('btn-cancelar-operacion-local');
                const btnSaveLocal = document.getElementById('btn-guardar-operacion-local');
                if (btnCancelLocal) btnCancelLocal.onclick = () => document.getElementById('modal-agrosoft').style.display = 'none';
                if (btnSaveLocal) btnSaveLocal.onclick = () => ModuloLabores.m_guardar();
                
                const select = document.getElementById('l_tipo_labor');
                if (select) {
                    const opt = new Option(labor, labor, true, true);
                    select.add(opt);
                }

                if (window.ComponentesUI && window.ComponentesUI.notificar) {
                    window.ComponentesUI.notificar("✅ Nueva labor guardada en catálogo local.");
                }
            } catch (err) {
                console.error("❌ Error al guardar tipo_labor local:", err);
                alert("Error al registrar en tipos_labores local: " + err.message);
            }
        };

        const inputLabor = document.getElementById('input_nueva_labor');
        if (inputLabor) inputLabor.focus();
    },

    m_restaurarBotoneraPrincipal: function() {
        const btnCancelLocal = document.getElementById('btn-cancelar-operacion-local');
        const btnSaveLocal = document.getElementById('btn-guardar-operacion-local');

        if (btnCancelLocal) btnCancelLocal.onclick = () => document.getElementById('modal-agrosoft').style.display = 'none';
        if (btnSaveLocal) btnSaveLocal.onclick = () => ModuloLabores.m_guardar();
    },
    
    m_uniqueid: function(prefix = '') {
        const timestamp = Date.now().toString(36); 
        const randomPart = Math.random().toString(36).substring(2, 7).toUpperCase(); 
        return `${prefix}${timestamp}-${randomPart}`;
    },

    /**
     * ESTO LO MODIFIQUE / ACA ES LO NUEVO:
     * Guardado 100% Offline en SQLite con Max(reg_local)+1, Max(orden_trab)+1, estado Activo y sincronizado = 0
     */
    m_guardar: async function() {
    const btnSave = document.getElementById('btn-guardar-operacion-local');
    if (btnSave) {
        btnSave.innerText = "GUARDANDO LOCAL...";
        btnSave.disabled = true;
    }

    try {
        const finalRegLocal = "REG-LABORES-" + Date.now();

        // Obtener la orden de trabajo máxima directamente desde la base de datos
        const resMax = await this.m_ejecutarSqlLocal(`
            SELECT MAX(CAST(orden_trab AS INTEGER)) AS max_ot FROM egresos_insumos
        `);
        const rowMax = (resMax.data && resMax.data[0]) || (resMax[0]) || {};
        const maxOrdenTrab = parseInt(rowMax.max_ot, 10) || 0;
        const nuevaOrdenTrab = maxOrdenTrab + 1;

        const precio = parseFloat(document.getElementById('l_precio')?.value) || 0;
        const cantidad = parseFloat(document.getElementById('l_cant')?.value) || 0;
        const totalDolarInput = parseFloat(document.getElementById('l_total_val')?.value) || (precio * cantidad);
        
        const cotizacionInput = document.getElementById('l_coti') || document.getElementById('rec_cot');
        const cotizacion = cotizacionInput ? (parseFloat(cotizacionInput.value) || 1200) : 1200;

        const estVal = document.getElementById('l_est')?.value || '';
        const campoVal = document.getElementById('l_campo')?.value || '';
        const loteVal = document.getElementById('l_lote')?.value || '';
        const laborVal = document.getElementById('l_tipo_labor')?.value || '';
        const fechaVal = document.getElementById('l_fecha')?.value || new Date().toISOString().split('T')[0];
        const obsVal = document.getElementById('l_obs')?.value || '';

        if (!estVal || !laborVal || !loteVal) {
            this.m_mostrarNotificacion("Complete establecimiento, sector y el cuadro correspondiente.", "error");
            return;
        }

        // 23 Columnas (OMITIMOS 'id' para aprovechar AUTOINCREMENT)
        const sqlInsert = `
            INSERT INTO egresos_insumos (
                reg_local, 
                tabla_origen, 
                orden_trab, 
                ref_orden, 
                fecha, 
                establecimiento,
                campo, 
                cuadro, 
                labor, 
                tipo_labor, 
                centro_costo, 
                sup_uso, 
                imp_uni,
                total_dolar, 
                cotizacion, 
                total_pesos, 
                costo_final_ha_dolar, 
                costo_final,
                insumo, 
                deposito_origen, 
                comentario, 
                estado, 
                sincronizado
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `;

        // 23 Parámetros correspondientes
        const paramsInsert = [
            finalRegLocal,
            'LABOR',
            nuevaOrdenTrab,
            0,
            fechaVal,
            estVal,
            campoVal,
            loteVal,
            laborVal,
            laborVal,
            laborVal ? laborVal.toUpperCase() : 'GENERAL',
            cantidad,
            precio,
            totalDolarInput,
            cotizacion,
            parseFloat((totalDolarInput * cotizacion).toFixed(4)),
            precio,
            parseFloat((precio * cantidad).toFixed(4)),
            'MANO DE OBRA / SERVICIO DIRECTO',
            'CAMPO',
            obsVal,
            'ACTIVO'
        ];

        await this.m_ejecutarSqlLocal(sqlInsert, paramsInsert);
        
        this.m_mostrarNotificacion("Labor de campo sincronizada con éxito en base local.", "exito");

        const modalBox = document.getElementById('modal-agrosoft');
        if (modalBox) modalBox.style.display = 'none';
        
        await this.m_inicializar();

    } catch (err) {
        console.error("❌ Error en persistencia local de Labor de Campo:", err);
        this.m_mostrarNotificacion("Error al guardar localmente en egresos_insumos: " + err.message, "error");
    } finally {
        if (btnSave) {
            btnSave.innerText = "GUARDAR OPERACIÓN";
            btnSave.disabled = false;
        }
    }
},
    m_verDetalleLaborVoucher: function(id) {
        this.m_asegurarModalBase();
        const l = this.parametros.egresos.find(item => String(item.id) === String(id) || String(item.reg_local) === String(id));
        if (!l) return;

        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        const footerAcciones = document.getElementById('modal-acciones-footer');
        const tituloComponente = document.getElementById('modal-titulo');
        
        if (modal) modal.style.display = 'flex';

        if (footerAcciones) footerAcciones.style.display = 'none'; 

        if (tituloComponente) {
            tituloComponente.innerText = `CONSULTA DE CERTIFICACIÓN DE LABOR`;
            tituloComponente.style.color = '#0071E3';
        }

        const modalContent = document.querySelector('.modal-apple-content');
        if (modalContent) modalContent.style.maxWidth = '850px';

        if (container) {
            container.innerHTML = `
                <div style="background:#FFFFFF; color:#1D1D1F; border-radius:14px; padding:20px; font-family:'Roboto', sans-serif;">
                    <div style="display:flex; justify-content:space-between; border-bottom:2px dashed #E4E7EC; padding-bottom:15px; margin-bottom:20px;">
                        <div style="display:flex; gap:12px; align-items:center;">
                            <!-- ESTO LO MODIFIQUE: Logo 3x3 -->
                            <div style="width:3in; height:3in; max-width:65px; max-height:65px; background:#F6F7F9; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:8px; font-weight:900; color:#0071E3; border:1px solid #E4E7EC; text-align:center; line-height:1.1;">
                                AGROSOFT<br>J&L<br>3x3
                            </div>
                            <div>
                                <h3 style="margin:0; font-size:1.1rem; font-weight:900; color:#1D1D1F; letter-spacing:-0.5px;">AGROSOFT J&L S.A.</h3>
                                <span style="font-size:0.7rem; color:#6E6E73; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Ecosystem Operations Terminal</span>
                            </div>
                        </div>
                        <div style="text-align:right;">
                            <span style="background:#0071E3; color:#FFFFFF; padding:3px 10px; border-radius:6px; font-size:0.65rem; font-weight:800; letter-spacing:0.5px; display:inline-block; margin-bottom:6px;">ORDEN INTERNA DE SERVICIO</span>
                            <h4 style="margin:0; font-size:1.1rem; font-weight:900; color:#1D1D1F;">COMPROBANTE LABOR #LAB-${l.id}</h4>
                            <small style="color:#6E6E73; font-weight:500;">Fecha Ejecución: ${l.fecha}</small>
                        </div>
                    </div>

                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:20px; font-size:0.8rem;">
                        <div style="background:#F6F7F9; padding:12px; border-radius:10px; border:1px solid #E4E7EC;">
                            <span style="font-size:0.6rem; color:#6E6E73; font-weight:700; display:block; margin-bottom:6px; text-transform:uppercase;">Ubicación Geográfica Campo</span>
                            <strong>Establecimiento:</strong> ${l.establecimiento}<br>
                            <strong>Campo / Sector:</strong> ${l.campo || '---'}<br>
                            <strong>Cuadro Físico:</strong> Cuadro N° ${l.cuadro}
                        </div>
                        <div style="background:#F6F7F9; padding:12px; border-radius:10px; border:1px solid #E4E7EC;">
                            <span style="font-size:0.6rem; color:#6E6E73; font-weight:700; display:block; margin-bottom:6px; text-transform:uppercase;">Trazabilidad Contable</span>
                            <strong>Registro Local (PKEY):</strong> ${l.reg_local}<br>
                            <!-- ESTO LO MODIFIQUE: Siempre muestra del detalle el estado activo -->
                            <strong>Estado de Fila:</strong> <span class="badge-estado-activo">ACTIVO</span><br>
                            <strong>Detalle Auxiliar:</strong> ${l.comentario || 'Sin anotaciones de campo.'}
                        </div>
                    </div>

                    <table style="width:100%; border-collapse:collapse; font-size:0.8rem; margin-bottom:20px; text-align:left;">
                        <thead>
                            <tr style="background:#F6F7F9; border-bottom:2px solid #E4E7EC;">
                                <th style="padding:10px;">CONCEPTO OPERATIVO EJECUTADO</th>
                                <th style="text-align:right; padding:10px;">VOLUMEN TRABAJADO</th>
                                <th style="text-align:right; padding:10px;">PRECIO UNITARIO TARIFA</th>
                                <th style="text-align:right; padding:10px;">TOTAL INVERSIÓN</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr style="border-bottom:1px solid #E4E7EC;">
                                <td style="padding:12px 10px;">🚜 <strong style="color:#1D1D1F;">SERVICIOS AGRÍCOLAS COMUNES: ${(l.tipo_labor || l.labor || '').toUpperCase()}</strong></td>
                                <td style="text-align:right; padding:12px 10px; font-weight:600;">${Number(l.sup_uso).toLocaleString('es-AR')} Ha/Kg</td>
                                <td style="text-align:right; padding:12px 10px;">U$S ${Number(l.imp_uni).toFixed(2)}</td>
                                <td style="text-align:right; padding:12px 10px; font-weight:900; color:#1FA958; font-size:0.85rem;">U$S ${Number(l.total_dolar).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                            </tr>
                        </tbody>
                    </table>

                    <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px; border-top:1px solid #E4E7EC; padding-top:15px;">
                        <button onclick="ModuloLabores.m_exportarVoucherExcel('${l.id}')" style="background:#1FA958; color:#FFFFFF; border:none; padding:8px 14px; border-radius:6px; font-weight:700; font-size:0.75rem; cursor:pointer; font-family:'Roboto';">
                            📊 EXCEL COMPROBANTE
                        </button>
                        <button onclick="ModuloLabores.m_imprimirVoucherPDF('${l.id}')" style="background:#0071E3; color:#FFFFFF; border:none; padding:8px 14px; border-radius:6px; font-weight:700; font-size:0.75rem; cursor:pointer; font-family:'Roboto';">
                            🖨️ IMPRIMIR VOUCHER (PDF)
                        </button>
                        <button onclick="document.getElementById('modal-agrosoft').style.display='none';" style="background:#F0F2F5; color:#1D1D1F; border:none; padding:8px 14px; border-radius:6px; font-weight:700; font-size:0.75rem; cursor:pointer; font-family:'Roboto';">
                            VOLVER
                        </button>
                    </div>
                </div>`;
        }
    },

    m_exportarVoucherExcel: function(id) {
        const l = this.parametros.egresos.find(item => String(item.id) === String(id) || String(item.reg_local) === String(id));
        if (!l) return;

        const headers = ["PARAMETRO LABOR", "VALOR COMPUTADO"];
        const filas = [
            ["ID LABOR REGISTRO", l.id],
            ["REGISTRO LOCAL", l.reg_local],
            ["FECHA", l.fecha],
            ["ESTABLECIMIENTO", l.establecimiento],
            ["CAMPO SECTOR", l.campo || ''],
            ["CUADRO CODIGO", l.cuadro],
            ["TABLA ORIGEN", l.tabla_origen],
            ["CONCEPTO LABOR", l.tipo_labor || l.labor],
            ["CANTIDAD OPERADA (SUP_USO)", l.sup_uso],
            ["TARIFA UNITARIA USD (IMP_UNI)", l.imp_uni],
            ["TOTAL NETO USD", l.total_dolar],
            ["TRAZABILIDAD OBSERVACIONES", l.comentario || ''],
            ["ESTADO", "ACTIVO"]
        ];

        let csvContent = "\uFEFF" + headers.join(";") + "\n";
        filas.forEach(f => { csvContent += f.join(";") + "\n"; });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.setAttribute("download", `AgroSoft_Comprobante_Labor_${l.id}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    m_imprimirVoucherPDF: function(id) {
        const l = this.parametros.egresos.find(item => String(item.id) === String(id) || String(item.reg_local) === String(id));
        if (!l) return;

        const ventanaImpresion = window.open('', '_blank');
        ventanaImpresion.document.write(`
            <html>
            <head>
                <title>Comprobante Labor #LAB-${l.id}</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap');
                    body { font-family: 'Roboto', sans-serif; padding: 40px; color: #1D1D1F; background:#FFFFFF; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    .remito-box { border: 2px solid #E4E7EC; border-radius: 12px; padding: 25px; }
                    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                    th { background: #F6F7F9; padding: 10px; font-weight: bold; border-bottom: 2px solid #E4E7EC; text-align: left; font-size:12px; }
                    td { padding: 12px 10px; border-bottom: 1px solid #E4E7EC; font-size:12px; }
                </style>
            </head>
            <body>
                <div class="remito-box">
                    <div style="display:flex; justify-content:space-between; border-bottom:2px dashed #E4E7EC; padding-bottom:15px; margin-bottom:20px;">
                        <div>
                            <h2 style="margin:0; font-size:1.3rem; font-weight:900;">AGROSOFT J&L S.A.</h2>
                            <small style="color:#6E6E73; font-weight:bold;">SISTEMA CENTRAL DE AUDITORÍA OPERATIVA (SQLITE LOCAL)</small>
                        </div>
                        <div style="text-align:right;">
                            <span style="background:#0071E3; color:#FFF; padding:2px 8px; border-radius:4px; font-size:10px; font-weight:bold;">ORDEN INTERNA DE COMPROBACIÓN</span>
                            <h3 style="margin:5px 0 0 0; color:#0071E3; font-size:1.2rem;">LABOR N° LAB-${l.id}</h3>
                            <small>Fecha Ejecución: ${l.fecha}</small>
                        </div>
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px; font-size:12px; margin-bottom:20px;">
                        <div style="background:#F6F7F9; padding:10px; border-radius:8px;">
                            <strong>TERRITORIO TRATADO:</strong><br>
                            Establecimiento: <b>${l.establecimiento}</b><br>
                            Campo / Sector: <b>${l.campo || '---'}</b><br>
                            Ubicación: <b>Cuadro N° ${l.cuadro}</b>
                        </div>
                        <div style="background:#F6F7F9; padding:10px; border-radius:8px;">
                            <strong>TRAZABILIDAD Y COMENTARIOS:</strong><br>
                            Concepto: <b>${l.tipo_labor || l.labor}</b><br>
                            Estado Operación: <b>ACTIVO</b><br>
                            Detalle: <b>${l.comentario || 'Sin especificaciones.'}</b>
                        </div>
                    </div>

                    <table>
                        <thead>
                            <tr>
                                <th>DESCRIPCIÓN DE LA TAREA AGRÍCOLA</th>
                                <th style="text-align:right;">VOLUMEN (HA/KG)</th>
                                <th style="text-align:right;">TARIFA BASE USD</th>
                                <th style="text-align:right;">SUBTOTAL LIQUIDADO</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td><b>SERVICIO MECÁNICO CENTRAL EN INMUEBLE RURAL</b></td>
                                <td style="text-align:right;">${Number(l.sup_uso).toLocaleString('es-AR')}</td>
                                <td style="text-align:right; font-family:monospace;">U$S ${Number(l.imp_uni).toFixed(2)}</td>
                                <td style="text-align:right; font-weight:900; color:#1FA958;">U$S ${Number(l.total_dolar).toLocaleString('en-US', {minimumFractionDigits:2})}</td>
                            </tr>
                        </tbody>
                    </table>

                    <div style="text-align:right; margin-top:20px; background:#F6F7F9; padding:15px; border-radius:8px;">
                        <span style="font-size:11px; color:#6E6E73;">VALORIZACIÓN DE EGRESO TOTAL EXTRANJERA (USD)</span>
                        <h2 style="margin:5px 0 0 0; color:#1FA958; font-size:1.5rem; font-weight:900;">U$S ${Number(l.total_dolar).toLocaleString('en-US', {minimumFractionDigits:2})} USD</h2>
                    </div>

                    <div style="margin-top:70px; border-top:1px solid #E4E7EC; padding-top:15px; display:flex; justify-content:space-between; font-size:10px; color:#6E6E73;">
                        <span>AgroSoft J&L &bull; Módulo Labores</span>
                        <span style="font-weight:bold; color:#1D1D1F;">Firma de Conformidad Encargado de Campo: ___________________________</span>
                    </div>
                </div>
                <script>
                    window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); }
                <\/script>
            </body>
            </html>
        `);
        ventanaImpresion.document.close();
    },

    m_exportarExcelGlobal: function() {
        if (this.parametros.egresos.length === 0) return this.m_mostrarNotificacion("No hay labores operadas en la grilla para exportar.", "error");

        const headers = ["ID OPERACIÓN", "REG_LOCAL", "FECHA", "ESTABLECIMIENTO", "CAMPO SECTOR", "CUADRO / LOTE", "TIPO MOVIMIENTO", "LABOR EJECUTADA", "CANTIDAD (HA/KG)", "TARIFA USD", "TOTAL USD", "OBSERVACIONES TRAZABILIDAD", "ESTADO"];
        let csvContent = "\uFEFF" + headers.join(";") + "\n";

        this.parametros.egresos.forEach(l => {
            const fila = [
                l.id, l.reg_local, l.fecha, `"${l.establecimiento}"`, `"${l.campo || ''}"`, l.cuadro, `"${l.tabla_origen}"`,
                `"${l.tipo_labor || l.labor}"`, l.sup_uso, l.imp_uni, l.total_dolar, `"${l.comentario || ''}"`, `"ACTIVO"`
            ];
            csvContent += fila.join(";") + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.setAttribute("download", `AgroSoft_Sabana_Labores_Campo_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    m_exportarPDFGlobal: function() {
        if (this.parametros.egresos.length === 0) return this.m_mostrarNotificacion("No hay registros operativos para liquidar auditoría gráfica.", "error");

        const costeoPorEstablecimiento = {};
        const hectareasPorLabor = {};

        this.parametros.egresos.forEach(l => {
            const inversion = parseFloat(l.total_dolar || 0);
            const volumen = parseFloat(l.sup_uso || 0);
            costeoPorEstablecimiento[l.establecimiento] = (costeoPorEstablecimiento[l.establecimiento] || 0) + inversion;
            const conceptoKey = l.tipo_labor || l.labor || 'S/D';
            hectareasPorLabor[conceptoKey] = (hectareasPorLabor[conceptoKey] || 0) + volumen;
        });

        let svgEst3D = `<svg width="100%" height="160" style="background:#F6F7F9; border:1px solid #E4E7EC; border-radius:14px; padding:20px;">`;
        let yE = 35;
        Object.entries(costeoPorEstablecimiento).slice(0, 4).forEach(([est, cash]) => {
            const maxW = 350;
            const barW = Math.max(15, Math.min((cash / 50000) * maxW, maxW));
            svgEst3D += `
                <text x="20" y="${yE + 13}" font-family="sans-serif" font-size="11" font-weight="700" fill="#1D1D1F">${est.toUpperCase()}</text>
                <polygon points="${130},${yE} ${130 + barW},${yE} ${134 + barW},${yE - 5} ${134},${yE - 5}" fill="#0071E3" opacity="0.75" />
                <rect x="130" y="${yE}" width="${barW}" height="14" fill="#0071E3" />
                <polygon points="${130 + barW},${yE} ${134 + barW},${yE - 5} ${134 + barW},${yE + 9} ${130 + barW},${yE + 14}" fill="#0055AB" />
                <text x="${145 + barW}" y="${yE + 12}" font-family="sans-serif" font-size="11" font-weight="700" fill="#0071E3">U$S ${cash.toLocaleString('en-US')}</text>
            `;
            yE += 32;
        });
        svgEst3D += `</svg>`;

        let svgLab3D = `<svg width="100%" height="160" style="background:#F6F7F9; border:1px solid #E4E7EC; border-radius:14px; padding:20px;">`;
        let yL = 35;
        Object.entries(hectareasPorLabor).slice(0, 4).forEach(([lab, has]) => {
            const maxW = 350;
            const barW = Math.max(15, Math.min((has / 5000) * maxW, maxW));
            svgLab3D += `
                <text x="20" y="${yL + 13}" font-family="sans-serif" font-size="11" font-weight="700" fill="#1D1D1F">${lab.toUpperCase().slice(0, 14)}</text>
                <polygon points="${130},${yL} ${130 + barW},${yL} ${134 + barW},${yL - 5} ${134},${yL - 5}" fill="#1FA958" opacity="0.75" />
                <rect x="130" y="${yL}" width="${barW}" height="14" fill="#1FA958" />
                <polygon points="${130 + barW},${yL} ${134 + barW},${yL - 5} ${134 + barW},${yL + 9} ${130 + barW},${yL + 14}" fill="#17914A" />
                <text x="${145 + barW}" y="${yL + 12}" font-family="sans-serif" font-size="11" font-weight="700" fill="#1FA958">${has.toLocaleString('es-AR')} Ha/Kg</text>
            `;
            yL += 32;
        });
        svgLab3D += `</svg>`;

        const ventanaImpresion = window.open('', '_blank');
        ventanaImpresion.document.write(`
            <html>
            <head>
                <title>AgroSoft J&L - Consolidado Central Labores</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap');
                    body { font-family: 'Roboto', sans-serif; color: #1D1D1F; padding: 40px; margin: 0; background: #FFFFFF; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    .header-pdf-premium { border-bottom: 3px solid #0071E3; padding-bottom: 15px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: flex-start; }
                    .logo-container-apple { width: 3in; height: 3in; border: 1px solid #E4E7EC; background: #F6F7F9; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #6E6E73; font-weight: bold; text-align: center; border-radius: 12px; margin-right: 20px; }
                    .logo-container-apple img { width: 100%; height: 100%; object-fit: contain; border-radius: 11px; }
                    .titulos-reporte { flex: 1; }
                    .titulos-reporte h1 { margin: 0; font-size: 18px; font-weight: 900; color: #1D1D1F; letter-spacing: -0.5px; }
                    .titulos-reporte h2 { margin: 4px 0 0 0; font-size: 11px; color: #0071E3; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
                    .metadata-impresion { text-align: right; font-size: 11px; color: #6E6E73; line-height: 1.5; }
                    .seccion-grafica { margin-bottom: 25px; page-break-inside: avoid; }
                    .seccion-grafica h4 { font-size: 11px; font-weight: 800; color: #1D1D1F; margin: 0 0 10px 0; letter-spacing: 0.5px; text-transform: uppercase; }
                    table { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 10px; }
                    tr { page-break-inside: avoid; }
                    th { background: #F6F7F9; color: #1D1D1F; text-align: left; padding: 8px; font-weight: 700; border-bottom: 2px solid #E4E7EC; }
                    td { padding: 8px; border-bottom: 1px solid #E4E7EC; color: #1D1D1F; font-weight: 500; }
                    .footer-firma-fija { margin-top: 60px; border-top: 1px solid #E4E7EC; padding-top: 15px; display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: #6E6E73; page-break-inside: avoid; }
                </style>
            </head>
            <body>
                <div class="header-pdf-premium">
                    <div class="logo-container-apple" id="wrapper-logo-dinamico">
                        AGROSOFT J&L<br>LOGO OFICIAL<br>3x3 PULGADAS
                    </div>
                    <div class="titulos-reporte">
                        <h2>AgroSoft J&L &bull; Intel Intelligence Ecosystem</h2>
                        <h1>Libro de Gestión Operativa de Labores</h1>
                    </div>
                    <div class="metadata-impresion">
                        <strong>EMISIÓN:</strong> ${new Date().toLocaleDateString('es-AR')}<br>
                        <strong>VOLUMEN INVERSIÓN:</strong> U$S ${this.parametros.egresos.reduce((a,c)=>a+parseFloat(c.total_dolar||0),0).toLocaleString('en-US')}<br>
                        <strong>REGISTROS:</strong> ${this.parametros.egresos.length} Órdenes
                    </div>
                </div>

                <div class="seccion-grafica">
                    <h4>■ FLUJO OPERATIVO FINANCIERO 3D POR ESTABLECIMIENTO (USD)</h4>
                    ${svgEst3D}
                </div>

                <div class="seccion-grafica">
                    <h4>■ DOSIFICACIÓN Y CUBICAJE NETO EN HA/KG POR LABOR</h4>
                    ${svgLab3D}
                </div>

                <h4>■ HOJA DE RUTA CONTABLE COMPROBANTES DE LABORES</h4>
                <table>
                    <thead>
                        <tr>
                            <th>REGISTRO N°</th>
                            <th>REG_LOCAL</th>
                            <th>FECHA</th>
                            <th>ESTABLECIMIENTO</th>
                            <th>CAMPO / CUADRO</th>
                            <th>CONCEPTO LABOR</th>
                            <th style="text-align:right;">CANTIDAD (HA/KG)</th>
                            <th style="text-align:right;">INVERSIÓN TOTAL USD</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.parametros.egresos.map(l => `
                            <tr>
                                <td><b>LAB-${l.id}</b></td>
                                <td>${l.reg_local}</td>
                                <td>${l.fecha}</td>
                                <td><strong>${l.establecimiento}</strong></td>
                                <td>${l.campo || '---'} &bull; <span style="color:#6E6E73; font-weight:700;">Cuadro ${l.cuadro}</span></td>
                                <td><span style="background:#F0F2F5; padding:2px 5px; border-radius:4px; font-weight:bold;">${l.tipo_labor || l.labor}</span></td>
                                <td style="text-align:right;">${Number(l.sup_uso).toLocaleString('es-AR')}</td>
                                <td style="text-align:right; font-weight:900; color:#1FA958;">U$S ${Number(l.total_dolar).toLocaleString('en-US', {minimumFractionDigits:2})}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>
                <div class="footer-firma-fija"><span>AgroSoft J&L &bull; Auditoría Interna Campaña (base Local)</span><span>Firma Responsable Administración Finca: ___________________________</span></div>
                <script>window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); }</script>
            </body>
            </html>
        `);
        ventanaImpresion.document.close();
    }
};

window.ModuloLabores = ModuloLabores;