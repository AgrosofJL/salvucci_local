/**
 * ModuloStock: Panel de Auditoría Volumétrica e Inventario Real por Establecimiento
 * AgroSoft J&L - "Apple Soft Studio" Edition / Roboto Font Unificada
 * Mode: Local-First (Engine SQLite IPC) + "No me quites nada" + Max(registro)+1 + sincronizado = 0
 */
const ModuloStock = {
    datosSilos: [],
    datosEgresos: [],
    listaAcopioCalculado: [], 
    filtroEstablecimiento: 'TODOS', 
    filtroInfraestructura: 'TODOS', 
    filtroCultivo: 'TODOS',

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

    /* ESTO LO MODIFIQUE: Carga 100% Offline desde SQLite local */
    m_inicializar: async function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;
        visor.innerHTML = `<div class="loader-apple" style="font-family: 'Roboto', sans-serif; text-align: center; padding: 50px; color: #0071e3; font-weight: 500;">Calculando balances y volumetrías desde base local...</div>`;

        try {
            const [resSilos, resEgresos] = await Promise.all([
                this.m_ejecutarSqlLocal(`SELECT * FROM acopio_produccion`),
                this.m_ejecutarSqlLocal(`SELECT * FROM egresos_forraje`)
            ]);

            this.datosSilos = resSilos.data || resSilos || [];
            this.datosEgresos = resEgresos.data || resEgresos || [];

            this.listaAcopioCalculado = this.datosSilos.map(s => {
                const egresadoSilo = this.datosEgresos
                    .filter(e => e.deposito !== null && e.deposito !== undefined && String(e.deposito).trim() === String(s.registro_aco).trim() && (e.estado || 'Activo').toUpperCase() === 'ACTIVO')
                    .reduce((acc, curr) => acc + (Number(curr.kilos) || 0), 0);
                const neto = Math.max(0, (Number(s.kg_en_silo) || 0) - egresadoSilo);
                return {
                    ...s,
                    kg_disponibles_reales: neto,
                    kg_originales: Number(s.kg_en_silo) || 0,
                    kg_mtr_silo: Number(s.kg_mtr_silo) || 0
                };
            });

            this.m_dibujarStock();
        } catch (err) {
            console.error("❌ Error en ModuloStock Local:", err);
            visor.innerHTML = `<div class="error-soft" style="color: #E0342A; padding: 20px; font-family: 'Roboto', sans-serif;">Error local en el panel de Stock base: ${err.message}</div>`;
        }
    },

    m_asegurarModalBase: function() {
        if (!document.getElementById('modal-agrosoft')) {
            const modalHTML = `
                <div id="modal-agrosoft" class="modal-overlay" style="display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(18, 22, 28, 0.48); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); z-index: 99999; justify-content: center; align-items: center;">
                    <div class="modal-apple-content" style="background: #FFFFFF; border: 1px solid #E4E7EC; border-radius: 14px; padding: 24px; width: 95%; max-width: 1000px; color: #1D1D1F; box-shadow: 0 7px 18px rgba(0,0,0,0.16); display: flex; flex-direction: column; transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);">
                        <div class="modal-header-apple" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; border-bottom: 1px solid #E4E7EC; padding-bottom: 12px;">
                            <h3 id="modal-titulo" style="margin: 0; font-size: 1.1rem; font-weight: 700; font-family: 'Roboto', sans-serif; color: #0071e3; text-transform: uppercase; letter-spacing: 0.5px;">DETALLE DE STOCK</h3>
                            <button onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background: #F6F7F9; border: 1px solid #E4E7EC; color: #6E6E73; width: 32px; height: 32px; border-radius: 50%; font-size: 1.2rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;" onmouseover="this.style.background='#E4E7EC'" onmouseout="this.style.background='#F6F7F9'">&times;</button>
                        </div>
                        <div id="modal-formulario" style="max-height: 72vh; overflow-y: auto; padding-right: 4px;"></div>
                        <div class="modal-apple-footer" id="modal-acciones-footer" style="display: none;"></div>
                    </div>
                </div>`;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
        }
    },

    /* ACA ES LO NUEVO: Se añade el botón "Sincronizar All" en la esquina superior derecha */
    m_dibujarStock: function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;
        
        const establecimientosUnicos = [...new Set(this.datosSilos.map(s => s.establecimiento).filter(e => e))];
        const cultivosUnicos = [...new Set(this.datosSilos.map(s => s.cultivo).filter(c => c))]; 

        let totalIngresado = 0;
        let totalEgresado = 0;
        const stockPorCultivo = {};

        const silosFiltradosYProcesados = this.listaAcopioCalculado
            .filter(s => {
                const matchEstab = (this.filtroEstablecimiento === 'TODOS' || s.establecimiento === this.filtroEstablecimiento);
                let matchInfra = true;
                const esSiloFisico = s.silo_n && String(s.silo_n).trim() !== "";
                if (this.filtroInfraestructura === 'SILO') matchInfra = esSiloFisico;
                if (this.filtroInfraestructura === 'DEPOSITO') matchInfra = !esSiloFisico;

                const matchCultivo = (this.filtroCultivo === 'TODOS' || (s.cultivo || '').trim().toUpperCase() === this.filtroCultivo.toUpperCase());

                return matchEstab && matchInfra && matchCultivo; 
            })
            .map(s => {
                totalIngresado += s.kg_originales;
                totalEgresado += (s.kg_originales - s.kg_disponibles_reales);

                const cultivoKey = (s.cultivo || 'SIN ESPECIFICAR').trim().toUpperCase();
                stockPorCultivo[cultivoKey] = (stockPorCultivo[cultivoKey] || 0) + s.kg_disponibles_reales;

                const capacidadBase = s.kg_originales > 0 ? s.kg_originales : 1;
                const porcentaje = Math.max(0, Math.min((s.kg_disponibles_reales / capacidadBase) * 100, 100)).toFixed(1);

                return { ...s, porcentaje };
            });

        const stockGlobal = Math.max(0, totalIngresado - totalEgresado);

        const gruposPorEstablecimiento = {};
        silosFiltradosYProcesados.forEach(item => {
            const estNombre = (item.establecimiento || 'ESTABLECIMIENTO GENERAL').trim().toUpperCase();
            if (!gruposPorEstablecimiento[estNombre]) {
                gruposPorEstablecimiento[estNombre] = [];
            }
            gruposPorEstablecimiento[estNombre].push(item);
        });

        visor.innerHTML = `
            <style>
                .stock-layout { font-family: 'Roboto', sans-serif; color: #1D1D1F; padding-bottom: 10px; }
                .grid-kpi-stock { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 22px; }
                .card-kpi-stk { background: #FFFFFF; border: 1px solid #E4E7EC; border-radius: 16px; padding: 18px 20px; display: flex; flex-direction: column; gap: 4px; box-shadow: 0 2px 8px rgba(20,26,36,0.04); transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
                .card-kpi-stk span { font-size: 0.68rem; color: #6E6E73; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; }
                .card-kpi-stk strong { font-size: 1.4rem; font-weight: 700; color: #1D1D1F; letter-spacing: -0.5px; }
                .card-kpi-stk.active-filter { border-color: rgba(31,169,88,0.3); background: #F6FFF9; }
                
                .select-stock-apple { background: #FFFFFF; border: 1px solid #DDE1E7; color: #1D1D1F; padding: 8px 14px; border-radius: 10px; font-size: 0.82rem; outline: none; font-weight: 600; cursor: pointer; box-shadow: 0 2px 6px rgba(20,26,36,0.04); transition: all 0.2s; font-family:'Roboto'; }
                .select-stock-apple:hover { border-color: rgba(0,113,227,0.5); }

                .btn-export-outline { background: #FFFFFF; border: 1px solid #DDE1E7; color: #1D1D1F; padding: 8px 16px; border-radius: 10px; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 6px; font-family: 'Roboto'; font-size: 0.8rem; box-shadow: 0 2px 6px rgba(20,26,36,0.04); transition: all 0.2s; }
                .btn-export-outline:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(20,26,36,0.08); }
                .btn-export-outline:active, .silo-visual-card:active, .btn-menu-apple:active { transform: scale(0.96); box-shadow: inset 0 0 8px rgba(20,26,36,0.12); }
                .btn-export-pdf:hover { border-color: #E0342A; color: #E0342A; background: rgba(224,52,42,0.04); }
                .btn-export-excel:hover { border-color: #1FA958; color: #1FA958; background: rgba(31,169,88,0.04); }

                .split-view-stock { display: grid; grid-template-columns: 1fr 340px; gap: 20px; align-items: flex-start; }
                
                .bloque-campo-container {
                    background: #FFFFFF;
                    border: 1px solid #E4E7EC;
                    border-radius: 12px;
                    padding: 18px;
                    margin-bottom: 20px;
                    box-shadow: 0 2px 8px rgba(20,26,36,0.04);
                }
                .bloque-campo-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 1px solid #F0F2F5;
                    padding-bottom: 12px;
                    margin-bottom: 16px;
                }
                .bloque-campo-title {
                    font-size: 0.92rem;
                    font-weight: 800;
                    color: #1D1D1F;
                    letter-spacing: -0.3px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .bloque-campo-badge {
                    background: rgba(0,113,227,0.08);
                    color: #0071E3;
                    font-size: 0.72rem;
                    font-weight: 700;
                    padding: 4px 10px;
                    border-radius: 14px;
                    border: 1px solid rgba(0,113,227,0.15);
                }

                .grid-celdas-infra { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }

                .silo-visual-card {
                    background: #F9FAFB;
                    border: 1px solid #E4E7EC;
                    border-radius: 14px;
                    padding: 14px;
                    display: flex;
                    align-items: center;
                    gap: 14px;
                    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
                }
                .silo-visual-card:hover {
                    transform: translateY(-3px);
                    border-color: #0071E3;
                    background: #FFFFFF;
                    box-shadow: 0 10px 25px rgba(20,26,36,0.08);
                }

                .silo-tank-container {
                    width: 58px;
                    height: 100px;
                    background: #EAECEF;
                    border: 2px solid #D6DAE1;
                    border-radius: 4px 4px 12px 12px;
                    position: relative;
                    overflow: hidden;
                    display: flex;
                    align-items: flex-end;
                    box-shadow: inset 0 0 8px rgba(20,26,36,0.08);
                    flex-shrink: 0;
                }
                .silo-tank-container::before {
                    content: '';
                    position: absolute;
                    top: 0; left: 0; right: 0;
                    height: 8px;
                    background: linear-gradient(90deg, #D6DAE1 0%, #F0F2F5 50%, #D6DAE1 100%);
                    border-bottom: 1px solid #D6DAE1;
                    z-index: 4;
                }
                .silo-fill {
                    width: 100%;
                    position: relative;
                    transition: height 0.8s cubic-bezier(0.1, 0.8, 0.2, 1);
                    background-image: linear-gradient(180deg, rgba(255,255,255,0.35) 0%, rgba(20,26,36,0.12) 100%);
                }
                .silo-percent-label {
                    position: absolute;
                    top: 50%; left: 50%;
                    transform: translate(-50%, -50%);
                    font-size: 0.65rem;
                    font-weight: 800;
                    color: #FFF;
                    text-shadow: 0 1px 3px rgba(0,0,0,0.45);
                    z-index: 5;
                    pointer-events: none;
                }

                .deposito-box-container {
                    width: 58px;
                    height: 100px;
                    background: #EAECEF;
                    border: 2px solid #D6DAE1;
                    border-radius: 6px;
                    position: relative;
                    overflow: hidden;
                    display: flex;
                    align-items: flex-end;
                    box-shadow: inset 0 0 8px rgba(20,26,36,0.08);
                    flex-shrink: 0;
                }
                .deposito-fill {
                    width: 100%;
                    position: relative;
                    transition: height 0.8s cubic-bezier(0.1, 0.8, 0.2, 1);
                    background-image: linear-gradient(180deg, rgba(255,255,255,0.3) 0%, rgba(20,26,36,0.12) 100%);
                }

                .silo-info { display: flex; flex-direction: column; align-items: flex-start; text-align: left; gap: 3px; flex-grow: 1; min-width: 0; }
                .silo-info small { color: #0071e3; font-weight: 700; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.5px; }
                .silo-info strong { font-size: 1.15rem; font-weight: 700; color: #1D1D1F; letter-spacing: -0.3px; }
                .silo-info p { font-size: 0.75rem; color: #3A3A3C; margin: 0; font-weight: 600; line-height: 1.2; }
                .silo-info span { font-size: 0.68rem; color: #6E6E73; font-weight: 400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px; }

                .panel-distribucion-stock {
                    background: #FFFFFF;
                    border: 1px solid #E4E7EC;
                    border-radius: 12px;
                    padding: 0 18px 20px 18px;
                    height: fit-content;
                    box-shadow: 0 2px 8px rgba(20,26,36,0.04);
                    max-height: 70vh;
                    overflow-y: auto;
                    position: sticky;
                    top: 10px;
                }

                .cabecera-inmovilizada {
                    font-size: 0.78rem;
                    margin: 0;
                    color: #0071e3;
                    font-weight: 700;
                    letter-spacing: 0.5px;
                    text-transform: uppercase;
                    position: sticky;
                    top: 0;
                    z-index: 10;
                    padding-top: 18px;
                    padding-bottom: 12px;
                    background: #FFFFFF;
                    border-bottom: 1px solid #E4E7EC;
                }

                .wrapper-silos-scroll {
                    max-height: 72vh;
                    overflow-y: auto;
                    padding-right: 6px;
                }
            </style>

            ${ComponentesUI.botonVolverHTML('PRODUCCION')}
            <div class="stock-layout animated fadeIn">
                <div class="modulo-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 22px;">
                    <div>
                        <h2 style="margin:0; font-weight: 800; font-size: 1.5rem; letter-spacing: -0.5px; color:#1D1D1F;">Panel de Stock e Inventario Real</h2>
                        <p style="margin:4px 0 0 0; font-size:0.82rem; color:#6E6E73;">Auditoría volumétrica consolidada de granos y forrajes Local</p>
                    </div>
                    
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <select class="select-stock-apple" onchange="ModuloStock.m_filtrarEstablecimiento(this.value)">
                            <option value="TODOS" ${this.filtroEstablecimiento === 'TODOS' ? 'selected' : ''}>🌍 TODOS LOS CAMPOS</option>
                            ${establecimientosUnicos.map(e => `<option value="${e}" ${this.filtroEstablecimiento === e ? 'selected' : ''}>📍 ${e.toUpperCase()}</option>`).join('')}
                        </select>
                        
                        <select class="select-stock-apple" onchange="ModuloStock.m_filtrarCultivo(this.value)">
                            <option value="TODOS" ${this.filtroCultivo === 'TODOS' ? 'selected' : ''}>🌾 TODOS LOS CULTIVOS</option>
                            ${cultivosUnicos.map(c => `<option value="${c}" ${this.filtroCultivo === c ? 'selected' : ''}>🌱 ${c.toUpperCase()}</option>`).join('')}
                        </select>
                        
                        <select class="select-stock-apple" onchange="ModuloStock.m_filtrarInfraestructura(this.value)">
                            <option value="TODOS" ${this.filtroInfraestructura === 'TODOS' ? 'selected' : ''}>🗂️ TODA LA INFRAESTRUCTURA</option>
                            <option value="SILO" ${this.filtroInfraestructura === 'SILO' ? 'selected' : ''}>⚡ SOLO SILOS</option>
                            <option value="DEPOSITO" ${this.filtroInfraestructura === 'DEPOSITO' ? 'selected' : ''}>📦 SOLO DEPÓSITOS / GALPONES</option>
                        </select>

                        <button class="btn-export-outline btn-export-pdf" onclick="ModuloStock.m_exportarPDF()" title="Exportar listado a PDF">
                            <i data-lucide="file-text" style="width:14px; height:14px;"></i> PDF
                        </button>
                        <button class="btn-export-outline btn-export-excel" onclick="ModuloStock.m_exportarExcel()" title="Exportar listado a Excel">
                            <i data-lucide="sheet" style="width:14px; height:14px;"></i> EXCEL
                        </button>

                        <!-- ACA ES LO NUEVO: Botón de Sincronización Global -->
                        <button class="btn-export-outline" onclick="window.sincronizar_todo && window.sincronizar_todo()" style="background:#0071e3; color:#FFF; border:none; box-shadow: 0 4px 12px rgba(0,113,227,0.22);" title="Sincronizar todo con la base central">
                            <i data-lucide="refresh-cw" style="width:14px; height:14px;"></i> SINCRONIZAR ALL
                        </button>
                    </div>
                </div>

                <div class="grid-kpi-stock">
                    <div class="card-kpi-stk"><span>INGRESO ACUMULADO BRUTO</span><strong>${totalIngresado.toLocaleString('es-AR')} KG</strong></div>
                    <div class="card-kpi-stk"><span>EGRESO SALIDA BALANZA</span><strong style="color:#E0342A;">${totalEgresado.toLocaleString('es-AR')} KG</strong></div>
                    <div class="card-kpi-stk active-filter"><span>STOCK NETO DISPONIBLE</span><strong style="color:#1FA958;">${stockGlobal.toLocaleString('es-AR')} KG</strong></div>
                </div>

                <div class="split-view-stock">
                    
                    <!-- VISTA PRINCIPAL: Celdas agrupadas visualmente por Establecimiento -->
                    <div class="wrapper-silos-scroll scroll-apple">
                        ${Object.keys(gruposPorEstablecimiento).length === 0 ? 
                            `<div style="text-align:center; padding:40px; color:#6E6E73; background:#FFFFFF; border-radius: 12px; border:1px solid #E4E7EC; font-weight:500;">No se registraron infraestructuras de stock con los filtros seleccionados.</div>` :
                            Object.entries(gruposPorEstablecimiento).map(([nombreEst, listaCeldas]) => {
                                const totalKilosGrupo = listaCeldas.reduce((acc, c) => acc + c.kg_disponibles_reales, 0);
                                return `
                                    <div class="bloque-campo-container">
                                        <div class="bloque-campo-header">
                                            <div class="bloque-campo-title">
                                                <span>🏢 ESTABLECIMIENTO: ${nombreEst}</span>
                                            </div>
                                            <div class="bloque-campo-badge">
                                                ${listaCeldas.length} Unidad(es) • ${totalKilosGrupo.toLocaleString('es-AR')} KG Disp.
                                            </div>
                                        </div>
                                        <div class="grid-celdas-infra">
                                            ${listaCeldas.map(s => {
                                                const esSiloFisico = s.silo_n && String(s.silo_n).trim() !== "";
                                                const colorGrafico = this.m_colorCultivo(s.cultivo);
                                                
                                                const contenedorGrafico = esSiloFisico
                                                    ? `<div class="silo-tank-container">
                                                            <div class="silo-fill" style="height: ${s.porcentaje}%; background: ${colorGrafico};">
                                                                <span class="silo-percent-label">${s.porcentaje}%</span>
                                                            </div>
                                                       </div>`
                                                    : `<div class="deposito-box-container">
                                                            <div class="deposito-fill" style="height: ${s.porcentaje}%; background: ${colorGrafico};">
                                                                <span class="silo-percent-label">${s.porcentaje}%</span>
                                                            </div>
                                                       </div>`;

                                                const labelInfra = esSiloFisico ? `SILO ${s.silo_n}` : `DEPÓSITO: ${s.deposito || 'G-Gral'}`;

                                                return `
                                                    <div class="silo-visual-card" onclick="ModuloStock.m_abrirMenuAcciones('${s.registro_aco}')" style="cursor:pointer;">
                                                        ${contenedorGrafico}
                                                        <div class="silo-info">
                                                            <small>${labelInfra}</small>
                                                            <strong>${s.kg_disponibles_reales.toLocaleString('es-AR')} kg</strong>
                                                            <p>${(s.cultivo || 'S/D').toUpperCase()}</p>
                                                            <span>Lote/Campo: ${s.campo || 'S/D'}</span>
                                                        </div>
                                                    </div>
                                                `;
                                            }).join('')}
                                        </div>
                                    </div>
                                `;
                            }).join('')
                        }
                    </div>

                    <!-- PANEL DERECHO: Distribución porcentual de granos -->
                    <div class="panel-distribucion-stock scroll-apple">
                        <h3 class="cabecera-inmovilizada">Distribución por Cultivo</h3>
                        <div style="margin-top: 15px;"> 
                            ${Object.entries(stockPorCultivo).map(([cultivo, kg]) => {
                                const divisorGlobal = stockGlobal > 0 ? stockGlobal : 1;
                                const p = ((kg / divisorGlobal) * 100).toFixed(1);
                                return `
                                    <div style="margin-bottom:16px;">
                                        <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:0.75rem;">
                                            <span style="font-weight:700; color:#1D1D1F;">${cultivo}</span>
                                            <span style="color:#6E6E73; font-weight:600;">${kg.toLocaleString('es-AR')} kg (${p}%)</span>
                                        </div>
                                        <div class="progress-bar-bg" style="height:6px; background:#F0F2F5; border-radius:10px; overflow:hidden;">
                                            <div style="width:${p}%; height:100%; background:${this.m_colorCultivo(cultivo)}; border-radius:10px; transition: width 0.5s ease;"></div>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>

                </div>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
    },

    m_abrirMenuAcciones: function(idAco) {
        this.m_asegurarModalBase();
        const silo = this.listaAcopioCalculado.find(s => s.registro_aco == idAco);
        if (!silo) return;

        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        const modalContent = document.querySelector('.modal-apple-content');
        
        if (modalContent) modalContent.style.maxWidth = '440px';
        if (modal) modal.style.display = 'flex';
        
        document.getElementById('modal-titulo').innerText = `CONTROL INTERNO: ${silo.silo_n ? 'SILO ' + silo.silo_n : 'DEPÓSITO ' + (silo.deposito || '')}`;

        container.innerHTML = `
            <style>
                .menu-acciones-grid { display: flex; flex-direction: column; gap: 10px; font-family: 'Roboto', sans-serif; padding: 2px; }
                .btn-menu-apple {
                    display: flex;
                    align-items: center;
                    gap: 14px;
                    background: #FFFFFF;
                    border: 1px solid #E4E7EC;
                    padding: 12px 14px;
                    border-radius: 12px;
                    color: #1D1D1F;
                    cursor: pointer;
                    text-align: left;
                    transition: all 0.2s ease;
                    box-shadow: 0 2px 6px rgba(20,26,36,0.04);
                }
                .btn-menu-apple:hover {
                    background: #F6F7F9;
                    border-color: #0071e3;
                    transform: translateY(-2px);
                    box-shadow: 0 8px 20px rgba(20,26,36,0.08);
                }
                .icon-box-apple {
                    width: 36px;
                    height: 36px;
                    border-radius: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }
            </style>
            <div class="menu-acciones-grid animated fadeIn">
                <div style="background: #F6F7F9; border: 1px solid #E4E7EC; padding: 12px 14px; border-radius: 10px; margin-bottom: 4px; font-size: 0.8rem; color: #6E6E73; line-height: 1.4;">
                    <span>Establecimiento: <b style="color:#1D1D1F;">${silo.establecimiento}</b></span><br>
                    <span>Variedad Forraje: <b style="color:${this.m_colorCultivo(silo.cultivo)};">${silo.cultivo}</b></span><br>
                    <span>Saldo Neto Real: <b style="color:#1FA958;">${silo.kg_disponibles_reales.toLocaleString('es-AR')} kg</b></span>
                </div>

                <button class="btn-menu-apple" onclick="document.getElementById('modal-agrosoft').style.display='none'; ModuloStock.m_abrirModalEgreso(null, '${idAco}');">
                    <div class="icon-box-apple" style="background: rgba(31, 169, 88, 0.1); color: #1FA958;">
                        <i data-lucide="truck" style="width: 18px; height: 18px;"></i>
                    </div>
                    <div>
                        <strong style="display:block; font-size:0.85rem; color:#1D1D1F;">Despachar Material (Salida)</strong>
                        <span style="font-size:0.7rem; color:#6E6E73;">Registrar remito de carga externa por balanza</span>
                    </div>
                </button>

                <button class="btn-menu-apple" onclick="document.getElementById('modal-agrosoft').style.display='none'; if(typeof ModuloAcopio !== 'undefined' && ModuloAcopio.m_abrirModalMovimientoRapido) { ModuloAcopio.m_abrirModalMovimientoRapido('${idAco}'); } else { window.ComponentesUI ? window.ComponentesUI.notifica('⚠️ Cargue el Módulo de Acopio para realizar traslados.') : alert('⚠️ Cargue el Módulo de Acopio para traslados.'); }">
                    <div class="icon-box-apple" style="background: rgba(224, 134, 0, 0.1); color: #E08600;">
                        <i data-lucide="move" style="width: 18px; height: 18px;"></i>
                    </div>
                    <div>
                        <strong style="display:block; font-size:0.85rem; color:#1D1D1F;">Mover Carga (Traslado Interno)</strong>
                        <span style="font-size:0.7rem; color:#6E6E73;">Transferir stock real a otro silo o depósito</span>
                    </div>
                </button>

                <button class="btn-menu-apple" onclick="document.getElementById('modal-agrosoft').style.display='none'; if(typeof ModuloAcopio !== 'undefined' && ModuloAcopio.m_abrirModalAcopioRapido) { const s = ModuloStock.listaAcopioCalculado.find(x => x.registro_aco == '${idAco}'); ModuloAcopio.m_abrirModalAcopioRapido(s); } else { window.ComponentesUI ? window.ComponentesUI.notifica('⚠️ Cargue el Módulo de Acopio para editar parámetros estructurales.') : alert('⚠️ Cargue el Módulo de Acopio para editar.'); }">
                    <div class="icon-box-apple" style="background: rgba(0, 113, 227, 0.1); color: #0071e3;">
                        <i data-lucide="edit-3" style="width: 18px; height: 18px;"></i>
                    </div>
                    <div>
                        <strong style="display:block; font-size:0.85rem; color:#1D1D1F;">Editar Parámetros / Ajustar</strong>
                        <span style="font-size:0.7rem; color:#6E6E73;">Modificar densidades, metros o kilos brutos base</span>
                    </div>
                </button>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
    },

    m_filtrarEstablecimiento: function(val) {
        this.filtroEstablecimiento = val;
        this.m_dibujarStock();
    },

    m_filtrarInfraestructura: function(val) {
        this.filtroInfraestructura = val;
        this.m_dibujarStock();
    },

    m_filtrarCultivo: function(val) {
        this.filtroCultivo = val;
        this.m_dibujarStock();
    },

    m_abrirModalEgreso: function(id = null, preselectedAcoId = null) {
        this.m_asegurarModalBase();
        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        const footerAcciones = document.getElementById('modal-acciones-footer');
        const modalContent = document.querySelector('.modal-apple-content');
        
        if (modalContent) modalContent.style.maxWidth = '950px';
        if (modal) modal.style.display = 'flex';
        if (footerAcciones) footerAcciones.style.display = 'none';

        const regEdicion = id ? this.datosEgresos.find(e => e.id == id || e.reg_local == id) : null;
        document.getElementById('modal-titulo').innerText = regEdicion ? `MODIFICAR EGRESO / REMITO N° ${regEdicion.remito}` : 'NUEVO DESPACHO DE FORRAJE';

        const silosConStock = this.listaAcopioCalculado.filter(s => s.kg_disponibles_reales > 0 || regEdicion);
        const idOrigenObjetivo = regEdicion ? regEdicion.deposito : preselectedAcoId;

        container.innerHTML = `
            <div class="form-container-apple" style="font-family:'Roboto', sans-serif; color:#1D1D1F; padding:2px;">
                <div class="grid-inputs-remito" style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom: 20px;">

                    <div style="display:flex; flex-direction:column; gap:12px;">
                        <div>
                            <label style="font-size:0.65rem; color:#6E6E73; display:block; margin-bottom:4px; font-weight:700; text-transform:uppercase;">Silo / Depósito de Origen (Stock Consolidado)</label>
                            <select id="e_silo_sel" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:9px 12px; border-radius:8px; color:#1D1D1F; outline:none; font-family:'Roboto';" onchange="ModuloStock.m_autoCompletarSilo(this.value)">
                                <option value="">Seleccione origen...</option>
                                ${silosConStock.map(s => `
                                    <option value="${s.registro_aco}" ${String(idOrigenObjetivo) === String(s.registro_aco) ? 'selected' : ''}>
                                        ${s.establecimiento} - ${s.campo} - ${s.silo_n ? 'Silo ' + s.silo_n : 'Dep: ' + s.deposito} (${s.cultivo}) [Disp: ${s.kg_disponibles_reales.toLocaleString()} kg]
                                    </option>`).join('')}
                            </select>
                        </div>

                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                            <div>
                                <label style="font-size:0.65rem; color:#6E6E73; display:block; margin-bottom:4px; font-weight:700; text-transform:uppercase;">Remito N°</label>
                                <input type="number" id="e_remito" value="${regEdicion?.remito || ''}" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:9px 12px; border-radius:8px; color:#1D1D1F; outline:none; font-family:'Roboto';">
                            </div>
                            <div>
                                <label style="font-size:0.65rem; color:#6E6E73; display:block; margin-bottom:4px; font-weight:700; text-transform:uppercase;">Cliente Comprador</label>
                                <input type="text" id="e_cliente" value="${regEdicion?.cliente || ''}" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:9px 12px; border-radius:8px; color:#1D1D1F; outline:none; font-family:'Roboto';">
                            </div>
                        </div>

                        <div>
                            <label style="font-size:0.65rem; color:#6E6E73; display:block; margin-bottom:4px; font-weight:700; text-transform:uppercase;">Chofer Conductor</label>
                            <input type="text" id="e_chofer" value="${regEdicion?.chofer || ''}" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:9px 12px; border-radius:8px; color:#1D1D1F; outline:none; font-family:'Roboto';">
                        </div>

                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                            <div>
                                <label style="font-size:0.65rem; color:#6E6E73; display:block; margin-bottom:4px; font-weight:700; text-transform:uppercase;">Patente Chasis</label>
                                <input type="text" id="e_patente1" value="${regEdicion?.patente_1 || ''}" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:9px 12px; border-radius:8px; color:#1D1D1F; outline:none; font-family:'Roboto';">
                            </div>
                            <div>
                                <label style="font-size:0.65rem; color:#6E6E73; display:block; margin-bottom:4px; font-weight:700; text-transform:uppercase;">Patente Acoplado</label>
                                <input type="text" id="e_patente2" value="${regEdicion?.patente_2 || ''}" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:9px 12px; border-radius:8px; color:#1D1D1F; outline:none; font-family:'Roboto';">
                            </div>
                        </div>
                    </div>

                    <div style="display:flex; flex-direction:column; gap:12px; justify-content:space-between;">
                        <div style="background:#F6F7F9; border:1px solid #E4E7EC; padding:12px; border-radius:10px; display:grid; grid-template-columns: repeat(3, 1fr); gap:10px;">
                            <div>
                                <label style="font-size:0.65rem; color:#6E6E73; display:block; margin-bottom:4px; font-weight:700;">PRECIO U$S</label>
                                <input type="number" step="0.001" id="e_imp_uni_dolar" value="${regEdicion?.imp_uni_dolar || '0'}" oninput="ModuloStock.m_recalcularMontoPro()" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:8px; border-radius:6px; color:#1D1D1F; outline:none;">
                            </div>
                            <div>
                                <label style="font-size:0.65rem; color:#6E6E73; display:block; margin-bottom:4px; font-weight:700;">COTI DÓLAR</label>
                                <input type="number" id="e_cotizacion" value="${regEdicion?.cotizacion || '1200'}" oninput="ModuloStock.m_recalcularMontoPro()" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:8px; border-radius:6px; color:#1D1D1F; outline:none;">
                            </div>
                            <div>
                                <label style="font-size:0.65rem; color:#6E6E73; display:block; margin-bottom:4px; font-weight:700;">IVA %</label>
                                <select id="e_iva" onchange="ModuloStock.m_recalcularMontoPro()" style="width:100%; background:#FFFFFF; border:1px solid #DDE1E7; padding:8px; border-radius:6px; color:#1D1D1F; outline:none; font-weight:bold; cursor:pointer;">
                                    <option value="21" ${regEdicion?.iva == 21 ? 'selected' : ''}>21.0%</option>
                                    <option value="10.5" ${regEdicion?.iva == 10.5 ? 'selected' : ''}>10.5%</option>
                                </select>
                            </div>
                        </div>

                        <div style="background:#F6F7F9; border:1px solid #E4E7EC; padding:12px 14px; border-radius:10px; display:flex; flex-direction:column; gap:4px;">
                            <span style="font-size:0.65rem; font-weight:700; color:#0071e3; letter-spacing:0.5px; text-transform:uppercase;">MÉTRICA DE INFRAESTRUCTURA DISPONIBLE REAL</span>
                            <div id="e_info_stock" style="font-size:0.78rem; color:#6E6E73; line-height:1.4; margin-top:2px;">Seleccione origen para calibrar balanza...</div>
                        </div>

                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                            <div style="background:#FFFAF9; border:1px solid rgba(224,52,42,0.25); padding:12px; border-radius:10px;">
                                <label style="color:#E0342A; font-weight:700; font-size:0.65rem; display:block; margin-bottom:4px; text-transform:uppercase;">KILOS A DESPACHAR</label>
                                <input type="number" id="e_kilos" value="${regEdicion?.kilos || ''}" oninput="ModuloStock.m_validarEgreso(); ModuloStock.m_recalcularMontoPro();" style="width:100%; background:transparent; border:none; color:#1D1D1F; font-size:1.35rem; font-weight:700; outline:none;" placeholder="0">
                            </div>

                            <div style="background:#F6FFF9; border:1px solid rgba(31,169,88,0.25); padding:12px; border-radius:10px; display:flex; flex-direction:column; justify-content:center;">
                                <small style="color:#1FA958; font-weight:700; font-size:0.6rem; display:block; margin-bottom:2px; text-transform:uppercase;">TOTAL LIQUIDADO (C/IVA)</small>
                                <strong style="font-size:1.2rem; color:#1FA958;" id="display_total_pesos_egr">$ 0</strong>
                            </div>
                        </div>
                    </div>
                </div>

                <input type="hidden" id="e_establecimiento" value="${regEdicion?.establecimiento || ''}">
                <input type="hidden" id="e_campo" value="${regEdicion?.campo || ''}">
                <input type="hidden" id="e_lote" value="${regEdicion?.lote || '0'}">
                <input type="hidden" id="e_cultivo" value="${regEdicion?.cultivo || ''}">
                <input type="hidden" id="e_campaña" value="${regEdicion?.campaña || ''}">
                <input type="hidden" id="e_variedad" value="${regEdicion?.variedad || ''}">
                <input type="hidden" id="e_stock_limite" value="0">
                <input type="hidden" id="e_id_edicion" value="${id || ''}">
                <input type="hidden" id="e_estado_valor" value="Activo"> <!-- Siempre debe mostrar del detalle el estado activo -->

                <div class="modal-apple-footer" style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #E4E7EC; padding-top: 16px; margin-top: 10px;">
                    <button class="btn-cancel-soft" id="btn-cancelar-egreso-local" style="background: #F0F2F5; color: #1D1D1F; border: none; padding: 10px 18px; font-weight: 700; border-radius: 8px; font-size: 0.8rem; cursor: pointer; font-family:'Roboto';">CANCELAR</button>
                    <button class="btn-save-soft" id="btn-guardar-egreso-local" style="background: #0071e3; color: #FFF; border: none; padding: 10px 22px; font-weight: 700; border-radius: 8px; font-size: 0.8rem; cursor: pointer; font-family:'Roboto'; box-shadow: 0 4px 12px rgba(0,113,227,0.25);">
                        ${regEdicion ? 'CONFIRMAR MODIFICACIÓN' : 'CONFIRMAR DESPACHO'}
                    </button>
                </div>
            </div>`;

        document.getElementById('btn-cancelar-egreso-local').onclick = () => {
            document.getElementById('modal-agrosoft').style.display = 'none';
        };

        document.getElementById('btn-guardar-egreso-local').onclick = () => {
            this.m_guardarTodo();
        };
        
        if (idOrigenObjetivo) {
            this.m_autoCompletarSilo(idOrigenObjetivo);
            if(regEdicion) this.m_recalcularMontoPro();
        } else {
            this.m_validarEgreso();
        }
    },
    
    m_uniqueid: function(prefix = '') {
        const timestamp = Date.now().toString(36); 
        const randomPart = Math.random().toString(36).substring(2, 7).toUpperCase(); 
        return `${prefix}${timestamp}-${randomPart}`;
    },

    m_recalcularMontoPro: function() {
        const kilos = parseFloat(document.getElementById('e_kilos').value) || 0;
        const precio = parseFloat(document.getElementById('e_imp_uni_dolar').value) || 0;
        const coti = parseFloat(document.getElementById('e_cotizacion').value) || 0;
        const porcetajeIva = parseFloat(document.getElementById('e_iva').value) || 0;
        
        const factorIva = 1 + (porcetajeIva / 100);
        const totalPesosConIva = kilos * precio * factorIva * coti;
        
        document.getElementById('display_total_pesos_egr').innerText = "$ " + totalPesosConIva.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    },

    m_autoCompletarSilo: function(id) {
        const silo = this.listaAcopioCalculado.find(s => s.registro_aco == id);
        if (!silo) return;

        document.getElementById('e_establecimiento').value = silo.establecimiento || '';
        document.getElementById('e_campo').value = silo.campo || '';
        document.getElementById('e_lote').value = silo.lote || '0';
        document.getElementById('e_cultivo').value = silo.cultivo || '';
        document.getElementById('e_campaña').value = silo.campaña || '';
        document.getElementById('e_variedad').value = silo.variedad || '';
        document.getElementById('e_stock_limite').value = silo.kg_disponibles_reales || 0;
        
        document.getElementById('e_info_stock').innerHTML = `
            Establecimiento: <b>${silo.establecimiento}</b><br>
            Métrica de Saldo Neto Real: <b style="color:#1FA958;">${Number(silo.kg_disponibles_reales).toLocaleString('es-AR')} KG</b><br>
            Capacidad Teórica Inicial: <span>${Number(silo.kg_originales).toLocaleString('es-AR')} KG</span>
        `;
        this.m_validarEgreso();
    },

    m_validarEgreso: function() {
        const id = document.getElementById('e_silo_sel').value;
        const cant = parseFloat(document.getElementById('e_kilos').value) || 0;
        const silo = this.listaAcopioCalculado.find(s => s.registro_aco == id);
        const btn = document.getElementById('btn-guardar-egreso-local');
        const idEdicion = document.getElementById('e_id_edicion').value;

        if (!btn) return;

        if (idEdicion || (silo && cant > 0 && cant <= silo.kg_disponibles_reales)) {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
        } else {
            btn.disabled = true;
            btn.style.opacity = '0.4';
            btn.style.cursor = 'not-allowed';
        }
    },

    /* ESTO LO MODIFIQUE / ACA ES LO NUEVO: Persistencia SQLite local con la regla Max(registro)+1, estado Activo y sincronizado = 0 */
    m_guardarTodo: async function() {
        const idAco = document.getElementById('e_silo_sel').value;
        const kilosSalida = parseFloat(document.getElementById('e_kilos').value);
        const impUniDolar = parseFloat(document.getElementById('e_imp_uni_dolar').value) || 0;
        const cotizacion = parseInt(document.getElementById('e_cotizacion').value) || 1;
        const porcetajeIva = parseFloat(document.getElementById('e_iva').value) || 0;
        const idEdicion = document.getElementById('e_id_edicion').value;
        
        const silo = this.listaAcopioCalculado.find(s => s.registro_aco == idAco);
        if (!silo && !idEdicion) return window.ComponentesUI ? window.ComponentesUI.notifica("⚠️ Seleccione una infraestructura de almacenamiento válida.") : alert("⚠️ Seleccione infraestructura válida.");

        const btn = document.getElementById('btn-guardar-egreso-local');
        if (btn) {
            btn.innerText = "GUARDANDO LOCALMENTE...";
            btn.disabled = true;
        }

        const hoy = new Date();
        const año = hoy.getFullYear();
        const mes = String(hoy.getMonth() + 1).padStart(2, '0');
        const periodoFormateado = parseInt(`${año}${mes}`);
        const factorIva = 1 + (porcetajeIva / 100);

        const calculoTotalUsd = impUniDolar * kilosSalida * factorIva;
        const calculoTotalArs = calculoTotalUsd * cotizacion;
        
        try {
            if (idEdicion) {
                // Actualización en SQLite local
                const sqlUpdate = `
                    UPDATE egresos_forraje SET
                        remito = ?, cliente = ?, chofer = ?, patente_1 = ?, patente_2 = ?,
                        kilos = ?, imp_uni_dolar = ?, cotizacion = ?, iva = ?,
                        imp_total_usd = ?, imp_total_ars = ?, estado = ?, despacho = ?,
                        sincronizado = 0
                    WHERE id = ? OR reg_local = ?
                `;
                const paramsUpdate = [
                    parseInt(document.getElementById('e_remito').value) || null,
                    document.getElementById('e_cliente').value.trim(),
                    document.getElementById('e_chofer').value.trim(),
                    document.getElementById('e_patente1').value.trim(),
                    document.getElementById('e_patente2').value.trim(),
                    kilosSalida,
                    impUniDolar,
                    cotizacion,
                    porcetajeIva,
                    parseFloat(calculoTotalUsd.toFixed(2)),
                    parseFloat(calculoTotalArs.toFixed(0)),
                    'Activo', // Siempre estado Activo
                    "SI",
                    idEdicion,
                    idEdicion
                ];
                await this.m_ejecutarSqlLocal(sqlUpdate, paramsUpdate);
            } else {
                // Regla: Max(registro)+1 para egresos_forraje en SQLite
                const resMax = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(reg_local AS INTEGER)) as max_reg FROM egresos_forraje`);
                const maxVal = (resMax.data && resMax.data[0] && resMax.data[0].max_reg) 
                    ? Number(resMax.data[0].max_reg) 
                    : (resMax[0] && resMax[0].max_reg ? Number(resMax[0].max_reg) : 0);
                
                const nuevoRegLocal = String(maxVal + 1);
                const stringRegistroPublico = "REG-" + (maxVal + 1);

                const sqlInsert = `
                    INSERT INTO egresos_forraje (
                        reg_local, registro, fecha, hora, establecimiento, campo, cultivo,
                        deposito, campaña, periodo, razon_origen, remito, cliente,
                        chofer, patente_1, patente_2, kilos, imp_uni_dolar, cotizacion,
                        iva, imp_total_usd, imp_total_ars, estado, despacho, sincronizado
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                const paramsInsert = [
                    nuevoRegLocal,
                    stringRegistroPublico,
                    hoy.toLocaleDateString('es-AR'),
                    hoy.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
                    silo.establecimiento,
                    silo.campo,
                    silo.cultivo,
                    silo.registro_aco,
                    silo.campaña,
                    periodoFormateado,
                    silo.establecimiento,
                    parseInt(document.getElementById('e_remito').value) || null,
                    document.getElementById('e_cliente').value.trim(),
                    document.getElementById('e_chofer').value.trim(),
                    document.getElementById('e_patente1').value.trim(),
                    document.getElementById('e_patente2').value.trim(),
                    kilosSalida,
                    impUniDolar,
                    cotizacion,
                    porcetajeIva,
                    parseFloat(calculoTotalUsd.toFixed(2)),
                    parseFloat(calculoTotalArs.toFixed(0)),
                    'Activo', // Siempre debe mostrar del detalle el estado activo
                    "SI",
                    0        // sincronizado = 0
                ];

                await this.m_ejecutarSqlLocal(sqlInsert, paramsInsert);

                // Descontar volumetría física local en acopio_produccion
                const nuevoStockFisico = silo.kg_originales - kilosSalida;
                const nuevosMtrs = silo.kg_mtr_silo > 0 ? parseFloat((nuevoStockFisico / silo.kg_mtr_silo).toFixed(2)) : 0;
                
                await this.m_ejecutarSqlLocal(
                    `UPDATE acopio_produccion SET kg_en_silo = ?, mtrs_silo = ?, sincronizado = 0 WHERE registro_aco = ?`,
                    [nuevoStockFisico, nuevosMtrs, idAco]
                );
            }

            document.getElementById('modal-agrosoft').style.display = 'none';
            await this.m_inicializar();
            if (window.ComponentesUI) window.ComponentesUI.notifica("✅ Despacho guardado en SQLite local. Listo para Sincronizar.");
        } catch (err) {
            console.error("❌ Error en la base de datos local SQLite:", err);
            if (window.ComponentesUI) window.ComponentesUI.notifica("Error en la operación local: " + err.message);
            else alert("Error local: " + err.message);
        } finally {
            if (btn) {
                btn.innerText = idEdicion ? "CONFIRMAR MODIFICACIÓN" : "CONFIRMAR DESPACHO";
                btn.disabled = false;
            }
        }
    },

    m_colorCultivo: function(cultivo) {
        const normalizado = (cultivo || '').trim().toUpperCase();
        const colors = {
            'MAIZ': '#E08600',
            'SORGO': '#8B4FD9',
            'SOJA': '#1FA958',
            'CEBADA': '#0071e3',
            'TRIGO': '#D9A400'
        };
        return colors[normalizado] || '#9AA0A6';
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

    _m_obtenerStockFiltradoExport: function() {
        return this.listaAcopioCalculado
            .filter(s => {
                const matchEstab = (this.filtroEstablecimiento === 'TODOS' || s.establecimiento === this.filtroEstablecimiento);
                let matchInfra = true;
                const esSiloFisico = s.silo_n && String(s.silo_n).trim() !== "";
                if (this.filtroInfraestructura === 'SILO') matchInfra = esSiloFisico;
                if (this.filtroInfraestructura === 'DEPOSITO') matchInfra = !esSiloFisico;
                const matchCultivo = (this.filtroCultivo === 'TODOS' || (s.cultivo || '').trim().toUpperCase() === this.filtroCultivo.toUpperCase());
                return matchEstab && matchInfra && matchCultivo;
            });
    },

    _m_infoFiltroExport: function() {
        const estTxt = this.filtroEstablecimiento === 'TODOS' ? 'TODOS LOS CAMPOS' : this.filtroEstablecimiento;
        const cultivoTxt = this.filtroCultivo === 'TODOS' ? 'TODOS' : this.filtroCultivo;
        const infraTxt = this.filtroInfraestructura === 'TODOS' ? 'TODA' : this.filtroInfraestructura;
        return `Campo: ${estTxt}  |  Cultivo: ${cultivoTxt}  |  Infraestructura: ${infraTxt}`;
    },

    m_exportarPDF: function() {
        let jsPDF, autoTable;
        try {
            jsPDF = require('jspdf').jsPDF;
            autoTable = require('jspdf-autotable').default;
        } catch (e) {
            console.error(e);
            if (window.ComponentesUI) window.ComponentesUI.notifica('error', "La librería de exportación a PDF no está disponible.");
            else alert("Error: jsPDF no está disponible.");
            return;
        }

        const datos = this._m_obtenerStockFiltradoExport();
        if (datos.length === 0) {
            if (window.ComponentesUI) window.ComponentesUI.notifica('error', "No hay registros de stock para exportar con el filtro actual.");
            else alert("No hay registros para exportar.");
            return;
        }

        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const anchoPagina = doc.internal.pageSize.getWidth();
        const altoPagina = doc.internal.pageSize.getHeight();

        const azul = [0, 113, 227];
        const gris = [110, 110, 115];
        const verde = [31, 169, 88];

        doc.setFillColor(...azul);
        doc.rect(0, 0, anchoPagina, 22, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.text('AGROSOFT J&L - SALVUCCI', 12, 10);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.text('Panel de Stock e Inventario Real', 12, 16);

        doc.setFontSize(8);
        doc.text(`Generado: ${new Date().toLocaleString('es-AR')}`, anchoPagina - 12, 10, { align: 'right' });
        doc.text(this._m_infoFiltroExport(), anchoPagina - 12, 16, { align: 'right' });

        const cabeceras = [['INFRAESTRUCTURA', 'ESTABLECIMIENTO', 'CAMPO', 'CULTIVO', 'CAMPAÑA', 'KG ORIGINALES', 'KG EGRESADOS', 'STOCK NETO (KG)']];

        let sumaOriginal = 0;
        let sumaEgresado = 0;
        let sumaNeto = 0;
        const filas = datos.map(s => {
            const egresado = s.kg_originales - s.kg_disponibles_reales;
            sumaOriginal += s.kg_originales;
            sumaEgresado += egresado;
            sumaNeto += s.kg_disponibles_reales;
            const infra = (s.silo_n && String(s.silo_n).trim() !== "") ? `SILO ${s.silo_n}` : `DEPÓSITO: ${s.deposito || 'G-Gral'}`;
            return [
                infra,
                s.establecimiento || '-',
                s.campo || '-',
                `${s.cultivo || '-'}${s.variedad ? ' (' + s.variedad + ')' : ''}`,
                s.campaña || '-',
                s.kg_originales.toLocaleString('es-AR'),
                egresado.toLocaleString('es-AR'),
                s.kg_disponibles_reales.toLocaleString('es-AR')
            ];
        });

        autoTable(doc, {
            head: cabeceras,
            body: filas,
            startY: 27,
            theme: 'grid',
            styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 2, textColor: [30, 30, 30], lineColor: [228, 231, 236], lineWidth: 0.1 },
            headStyles: { fillColor: azul, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
            alternateRowStyles: { fillColor: [250, 251, 252] },
            columnStyles: {
                5: { halign: 'right' },
                6: { halign: 'right' },
                7: { halign: 'right' }
            },
            foot: [[
                { content: `TOTAL DE INFRAESTRUCTURAS: ${datos.length}`, colSpan: 5, styles: { halign: 'left', fontStyle: 'bold', fillColor: [246, 247, 249], textColor: [30, 30, 30] } },
                { content: sumaOriginal.toLocaleString('es-AR'), styles: { halign: 'right', fontStyle: 'bold', fillColor: [246, 247, 249] } },
                { content: sumaEgresado.toLocaleString('es-AR'), styles: { halign: 'right', fontStyle: 'bold', fillColor: [246, 247, 249] } },
                { content: sumaNeto.toLocaleString('es-AR') + ' KG', styles: { halign: 'right', fontStyle: 'bold', textColor: verde, fillColor: [246, 247, 249] } }
            ]]
        });

        const totalPaginas = doc.internal.getNumberOfPages();
        for (let p = 1; p <= totalPaginas; p++) {
            doc.setPage(p);
            doc.setFontSize(7.5);
            doc.setTextColor(...gris);
            doc.text('AgroSoft J&L - Sistema de Gestión Salvucci', 12, altoPagina - 6);
            doc.text(`Página ${p} de ${totalPaginas}`, anchoPagina - 12, altoPagina - 6, { align: 'right' });
        }

        this._m_descargarBlob(doc.output('blob'), `Panel_Stock_${new Date().toISOString().split('T')[0]}.pdf`);
        if (window.ComponentesUI) window.ComponentesUI.notificar('exito', "📄 Reporte PDF de stock generado con éxito.");
    },

    m_exportarExcel: function() {
        let XLSX;
        try {
            XLSX = require('xlsx');
        } catch (e) {
            console.error(e);
            if (window.ComponentesUI) window.ComponentesUI.notifica('error', "La librería de exportación a Excel no está disponible.");
            else alert("Error: XLSX no disponible.");
            return;
        }

        const datos = this._m_obtenerStockFiltradoExport();
        if (datos.length === 0) {
            if (window.ComponentesUI) window.ComponentesUI.notifica('error', "No hay registros de stock para exportar con el filtro actual.");
            else alert("No hay registros para exportar.");
            return;
        }

        const encabezados = [
            'REGISTRO ACOPIO', 'SILO N°', 'DEPÓSITO', 'ESTABLECIMIENTO', 'CAMPO', 'LOTE', 'CULTIVO',
            'VARIEDAD', 'CAMPAÑA', 'KG ORIGINALES', 'KG EGRESADOS', 'STOCK NETO (KG)', 'DENSIDAD (KG/MTR)', 'MÉTRICA LINEAL (MTR)'
        ];

        const filas = datos.map(s => {
            const egresado = s.kg_originales - s.kg_disponibles_reales;
            return [
                s.registro_aco || '',
                s.silo_n || '',
                s.deposito || '',
                s.establecimiento || '',
                s.campo || '',
                s.lote || '',
                s.cultivo || '',
                s.variedad || '',
                s.campaña || '',
                Number(s.kg_originales || 0),
                Number(egresado || 0),
                Number(s.kg_disponibles_reales || 0),
                Number(s.kg_mtr_silo || 0),
                Number(s.mtrs_silo || 0)
            ];
        });

        const sumaOriginal = datos.reduce((a, s) => a + s.kg_originales, 0);
        const sumaEgresado = datos.reduce((a, s) => a + (s.kg_originales - s.kg_disponibles_reales), 0);
        const sumaNeto = datos.reduce((a, s) => a + s.kg_disponibles_reales, 0);
        const filaTotales = ['', '', '', '', '', '', '', '', 'TOTALES →', sumaOriginal, sumaEgresado, sumaNeto, '', ''];

        const aoa = [encabezados, ...filas, filaTotales];
        const ws = XLSX.utils.aoa_to_sheet(aoa);

        ws['!cols'] = [
            { wch: 14 }, { wch: 10 }, { wch: 18 }, { wch: 20 }, { wch: 14 }, { wch: 10 }, { wch: 16 },
            { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 }
        ];
        ws['!autofilter'] = { ref: `A1:N${filas.length + 1}` };
        ws['!views'] = [{ state: 'frozen', ySplit: 1 }];

        const numFmt = '#,##0.00';
        for (let r = 2; r <= filas.length + 2; r++) {
            ['J', 'K', 'L', 'M', 'N'].forEach(col => {
                const celda = ws[`${col}${r}`];
                if (celda && typeof celda.v === 'number') celda.z = numFmt;
            });
        }

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Stock Inventario');

        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/octet-stream' });
        this._m_descargarBlob(blob, `Panel_Stock_${new Date().toISOString().split('T')[0]}.xlsx`);
        if (window.ComponentesUI) window.ComponentesUI.notificar('exito', "📊 Reporte Excel de stock generado con éxito.");
    }
};

window.ModuloStock = ModuloStock;