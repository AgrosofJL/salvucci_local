/**
 * ModuloCampos: Ecosistema Territorial y Gestión de Plantaciones Activas
 * AgroSoft J&L - "Apple Soft Studio" Edition / Tipografía Roboto
 * Mode: Local-First (Engine SQLite IPC) + "No me quites nada" + Max(registro)+1 + sincronizado = 0
 */
const ModuloCampos = {
    rawDataCuadros: [],      // Registros de la tabla campos
    listaCuadros: [],        // Registros de la tabla maestra cuadros
    inventarioActivo: [],
    inventarioHistorial: [],
    listaCultivos: [],
    seleccionActual: { establecimiento: null, campo: null, lotes: [] },
    filtroCultivoActivo: null,
    filtroVariedadActiva: null,
    filtroEstablecimientoCultivoTab: '',
    buscadorCultivoTexto: '',
    buscadorEstTexto: '',
    buscadorCampoTexto: '',
    buscadorLoteTexto: '',
    modalTipoActual: null,
    datosEdicionActual: null,
    vistaInventarioActual: 'ACTIVOS',
    solapaPrincipalActual: 'TERRITORIO', // TERRITORIO | CULTIVOS_ACTIVOS

    // Helper IPC para ejecutar SQL en la base SQLite local
    m_ejecutarSqlLocal: async function(sql, params = []) {
        if (window.apiLocal && window.apiLocal.query) {
            return await window.apiLocal.query({ sql, params });
        }
        if (window.electronAPI && window.electronAPI.invoke) {
            return await window.electronAPI.invoke('local-db-query', { sql, params });
        }
        throw new Error("No se encontró el puente IPC con la base de datos local.");
    },

    // Normalizador numérico compatible con "1.0", "1", "Lote 1", "01"
    m_normalizarLoteNumero: function(val) {
        if (val === null || val === undefined) return '';
        const str = val.toString().trim().toUpperCase().replace(/^(LOTE|CUADRO|L)\s*[-_:]?\s*/i, '');
        const num = parseFloat(str);
        return !isNaN(num) ? num.toString() : str;
    },

    // Comparador flexible con soporte para multi-selección de lotes
    m_coincideLote: function(item, est, campo, lotesFiltro) {
        if (!item) return false;
        
        const limpiar = (val) => (val || '').toString().trim().toUpperCase();

        // 1. Establecimiento
        const estOk = !est || limpiar(item.establecimiento) === limpiar(est);

        // 2. Campo o Sector
        const campoOk = !campo || 
            limpiar(item.campo) === limpiar(campo) || 
            limpiar(item.sector) === limpiar(campo);

        // 3. Lote (Soporta individual, array múltiple o TODOS si está vacío)
        let loteOk = true;
        if (lotesFiltro && Array.isArray(lotesFiltro) && lotesFiltro.length > 0) {
            const lotesNormalizados = lotesFiltro.map(l => this.m_normalizarLoteNumero(l));
            const partesLoteItem = (item.lote || '').toString().split(',').map(s => this.m_normalizarLoteNumero(s));
            
            loteOk = partesLoteItem.some(p => lotesNormalizados.includes(p)) || 
                     lotesNormalizados.includes(this.m_normalizarLoteNumero(item.lote));
        } else if (lotesFiltro && typeof lotesFiltro === 'string' && lotesFiltro !== '' && lotesFiltro !== 'TODOS') {
            const loteBuscadoNorm = this.m_normalizarLoteNumero(lotesFiltro);
            const partesLoteItem = (item.lote || '').toString().split(',').map(s => this.m_normalizarLoteNumero(s));
            loteOk = partesLoteItem.includes(loteBuscadoNorm) || this.m_normalizarLoteNumero(item.lote) === loteBuscadoNorm;
        }

        // 4. Cultivo (si está activo el filtro de la Solapa 2)
        let cultivoOk = true;
        if (this.filtroCultivoActivo && this.solapaPrincipalActual === 'CULTIVOS_ACTIVOS') {
            cultivoOk = limpiar(item.cultivo) === limpiar(this.filtroCultivoActivo);
        }

        return estOk && campoOk && loteOk && cultivoOk;
    },

    // Fusión de lotes desde 'cuadros', 'campos' e 'inventario_plantacion'
    m_obtenerCuadrosDelCampo: function(est, campo) {
        if (!campo) return [];
        const norm = (v) => (v || '').toString().trim().toUpperCase();
        const estNorm = norm(est);
        const campoNorm = norm(campo);

        const mapaLotes = new Map();

        // 1. Incorporar lotes de la tabla 'cuadros' si existen
        if (this.listaCuadros && this.listaCuadros.length > 0) {
            this.listaCuadros.filter(c => norm(c.campo) === campoNorm).forEach(c => {
                const lNorm = this.m_normalizarLoteNumero(c.lote);
                if (lNorm) {
                    mapaLotes.set(lNorm, {
                        lote: lNorm,
                        nombre_lote: c.nombre_lote || `Cuadro ${lNorm}`,
                        sup: parseFloat(c.sup) || 0,
                        reg_local: c.reg_local || c.id || lNorm,
                        origen: 'cuadros'
                    });
                }
            });
        }

        // 2. Incorporar lotes de la tabla 'campos'
        if (this.rawDataCuadros && this.rawDataCuadros.length > 0) {
            this.rawDataCuadros.filter(c => norm(c.establecimiento) === estNorm && norm(c.campo) === campoNorm).forEach(c => {
                const lNorm = this.m_normalizarLoteNumero(c.lote || '1');
                if (lNorm && !mapaLotes.has(lNorm)) {
                    mapaLotes.set(lNorm, {
                        lote: lNorm,
                        nombre_lote: c.nombre_lote || `Lote ${lNorm}`,
                        sup: parseFloat(c.sup_total || c.sup) || 0,
                        reg_local: c.reg_local || c.id || lNorm,
                        origen: 'campos'
                    });
                }
            });
        }

        // 3. Incorporar lotes que tienen siembras en 'inventario_plantacion' (Lote 1, 2, 3, etc.)
        const todosInventarios = [...(this.inventarioActivo || []), ...(this.inventarioHistorial || [])];
        todosInventarios.forEach(inv => {
            const invEst = norm(inv.establecimiento);
            const invCampo = norm(inv.campo || inv.sector);
            if (invEst === estNorm && invCampo === campoNorm) {
                const lNorm = this.m_normalizarLoteNumero(inv.lote);
                if (lNorm) {
                    if (!mapaLotes.has(lNorm)) {
                        mapaLotes.set(lNorm, {
                            lote: lNorm,
                            nombre_lote: `Lote ${lNorm}`,
                            sup: parseFloat(inv.sup) || 0,
                            reg_local: inv.reg_local || lNorm,
                            origen: 'inventario'
                        });
                    } else {
                        const actual = mapaLotes.get(lNorm);
                        if (actual.sup === 0 && parseFloat(inv.sup) > 0) {
                            actual.sup = parseFloat(inv.sup);
                        }
                    }
                }
            }
        });

        // Ordenamiento numérico natural de los lotes
        return Array.from(mapaLotes.values()).sort((a, b) => {
            const numA = parseFloat(a.lote);
            const numB = parseFloat(b.lote);
            if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
            return a.lote.localeCompare(b.lote);
        });
    },

    m_obtenerResumenCultivosActivos: function(estFiltro = null) {
        const resumen = {};
        let lista = this.inventarioActivo;
        
        if (estFiltro) {
            const normEst = estFiltro.toString().trim().toUpperCase();
            lista = lista.filter(i => (i.establecimiento || '').toString().trim().toUpperCase() === normEst);
        }

        lista.forEach(i => {
            const c = (i.cultivo || 'SIN ESPECIFICAR').trim().toUpperCase();
            if (!resumen[c]) {
                resumen[c] = { cultivo: c, sup: 0, cantidad: 0, variedades: new Set() };
            }
            resumen[c].sup += (parseFloat(i.sup) || 0);
            resumen[c].cantidad += 1;
            if (i.variedad) resumen[c].variedades.add(i.variedad.trim().toUpperCase());
        });
        return Object.values(resumen).sort((a, b) => b.sup - a.sup);
    },

    m_notificarApple: function(mensaje, tipo = 'exito') {
        if (tipo === 'error') {
            if (window.ComponentesUI && window.ComponentesUI.notifica) {
                return window.ComponentesUI.notifica("⚠️ " + mensaje);
            }
            return alert(mensaje);
        }

        const viejaAlerta = document.getElementById('apple-toast-premium');
        if (viejaAlerta) viejaAlerta.remove();

        const toastHTML = `
            <div id="apple-toast-premium" style="position: fixed; top: 30px; left: 50%; transform: translateX(-50%); background: #FFFFFF; border: 1px solid #E0DCD4; border-radius: 16px; padding: 14px 24px; display: flex; align-items: center; gap: 14px; color: #1D1D1F; font-family: 'Roboto', sans-serif; font-size: 0.88rem; font-weight: 600; box-shadow: 0 6px 14px rgba(20,26,36,0.12); z-index: 100000;">
                <div style="background: rgba(30,107,76,0.1); border: 1px solid #1E6B4C; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #1E6B4C; font-weight: 900;">✓</div>
                <div style="letter-spacing: 0.2px;">${mensaje}</div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', toastHTML);

        setTimeout(() => {
            const elemento = document.getElementById('apple-toast-premium');
            if (elemento) {
                elemento.style.transition = "all 0.4s ease";
                elemento.style.opacity = "0";
                elemento.style.transform = "translate(-50%, -20px) scale(0.95)";
                setTimeout(() => elemento.remove(), 400);
            }
        }, 3500);
    },

    m_renderFilasInventario: function(datos, esHistorial = false) {
        if (!datos || datos.length === 0) {
            const mensajeVacio = esHistorial
                ? 'No hay siembras cerradas en el historial para los cuadros seleccionados.'
                : 'No se encontraron siembras activas en los cuadros seleccionados.';
            return `<tr><td colspan="5" style="text-align:center; padding:20px; opacity:0.7; font-size:0.78rem; font-style:italic; color:#9AA0A6;">${mensajeVacio}</td></tr>`;
        }

        return datos.map(inv => `
            <tr>
                <td style="padding:8px 10px;">
                    <strong style="color:var(--color-plant-dark); font-size:0.84rem;">🌱 ${(inv.cultivo || '').toUpperCase()}</strong>
                    <div style="font-size:0.7rem; color:var(--color-text-secondary); margin-top:2px;">Var. ${inv.variedad || 'General'} · <b>Lote ${inv.lote}</b></div>
                </td>
                <td style="padding:8px 10px; text-align:right; font-weight:800; color:#1FA958;">${parseFloat(inv.sup || 0).toFixed(1)} Has</td>
                <td style="padding:8px 10px; font-size:0.75rem; color:var(--color-text-secondary);">${inv.fecha_siembra || inv.fecha_cosecha || '-'}</td>
                <td style="padding:8px 10px; font-size:0.75rem; color:#C62828;">${esHistorial ? (inv.fecha_cierre || '-') : '-'}</td>
                <td style="padding:8px 10px; text-align:center;">
                    <div style="display:inline-flex; gap:6px;">
                        ${esHistorial ? `
                            <button onclick="ModuloCampos.m_reabrirRegistro('${inv.reg_local}')" class="btn-accion-plant" title="Reactivar">
                                ↺ Reactivar
                            </button>
                        ` : `
                            <button onclick="ModuloCampos.m_verDetalle('${inv.reg_local}')" class="btn-accion-plant" title="Editar">
                                ✏️
                            </button>
                            <button onclick="ModuloCampos.m_abrirModalBaja('${inv.reg_local}')" class="btn-accion-plant" style="color:#C62828; border-color:rgba(198,40,40,0.25);" title="Baja / Cierre">
                                📦 Cerrar
                            </button>
                        `}
                    </div>
                </td>
            </tr>
        `).join('');
    },

    m_inicializar: async function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (visor) {
            visor.innerHTML = '<div class="loader-apple" style="font-family: \'Roboto\', sans-serif; text-align: center; padding: 40px; color: #1E6B4C; font-weight: 500; letter-spacing: 0.3px;">Cargando Ecosistema Territorial desde Base Local...</div>';
        }

        try {
            const [resCampos, resCuadros, resInventario, resVariedades] = await Promise.all([
                this.m_ejecutarSqlLocal(`SELECT * FROM campos ORDER BY establecimiento ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM cuadros ORDER BY lote ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM inventario_plantacion`),
                this.m_ejecutarSqlLocal(`SELECT * FROM cultivos_variedades`)
            ]);

            this.rawDataCuadros = (resCampos.data || []).map(c => ({
                ...c,
                sup: parseFloat(c.sup_total || c.sup) || 0,
                poligono: c.ubicacion || '',
                lote: c.lote || '1'
            }));

            this.listaCuadros = (resCuadros.data || []).map(c => ({
                ...c,
                lote: c.lote ? c.lote.toString() : '1',
                sup: parseFloat(c.sup) || 0,
                nombre_lote: c.nombre_lote || ''
            }));

            const todosLosRegistros = resInventario.data || [];
            this.inventarioActivo = todosLosRegistros.filter(i => (i.estado || 'ACTIVO').trim().toUpperCase() === 'ACTIVO');
            this.inventarioHistorial = todosLosRegistros.filter(i => (i.estado || '').trim().toUpperCase() !== 'ACTIVO');
            this.listaCultivos = resVariedades.data || [];

            // Selección inicial coherente
            const ests = [...new Set(this.rawDataCuadros.map(c => c.establecimiento).filter(Boolean))];
            if (ests.length > 0 && !this.seleccionActual.establecimiento) {
                this.seleccionActual.establecimiento = ests[0];
            }

            if (this.seleccionActual.establecimiento) {
                const campos = [...new Set(this.rawDataCuadros.filter(c => c.establecimiento === this.seleccionActual.establecimiento).map(c => c.campo).filter(Boolean))];
                if (campos.length > 0 && (!this.seleccionActual.campo || !campos.includes(this.seleccionActual.campo))) {
                    this.seleccionActual.campo = campos[0];
                }
            }

            this.seleccionActual.lotes = []; // Mostrar todos los lotes del campo seleccionado

            this.m_dibujarInterfazCompleta();

        } catch (err) {
            console.error("❌ Error en Inicialización Local:", err);
            if (visor) {
                visor.innerHTML = `<div class="error-msg" style="color: #E0342A; padding: 25px; font-family: 'Roboto', sans-serif; background: rgba(224,52,42,0.09); border-radius:12px; border: 1px solid rgba(224,52,42,0.2);">Error de lectura en Base Local: ${err.message}</div>`;
            }
        }
    },

    m_cambiarSolapaPrincipal: function(solapa) {
        this.solapaPrincipalActual = solapa;
        if (solapa === 'CULTIVOS_ACTIVOS' && !this.filtroCultivoActivo) {
            const resumen = this.m_obtenerResumenCultivosActivos();
            if (resumen.length > 0) this.filtroCultivoActivo = resumen[0].cultivo;
        }
        this.m_dibujarInterfazCompleta();
    },

    m_dibujarInterfazCompleta: function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;

        const totalHasActivas = this.inventarioActivo.reduce((acc, c) => acc + (parseFloat(c.sup) || 0), 0);
        const cantCultivosUnicos = new Set(this.inventarioActivo.map(i => (i.cultivo || '').trim().toUpperCase())).size;
        const estsTotalCount = new Set(this.rawDataCuadros.map(c => c.establecimiento).filter(Boolean)).size;

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

                .salvucci-campos-wrapper {
                    font-family: 'Roboto', -apple-system, sans-serif;
                    background: var(--color-bg);
                    color: var(--color-text);
                    width: 100%;
                    min-height: calc(100vh - 10px);
                    display: flex;
                    flex-direction: column;
                }

                .panel-pro-campos {
                    font-family: 'Roboto', sans-serif;
                    color: #211C16;
                    padding: 8px 18px 20px 18px;
                    max-height: calc(100vh - 15px);
                    overflow-y: auto;
                }

                .tabs-header-archivero-main {
                    display: flex;
                    gap: 8px;
                    border-bottom: 2px solid var(--color-border);
                    margin-bottom: 12px;
                    align-items: flex-end;
                }
                .tab-main-archivero {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 9px 18px;
                    background: #EAE8E1;
                    border: 1.5px solid var(--color-border);
                    border-bottom: none;
                    border-radius: 12px 12px 0 0;
                    font-size: 0.82rem;
                    font-weight: 800;
                    color: var(--color-text-secondary);
                    cursor: pointer;
                    transition: all 0.15s ease;
                    position: relative;
                    bottom: -2px;
                }
                .tab-main-archivero:hover {
                    background: #F0EEE8;
                    color: var(--color-text);
                }
                .tab-main-archivero.active {
                    background: #FFFFFF;
                    color: var(--color-plant-dark);
                    border-color: var(--color-border);
                    border-top: 3px solid var(--color-plant);
                    box-shadow: 0 -2px 8px rgba(0,0,0,0.04);
                }
                .badge-tab-main {
                    background: var(--color-plant-soft);
                    color: var(--color-plant);
                    padding: 2px 7px;
                    border-radius: 12px;
                    font-size: 0.68rem;
                    font-weight: 800;
                }

                .triple-container-territorio {
                    display: grid;
                    grid-template-columns: 240px 260px 1fr;
                    gap: 14px;
                    align-items: start;
                }

                @media (max-width: 1200px) {
                    .triple-container-territorio {
                        grid-template-columns: 220px 220px 1fr;
                    }
                }

                .split-container-plant {
                    display: grid;
                    grid-template-columns: 280px 1fr;
                    gap: 16px;
                    align-items: start;
                }

                .panel-box-plant {
                    background: #FFFFFF;
                    border: 1.5px solid var(--color-border);
                    border-radius: 14px;
                    padding: 14px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.04);
                }

                .item-list-selectable {
                    background: #F8FAFC;
                    border: 1.2px solid var(--color-border);
                    border-radius: 10px;
                    padding: 10px 12px;
                    cursor: pointer;
                    transition: all 0.15s ease;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .item-list-selectable:hover {
                    border-color: var(--color-plant);
                    background: #FFFFFF;
                }
                .item-list-selectable.active {
                    border-color: var(--color-plant);
                    background: var(--color-plant-soft);
                    box-shadow: 0 2px 6px rgba(30, 107, 76, 0.12);
                    border-left: 4px solid var(--color-plant);
                }

                .cards-variedades-grid {
                    display: flex;
                    gap: 8px;
                    overflow-x: auto;
                    padding: 4px 2px 6px 2px;
                    flex-wrap: wrap;
                }
                .card-variedad-item {
                    background: #FFFFFF;
                    border: 1.5px solid var(--color-border);
                    border-radius: 10px;
                    padding: 8px 12px;
                    flex-shrink: 0;
                    min-width: 120px;
                    border-left: 4px solid var(--color-plant);
                    cursor: pointer;
                    transition: all 0.15s ease;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.03);
                }
                .card-variedad-item:hover {
                    border-color: var(--color-plant);
                    transform: translateY(-2px);
                }
                .card-variedad-item.selected {
                    background: var(--color-plant-soft);
                    border-color: var(--color-plant);
                    box-shadow: 0 3px 8px rgba(30, 107, 76, 0.18);
                }

                .tabla-cuadros-plant {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 0.82rem;
                }
                .tabla-cuadros-plant th {
                    background: #475569;
                    color: #FFFFFF;
                    font-size: 0.68rem;
                    font-weight: 700;
                    text-transform: uppercase;
                    padding: 9px 8px;
                    text-align: left;
                    letter-spacing: 0.4px;
                }
                .tabla-cuadros-plant td {
                    padding: 8px;
                    border-bottom: 1px solid var(--color-border);
                    color: #211C16;
                }
                .tabla-cuadros-plant tbody tr:hover {
                    background: #F8FAFC;
                }

                .btn-accion-plant {
                    background: var(--color-plant-soft);
                    border: 1px solid rgba(30,107,76,0.25);
                    color: var(--color-plant);
                    padding: 4px 8px;
                    border-radius: 6px;
                    font-size: 0.7rem;
                    font-weight: 700;
                    cursor: pointer;
                    transition: background 0.15s;
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                }
                .btn-accion-plant:hover {
                    background: rgba(30,107,76,0.2);
                }

                .input-filtro-box {
                    width: 100%;
                    padding: 7px 10px;
                    border-radius: 8px;
                    border: 1px solid var(--color-border);
                    font-size: 0.78rem;
                    outline: none;
                    background: #F8FAFC;
                    box-sizing: border-box;
                }
                .input-filtro-box:focus {
                    border-color: var(--color-plant);
                    background: #FFFFFF;
                }

                .btn-nuevo-box {
                    background: var(--color-plant);
                    color: #FFFFFF;
                    border: none;
                    padding: 6px 12px;
                    border-radius: 6px;
                    font-size: 0.72rem;
                    font-weight: 700;
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                }
                .btn-nuevo-box:hover {
                    background: var(--color-plant-dark);
                }
            </style>

            <div class="salvucci-campos-wrapper animated fadeIn">
                <div class="panel-pro-campos">
                    ${window.ComponentesUI ? ComponentesUI.botonVolverHTML('PARAMETROS') : ''}
                    
                    <div class="tabs-header-archivero-main" style="margin-top: 4px;">
                        <div class="tab-main-archivero ${this.solapaPrincipalActual === 'TERRITORIO' ? 'active' : ''}" onclick="ModuloCampos.m_cambiarSolapaPrincipal('TERRITORIO')">
                            <i data-lucide="map" style="width:15px; height:15px;"></i>
                            <span>EXPLORADOR TERRITORIAL</span>
                            <span class="badge-tab-main">${estsTotalCount} Est.</span>
                        </div>
                        <div class="tab-main-archivero ${this.solapaPrincipalActual === 'CULTIVOS_ACTIVOS' ? 'active' : ''}" onclick="ModuloCampos.m_cambiarSolapaPrincipal('CULTIVOS_ACTIVOS')">
                            <i data-lucide="sprout" style="width:15px; height:15px; color:var(--color-plant);"></i>
                            <span>🌱 CULTIVOS ACTIVOS</span>
                            <span class="badge-tab-main">${cantCultivosUnicos} Cult. · ${totalHasActivas.toFixed(1)} Has</span>
                        </div>
                    </div>

                    ${this.solapaPrincipalActual === 'TERRITORIO' ? this.m_htmlTabExploradorTerritorial() : this.m_htmlTabCultivosActivos()}
                </div>
            </div>

            <!-- MODAL PRINCIPAL -->
            <div id="modal-agrosoft-campos" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(20,26,36,0.5); z-index:99999; justify-content:center; align-items:center;">
                <div style="background:#FFFFFF; border:1.5px solid var(--color-plant); border-radius:14px; padding:25px; width:90%; max-width:680px; color:#211C16; box-shadow: 0 10px 25px rgba(0,0,0,0.15); position:relative;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; border-bottom:1px solid var(--color-border); padding-bottom:12px;">
                        <h3 id="modal-titulo-campos" style="margin:0; font-size:1.2rem; font-weight:800; letter-spacing:0.3px; color:var(--color-plant-dark);">NUEVO REGISTRO</h3>
                        <span onclick="ModuloCampos.m_cerrarModal()" style="cursor:pointer; opacity:0.6; font-size:1.5rem; font-weight:bold; color:#211C16;">&times;</span>
                    </div>
                    <div id="modal-formulario-campos" style="max-height:60vh; overflow-y:auto; padding-right:6px;"></div>

                    <div id="modal-footer-campos" style="display:flex; justify-content:flex-end; gap:10px; margin-top:25px; border-top:1px solid var(--color-border); padding-top:15px;">
                        <button class="btn-soft-f" onclick="ModuloCampos.m_cerrarModal()" style="background:#F0F2F5; color:#211C16; border:1px solid var(--color-border); padding:8px 16px; border-radius:8px; font-weight:700; cursor:pointer;">CANCELAR</button>
                        <button id="btn-guardar-campos" class="btn-soft-f" onclick="ModuloCampos.m_guardarRegistro()" style="background:var(--color-plant); color:#FFF; padding:8px 24px; border:none; border-radius:8px; font-weight:700; cursor:pointer;">GUARDAR DATOS LOCALES</button>
                    </div>
                </div>
            </div>
        `;

        if (window.lucide) lucide.createIcons();
    },

    m_htmlTabCultivosActivos: function() {
        const resumenCultivos = this.m_obtenerResumenCultivosActivos();
        const cultivoSeleccionado = this.filtroCultivoActivo || (resumenCultivos[0] ? resumenCultivos[0].cultivo : null);

        let siembrasDelCultivo = this.inventarioActivo;
        if (cultivoSeleccionado && cultivoSeleccionado !== 'TODOS') {
            siembrasDelCultivo = siembrasDelCultivo.filter(i => (i.cultivo || '').trim().toUpperCase() === cultivoSeleccionado.trim().toUpperCase());
        }

        const variedadesDelCultivo = [...new Set(siembrasDelCultivo.map(i => (i.variedad || 'GENERAL').trim().toUpperCase()))];

        if (this.filtroVariedadActiva) {
            siembrasDelCultivo = siembrasDelCultivo.filter(i => (i.variedad || 'GENERAL').trim().toUpperCase() === this.filtroVariedadActiva.trim().toUpperCase());
        }

        if (this.filtroEstablecimientoCultivoTab) {
            siembrasDelCultivo = siembrasDelCultivo.filter(i => (i.establecimiento || '').trim().toUpperCase() === this.filtroEstablecimientoCultivoTab.trim().toUpperCase());
        }

        if (this.buscadorCultivoTexto) {
            const txt = this.buscadorCultivoTexto.toLowerCase();
            siembrasDelCultivo = siembrasDelCultivo.filter(i => 
                (i.campo || '').toLowerCase().includes(txt) ||
                (i.establecimiento || '').toLowerCase().includes(txt) ||
                (i.lote || '').toString().toLowerCase().includes(txt) ||
                (i.variedad || '').toLowerCase().includes(txt)
            );
        }

        const totalHasCultivoSel = siembrasDelCultivo.reduce((acc, c) => acc + (parseFloat(c.sup) || 0), 0);
        const estsDisponibles = [...new Set(this.inventarioActivo.map(i => i.establecimiento).filter(Boolean))].sort();

        return `
            <div class="split-container-plant animated fadeIn">
                
                <div class="panel-box-plant">
                    <div style="font-size:0.7rem; font-weight:800; color:var(--color-plant-dark); text-transform:uppercase; letter-spacing:0.4px;">
                        CULTIVOS EN PRODUCCIÓN (${resumenCultivos.length})
                    </div>
                    
                    <div style="display:flex; flex-direction:column; gap:6px; max-height:calc(100vh - 220px); overflow-y:auto;">
                        <div class="item-list-selectable ${!this.filtroCultivoActivo || this.filtroCultivoActivo === 'TODOS' ? 'active' : ''}" onclick="ModuloCampos.m_seleccionarCultivoTab('TODOS')">
                            <div>
                                <strong style="font-size:0.82rem; color:#211C16;">🌍 TODOS LOS CULTIVOS</strong>
                                <div style="font-size:0.68rem; color:var(--color-text-secondary); margin-top:2px;">Consolidado global</div>
                            </div>
                            <span style="font-size:0.8rem; font-weight:800; color:var(--color-plant);">${this.inventarioActivo.reduce((a,c)=>a+(parseFloat(c.sup)||0),0).toFixed(1)} Has</span>
                        </div>

                        ${resumenCultivos.map(c => {
                            const esActivo = cultivoSeleccionado === c.cultivo && this.filtroCultivoActivo !== 'TODOS';
                            return `
                                <div class="item-list-selectable ${esActivo ? 'active' : ''}" onclick="ModuloCampos.m_seleccionarCultivoTab('${c.cultivo.replace(/'/g, "\\'")}')">
                                    <div>
                                        <strong style="font-size:0.82rem; color:#211C16;">🌱 ${c.cultivo}</strong>
                                        <div style="font-size:0.68rem; color:var(--color-text-secondary); margin-top:2px;">${c.cantidad} lote(s) · ${c.variedades.size} var.</div>
                                    </div>
                                    <span style="font-size:0.8rem; font-weight:800; color:var(--color-plant);">${c.sup.toFixed(1)} Has</span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>

                <div class="panel-box-plant" style="flex:1;">
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; border-bottom:1px solid var(--color-border); padding-bottom:12px;">
                        <div>
                            <h3 style="margin:0; font-size:1.15rem; font-weight:800; color:var(--color-plant-dark);">
                                🌱 ${cultivoSeleccionado === 'TODOS' || !cultivoSeleccionado ? 'Todos los Cultivos Activos' : cultivoSeleccionado}
                            </h3>
                            <p style="margin:2px 0 0 0; font-size:0.75rem; color:var(--color-text-secondary);">
                                ${siembrasDelCultivo.length} cuadro(s) implantados · <strong>${totalHasCultivoSel.toFixed(1)} Hectáreas totales</strong>
                            </p>
                        </div>
                        
                        <div style="display:flex; gap:8px; align-items:center;">
                            <input type="text" placeholder="🔍 Buscar lote, campo..." value="${this.buscadorCultivoTexto}" oninput="ModuloCampos.m_filtrarTextoCultivoTab(this.value)" style="padding:6px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.78rem; outline:none; background:#F8FAFC;">
                            
                            <select onchange="ModuloCampos.m_filtrarEstablecimientoCultivoTab(this.value)" style="padding:6px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.78rem; outline:none; background:#FFFFFF; font-weight:600; cursor:pointer;">
                                <option value="">🏢 Todos los Establecimientos</option>
                                ${estsDisponibles.map(e => `<option value="${e}" ${this.filtroEstablecimientoCultivoTab === e ? 'selected' : ''}>${e}</option>`).join('')}
                            </select>
                        </div>
                    </div>

                    ${variedadesDelCultivo.length > 1 ? `
                        <div>
                            <div style="font-size:0.65rem; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; margin-bottom:4px;">
                                Filtrar por Variedad Específica:
                            </div>
                            <div class="cards-variedades-grid">
                                <div class="card-variedad-item ${!this.filtroVariedadActiva ? 'selected' : ''}" onclick="ModuloCampos.m_seleccionarVariedadTab('')">
                                    <div style="font-size:0.78rem; font-weight:800; color:var(--color-plant-dark);">TODAS LAS VARIEDADES</div>
                                    <div style="font-size:0.68rem; color:var(--color-text-secondary);">${siembrasDelCultivo.length} lotes</div>
                                </div>
                                ${variedadesDelCultivo.map(v => {
                                    const esSel = this.filtroVariedadActiva === v;
                                    const itemsVar = siembrasDelCultivo.filter(i => (i.variedad || 'GENERAL').trim().toUpperCase() === v);
                                    const hasVar = itemsVar.reduce((a,c)=>a+(parseFloat(c.sup)||0),0);
                                    return `
                                        <div class="card-variedad-item ${esSel ? 'selected' : ''}" onclick="ModuloCampos.m_seleccionarVariedadTab('${v}')">
                                            <div style="font-size:0.8rem; font-weight:800; color:var(--color-plant-dark);">🧬 ${v}</div>
                                            <div style="font-size:0.68rem; color:var(--color-text-secondary);">${hasVar.toFixed(1)} Has · ${itemsVar.length} lote(s)</div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    ` : ''}

                    <div style="overflow-x:auto; border-radius:10px; border:1px solid var(--color-border); margin-top:6px;">
                        <table class="tabla-cuadros-plant">
                            <thead>
                                <tr>
                                    <th>Establecimiento</th>
                                    <th>Campo / Sector</th>
                                    <th>Lote / Cuadro</th>
                                    <th>Variedad</th>
                                    <th style="text-align:right;">Superficie</th>
                                    <th>F. Siembra</th>
                                    <th style="text-align:center;">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${siembrasDelCultivo.map(i => `
                                    <tr>
                                        <td><strong>${(i.establecimiento || '-').toUpperCase()}</strong></td>
                                        <td>${i.campo || i.sector || '-'}</td>
                                        <td><span style="background:var(--color-plant-soft); color:var(--color-plant-dark); padding:2px 8px; border-radius:6px; font-weight:800; font-size:0.72rem;">Lote ${i.lote}</span></td>
                                        <td>${i.variedad || 'General'}</td>
                                        <td style="text-align:right; font-weight:800; color:#1FA958;">${parseFloat(i.sup || 0).toFixed(1)} Has</td>
                                        <td style="font-size:0.75rem; color:var(--color-text-secondary);">${i.fecha_siembra || i.fecha_cosecha || '-'}</td>
                                        <td style="text-align:center;">
                                            <div style="display:inline-flex; gap:6px;">
                                                <button class="btn-accion-plant" onclick="ModuloCampos.m_irALoteDesdeCultivos('${i.establecimiento.replace(/'/g, "\\'")}', '${(i.campo || i.sector || '').replace(/'/g, "\\'")}', '${i.lote}')" title="Ver en explorador territorial">
                                                    🗺️ Ver Lote
                                                </button>
                                                <button class="btn-accion-plant" onclick="ModuloCampos.m_verDetalle('${i.reg_local}')" title="Editar Siembra">
                                                    ✏️
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                `).join('')}
                                ${siembrasDelCultivo.length === 0 ? '<tr><td colspan="7" style="text-align:center; padding:30px; color:#9AA0A6; font-style:italic;">No hay lotes que coincidan con los filtros seleccionados.</td></tr>' : ''}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>
        `;
    },
    m_htmlTabExploradorTerritorial: function() {
        // Columna A: Lista de Establecimientos
        let estData = [...new Set(this.rawDataCuadros.map(item => item.establecimiento).filter(Boolean))].map(nombre => {
            const items = this.rawDataCuadros.filter(i => i.establecimiento === nombre);
            return {
                nombre,
                sup: items.reduce((acc, curr) => acc + (Number(curr.sup) || 0), 0),
                camposCount: new Set(items.map(i => i.campo).filter(Boolean)).size
            };
        });

        if (this.buscadorEstTexto) {
            const t = this.buscadorEstTexto.toLowerCase();
            estData = estData.filter(e => e.nombre.toLowerCase().includes(t));
        }

        const estSel = this.seleccionActual.establecimiento;

        // Columna B: Lista de Campos del establecimiento seleccionado
        let camposData = [];
        if (estSel) {
            const camposNombres = [...new Set(this.rawDataCuadros.filter(i => i.establecimiento === estSel).map(i => i.campo).filter(Boolean))];
            camposData = camposNombres.map(nombre => {
                const itemsCuadros = this.m_obtenerCuadrosDelCampo(estSel, nombre);
                return {
                    nombre,
                    sup: itemsCuadros.reduce((acc, curr) => acc + (Number(curr.sup) || 0), 0),
                    cuadrosCount: itemsCuadros.length
                };
            });

            if (this.buscadorCampoTexto) {
                const tc = this.buscadorCampoTexto.toLowerCase();
                camposData = camposData.filter(c => c.nombre.toLowerCase().includes(tc));
            }
        }

        const campoSel = this.seleccionActual.campo;

        // Columna C: Obtener todos los cuadros y lotes del campo unificados
        let lotesData = [];
        if (estSel && campoSel) {
            lotesData = this.m_obtenerCuadrosDelCampo(estSel, campoSel);

            if (this.buscadorLoteTexto) {
                const tl = this.buscadorLoteTexto.toLowerCase();
                lotesData = lotesData.filter(l => 
                    String(l.lote).toLowerCase().includes(tl) || 
                    (l.nombre_lote || '').toLowerCase().includes(tl)
                );
            }
        }

        const lotesSeleccionadosActivos = this.seleccionActual.lotes || [];
        const esTodosSeleccionados = lotesSeleccionadosActivos.length === 0;

        const activosCampo = (estSel && campoSel) 
            ? this.inventarioActivo.filter(i => this.m_coincideLote(i, estSel, campoSel, lotesSeleccionadosActivos)) 
            : [];
        const historialCampo = (estSel && campoSel) 
            ? this.inventarioHistorial.filter(i => this.m_coincideLote(i, estSel, campoSel, lotesSeleccionadosActivos)) 
            : [];

        const totalHasCampo = camposData.find(c => c.nombre === campoSel)?.sup || 0;

        return `
            <div class="triple-container-territorio animated fadeIn">
                
                <!-- COLUMNA 1 (a): LISTA DE ESTABLECIMIENTOS -->
                <div class="panel-box-plant">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.68rem; font-weight:800; color:var(--color-plant-dark); text-transform:uppercase;">
                            🏢 ESTABLECIMIENTOS (${estData.length})
                        </span>
                        <button class="btn-nuevo-box" onclick="ModuloCampos.m_abrirModal('LOTE')" title="Nuevo Establecimiento">
                            + Nuevo
                        </button>
                    </div>

                    <input type="text" placeholder="🔍 Buscar..." value="${this.buscadorEstTexto}" oninput="ModuloCampos.m_filtrarBuscadorEst(this.value)" class="input-filtro-box">

                    <div style="display:flex; flex-direction:column; gap:6px; max-height:calc(100vh - 210px); overflow-y:auto;">
                        ${estData.map(e => {
                            const esActivo = estSel === e.nombre;
                            return `
                                <div class="item-list-selectable ${esActivo ? 'active' : ''}" onclick="ModuloCampos.m_seleccionarEstablecimiento('${e.nombre.replace(/'/g, "\\'")}')">
                                    <div>
                                        <strong style="font-size:0.82rem; color:#211C16;">${e.nombre}</strong>
                                        <div style="font-size:0.68rem; color:var(--color-text-secondary); margin-top:2px;">${e.camposCount} campo(s)</div>
                                    </div>
                                    <span style="font-size:0.75rem; font-weight:800; color:var(--color-plant);">${e.sup.toFixed(1)} Has</span>
                                </div>
                            `;
                        }).join('')}
                        ${estData.length === 0 ? '<div style="text-align:center; padding:20px; font-size:0.75rem; color:#9AA0A6; font-style:italic;">No hay establecimientos.</div>' : ''}
                    </div>
                </div>

                <!-- COLUMNA 2 (b): LISTA DE CAMPOS / SECTORES -->
                <div class="panel-box-plant">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.68rem; font-weight:800; color:var(--color-plant-dark); text-transform:uppercase;">
                            📍 CAMPOS (${camposData.length})
                        </span>
                        <button class="btn-nuevo-box" onclick="ModuloCampos.m_abrirModal('LOTE')" title="Nuevo Campo">
                            + Nuevo
                        </button>
                    </div>

                    <input type="text" placeholder="🔍 Buscar campo..." value="${this.buscadorCampoTexto}" oninput="ModuloCampos.m_filtrarBuscadorCampo(this.value)" class="input-filtro-box">

                    <div style="display:flex; flex-direction:column; gap:6px; max-height:calc(100vh - 210px); overflow-y:auto;">
                        ${camposData.map(c => {
                            const esActivo = campoSel === c.nombre;
                            return `
                                <div class="item-list-selectable ${esActivo ? 'active' : ''}" onclick="ModuloCampos.m_seleccionarCampo('${estSel.replace(/'/g, "\\'")}', '${c.nombre.replace(/'/g, "\\'")}')">
                                    <div>
                                        <strong style="font-size:0.82rem; color:#211C16;">${c.nombre}</strong>
                                        <div style="font-size:0.68rem; color:var(--color-text-secondary); margin-top:2px;">${c.cuadrosCount} cuadro(s)</div>
                                    </div>
                                    <div style="display:flex; align-items:center; gap:6px;">
                                        <span style="font-size:0.75rem; font-weight:800; color:var(--color-plant);">${c.sup.toFixed(1)} Has</span>
                                        <button onclick="event.stopPropagation(); ModuloCampos.m_editarCampoSector('${estSel.replace(/'/g, "\\'")}', '${c.nombre.replace(/'/g, "\\'")}');" style="background:transparent; border:none; color:var(--color-plant); cursor:pointer; font-size:0.7rem;" title="Editar Campo">✏️</button>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                        ${!estSel ? '<div style="text-align:center; padding:20px; font-size:0.75rem; color:#9AA0A6; font-style:italic;">Seleccione un establecimiento.</div>' : ''}
                        ${estSel && camposData.length === 0 ? '<div style="text-align:center; padding:20px; font-size:0.75rem; color:#9AA0A6; font-style:italic;">Sin campos registrados.</div>' : ''}
                    </div>
                </div>

                <!-- COLUMNA 3 (c): CUADROS Y SIEMBRAS EN FORMATO SOLAPA 2 -->
                <div class="panel-box-plant">
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; border-bottom:1px solid var(--color-border); padding-bottom:10px;">
                        <div>
                            <h3 style="margin:0; font-size:1.05rem; font-weight:800; color:var(--color-plant-dark);">
                                🗺️ ${campoSel || 'Sin Campo Seleccionado'}
                            </h3>
                            <p style="margin:2px 0 0 0; font-size:0.75rem; color:var(--color-text-secondary);">
                                ${estSel || '-'} · <strong>${totalHasCampo.toFixed(1)} Hectáreas totales</strong>
                            </p>
                        </div>
                        
                        <div style="display:flex; gap:6px; align-items:center;">
                            <button onclick="ModuloCampos.m_exportarExcelEstablecimientoCompleto()" style="background:#1FA958; color:#FFF; border:none; padding:6px 12px; border-radius:6px; font-size:0.72rem; font-weight:700; cursor:pointer;">
                                🗂️ Excel
                            </button>
                            <button onclick="ModuloCampos.m_exportarPDFEstablecimientoCompleto()" style="background:#E0342A; color:#FFF; border:none; padding:6px 12px; border-radius:6px; font-size:0.72rem; font-weight:700; cursor:pointer;">
                                📊 PDF
                            </button>
                            <button onclick="ModuloCampos.m_abrirModal('LOTE')" style="background:var(--color-plant); color:#FFF; border:none; padding:6px 12px; border-radius:6px; font-size:0.72rem; font-weight:700; cursor:pointer;">
                                + Nuevo Cuadro
                            </button>
                        </div>
                    </div>

                    <!-- SELECTOR HORIZONTAL CON MULTI-SELECCIÓN DE LOTES -->
                    ${lotesData.length > 0 ? `
                        <div>
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                                <span style="font-size:0.65rem; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">
                                    Cuadros del Campo (Tocá para seleccionar uno o varios):
                                </span>
                                <input type="text" placeholder="Buscar lote..." value="${this.buscadorLoteTexto}" oninput="ModuloCampos.m_filtrarBuscadorLote(this.value)" style="padding:3px 8px; border-radius:6px; border:1px solid var(--color-border); font-size:0.7rem; outline:none; background:#F8FAFC; width:120px;">
                            </div>
                            <div class="cards-variedades-grid">
                                <!-- Card "TODOS LOS LOTES" -->
                                <div class="card-variedad-item ${esTodosSeleccionados ? 'selected' : ''}" onclick="ModuloCampos.m_seleccionarTodosLotes()">
                                    <div style="font-size:0.78rem; font-weight:800; color:var(--color-plant-dark);">🌟 TODOS (${lotesData.length})</div>
                                    <div style="font-size:0.68rem; color:var(--color-text-secondary); margin-top:2px;">${totalHasCampo.toFixed(1)} Has</div>
                                </div>

                                <!-- Cards individuales de cada Lote de la tabla 'cuadros' / 'inventario' -->
                                ${lotesData.map(l => {
                                    const lNorm = this.m_normalizarLoteNumero(l.lote);
                                    const esSeleccionado = lotesSeleccionadosActivos.includes(lNorm);
                                    const siembrasLote = this.inventarioActivo.filter(i => this.m_coincideLote(i, estSel, campoSel, l.lote)).length;
                                    return `
                                        <div class="card-variedad-item ${esSeleccionado ? 'selected' : ''}" onclick="ModuloCampos.m_toggleLoteMulti('${l.lote}')">
                                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                                <div style="font-size:0.8rem; font-weight:800; color:var(--color-plant-dark);">Lote ${l.lote}</div>
                                                <button onclick="event.stopPropagation(); ModuloCampos.m_editarLote('${l.reg_local || l.id}');" style="background:transparent; border:none; color:var(--color-plant); cursor:pointer; font-size:0.65rem;" title="Editar cuadro">✏️</button>
                                            </div>
                                            <div style="font-size:0.68rem; color:var(--color-text-secondary); margin-top:2px;">
                                                ${l.sup} Has · <b style="color:${siembrasLote > 0 ? '#1FA958' : '#6E6E73'};">${siembrasLote} act.</b>
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    ` : ''}

                    <!-- DETALLE DE SIEMBRA DEL CAMPO O LOTES SELECCIONADOS -->
                    ${campoSel ? `
                        <div style="margin-top:4px; background:#FAFAFA; border:1px solid var(--color-border); border-radius:10px; padding:12px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                                <div>
                                    <strong style="font-size:0.92rem; color:var(--color-plant-dark);">
                                        ${esTodosSeleccionados ? `Todos los cuadros de ${campoSel}` : `Cuadros seleccionados: Lote(s) ${lotesSeleccionadosActivos.join(', ')}`}
                                    </strong>
                                </div>
                                <button onclick="ModuloCampos.m_abrirModal('INVENTARIO')" class="btn-nuevo-box">
                                    🌱 Nueva Siembra en Lote
                                </button>
                            </div>

                            <div class="tabs-archivero-campos" style="display:flex; gap:6px; margin-bottom:8px;">
                                <button type="button" class="btn-accion-plant" style="${this.vistaInventarioActual === 'ACTIVOS' ? 'background:var(--color-plant); color:#FFF;' : ''}" onclick="ModuloCampos.m_cambiarVistaInventario('ACTIVOS')">
                                    SIEMBRA ACTIVA (${activosCampo.length})
                                </button>
                                <button type="button" class="btn-accion-plant" style="${this.vistaInventarioActual === 'HISTORIAL' ? 'background:var(--color-plant); color:#FFF;' : ''}" onclick="ModuloCampos.m_cambiarVistaInventario('HISTORIAL')">
                                    HISTORIAL CERRADOS (${historialCampo.length})
                                </button>
                            </div>

                            <div style="overflow-x:auto; border-radius:8px; border:1px solid var(--color-border); background:#FFFFFF;">
                                <table class="tabla-cuadros-plant">
                                    <thead>
                                        <tr>
                                            <th>Cultivo & Variedad</th>
                                            <th style="text-align:right;">Superficie</th>
                                            <th>F. Siembra</th>
                                            <th>F. Cierre</th>
                                            <th style="text-align:center;">Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody id="tbody-inventario">
                                        ${this.m_renderFilasInventario(this.vistaInventarioActual === 'HISTORIAL' ? historialCampo : activosCampo, this.vistaInventarioActual === 'HISTORIAL')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ` : `
                        <div style="text-align:center; padding:35px 20px; color:#9AA0A6; font-style:italic; font-size:0.82rem;">
                            Seleccione un campo para visualizar sus cuadros y siembras activas.
                        </div>
                    `}
                </div>

            </div>
        `;
    },

    m_seleccionarTodosLotes: function() {
        this.seleccionActual.lotes = [];
        this.m_dibujarInterfazCompleta();
    },

    m_toggleLoteMulti: function(lote) {
        const lNorm = this.m_normalizarLoteNumero(lote);
        let lotesActuales = [...(this.seleccionActual.lotes || [])];

        if (lotesActuales.includes(lNorm)) {
            lotesActuales = lotesActuales.filter(l => l !== lNorm);
        } else {
            lotesActuales.push(lNorm);
        }

        this.seleccionActual.lotes = lotesActuales;
        this.m_dibujarInterfazCompleta();
    },

    m_seleccionarEstablecimiento: function(est) {
        this.seleccionActual.establecimiento = est;
        const campos = [...new Set(this.rawDataCuadros.filter(c => c.establecimiento === est).map(c => c.campo).filter(Boolean))];
        this.seleccionActual.campo = campos.length > 0 ? campos[0] : null;
        this.seleccionActual.lotes = [];
        this.m_dibujarInterfazCompleta();
    },

    m_seleccionarCampo: function(est, campo) {
        this.seleccionActual.establecimiento = est;
        this.seleccionActual.campo = campo;
        this.seleccionActual.lotes = [];
        this.m_dibujarInterfazCompleta();
    },

    m_filtrarBuscadorEst: function(txt) {
        this.buscadorEstTexto = txt || '';
        this.m_dibujarInterfazCompleta();
    },

    m_filtrarBuscadorCampo: function(txt) {
        this.buscadorCampoTexto = txt || '';
        this.m_dibujarInterfazCompleta();
    },

    m_filtrarBuscadorLote: function(txt) {
        this.buscadorLoteTexto = txt || '';
        this.m_dibujarInterfazCompleta();
    },

    m_seleccionarCultivoTab: function(cultivo) {
        this.filtroCultivoActivo = cultivo === 'TODOS' ? null : cultivo;
        this.filtroVariedadActiva = null;
        this.m_dibujarInterfazCompleta();
    },

    m_seleccionarVariedadTab: function(variedad) {
        this.filtroVariedadActiva = variedad || null;
        this.m_dibujarInterfazCompleta();
    },

    m_filtrarEstablecimientoCultivoTab: function(est) {
        this.filtroEstablecimientoCultivoTab = est || '';
        this.m_dibujarInterfazCompleta();
    },

    m_filtrarTextoCultivoTab: function(txt) {
        this.buscadorCultivoTexto = txt || '';
        this.m_dibujarInterfazCompleta();
    },

    m_irALoteDesdeCultivos: function(est, campo, lote) {
        this.solapaPrincipalActual = 'TERRITORIO';
        this.seleccionActual = { establecimiento: est, campo: campo, lotes: [this.m_normalizarLoteNumero(lote)] };
        this.filtroCultivoActivo = null;
        this.m_dibujarInterfazCompleta();
    },

    m_cambiarVistaInventario: function(vista) {
        this.vistaInventarioActual = vista;
        this.m_dibujarInterfazCompleta();
    },

    m_abrirModalBaja: function(reg_local) {
        this.modalTipoActual = 'BAJA';
        this.bajaRegLocalActual = reg_local;

        document.getElementById('modal-titulo-campos').innerText = "GESTIÓN DE BAJA DE SIEMBRA";
        document.getElementById('modal-footer-campos').style.display = 'none';

        const container = document.getElementById('modal-formulario-campos');
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:14px; font-family:'Roboto', sans-serif;">
                <div style="background:#FFF8E1; border-left:4px solid #FBC02D; padding:12px; border-radius:8px; font-size:0.8rem; color:#211C16;">
                    <strong>TERMINAR:</strong> Pasa el lote a histórico como INACTIVO.<br>
                    <strong>ELIMINAR:</strong> Borrado físico definitivo de la base local.
                </div>
                <div>
                    <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Fecha de Cierre (para opción Terminar)</label>
                    <input type="date" id="f_fecha_cierre" value="${new Date().toISOString().split('T')[0]}" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; border-top:1px solid var(--color-border); padding-top:12px;">
                    <button onclick="ModuloCampos.m_cerrarModal()" style="background:#F0F2F5; color:#211C16; border:none; padding:8px 16px; border-radius:8px; font-weight:700; cursor:pointer;">CANCELAR</button>
                    <div style="display:flex; gap:8px;">
                        <button onclick="ModuloCampos.m_ejecutarEliminacionDefinitiva()" style="background:#C62828; color:#FFF; border:none; padding:8px 16px; border-radius:8px; font-weight:700; cursor:pointer;">ELIMINAR</button>
                        <button onclick="ModuloCampos.m_ejecutarBajaConFecha()" style="background:#F57F17; color:#FFF; border:none; padding:8px 16px; border-radius:8px; font-weight:700; cursor:pointer;">TERMINAR</button>
                    </div>
                </div>
            </div>`;
        document.getElementById('modal-agrosoft-campos').style.display = 'flex';
    },

    m_ejecutarBajaConFecha: async function() {
        const fechaCierre = document.getElementById('f_fecha_cierre').value;
        if (!fechaCierre) {
            this.m_notificarApple("Seleccione una fecha de cierre válida.", "error");
            return;
        }

        try {
            const sql = `UPDATE inventario_plantacion SET estado = 'INACTIVO', fecha_cierre = ?, sincronizado = 0 WHERE reg_local = ?`;
            await this.m_ejecutarSqlLocal(sql, [fechaCierre, this.bajaRegLocalActual]);

            this.m_cerrarModal();
            this.m_notificarApple("Plantación cerrada en base local con éxito.", "exito");
            this.m_inicializar();
        } catch (e) {
            console.error("❌ Error en baja de plantación:", e);
            this.m_notificarApple("Error al procesar la baja local: " + e.message, "error");
        }
    },

    m_reabrirRegistro: async function(reg_local) {
        const confirmar = confirm("¿Reabrir esta siembra/plantación en la base local?");
        if (!confirmar) return;

        try {
            const sql = `UPDATE inventario_plantacion SET estado = 'ACTIVO', fecha_cierre = NULL, sincronizado = 0 WHERE reg_local = ?`;
            await this.m_ejecutarSqlLocal(sql, [reg_local]);

            this.vistaInventarioActual = 'ACTIVOS';
            this.m_notificarApple("Siembra reactivada con éxito.", "exito");
            await this.m_inicializar();
        } catch (e) {
            console.error("❌ Error al reabrir siembra:", e);
            this.m_notificarApple("Error al reabrir: " + e.message, "error");
        }
    },

    m_ejecutarEliminacionDefinitiva: async function() {
        const confirmar = confirm("⚠️ ¿Eliminar definitivamente este registro local? Esta acción no se puede deshacer.");
        if (!confirmar) return;

        try {
            const sql = `DELETE FROM inventario_plantacion WHERE reg_local = ?`;
            await this.m_ejecutarSqlLocal(sql, [this.bajaRegLocalActual]);

            this.m_cerrarModal();
            this.m_notificarApple("Registro eliminado físicamente de la base local.", "exito");
            this.m_inicializar();
        } catch (e) {
            console.error("❌ Error en eliminación:", e);
            this.m_notificarApple("Error al eliminar: " + e.message, "error");
        }
    },

    m_cargarVariedades: function(cultivoSel) {
        const selectVar = document.getElementById('f_variedad');
        if (!selectVar) return;
        const vars = this.listaCultivos.filter(c => c.cultivo === cultivoSel);
        selectVar.innerHTML = '<option value="">-- Seleccione Variedad --</option>' +
            vars.map(v => `<option value="${v.variedad}">${v.variedad}</option>`).join('');
    },

    m_obtenerMaxIdPlantacion: async function() {
        try {
            const res = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(id AS INTEGER)) as max_id FROM inventario_plantacion`);
            if (res.data && res.data[0] && res.data[0].max_id) {
                return parseInt(res.data[0].max_id, 10) || 0;
            }
        } catch (e) {
            console.warn("Error calculando Max(id):", e);
        }
        return 0;
    },

    m_obtenerMaxRegLocal: async function(tabla) {
        try {
            const res = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(reg_local AS INTEGER)) as max_reg FROM ${tabla}`);
            if (res.data && res.data[0] && res.data[0].max_reg) {
                return parseInt(res.data[0].max_reg, 10) || 0;
            }
        } catch (e) {
            console.warn("Error calculando Max local:", e);
        }
        return 0;
    },

    m_abrirModal: function(tipo, data = null) {
        const container = document.getElementById('modal-formulario-campos');
        const footer = document.getElementById('modal-footer-campos');
        const esEdicion = data !== null;
        this.modalTipoActual = tipo;
        this.datosEdicionActual = data;

        let supTotalLote = 0;
        let supSembradaActiva = 0;
        let supVacia = 0;

        if (tipo === 'INVENTARIO') {
            const estabSel = esEdicion ? data.establecimiento : this.seleccionActual.establecimiento;
            const campoSel = esEdicion ? data.campo : this.seleccionActual.campo;
            const loteSel = esEdicion ? data.lote : (this.seleccionActual.lotes[0] || '1');

            const lotesDelCampo = this.m_obtenerCuadrosDelCampo(estabSel, campoSel);
            const loteInfo = lotesDelCampo.find(l => this.m_normalizarLoteNumero(l.lote) === this.m_normalizarLoteNumero(loteSel));
            
            supTotalLote = loteInfo ? (parseFloat(loteInfo.sup) || 0) : 0;

            const activasEnLote = this.inventarioActivo.filter(i => 
                this.m_coincideLote(i, estabSel, campoSel, loteSel) && 
                (!esEdicion || String(i.reg_local) !== String(data.reg_local))
            );

            supSembradaActiva = activasEnLote.reduce((acc, c) => acc + (parseFloat(c.sup) || 0), 0);
            supVacia = Math.max(0, supTotalLote - supSembradaActiva);
        }

        document.getElementById('modal-titulo-campos').innerText = `${esEdicion ? 'EDITAR' : 'NUEVO'} CONSOLIDADO DE ${tipo}`;
        footer.style.display = 'flex';
        let htmlForm = '';

        if (tipo === 'LOTE') {
            const estUnicos = [...new Set(this.rawDataCuadros.map(c => c.establecimiento).filter(Boolean))];
            const camposUnicos = [...new Set(this.rawDataCuadros.map(c => c.campo).filter(Boolean))];
            const estValor = esEdicion ? (data.establecimiento || '') : (this.seleccionActual.establecimiento || '');
            const campoValor = esEdicion ? (data.campo || '') : (this.seleccionActual.campo || '');

            htmlForm = `
                <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                        <div>
                            <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700;">Establecimiento</label>
                            <input type="text" id="f_est" list="dl-establecimientos-campos" value="${estValor}" placeholder="Ej: Establecimiento Salvucci" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                            <datalist id="dl-establecimientos-campos">${estUnicos.map(e => `<option value="${e}">`).join('')}</datalist>
                        </div>
                        <div>
                            <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700;">Campo / Sector</label>
                            <input type="text" id="f_campo" list="dl-campos-campos" value="${campoValor}" placeholder="Ej: Sector Norte" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                            <datalist id="dl-campos-campos">${camposUnicos.map(c => `<option value="${c}">`).join('')}</datalist>
                        </div>
                    </div>

                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                        <div><label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700;">Nombre Lote</label><input type="text" id="f_nombre_lote" value="${data?.nombre_lote || ''}" placeholder="Ej: Cuadro Norte" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;"></div>
                        <div><label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700;">ID Lote (TEXT/N°)</label><input type="text" id="f_lote" value="${data?.lote || ''}" placeholder="Ej: 1" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;"></div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                        <div><label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700;">Superficie (Has)</label><input type="number" step="0.01" id="f_sup" value="${data?.sup || ''}" placeholder="0.00" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;"></div>
                        <div><label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700;">Localidad</label><input type="text" id="f_localidad" value="${data?.localidad || ''}" placeholder="Ej: Chimpay" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;"></div>
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700;">Polígono Georreferencial</label>
                        <input type="text" id="f_poligono" value="${data?.poligono || ''}" placeholder="URL o coordenadas de Google Maps" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <input type="hidden" id="f_reg_local" value="${esEdicion ? data.reg_local : 0}">
                </div>`;
        } else if (tipo === 'INVENTARIO') {
            if (!esEdicion && (!this.seleccionActual.lotes || this.seleccionActual.lotes.length === 0)) {
                const lotesDelCampo = this.m_obtenerCuadrosDelCampo(this.seleccionActual.establecimiento, this.seleccionActual.campo);
                if (lotesDelCampo.length > 0) {
                    this.seleccionActual.lotes = [this.m_normalizarLoteNumero(lotesDelCampo[0].lote)];
                }
            }

            const loteSelFinal = esEdicion ? data.lote : (this.seleccionActual.lotes[0] || '1');
            const supSugeridaFinal = esEdicion ? data.sup : (supVacia > 0 ? supVacia.toFixed(1) : supTotalLote.toFixed(1));

            htmlForm = `
                <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                    <div style="background:var(--color-plant-soft); border-left:4px solid var(--color-plant); padding:10px 12px; border-radius:8px; font-size:0.82rem;">
                        <strong>Jerarquía:</strong> ${esEdicion ? data.establecimiento : this.seleccionActual.establecimiento} &gt; ${esEdicion ? data.campo : this.seleccionActual.campo} &gt; Lote ${loteSelFinal}
                    </div>

                    <!-- BALANCE DE SUPERFICIE SEMBRADA VS DISPONIBLE -->
                    <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; background:#F8FAFC; border:1px solid var(--color-border); padding:10px; border-radius:8px; text-align:center;">
                        <div>
                            <span style="font-size:0.63rem; font-weight:700; color:var(--color-text-secondary); text-transform:uppercase;">Superficie Total</span>
                            <strong style="display:block; font-size:0.95rem; color:#211C16;">${supTotalLote.toFixed(1)} Has</strong>
                        </div>
                        <div>
                            <span style="font-size:0.63rem; font-weight:700; color:#E08600; text-transform:uppercase;">Sembrada Activa</span>
                            <strong style="display:block; font-size:0.95rem; color:#E08600;">${supSembradaActiva.toFixed(1)} Has</strong>
                        </div>
                        <div>
                            <span style="font-size:0.63rem; font-weight:700; color:#1FA958; text-transform:uppercase;">Disponible / Vacía</span>
                            <strong style="display:block; font-size:0.95rem; color:#1FA958;">${supVacia.toFixed(1)} Has</strong>
                        </div>
                    </div>

                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                        <div>
                            <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700;">Cultivo</label>
                            <select id="f_cultivo" onchange="ModuloCampos.m_cargarVariedades(this.value)" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                                <option value="">Seleccionar cultivo...</option>
                                ${[...new Set(this.listaCultivos.map(c => c.cultivo))].map(c => `<option value="${c}" ${data?.cultivo === c ? 'selected' : ''}>🌱 ${c}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700;">Variedad</label>
                            <select id="f_variedad" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                                <option value="">-- Seleccione Variedad --</option>
                                ${esEdicion ? `<option value="${data.variedad}" selected>${data.variedad}</option>` : ''}
                            </select>
                        </div>
                    </div>

                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                        <div>
                            <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700;">Superficie a Sembrar (Has)</label>
                            <input type="number" step="0.01" id="f_sup_inventario" value="${supSugeridaFinal}" style="width:100%; padding:8px 10px; border-radius:8px; border:2px solid var(--color-plant); font-weight:700; font-size:0.85rem; box-sizing:border-box;">
                        </div>
                        <div>
                            <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700;">Fecha de Siembra</label>
                            <input type="date" id="f_fecha" value="${data?.fecha_siembra || data?.fecha_cosecha || new Date().toISOString().split('T')[0]}" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                        </div>
                    </div>
                    <input type="hidden" id="f_reg_local" value="${esEdicion ? data.reg_local : 0}">
                </div>`;
        }

        container.innerHTML = htmlForm;
        document.getElementById('modal-agrosoft-campos').style.display = 'flex';

        if (esEdicion && tipo === 'INVENTARIO') {
            this.m_cargarVariedades(data.cultivo);
            document.getElementById('f_variedad').value = data.variedad;
        }
    },

    m_editarLote: function(regLocal) {
        const cuadro = this.rawDataCuadros.find(c => String(c.reg_local) === String(regLocal)) || 
                       this.listaCuadros.find(c => String(c.reg_local || c.id) === String(regLocal));
        if (cuadro) this.m_abrirModal('LOTE', cuadro);
    },

    m_editarCampoSector: function(est, campoActual) {
        this.modalTipoActual = 'CAMPO_SECTOR';
        this.datosEdicionActual = null;
        document.getElementById('modal-titulo-campos').innerText = 'EDITAR CAMPO / SECTOR';
        document.getElementById('modal-footer-campos').style.display = 'flex';

        const estUnicos = [...new Set(this.rawDataCuadros.map(c => c.establecimiento).filter(Boolean))];
        const cantidadLotes = this.m_obtenerCuadrosDelCampo(est, campoActual).length;

        const container = document.getElementById('modal-formulario-campos');
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                <div style="background:var(--color-plant-soft); border-left:4px solid var(--color-plant); padding:10px 12px; border-radius:8px; font-size:0.8rem;">
                    Este cambio moverá <strong>${cantidadLotes}</strong> cuadro(s) asociados a este campo.
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700;">Establecimiento</label>
                        <input type="text" id="fcs_est" list="dl-est-campo-sector" value="${est}" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                        <datalist id="dl-est-campo-sector">${estUnicos.map(e => `<option value="${e}">`).join('')}</datalist>
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:var(--color-text-secondary); text-transform:uppercase; font-weight:700;">Nombre Campo / Sector</label>
                        <input type="text" id="fcs_campo" value="${campoActual}" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem; box-sizing:border-box;">
                    </div>
                </div>
                <input type="hidden" id="fcs_est_original" value="${est}">
                <input type="hidden" id="fcs_campo_original" value="${campoActual}">
            </div>`;
        document.getElementById('modal-agrosoft-campos').style.display = 'flex';
    },

    m_guardarRegistro: async function() {
        const btn = document.getElementById('btn-guardar-campos');
        if (btn) btn.innerText = "GUARDANDO...";

        const tipo = this.modalTipoActual;
        const esEdicion = this.datosEdicionActual !== null;
        let reg_local_input = parseInt(document.getElementById('f_reg_local').value, 10) || 0;

        try {
            if (tipo === 'LOTE') {
                let finalRegLocal = reg_local_input;
                if (!esEdicion || finalRegLocal === 0) {
                    const maxVal = await this.m_obtenerMaxRegLocal('campos');
                    finalRegLocal = maxVal + 1;
                }

                const est = document.getElementById('f_est').value.trim();
                const campo = document.getElementById('f_campo').value.trim();
                const localidad = document.getElementById('f_localidad').value.trim();
                const sup = parseFloat(document.getElementById('f_sup').value) || 0.0;
                const ubicacion = document.getElementById('f_poligono').value.trim();
                const nombreLote = document.getElementById('f_nombre_lote').value.trim();
                const loteId = document.getElementById('f_lote').value.trim();

                if (!est || !campo) {
                    if (btn) btn.innerText = "REINTENTAR";
                    this.m_notificarApple("Establecimiento y Campo son obligatorios.", "error");
                    return;
                }

                let sql, params;
                if (esEdicion) {
                    sql = `UPDATE campos SET establecimiento=?, campo=?, localidad=?, sup_total=?, ubicacion=?, lote=?, sincronizado=0 WHERE reg_local=?`;
                    params = [est, campo, localidad, sup, ubicacion, loteId, String(finalRegLocal)];
                } else {
                    sql = `INSERT INTO campos (establecimiento, campo, localidad, sup_total, ubicacion, lote, reg_local, sincronizado) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`;
                    params = [est, campo, localidad, sup, ubicacion, loteId, String(finalRegLocal)];
                }

                await this.m_ejecutarSqlLocal(sql, params);

            } else if (tipo === 'CAMPO_SECTOR') {
                const estOriginal = document.getElementById('fcs_est_original').value;
                const campoOriginal = document.getElementById('fcs_campo_original').value;
                const estNuevo = document.getElementById('fcs_est').value.trim();
                const campoNuevo = document.getElementById('fcs_campo').value.trim();

                if (!estNuevo || !campoNuevo) {
                    if (btn) btn.innerText = "REINTENTAR";
                    this.m_notificarApple("Complete establecimiento y campo.", "error");
                    return;
                }

                const sql = `UPDATE campos SET establecimiento = ?, campo = ?, sincronizado = 0 WHERE establecimiento = ? AND campo = ?`;
                await this.m_ejecutarSqlLocal(sql, [estNuevo, campoNuevo, estOriginal, campoOriginal]);
                this.seleccionActual = { establecimiento: estNuevo, campo: campoNuevo, lotes: [] };

            } else if (tipo === 'INVENTARIO') {
                const estabSel = esEdicion ? this.datosEdicionActual.establecimiento : this.seleccionActual.establecimiento;
                const campoSel = esEdicion ? this.datosEdicionActual.campo : this.seleccionActual.campo;
                const loteSel = esEdicion ? this.datosEdicionActual.lote : (this.seleccionActual.lotes[0] || '1');

                let finalRegLocal = reg_local_input;
                if (!esEdicion || finalRegLocal === 0) {
                    const maxVal = await this.m_obtenerMaxRegLocal('inventario_plantacion');
                    finalRegLocal = maxVal + 1;
                }

                const cultivo = document.getElementById('f_cultivo').value;
                const variedad = document.getElementById('f_variedad').value;
                const sup = parseFloat(document.getElementById('f_sup_inventario').value) || 0.0;
                const fecha = document.getElementById('f_fecha').value;

                let sql, params;
                if (esEdicion) {
                    sql = `UPDATE inventario_plantacion SET establecimiento=?, campo=?, sector=?, lote=?, cultivo=?, variedad=?, sup=?, fecha_siembra=?, estado='ACTIVO', sincronizado=0 WHERE reg_local=?`;
                    params = [estabSel, campoSel, campoSel, String(loteSel), cultivo, variedad, sup, fecha, String(finalRegLocal)];
                } else {
                    const maxId = await this.m_obtenerMaxIdPlantacion();
                    const nuevoId = maxId + 1;

                    sql = `INSERT INTO inventario_plantacion (reg_local, id, establecimiento, campo, sector, lote, cultivo, variedad, sup, fecha_siembra, estado, sincronizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVO', 0)`;
                    params = [String(finalRegLocal), nuevoId, estabSel, campoSel, campoSel, String(loteSel), cultivo, variedad, sup, fecha];
                }

                await this.m_ejecutarSqlLocal(sql, params);
            }

            this.m_cerrarModal();
            this.m_notificarApple("Guardado en Base Local con éxito.", "exito");
            this.m_inicializar();

        } catch (e) {
            console.error("❌ Falló el guardado local:", e.message);
            if (btn) btn.innerText = "REINTENTAR";
            this.m_notificarApple("Error al guardar: " + e.message, "error");
        }
    },

    m_cerrarModal: () => document.getElementById('modal-agrosoft-campos').style.display = 'none',

    m_verDetalle: function(reg) {
        const item = this.inventarioActivo.find(i => String(i.reg_local) === String(reg));
        if (item) this.m_abrirModal('INVENTARIO', item);
    },

    m_obtenerDatosParaExportar: function() {
        const { establecimiento, campo, lotes } = this.seleccionActual;
        return {
            activos: this.inventarioActivo.filter(i => this.m_coincideLote(i, establecimiento, campo, lotes)),
            historial: this.inventarioHistorial.filter(i => this.m_coincideLote(i, establecimiento, campo, lotes))
        };
    },

    // Exportación Excel completa del Establecimiento agrupado por Campo + Historial
    m_exportarExcelEstablecimientoCompleto: function() {
        const estSel = this.seleccionActual.establecimiento;
        if (!estSel) return this.m_notificarApple("Seleccione un establecimiento para exportar.", "error");

        const activosEst = this.inventarioActivo.filter(i => (i.establecimiento || '').trim().toUpperCase() === estSel.trim().toUpperCase());
        const historialEst = this.inventarioHistorial.filter(i => (i.establecimiento || '').trim().toUpperCase() === estSel.trim().toUpperCase());

        if (activosEst.length === 0 && historialEst.length === 0) {
            return this.m_notificarApple("No hay datos para exportar en este establecimiento.", "error");
        }

        const headers = ["ESTABLECIMIENTO", "CAMPO/SECTOR", "LOCALIDAD", "LOTE", "SUPERFICIE (HA)", "CULTIVO", "VARIEDAD", "FECHA SIEMBRA", "FECHA CIERRE", "ESTADO"];
        
        const filaCsv = (i, esHistorial) => [
            `"${i.establecimiento || ''}"`,
            `"${i.campo || i.sector || ''}"`,
            `"${i.localidad || ''}"`,
            i.lote || '',
            i.sup || 0,
            `"${(i.cultivo || '').toUpperCase()}"`,
            `"${i.variedad || ''}"`,
            i.fecha_siembra || i.fecha_cosecha || '',
            esHistorial ? (i.fecha_cierre || '') : '',
            esHistorial ? 'INACTIVO' : 'ACTIVO'
        ].join(";");

        let csvContent = "\uFEFF";
        csvContent += `SALVUCCI GESTION - ESTABLECIMIENTO: ${estSel.toUpperCase()}\n`;
        csvContent += "SIEMBRAS Y PLANTACIONES ACTIVAS\n";
        csvContent += headers.join(";") + "\n";
        activosEst.forEach(i => { csvContent += filaCsv(i, false) + "\n"; });

        csvContent += "\nHISTORIAL DE CIERRES\n";
        csvContent += headers.join(";") + "\n";
        historialEst.forEach(i => { csvContent += filaCsv(i, true) + "\n"; });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.setAttribute("download", `Salvucci_${estSel.replace(/\s+/g, '_')}_Completo_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    // Exportación PDF Profesional en CARDS agrupado por Campo + Logo + Historial
    m_exportarPDFEstablecimientoCompleto: function() {
        const estSel = this.seleccionActual.establecimiento;
        if (!estSel) return this.m_notificarApple("Seleccione un establecimiento para emitir el reporte.", "error");

        const activosEst = this.inventarioActivo.filter(i => (i.establecimiento || '').trim().toUpperCase() === estSel.trim().toUpperCase());
        const historialEst = this.inventarioHistorial.filter(i => (i.establecimiento || '').trim().toUpperCase() === estSel.trim().toUpperCase());

        if (activosEst.length === 0 && historialEst.length === 0) {
            return this.m_notificarApple("No hay datos de siembra para emitir el reporte.", "error");
        }

        const camposAgrupadosActivos = {};
        activosEst.forEach(i => {
            const campoNom = (i.campo || i.sector || 'GENERAL').toUpperCase();
            if (!camposAgrupadosActivos[campoNom]) camposAgrupadosActivos[campoNom] = [];
            camposAgrupadosActivos[campoNom].push(i);
        });

        const totalHasActivas = activosEst.reduce((a, c) => a + (parseFloat(c.sup) || 0), 0);

        const cardsCamposHtml = Object.entries(camposAgrupadosActivos).map(([campoNom, siembras]) => {
            const hasCampo = siembras.reduce((a, c) => a + (parseFloat(c.sup) || 0), 0);
            return `
                <div style="background:#FFFFFF; border:1px solid #E0DCD4; border-radius:10px; padding:16px; margin-bottom:18px; box-shadow:0 2px 6px rgba(0,0,0,0.04); page-break-inside:avoid;">
                    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #1E6B4C; padding-bottom:8px; margin-bottom:12px;">
                        <h3 style="margin:0; font-size:13px; font-weight:800; color:#123F2C;">📍 CAMPO: ${campoNom}</h3>
                        <span style="background:rgba(30,107,76,0.1); color:#1E6B4C; padding:3px 10px; border-radius:12px; font-weight:800; font-size:11px;">
                            ${siembras.length} Lote(s) · ${hasCampo.toFixed(1)} Has
                        </span>
                    </div>

                    <table style="width:100%; border-collapse:collapse; font-size:10px;">
                        <thead>
                            <tr style="background:#F8FAFC; color:#6B6255; font-size:9px; text-transform:uppercase;">
                                <th style="padding:6px; text-align:left;">LOTE</th>
                                <th style="padding:6px; text-align:left;">CULTIVO</th>
                                <th style="padding:6px; text-align:left;">VARIEDAD</th>
                                <th style="padding:6px; text-align:right;">SUPERFICIE</th>
                                <th style="padding:6px; text-align:left;">F. SIEMBRA</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${siembras.map(s => `
                                <tr style="border-bottom:1px solid #EAE8E1;">
                                    <td style="padding:6px; font-weight:800; color:#123F2C;">Lote ${s.lote}</td>
                                    <td style="padding:6px; font-weight:800; color:#1E6B4C;">🌱 ${(s.cultivo || '').toUpperCase()}</td>
                                    <td style="padding:6px;">${s.variedad || 'General'}</td>
                                    <td style="padding:6px; text-align:right; font-weight:800; color:#1FA958;">${parseFloat(s.sup || 0).toFixed(1)} Has</td>
                                    <td style="padding:6px; color:#6B6255;">${s.fecha_siembra || s.fecha_cosecha || '-'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }).join('');

        const tablaHistorialHtml = historialEst.length > 0 ? `
            <div style="background:#FFFFFF; border:1px solid #E0DCD4; border-radius:10px; padding:16px; margin-top:24px; page-break-inside:avoid;">
                <div style="border-bottom:2px solid #6E6E73; padding-bottom:8px; margin-bottom:12px;">
                    <h3 style="margin:0; font-size:13px; font-weight:800; color:#4B4F56;">📜 HISTORIAL DE CIERRES (${historialEst.length})</h3>
                </div>
                <table style="width:100%; border-collapse:collapse; font-size:10px;">
                    <thead>
                        <tr style="background:#F8FAFC; color:#6B6255; font-size:9px; text-transform:uppercase;">
                            <th style="padding:6px; text-align:left;">CAMPO</th>
                            <th style="padding:6px; text-align:left;">LOTE</th>
                            <th style="padding:6px; text-align:left;">CULTIVO</th>
                            <th style="padding:6px; text-align:left;">VARIEDAD</th>
                            <th style="padding:6px; text-align:right;">SUPERFICIE</th>
                            <th style="padding:6px; text-align:left;">F. SIEMBRA</th>
                            <th style="padding:6px; text-align:left;">F. CIERRE</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${historialEst.map(h => `
                            <tr style="border-bottom:1px solid #EAE8E1;">
                                <td style="padding:6px;">${h.campo || h.sector || '-'}</td>
                                <td style="padding:6px; font-weight:800;">Lote ${h.lote}</td>
                                <td style="padding:6px; color:#4B4F56; font-weight:700;">${(h.cultivo || '').toUpperCase()}</td>
                                <td style="padding:6px;">${h.variedad || '-'}</td>
                                <td style="padding:6px; text-align:right; font-weight:800;">${parseFloat(h.sup || 0).toFixed(1)} Has</td>
                                <td style="padding:6px; color:#6B6255;">${h.fecha_siembra || '-'}</td>
                                <td style="padding:6px; color:#C62828; font-weight:700;">${h.fecha_cierre || '-'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        ` : '';

        const ventanaImpresion = window.open('', '_blank');
        ventanaImpresion.document.write(`
            <html>
            <head>
                <title>Salvucci Gestión - ${estSel}</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap');
                    body { font-family: 'Roboto', sans-serif; color: #211C16; padding: 35px; margin: 0; background: #F5F4F1; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    .header-pdf-premium { border-bottom: 3px solid #1E6B4C; padding-bottom: 14px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; background:#FFFFFF; padding:18px; border-radius:12px; border:1px solid #E0DCD4; }
                    .logo-container-apple { width: 75px; height: 75px; display: flex; align-items: center; justify-content: center; margin-right: 15px; }
                    .logo-container-apple img { width: 100%; height: 100%; object-fit: contain; }
                    .titulos-reporte h1 { margin: 0; font-size: 18px; font-weight: 900; color: #123F2C; }
                    .titulos-reporte h2 { margin: 3px 0 0 0; font-size: 11px; color: #1E6B4C; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
                    .kpi-tile-top { background:rgba(30,107,76,0.08); border:1px solid rgba(30,107,76,0.25); padding:8px 14px; border-radius:8px; text-align:right; }
                    .footer-firma-fija { margin-top: 30px; border-top: 1px solid #E0DCD4; padding-top: 15px; display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: #6B6255; page-break-inside: avoid; }
                    @media print {
                        body { background: #FFFFFF; padding: 15px; }
                    }
                </style>
            </head>
            <body>
                <div class="header-pdf-premium">
                    <div style="display:flex; align-items:center;">
                        <div class="logo-container-apple">
                            <img src="logo.png" onerror="this.style.display='none';" />
                        </div>
                        <div class="titulos-reporte">
                            <h2>SALVUCCI GESTIÓN · REPORTE TERRITORIAL</h2>
                            <h1>ESTABLECIMIENTO: ${estSel.toUpperCase()}</h1>
                        </div>
                    </div>
                    <div class="kpi-tile-top">
                        <div style="font-size:9px; color:#6B6255; font-weight:700; text-transform:uppercase;">Superficie Activa Total</div>
                        <div style="font-size:16px; font-weight:900; color:#1E6B4C;">${totalHasActivas.toFixed(1)} Has</div>
                        <small style="font-size:9px; color:#6B6255;">Emitido: ${new Date().toLocaleDateString('es-AR')}</small>
                    </div>
                </div>

                <div style="margin-bottom:12px; font-size:11px; font-weight:800; color:#123F2C; text-transform:uppercase;">
                    ■ DETALLE DE CULTIVOS ACTIVOS POR CAMPO
                </div>

                ${cardsCamposHtml}
                ${tablaHistorialHtml}

                <div class="footer-firma-fija">
                    <span>Salvucci Gestión &bull; Ecosistema Territorial Local</span>
                    <span style="font-weight:bold;">Firma Responsable de Campo: ___________________________</span>
                </div>

                <script>
                    window.onload = function() { setTimeout(() => { window.print(); window.close(); }, 300); }
                </script>
            </body>
            </html>
        `);
        ventanaImpresion.document.close();
    }
};

window.ModuloCampos = ModuloCampos;
window.PAR_ESTABLECIMIENTOS = ModuloCampos;