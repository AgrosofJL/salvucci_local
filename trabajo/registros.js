/**
 * ModuloRegistracion: Panel Maestro de Registración y Ruteo Operativo
 * AgroSoft J&L - "Apple Soft Studio" Edition / Tipografía Roboto
 * Mode: Local-First (Engine SQLite IPC) + "No me quites nada" + sincronizado = 0
 */
const ModuloRegistracion = {
    parametros: {
        depositos: [], 
        insumos: [], 
        contratistas: [], 
        labores: [], 
        gastos: []
    },

    // ESTO LO MODIFIQUE / ACA ES LO NUEVO: Helper IPC para ejecutar SQL en la base SQLite local
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
                <div id="modal-agrosoft" class="modal-overlay" style="display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(18, 22, 28, 0.48); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); z-index: 99999; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box;">
                    <div class="modal-apple-content" id="modal-size-ctx" style="background: #FFFFFF; border: 1px solid #E4E7EC; border-radius: 14px; padding: 22px 26px; width: 95%; max-width: 1100px; color: #1D1D1F; box-shadow: 0 9px 21px rgba(20,26,36,0.25); display: flex; flex-direction: column; position: relative;">
                        <div class="modal-header-apple" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid #E4E7EC; padding-bottom: 12px;">
                            <h3 id="modal-titulo" style="margin: 0; font-size: 1.1rem; font-weight: bold; font-family: 'Roboto', sans-serif; color: #0071E3;">GESTIÓN TÉCNICA</h3>
                            <button onclick="ModuloRegistracion.m_cerrarModal()" class="btn-close-soft" style="background: #F0F2F5; border: none; color: #1D1D1F; font-size: 1.2rem; cursor: pointer; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-weight: bold;">×</button>
                        </div>
                        <div id="modal-formulario" style="max-height:75vh; overflow-y:auto; padding-right: 4px;" class="scroll-apple"></div>
                        <div class="modal-footer-apple" id="modal-footer-dinamico" style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; border-top: 1px solid #E4E7EC; padding-top: 14px;"></div>
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

    m_cerrarModal: function() {
        const m = document.getElementById('modal-agrosoft');
        if(m) m.style.display = 'none';
    },

    /**
     * ESTO LO MODIFIQUE: Carga 100% Offline de tablas maestras desde SQLite local
     */
    m_inicializar: async function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;
        visor.innerHTML = `<div class="loader-apple" style="font-family:'Roboto', sans-serif; text-align:center; padding:50px; color:#0071E3; font-weight:600; letter-spacing:0.3px;">Sincronizando Tablas Maestras desde base local...</div>`;

        try {
            const [resDep, resIns, resCon, resLab, resGas] = await Promise.all([
                this.m_ejecutarSqlLocal(`SELECT * FROM depositos ORDER BY deposito ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM insumos ORDER BY articulo ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM contratistas ORDER BY contratista ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM tipos_labores ORDER BY labor ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM tipos_gastos ORDER BY nombre_gasto ASC`)
            ]);

            this.parametros = {
                depositos: resDep.data || resDep || [],
                insumos: resIns.data || resIns || [],
                contratistas: resCon.data || resCon || [],
                labores: resLab.data || resLab || [],
                gastos: resGas.data || resGas || []
            };

            this.m_dibujarSelectorInicial();
        } catch (err) {
            console.error("Error al inicializar ModuloRegistracion Local:", err);
            visor.innerHTML = `<div class="error-soft" style="color:#E0342A; padding:20px; font-family:'Roboto'; border: 1px solid rgba(224,52,42,0.2); background: rgba(224,52,42,0.04); border-radius: 12px;">Error cargando maestros locales: ${err.message}</div>`;
        }
    },

    /* ACA ES LO NUEVO: Se incorpora botón de Sincronización Global en la cabecera superior y contenedor para historial */
    m_dibujarSelectorInicial: function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;
        
        const estilosCards = `
            <style>
                .grid-contenedor-apple {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                    gap: 20px;
                    padding: 10px 0 20px 0;
                }
                .card-apple-item {
                    background: #FFFFFF;
                    border: 1px solid #E4E7EC;
                    border-radius: 14px;
                    padding: 25px;
                    display: flex;
                    flex-direction: column;
                    align-items: flex-start;
                    transition: all 0.35s cubic-bezier(0.165, 0.84, 0.44, 1);
                    cursor: pointer;
                    position: relative;
                    overflow: hidden;
                    box-shadow: 0 2px 8px rgba(20,26,36,0.06);
                }
                .card-apple-item:hover {
                    transform: translateY(-8px);
                    border-color: #D6DAE1;
                    box-shadow: 0 7px 14px rgba(20,26,36,0.14);
                }
                .card-apple-item:active {
                    transform: scale(0.97);
                }
                .icon-box {
                    width: 50px;
                    height: 50px;
                    border-radius: 14px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-bottom: 15px;
                    box-shadow: 0 8px 16px rgba(20,26,36,0.16);
                }
                .card-apple-item h4 { margin: 0; font-size: 1.1rem; font-weight: 700; letter-spacing: 0.3px; color: #1D1D1F; }
                .card-apple-item p { margin: 5px 0 0 0; font-size: 0.85rem; color: #6E6E73; line-height: 1.3; }
                .arrow-link { position: absolute; bottom: 20px; right: 20px; color: #9AA0A6; opacity: 0.6; transition: 0.3s; }
                .card-apple-item:hover .arrow-link { opacity: 1; color: #0071E3; transform: translateX(5px); }

                .tabla-resumen-apple {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 0.8rem;
                    text-align: left;
                    font-family: 'Roboto', sans-serif;
                }
                .tabla-resumen-apple th {
                    padding: 10px 12px;
                    color: #6E6E73;
                    font-weight: 700;
                    font-size: 0.68rem;
                    text-transform: uppercase;
                    border-bottom: 2px solid #E4E7EC;
                    background: #F6F7F9;
                }
                .tabla-resumen-apple td {
                    padding: 10px 12px;
                    border-bottom: 1px solid #EEF0F3;
                    vertical-align: middle;
                }
                .badge-soft {
                    padding: 3px 8px;
                    border-radius: 10px;
                    font-size: 0.65rem;
                    font-weight: 800;
                    display: inline-block;
                }
                .bg-green { background: rgba(31,169,88,0.1); color: #1FA958; }
                .bg-blue { background: rgba(0,113,227,0.1); color: #0071E3; }
                .btn-mini-soft {
                    background: #F0F2F5;
                    border: 1px solid #E4E7EC;
                    padding: 4px 8px;
                    border-radius: 6px;
                    cursor: pointer;
                    color: #0071E3;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s;
                }
                .btn-mini-soft:hover {
                    background: rgba(0,113,227,0.1);
                    border-color: #0071E3;
                }
            </style>
        `;

        visor.innerHTML = estilosCards + `
            ${ComponentesUI.botonVolverHTML('LABORES')}
            <div class="modulo-header animated fadeIn" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; flex-wrap:wrap; gap:10px;">
                <div>
                    <h2 style="margin:0; font-weight:700; font-size:1.5rem; letter-spacing:-0.5px; color:#1D1D1F;">Panel de Registración</h2>
                    <p style="margin:4px 0 0 0; font-size:0.8rem; color:#6E6E73;">Gestión por tarjetas inteligentes (Engine base Local)</p>
                </div>

            </div>

            <div class="grid-contenedor-apple animated fadeInUp">

                <div class="card-apple-item" onclick="ModuloRegistracion.m_rutear('ORDEN TRABAJO')">
                    <div class="icon-box" style="background: linear-gradient(135deg, #007AFF, #00C6FF);">
                        <i data-lucide="tractor" style="color:white"></i>
                    </div>
                    <h4>ORDEN TRABAJO</h4>
                    <p>Registrar nuevas tareas de campo y equipos.</p>
                    <div class="arrow-link"><i data-lucide="arrow-right"></i></div>
                </div>

                <div class="card-apple-item" onclick="ModuloRegistracion.m_rutear('LABORES')">
                    <div class="icon-box" style="background: linear-gradient(135deg, #FF9500, #FFCC00);">
                        <i data-lucide="settings" style="color:white"></i>
                    </div>
                    <h4>LABORES</h4>
                    <p>Control de cosecha, siembra y movimientos.</p>
                    <div class="arrow-link"><i data-lucide="arrow-right"></i></div>
                </div>

                <div class="card-apple-item" onclick="ModuloRegistracion.m_rutear('OTROS GASTOS ADM')">
                    <div class="icon-box" style="background: linear-gradient(135deg, #34C759, #32E0C4);">
                        <i data-lucide="receipt" style="color:white"></i>
                    </div>
                    <h4>GASTOS ADM</h4>
                    <p>Administración de facturas, viáticos y fijos.</p>
                    <div class="arrow-link"><i data-lucide="arrow-right"></i></div>
                </div>

                <div class="card-apple-item" onclick="ModuloRegistracion.m_rutear('BAJA CONSUMO')">
                    <div class="icon-box" style="background: linear-gradient(135deg, #FF3B30, #FF2D55);">
                        <i data-lucide="trending-down" style="color:white"></i>
                    </div>
                    <h4>BAJA CONSUMO</h4>
                    <p>Salida directa de stock y ajustes de depósito.</p>
                    <div class="arrow-link"><i data-lucide="arrow-right"></i></div>
                </div>

            </div>

            <!-- CONTENEDOR DE HISTORIAL RESUMEN -->
            <div class="card-soft-main animated fadeInUp" style="background:#FFFFFF; border:1px solid #E4E7EC; border-radius:14px; padding:18px; box-shadow:0 2px 8px rgba(20,26,36,0.04); margin-top:10px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                    <span style="font-size:0.8rem; font-weight:800; color:#1D1D1F; letter-spacing:0.3px; text-transform:uppercase;">Últimos Movimientos Registrados</span>
                    <span style="font-size:0.68rem; color:#6E6E73; font-weight:600;">Historial Local</span>
                </div>
                <div style="overflow-x:auto;">
                    <table class="tabla-resumen-apple">
                        <thead>
                            <tr>
                                <th>Fecha</th>
                                <th>Tipo Operación</th>
                                <th>Concepto / Insumo</th>
                                <th style="text-align:right;">Monto Total</th>
                                <th style="text-align:center; width:60px;">Acción</th>
                            </tr>
                        </thead>
                        <tbody id="tbody-resumen-registros">
                            <tr><td colspan="5" style="text-align:center; padding:20px; color:#9AA0A6;">Cargando movimientos recientes...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        
        if (window.lucide) lucide.createIcons();
        this.m_cargarHistorialResumen();
    },

    /**
     * ESTO LO MODIFIQUE: Consulta directa a SQLite local para egresos_insumos recientes
     */
    m_cargarHistorialResumen: async function() {
        const tbody = document.getElementById('tbody-resumen-registros');
        if (!tbody) return;

        try {
            const res = await this.m_ejecutarSqlLocal(
                `SELECT fecha, tipo_labor, insumo, total_dolar, establecimiento FROM egresos_insumos ORDER BY fecha DESC LIMIT 6`
            );
            const data = res.data || res || [];

            if (!data || data.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:#9AA0A6;">No hay registros recientes en la base local.</td></tr>`;
                return;
            }

            tbody.innerHTML = data.map(reg => {
                let badgeStyle = reg.tipo_labor === 'OTROS GASTOS ADM' ? 'bg-green' : 'bg-blue';
                return `
                    <tr style="border-bottom:1px solid #EEF0F3; transition: background 0.15s;" onmouseover="this.style.background='#F9FAFB'" onmouseout="this.style.background='transparent'">
                        <td><b>${reg.fecha || '-'}</b></td>
                        <td><span class="badge-soft ${badgeStyle}">${reg.tipo_labor || 'GENERAL'}</span></td>
                        <td>
                            <div style="display:flex; flex-direction:column;">
                                <strong style="color:#1D1D1F;">${reg.insumo || 'Sin detalle'}</strong>
                                <small style="color:#6E6E73; font-size:0.7rem;">${reg.establecimiento || 'General'}</small>
                            </div>
                        </td>
                        <td style="text-align:right; font-weight:800; color:#1FA958;">U$S ${Number(reg.total_dolar || 0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                        <td style="text-align:center;">
                            <button class="btn-mini-soft" onclick="ModuloRegistracion.m_rutear('${reg.tipo_labor}')" title="Ir a ${reg.tipo_labor}">
                                <i data-lucide="arrow-up-right" style="width:13px; height:13px;"></i>
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
            
            if (window.lucide) lucide.createIcons();
        } catch (err) {
            console.error("Error historial local:", err);
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#E0342A; padding:15px;">Error al consultar base local : ${err.message}</td></tr>`;
        }
    },

    m_rutear: function(tipo) {
        document.querySelectorAll('[id^="modal-agrosoft"]').forEach(el => el.remove());

        switch (tipo) {
            case 'OTROS GASTOS ADM':
                ModuloGastosAdm.parametros.gastos = this.parametros.gastos;
                ModuloGastosAdm.parametros.campos = this.parametros.depositos;
                ModuloGastosAdm.m_inicializar(); 
                break;
            case 'LABORES':
                ModuloLabores.parametros.insumos = this.parametros.insumos;
                ModuloLabores.parametros.labores = this.parametros.labores;
                ModuloLabores.m_inicializar(); 
                break;
            case 'ORDEN TRABAJO':
                ModuloOrdenes.m_inicializar();
                break;
            case 'BAJA CONSUMO':
                if (typeof PaginaBajaInsumos !== 'undefined' && PaginaBajaInsumos.m_inicializar) {
                    PaginaBajaInsumos.m_inicializar();
                } else if (typeof ModuloEgresos !== 'undefined' && ModuloEgresos.m_inicializar) {
                    ModuloEgresos.m_inicializar();
                }
                break;
            default:
                console.log("Módulo en desarrollo:", tipo);
                break;
        }
    }
};

window.ModuloRegistracion = ModuloRegistracion;