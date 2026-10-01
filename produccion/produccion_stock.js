/**
 * stock.js - Panel de Stock e Inventario Real con Visor Satelital, Traslados Internos y Venta
 * Sistema: SALVUCCI / AgroSoft J&L
 * Lenguaje Visual: Apple Soft Studio / Roboto Font
 * Mode: Local-First (SQLite IPC) + Sincronización + Trazabilidad
 */

const ModuloStock = {
    datosSilos: [],
    datosEgresos: [],
    listaDepositosMaestros: [],
    listaAcopioCalculado: [], 
    filtroEstablecimiento: 'TODOS', 
    filtroInfraestructura: 'TODOS', 
    filtroCultivo: 'TODOS',
    vistaStock: 'VISUAL',          // 'VISUAL' (silos y galpones dibujados) | 'TABLA'
    textoBusqueda: '',
    mostrarVacios: false,
    googleMapsCargado: false,
    googleApiKey: 'AIzaSyA374dJeJJ-IBirYrb_uTqRH9yrUK2VUaE',

    m_ejecutarSqlLocal: async function(sql, params = []) {
        if (window.apiLocal && window.apiLocal.query) {
            return await window.apiLocal.query({ sql, params });
        }
        if (window.electronAPI && window.electronAPI.invoke) {
            return await window.electronAPI.invoke('local-db-query', { sql, params });
        }
        throw new Error("No se encontró el puente IPC con la base de datos base local.");
    },

    m_inicializar: async function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;
        visor.innerHTML = `<div class="loader-apple" style="font-family: 'Roboto', sans-serif; text-align: center; padding: 50px; color: #1E6B4C; font-weight: 500;">Consolidando inventario y volumetrías...</div>`;

        try {
            const [resSilos, resEgresos, resDepositos] = await Promise.all([
                this.m_ejecutarSqlLocal(`SELECT * FROM acopio_produccion ORDER BY registro_aco DESC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM egresos_forraje ORDER BY id DESC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM depositos ORDER BY deposito ASC`)
            ]);

            this.datosSilos = resSilos.data || resSilos || [];
            this.datosEgresos = resEgresos.data || resEgresos || [];
            this.listaDepositosMaestros = resDepositos.data || resDepositos || [];

            // ACA ES LO NUEVO: Cálculo exacto sin doble descuento + auditoría de recepción real
            const acopiosBase = this.datosSilos.map(s => {
                const regAcoStr = String(s.registro_aco).trim();
                const siloNumStr = s.silo_n ? String(s.silo_n).trim() : '';

                // Filtramos egresos asociados a este silo/depósito físico
                const egresosAsociados = this.datosEgresos.filter(e => {
                    const depEgr = e.deposito !== null && e.deposito !== undefined ? String(e.deposito).trim() : '';
                    const estadoNorm = (e.estado || 'ACTIVO').trim().toUpperCase();
                    if (estadoNorm === 'CANCELADO' || estadoNorm === 'ANULADO') return false;
                    return depEgr === regAcoStr || (siloNumStr && depEgr === siloNumStr);
                });

                const totalDespachadoKg = egresosAsociados.reduce((acc, curr) => acc + (Number(curr.kilos) || 0), 0);
                const totalRecepcionadoKg = egresosAsociados.reduce((acc, curr) => {
                    const rec = curr.cant_recepcionada !== null && curr.cant_recepcionada !== undefined ? Number(curr.cant_recepcionada) : Number(curr.kilos);
                    return acc + (rec || 0);
                }, 0);

                const mermaAcumuladaKg = totalRecepcionadoKg - totalDespachadoKg;
                const indiceRecepPromedio = totalDespachadoKg > 0 ? (totalRecepcionadoKg / totalDespachadoKg) * 100 : 100;

                // kg_en_silo ya tiene los descuentos realizados al guardar el egreso
                const kgFisicoActual = Math.max(0, Number(s.kg_en_silo) || 0);
                const capacidadHistorica = Math.max(kgFisicoActual + totalDespachadoKg, kgFisicoActual, 1);

                return {
                    ...s,
                    kg_disponibles_reales: kgFisicoActual,
                    kg_originales: kgFisicoActual + totalDespachadoKg,
                    kg_despachados_totales: totalDespachadoKg,
                    kg_recepcionados_totales: totalRecepcionadoKg,
                    merma_acumulada_kg: mermaAcumuladaKg,
                    indice_recepcion: indiceRecepPromedio,
                    capacidad_base: capacidadHistorica,
                    kg_mtr_silo: Number(s.kg_mtr_silo) || 0,
                    ubicacion: s.ubicacion || ''
                };
            });

            // Consolidación de depósitos físicos
            const mapaUnificado = new Map();
            acopiosBase.forEach(item => {
                const esSiloFisico = item.silo_n && String(item.silo_n).trim() !== "" && item.silo_n !== '0';
                if (esSiloFisico) {
                    const claveSilo = `SILO_${item.registro_aco}`;
                    mapaUnificado.set(claveSilo, {
                        ...item,
                        es_consolidado: false,
                        partidas_incluidas: [item],
                        resumen_cultivos: { [(item.cultivo || 'SIN ESPECIFICAR').toUpperCase()]: item.kg_disponibles_reales },
                        es_traslado: !!item.origen_traslado
                    });
                } else {
                    const nombreDepo = (item.deposito || 'TRANSITORIO').trim().toUpperCase();
                    const estab = (item.establecimiento || 'CENTRAL').trim().toUpperCase();
                    const claveDepo = `DEPO_${estab}_${nombreDepo}`;

                    if (!mapaUnificado.has(claveDepo)) {
                        mapaUnificado.set(claveDepo, {
                            ...item,
                            deposito: nombreDepo,
                            es_consolidado: true,
                            kg_disponibles_reales: 0,
                            kg_originales: 0,
                            kg_despachados_totales: 0,
                            kg_recepcionados_totales: 0,
                            capacidad_base: 0,
                            partidas_incluidas: [],
                            resumen_cultivos: {},
                            es_traslado: false
                        });
                    }
                    const grupo = mapaUnificado.get(claveDepo);
                    grupo.kg_disponibles_reales += item.kg_disponibles_reales;
                    grupo.kg_originales += item.kg_originales;
                    grupo.kg_despachados_totales += item.kg_despachados_totales;
                    grupo.kg_recepcionados_totales += item.kg_recepcionados_totales;
                    grupo.capacidad_base += item.capacidad_base;
                    grupo.partidas_incluidas.push(item);
                    if (item.origen_traslado) grupo.es_traslado = true;

                    const cult = (item.cultivo || 'SIN ESPECIFICAR').toUpperCase();
                    grupo.resumen_cultivos[cult] = (grupo.resumen_cultivos[cult] || 0) + item.kg_disponibles_reales;

                    const difKilosTot = grupo.kg_recepcionados_totales - grupo.kg_despachados_totales;
                    grupo.merma_acumulada_kg = difKilosTot;
                    grupo.indice_recepcion = grupo.kg_despachados_totales > 0 
                        ? (grupo.kg_recepcionados_totales / grupo.kg_despachados_totales) * 100 
                        : 100;
                }
            });

            this.listaAcopioCalculado = Array.from(mapaUnificado.values());
            this.m_dibujarStock();
        } catch (err) {
            console.error("❌ Error en ModuloStock Local:", err);
            visor.innerHTML = `<div style="color: #E0342A; padding: 20px;">Error: ${err.message}</div>`;
        }
    },

    m_asegurarModalBase: function() {
        if (window.AgroUI && typeof AgroUI.asegurarModal === 'function') return AgroUI.asegurarModal();
        let modal = document.getElementById('modal-agrosoft');
        if (!modal) {
            const modalHTML = `
                <div id="modal-agrosoft" class="modal-overlay" style="display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(18, 22, 28, 0.48); backdrop-filter: blur(14px); z-index: 99999; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box;">
                    <div class="modal-apple-content" style="background: #FFFFFF; border: 1.5px solid #E0DCD4; border-radius: 14px; padding: 24px; width: 95%; max-width: 920px; max-height: 92vh; color: #1D1D1F; box-shadow: 0 10px 25px rgba(0,0,0,0.15); display: flex; flex-direction: column;">
                        <div class="modal-header-apple" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; border-bottom: 1px solid #E0DCD4; padding-bottom: 10px;">
                            <h3 id="modal-titulo" style="margin: 0; font-size: 1.15rem; font-weight: 800; font-family: 'Roboto', sans-serif; color: #123F2C; letter-spacing: -0.3px;">OPERACIÓN DE STOCK</h3>
                            <button onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background: none; border: none; color: #6E6E73; font-size: 1.5rem; font-weight:bold; cursor: pointer;">&times;</button>
                        </div>
                        <div id="modal-formulario" style="max-height: 75vh; overflow-y: auto; padding-right: 4px;"></div>
                        <div class="modal-apple-footer" id="modal-acciones-footer" style="display: none;"></div>
                    </div>
                </div>`;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
        }
    },

    m_dibujarStock: function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;
        this.m_asegurarEstilosStock();
        const e = this.m_esc, kg = n => this.m_kg(n);

        const todos = this.listaAcopioCalculado || [];
        const establecimientosUnicos = [...new Set(todos.map(s => (s.establecimiento || 'CENTRAL').trim().toUpperCase()).filter(Boolean))].sort();
        const cultivosUnicos = [...new Set(todos.flatMap(s => Object.keys(s.resumen_cultivos || {})))].sort();

        // Filtros (sin la búsqueda de texto: los chips muestran totales por establecimiento sin depender de lo escrito)
        const filtrados = this.m_obtenerDatosFiltrados();
        const vacios = filtrados.filter(s => (Number(s.kg_disponibles_reales) || 0) <= 0).length;
        const visibles = this.mostrarVacios ? filtrados : filtrados.filter(s => (Number(s.kg_disponibles_reales) || 0) > 0);

        // Indicadores
        const tot = { stock: 0, silos: 0, nSilos: 0, galpon: 0, nGalpon: 0, trasl: 0, desp: 0, recep: 0 };
        filtrados.forEach(s => {
            const k = Number(s.kg_disponibles_reales) || 0;
            tot.stock += k;
            if (this.m_esSilo(s)) { tot.silos += k; if (k > 0) tot.nSilos++; }
            else { tot.galpon += k; if (k > 0) tot.nGalpon++; }
            (s.partidas_incluidas || [s]).forEach(p => { if (p.origen_traslado) tot.trasl += Number(p.kg_disponibles_reales) || 0; });
            tot.desp += Number(s.kg_despachados_totales) || 0;
            tot.recep += Number(s.kg_recepcionados_totales) || 0;
        });
        const idxRecep = tot.desp > 0 ? (tot.recep / tot.desp) * 100 : null;

        const kgPorEst = {};
        todos.forEach(s => { const est = (s.establecimiento || 'CENTRAL').trim().toUpperCase(); kgPorEst[est] = (kgPorEst[est] || 0) + (Number(s.kg_disponibles_reales) || 0); });

        visor.innerHTML = `
            <div class="stk animated fadeIn">
                <div class="stk-top">
                    ${window.ComponentesUI && ComponentesUI.botonVolverHTML ? ComponentesUI.botonVolverHTML('PRODUCCION') : ''}
                    <h2>Stock de granos</h2>
                    <div class="stk-seg">
                        <button class="${this.vistaStock !== 'TABLA' ? 'on' : ''}" onclick="ModuloStock.m_cambiarVista('VISUAL')">▦ Visual</button>
                        <button class="${this.vistaStock === 'TABLA' ? 'on' : ''}" onclick="ModuloStock.m_cambiarVista('TABLA')">☰ Tabla</button>
                    </div>
                    <div class="stk-acc">
                        <button class="stk-btn azul" onclick="ModuloStock.m_abrirModalMapaGlobal()">📍 Satélite</button>
                        <button class="stk-btn" onclick="ModuloStock.m_exportarExcel()">Excel</button>
                        <button class="stk-btn" onclick="ModuloStock.m_exportarPDF()">PDF</button>
                    </div>
                </div>

                <div class="stk-kpis">
                    <div class="stk-kpi fuerte"><span>Stock total</span><b>${kg(tot.stock)}</b></div>
                    <div class="stk-kpi"><span><i class="ico-bolsa"></i>En el campo · silos bolsa</span><b>${kg(tot.silos)}</b><small>${tot.nSilos} silo(s) con grano</small></div>
                    <div class="stk-kpi"><span><i class="ico-galpon"></i>En galpones / depósitos</span><b>${kg(tot.galpon)}</b><small>${tot.nGalpon} depósito(s)</small></div>
                    <div class="stk-kpi azul"><span>Llegó por traslado</span><b>${kg(tot.trasl)}</b><small>hoy guardado en otro lugar</small></div>
                    <div class="stk-kpi ${idxRecep === null ? '' : (idxRecep < 98 ? 'rojo' : (idxRecep < 99.5 ? 'ambar' : 'verde'))}"><span>Despachado · recepción</span><b>${kg(tot.desp)}</b><small>${idxRecep === null ? 'sin despachos' : `recibido ${idxRecep.toFixed(1)}% (${(tot.recep - tot.desp >= 0 ? '+' : '') + this.m_num(tot.recep - tot.desp)} kg)`}</small></div>
                </div>

                <div class="stk-filtros">
                    <div class="stk-chips">
                        <button class="stk-chip ${this.filtroEstablecimiento === 'TODOS' ? 'on' : ''}" onclick="ModuloStock.m_filtrarEstablecimiento('TODOS')">Todos <em>${kg(Object.values(kgPorEst).reduce((a, b) => a + b, 0))}</em></button>
                        ${establecimientosUnicos.map(est => `<button class="stk-chip ${this.filtroEstablecimiento.toUpperCase() === est ? 'on' : ''}" onclick="ModuloStock.m_filtrarEstablecimiento(${this.m_jsStr(est)})">${e(est)} <em>${kg(kgPorEst[est] || 0)}</em></button>`).join('')}
                    </div>
                    <div class="stk-seg chico">
                        ${[['TODOS', 'Todo'], ['SILO', 'Silos bolsa'], ['DEPOSITO', 'Galpones']].map(([v, t]) => `<button class="${this.filtroInfraestructura === v ? 'on' : ''}" onclick="ModuloStock.m_filtrarInfraestructura('${v}')">${t}</button>`).join('')}
                    </div>
                    <div class="stk-chips">
                        <button class="stk-chip ${this.filtroCultivo === 'TODOS' ? 'on' : ''}" onclick="ModuloStock.m_filtrarCultivo('TODOS')">Todos los cultivos</button>
                        ${cultivosUnicos.map(c => `<button class="stk-chip ${this.filtroCultivo.toUpperCase() === c ? 'on' : ''}" onclick="ModuloStock.m_filtrarCultivo(${this.m_jsStr(c)})"><i style="background:${this.m_colorCultivo(c)}"></i>${e(c)}</button>`).join('')}
                    </div>
                    <div class="stk-buscar"><input type="text" id="stk-buscar" placeholder="Buscar silo, galpón, campo, lote…" value="${e(this.textoBusqueda || '')}" oninput="ModuloStock.m_buscar(this.value)"></div>
                    ${vacios ? `<button class="stk-link" onclick="ModuloStock.m_toggleVacios()">${this.mostrarVacios ? 'Ocultar' : 'Mostrar'} ${vacios} vacío(s)</button>` : ''}
                </div>

                <div class="stk-main">
                    <div class="stk-izq scroll-apple" id="stk-izq">
                        ${this.vistaStock === 'TABLA' ? this.m_htmlTabla(visibles) : this.m_htmlVisual(visibles)}
                    </div>
                    <aside class="stk-der scroll-apple">${this.m_htmlPanelCultivos(filtrados, tot.stock)}</aside>
                </div>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
    },

    m_exportarPDF: function() {
        const datos = (typeof this._m_obtenerStockFiltradoExport === 'function') 
            ? this._m_obtenerStockFiltradoExport() 
            : (typeof this.m_obtenerDatosFiltrados === 'function' ? this.m_obtenerDatosFiltrados() : (this.listaAcopioCalculado || this.datosSilos || []));

        if (!datos || datos.length === 0) {
            return ModuloStock.m_notificar("No hay registros de stock cargados para exportar.", "alerta");
        }

        const esElectron = typeof require === 'function' && typeof process !== 'undefined';
        
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
                console.warn("Fallo importación Node jsPDF:", e);
            }
        }

        const folio = (typeof generarFolio === 'function') ? generarFolio('STK') : `STK-${Date.now().toString().slice(-6)}`;
        const hoyStr = new Date().toISOString().split('T')[0];
        const emitido = new Date().toLocaleString('es-AR');
        const operario = (typeof operarioName !== 'undefined' ? operarioName : (window.operarioGlobal || 'ADMINISTRADOR')).toUpperCase();

        const confTema = typeof SALVUCCI_CONF !== 'undefined' ? SALVUCCI_CONF : {
            rgbTema: [30, 107, 76],
            rgbTemaDark: [18, 63, 44],
            empresaDomicilio: 'Auditoría Central de Almacenamiento, Silos y Galpones',
            pieInstitucional: 'Sistemas de Gestión Agrosoft J&L - Chimpay R.N. - Contacto: jsosa190585@gmail.com'
        };

        let sumaOriginal = 0;
        let sumaDespachado = 0;
        let sumaRecepcionado = 0;
        let sumaNeto = 0;

        datos.forEach(s => {
            const orig = Number(s.kg_originales || s.kg_en_silo || 0);
            const neto = Number(s.kg_disponibles_reales !== undefined ? s.kg_disponibles_reales : orig);
            const desp = Number(s.kg_despachados_totales !== undefined ? s.kg_despachados_totales : Math.max(0, orig - neto));
            const rec = Number(s.kg_recepcionados_totales !== undefined ? s.kg_recepcionados_totales : desp);
            
            sumaOriginal += orig;
            sumaDespachado += desp;
            sumaRecepcionado += rec;
            sumaNeto += neto;
        });

        // 1. Generación Vectorial Nativa con jsPDF y AutoTable
        if (jsPDFClass) {
            try {
                const doc = new jsPDFClass({ orientation: 'landscape', unit: 'mm', format: 'a4' });
                const pageW = doc.internal.pageSize.getWidth();
                const pageH = doc.internal.pageSize.getHeight();
                const margen = 12;
                const ALTO_HEADER = 38;
                const ALTO_PIE = 14;
                const logoBase64 = typeof cargarLogoBase64 === 'function' ? cargarLogoBase64() : null;

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
                    doc.setFontSize(13);
                    doc.setTextColor(...confTema.rgbTemaDark);
                    doc.text('SALVUCCI GESTIÓN · PANEL DE STOCK E INVENTARIO REAL', xTexto, 12.5);

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(8);
                    doc.setTextColor(85, 99, 88);
                    doc.text(confTema.empresaDomicilio, xTexto, 17);

                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(10.5);
                    doc.setTextColor(...confTema.rgbTema);
                    doc.text('BALANCE FÍSICO DE INFRAESTRUCTURA, BÁSCULA Y EXISTENCIAS', xTexto, 24.5);

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(7.5);
                    doc.setTextColor(110, 120, 115);
                    const filtroTexto = typeof ModuloStock._m_infoFiltroExport === 'function' 
                        ? ModuloStock._m_infoFiltroExport() 
                        : `Celdas e Infraestructuras: ${datos.length} relevadas`;
                    doc.text(filtroTexto, xTexto, 29);

                    const anchoCb = 60;
                    const xCb = pageW - margen - anchoCb;
                    if (typeof dibujarCodigoBarrasPdf === 'function') {
                        dibujarCodigoBarrasPdf(doc, folio, xCb, 6.5, anchoCb, 10);
                    }

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(7.2);
                    doc.setTextColor(90, 100, 95);
                    doc.text(`Emitido: ${emitido}`, pageW - margen, 24, { align: 'right' });
                    doc.text(`Operador: ${operario}`, pageW - margen, 28, { align: 'right' });
                    doc.text(`Stock Neto: ${sumaNeto.toLocaleString('es-AR')} KG   ·   Hoja ${pagina}`, pageW - margen, 32, { align: 'right' });

                    doc.setDrawColor(...confTema.rgbTema);
                    doc.setLineWidth(0.5);
                    doc.line(margen, ALTO_HEADER - 2, pageW - margen, ALTO_HEADER - 2);
                }

                const cabeceras = [['INFRAESTRUCTURA', 'ESTABLECIMIENTO', 'CAMPO', 'CULTIVO / VARIEDAD', 'CAMPAÑA', 'GPS', 'KG ORIGINAL', 'DESPACHADO', 'RECEPCIONADO', 'DIF. BÁSCULA', 'STOCK NETO (KG)']];

                const filas = datos.map(s => {
                    const orig = Number(s.kg_originales || s.kg_en_silo || 0);
                    const neto = Number(s.kg_disponibles_reales !== undefined ? s.kg_disponibles_reales : orig);
                    const desp = Number(s.kg_despachados_totales !== undefined ? s.kg_despachados_totales : Math.max(0, orig - neto));
                    const rec = Number(s.kg_recepcionados_totales !== undefined ? s.kg_recepcionados_totales : desp);
                    const dif = rec - desp;

                    const esSilo = s.silo_n && String(s.silo_n).trim() !== "" && s.silo_n !== '0';
                    const infra = esSilo ? `SILO ${s.silo_n}` : `DEPÓSITO: ${s.deposito || 'TRANSITORIO'}`;
                    const variedadTexto = String(s.variedad != null && s.variedad !== '' ? s.variedad : 'GENERAL').toUpperCase();

                    return [
                        infra.toUpperCase(),
                        String(s.establecimiento || '-').toUpperCase(),
                        String(s.campo || '-').toUpperCase(),
                        `${String(s.cultivo || '-').toUpperCase()} (${variedadTexto})`,
                        String(s.campaña || '2025/2026'),
                        String(s.ubicacion || 'S/D'),
                        orig.toLocaleString('es-AR'),
                        desp.toLocaleString('es-AR'),
                        rec.toLocaleString('es-AR'),
                        `${dif !== 0 ? (dif > 0 ? '+' : '') + dif.toLocaleString('es-AR') : '-'}`,
                        `${neto.toLocaleString('es-AR')} KG`
                    ];
                });

                const autoTableOpts = {
                    head: cabeceras,
                    body: filas,
                    startY: ALTO_HEADER + 4,
                    margin: { left: margen, right: margen, top: ALTO_HEADER + 4, bottom: ALTO_PIE + 6 },
                    theme: 'grid',
                    styles: { font: 'helvetica', fontSize: 6.8, cellPadding: 2, textColor: [30, 30, 30], lineColor: [224, 220, 212], lineWidth: 0.12, valign: 'middle' },
                    headStyles: { fillColor: confTema.rgbTema, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.2, halign: 'center' },
                    alternateRowStyles: { fillColor: [248, 250, 248] },
                    columnStyles: {
                        0: { fontStyle: 'bold', textColor: confTema.rgbTemaDark },
                        3: { fontStyle: 'bold', textColor: confTema.rgbTema },
                        6: { halign: 'right' },
                        7: { halign: 'right', textColor: [198, 40, 40] },
                        8: { halign: 'right', textColor: [46, 125, 50] },
                        9: { halign: 'right', fontStyle: 'bold' },
                        10: { halign: 'right', fontStyle: 'bold', textColor: confTema.rgbTema }
                    },
                    didDrawPage: dibujarEncabezado
                };

                if (doc.autoTable) doc.autoTable(autoTableOpts);
                else autoTableFunc(doc, autoTableOpts);

                let y = ((doc.lastAutoTable && doc.lastAutoTable.finalY) || ALTO_HEADER + 4) + 6;

                // Panel Resumen KPI
                const altoBloque = 36;
                if (y + altoBloque > pageH - ALTO_PIE) {
                    doc.addPage();
                    dibujarEncabezado({ pageNumber: doc.internal.getNumberOfPages() });
                    y = ALTO_HEADER + 6;
                }

                const anchoPanel = pageW - margen * 2;
                doc.setFillColor(248, 250, 248);
                doc.setDrawColor(220, 225, 222);
                doc.setLineWidth(0.25);
                doc.roundedRect(margen, y, anchoPanel, 18, 2, 2, 'FD');

                doc.setFont('helvetica', 'bold');
                doc.setFontSize(7.8);
                doc.setTextColor(...confTema.rgbTema);
                doc.text('RESUMEN GENERAL DE BÁSCULA Y EXISTENCIAS', margen + 5, y + 5);

                const mermaGlobal = sumaRecepcionado - sumaDespachado;
                const itemsRes = [
                    { label: 'CELDAS AUDITADAS', val: String(datos.length) },
                    { label: 'VOLUMEN BRUTO INICIAL', val: `${sumaOriginal.toLocaleString('es-AR')} KG` },
                    { label: 'SALIDA BÁSCULA (CAMPO)', val: `${sumaDespachado.toLocaleString('es-AR')} KG` },
                    { label: 'RECEPCIÓN (PLANTA/DESTINO)', val: `${sumaRecepcionado.toLocaleString('es-AR')} KG` },
                    { label: 'MERMA / DIF. TRANSPORTE', val: `${mermaGlobal.toLocaleString('es-AR')} KG` },
                    { label: 'STOCK NETO DISPONIBLE', val: `${sumaNeto.toLocaleString('es-AR')} KG` }
                ];

                const anchoItem = (anchoPanel - 10) / itemsRes.length;
                itemsRes.forEach((it, idx) => {
                    const xi = margen + 5 + anchoItem * idx;
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(6.2);
                    doc.setTextColor(110, 120, 115);
                    doc.text(it.label, xi, y + 10);
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(9);
                    doc.setTextColor(...confTema.rgbTemaDark);
                    doc.text(it.val, xi, y + 14.8);
                });

                // Panel de Firmas
                const yFirma = y + 28;
                doc.setDrawColor(120, 130, 125);
                doc.setLineWidth(0.25);
                doc.line(margen + 25, yFirma, margen + 95, yFirma);
                doc.line(pageW - margen - 95, yFirma, pageW - margen - 25, yFirma);

                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7.2);
                doc.setTextColor(90, 100, 95);
                doc.text('Responsable de Acopio / Silos', margen + 60, yFirma + 3.8, { align: 'center' });
                doc.text('Auditoría General / Logística', pageW - margen - 60, yFirma + 3.8, { align: 'center' });

                const totalPaginas = doc.internal.getNumberOfPages();
                for (let p = 1; p <= totalPaginas; p++) {
                    doc.setPage(p);
                    doc.setDrawColor(220, 225, 222);
                    doc.setLineWidth(0.2);
                    doc.line(margen, pageH - 10, pageW - margen, pageH - 10);

                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(7);
                    doc.setTextColor(90, 100, 95);
                    doc.text(confTema.pieInstitucional, margen, pageH - 6);

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(6.8);
                    doc.text(`Folio ${folio}   ·   Página ${p} de ${totalPaginas}`, pageW - margen, pageH - 6, { align: 'right' });
                }

                const nombreArchivo = `Panel_Stock_${hoyStr}.pdf`;

                if (esElectron && typeof guardarEnDescargas === 'function') {
                    guardarEnDescargas(nombreArchivo, Buffer.from(doc.output('arraybuffer')));
                    if (this.m_notificarApple) this.m_notificarApple(`✓ PDF guardado en Descargas: ${nombreArchivo}`, "exito");
                    else if (typeof lanzarToast === 'function') lanzarToast(`PDF guardado: ${nombreArchivo}`);
                    else ModuloStock.m_notificar(`PDF guardado en Descargas: ${nombreArchivo}`, "exito");
                } else if (typeof this._m_descargarBlob === 'function') {
                    this._m_descargarBlob(doc.output('blob'), nombreArchivo);
                } else {
                    doc.save(nombreArchivo);
                }
                return;

            } catch (err) {
                console.warn("Fallo motor jsPDF, utilizando respaldo visual:", err);
            }
        }

        // 2. Respaldo Visual de Impresión
        const cbWebBase64 = typeof codigoBarrasPngBase64 === 'function' ? codigoBarrasPngBase64(folio, 320, 50) : '';
        const ventanaImpresion = window.open('', '_blank');
        ventanaImpresion.document.write(`
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Salvucci Gestión - Panel de Stock</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap');
                    @page { size: landscape; margin: 10mm; }
                    body { font-family: 'Roboto', sans-serif; color: #211C16; padding: 25px; margin: 0; background: #FFFFFF; font-size: 11px; }
                    .header-pdf-premium { border-bottom: 2.5px solid #1E6B4C; padding: 14px 18px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; background: #F8FAF8; border-radius: 8px; border: 1px solid #D2D7D3; }
                    .logo-box { width: 55px; height: 55px; display: flex; align-items: center; justify-content: center; margin-right: 14px; }
                    .logo-box img { width: 100%; height: 100%; object-fit: contain; }
                    .titulos h1 { margin: 0; font-size: 16px; font-weight: 900; color: #123F2C; }
                    .titulos h2 { margin: 2px 0 0 0; font-size: 10px; color: #1E6B4C; font-weight: 800; text-transform: uppercase; }
                    .kpi-tile-top { background: #FFFFFF; border: 1px solid #C8E6C9; padding: 6px 14px; border-radius: 6px; text-align: right; }
                    table { width: 100%; border-collapse: collapse; font-size: 9px; margin-top: 8px; }
                    th { background: #1E6B4C; color: #FFFFFF; text-align: left; padding: 6px 7px; font-weight: 700; text-transform: uppercase; font-size: 8px; }
                    td { padding: 5px 7px; border-bottom: 1px solid #E2E8F0; }
                    tr:nth-child(even) { background: #FAFBFA; }
                    .footer-firma-fija { margin-top: 25px; border-top: 1px solid #D2D7D3; padding-top: 15px; display: flex; justify-content: space-between; align-items: center; font-size: 9px; color: #556358; }
                </style>
            </head>
            <body>
                <div class="header-pdf-premium">
                    <div style="display:flex; align-items:center;">
                        <div class="logo-box"><img src="logo.png" onerror="this.style.display='none';" /></div>
                        <div class="titulos">
                            <h2>SALVUCCI GESTIÓN · STOCK DE ACOPIO</h2>
                            <h1>PANEL DE STOCK E INVENTARIO REAL</h1>
                            <p>${confTema.empresaDomicilio} · Operador: ${operario}</p>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:16px;">
                        ${cbWebBase64 ? `<img src="${cbWebBase64}" style="height:38px;" />` : ''}
                        <div class="kpi-tile-top">
                            <div style="font-size:8.5px; color:#556358; font-weight:700; text-transform:uppercase;">Stock Neto Disponible</div>
                            <div style="font-size:15px; font-weight:900; color:#1E6B4C;">${sumaNeto.toLocaleString('es-AR')} KG</div>
                            <small style="font-size:8px; color:#556358;">Original: ${sumaOriginal.toLocaleString('es-AR')} KG | Despacho: ${sumaDespachado.toLocaleString('es-AR')} KG</small>
                        </div>
                    </div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>INFRAESTRUCTURA</th><th>ESTABLECIMIENTO</th><th>CAMPO</th><th>CULTIVO / VARIEDAD</th>
                            <th>CAMPAÑA</th><th>GPS</th><th style="text-align:right;">ORIGINAL KG</th>
                            <th style="text-align:right;">DESPACHADO</th><th style="text-align:right;">RECEPCIÓN</th><th style="text-align:right;">NETO ACTUAL</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${datos.map(s => {
                            const orig = Number(s.kg_originales || s.kg_en_silo || 0);
                            const neto = Number(s.kg_disponibles_reales !== undefined ? s.kg_disponibles_reales : orig);
                            const desp = Number(s.kg_despachados_totales !== undefined ? s.kg_despachados_totales : Math.max(0, orig - neto));
                            const rec = Number(s.kg_recepcionados_totales !== undefined ? s.kg_recepcionados_totales : desp);

                            const esSilo = s.silo_n && String(s.silo_n).trim() !== "" && s.silo_n !== '0';
                            const infra = esSilo ? `SILO ${s.silo_n}` : `DEPÓSITO: ${s.deposito || 'TRANSITORIO'}`;
                            const variedadTexto = String(s.variedad != null && s.variedad !== '' ? s.variedad : 'GENERAL').toUpperCase();

                            return `
                                <tr>
                                    <td><b>${infra}</b></td>
                                    <td>${String(s.establecimiento || '-').toUpperCase()}</td>
                                    <td>${String(s.campo || '-').toUpperCase()}</td>
                                    <td><strong style="color:#1E6B4C;">${String(s.cultivo ||'').toUpperCase()}</strong> (${variedadTexto})</td>
                                    <td>${s.campaña || '-'}</td>
                                    <td>${s.ubicacion || 'S/D'}</td>
                                    <td style="text-align:right;">${orig.toLocaleString('es-AR')}</td>
                                    <td style="text-align:right; color:#C62828;">-${desp.toLocaleString('es-AR')}</td>
                                    <td style="text-align:right; color:#2E7D32;">+${rec.toLocaleString('es-AR')}</td>
                                    <td style="text-align:right; font-weight:bold; color:${neto <= 0 ? '#C62828' : '#1E6B4C'};">${neto.toLocaleString('es-AR')} KG</td>
                                </tr>
                            `;
                        }).join('')}
                        <tr style="background:#ECEFF1; font-weight:bold;">
                            <td colspan="6">TOTALES GENERALES</td>
                            <td style="text-align:right;">${sumaOriginal.toLocaleString('es-AR')} KG</td>
                            <td style="text-align:right; color:#C62828;">-${sumaDespachado.toLocaleString('es-AR')} KG</td>
                            <td style="text-align:right; color:#2E7D32;">+${sumaRecepcionado.toLocaleString('es-AR')} KG</td>
                            <td style="text-align:right; color:#1E6B4C;">${sumaNeto.toLocaleString('es-AR')} KG</td>
                        </tr>
                    </tbody>
                </table>

                <div class="footer-firma-fija">
                    <span>${confTema.pieInstitucional}</span>
                    <span>Folio: ${folio} · Emitido: ${emitido}</span>
                    <span style="font-weight:bold;">Firma Responsable Acopio: ___________________________</span>
                </div>

                <script>
                    window.onload = function() { setTimeout(() => { window.print(); window.close(); }, 350); };
                </script>
            </body>
            </html>
        `);
        ventanaImpresion.document.close();
    },

    m_exportarExcel: async function() {
        const datos = (typeof this._m_obtenerStockFiltradoExport === 'function') 
            ? this._m_obtenerStockFiltradoExport() 
            : (typeof this.m_obtenerDatosFiltrados === 'function' ? this.m_obtenerDatosFiltrados() : (this.listaAcopioCalculado || this.datosSilos || []));

        if (!datos || datos.length === 0) {
            return ModuloStock.m_notificar("No hay registros de stock cargados para exportar.", "alerta");
        }

        let ExcelJS = null;
        if (typeof window !== 'undefined' && window.ExcelJS) {
            ExcelJS = window.ExcelJS;
        } else if (typeof require === 'function') {
            try { ExcelJS = require('exceljs'); } catch (e) { ExcelJS = null; }
        }

        if (!ExcelJS) {
            return this.m_exportarCsvStockFallback(datos);
        }

        const esElectron = typeof require === 'function' && typeof process !== 'undefined';
        const folio = (typeof generarFolio === 'function') ? generarFolio('STK') : `STK-${Date.now().toString().slice(-6)}`;
        const hoyStr = new Date().toISOString().split('T')[0];
        const emitido = new Date().toLocaleString('es-AR');
        const operario = (typeof operarioName !== 'undefined' ? operarioName : (window.operarioGlobal || 'ADMINISTRADOR')).toUpperCase();

        const confTema = typeof SALVUCCI_CONF !== 'undefined' ? SALVUCCI_CONF : {
            argbDark: 'FF104630',
            argbTema: 'FF1E6B4C',
            empresaRazon: 'SALVUCCI GESTIÓN · AGROSOFT J&L',
            empresaDomicilio: 'Auditoría Central de Almacenamiento, Silos y Galpones',
            pieInstitucional: 'Sistemas de Gestión Agrosoft J&L - Chimpay R.N. - Contacto: jsosa190585@gmail.com'
        };

        const columnas = [
            { header: 'REG. ACOPIO', key: 'registro', width: 14, halign: 'center' },
            { header: 'INFRAESTRUCTURA', key: 'infra', width: 22 },
            { header: 'ESTABLECIMIENTO', key: 'establecimiento', width: 22 },
            { header: 'CAMPO', key: 'campo', width: 18 },
            { header: 'LOTE', key: 'lote', width: 12, halign: 'center' },
            { header: 'CULTIVO', key: 'cultivo', width: 18, halign: 'center' },
            { header: 'VARIEDAD', key: 'variedad', width: 18 },
            { header: 'CAMPAÑA', key: 'campana', width: 14, halign: 'center' },
            { header: 'COORDENADAS GPS', key: 'ubicacion', width: 22 },
            { header: 'KG ORIGINALES', key: 'kg_originales', width: 18, halign: 'right', numero: true },
            { header: 'KG DESPACHADOS', key: 'kg_despachados', width: 18, halign: 'right', numero: true },
            { header: 'KG RECEPCIONADOS', key: 'kg_recepcionados', width: 18, halign: 'right', numero: true },
            { header: 'MERMA BÁSCULA (KG)', key: 'merma_kilos', width: 18, halign: 'right', numero: true },
            { header: 'STOCK NETO DISPONIBLE', key: 'stock_neto', width: 22, halign: 'right', numero: true, destacada: true },
            { header: 'DENSIDAD (KG/M)', key: 'densidad', width: 16, halign: 'right', numero: true },
            { header: 'METROS SILO', key: 'metros', width: 16, halign: 'right', numero: true }
        ];

        // Mapeo seguro forzando String() en variedad para evitar la excepción
        const filasProcesadas = datos.map(s => {
            const orig = Number(s.kg_originales || s.kg_en_silo || 0);
            const neto = Number(s.kg_disponibles_reales !== undefined ? s.kg_disponibles_reales : orig);
            const desp = Number(s.kg_despachados_totales !== undefined ? s.kg_despachados_totales : Math.max(0, orig - neto));
            const rec = Number(s.kg_recepcionados_totales !== undefined ? s.kg_recepcionados_totales : desp);
            const merma = Number(s.merma_acumulada_kg !== undefined ? s.merma_acumulada_kg : (rec - desp));

            const esSilo = s.silo_n && String(s.silo_n).trim() !== "" && s.silo_n !== '0';
            const infra = esSilo ? `SILO N° ${s.silo_n}` : `DEPÓSITO: ${s.deposito || 'TRANSITORIO'}`;

            // Conversión segura de tipo de dato
            const variedadTexto = String(s.variedad != null && s.variedad !== '' ? s.variedad : 'GENERAL').toUpperCase();

            return {
                registro: String(s.registro_aco || s.id || ''),
                infra: infra.toUpperCase(),
                establecimiento: String(s.establecimiento || '-').toUpperCase(),
                campo: String(s.campo || '-').toUpperCase(),
                lote: `Lote ${s.lote || 0}`,
                cultivo: String(s.cultivo || '-').toUpperCase(),
                variedad: variedadTexto,
                campana: String(s.campaña || '2025/2026'),
                ubicacion: String(s.ubicacion || 'S/D'),
                kg_originales: orig,
                kg_despachados: desp,
                kg_recepcionados: rec,
                merma_kilos: merma,
                stock_neto: neto,
                densidad: parseFloat(s.kg_mtr_silo || 0),
                metros: parseFloat(s.mtrs_silo || 0)
            };
        });

        try {
            const wb = new ExcelJS.Workbook();
            wb.creator = 'Salvucci Gestión · AgroSoft J&L';
            wb.created = new Date();

            // -------------------------------------------------------------
            // HOJA 1: AUDITORÍA Y DISPONIBILIDAD DE STOCK
            // -------------------------------------------------------------
            const ws = wb.addWorksheet('Inventario y Stock Real', {
                views: [{ state: 'frozen', ySplit: 5 }],
                pageSetup: {
                    orientation: 'landscape',
                    fitToPage: true,
                    fitToWidth: 1,
                    fitToHeight: 0,
                    paperSize: 9,
                    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 }
                }
            });

            ws.columns = columnas.map(c => ({ header: c.header, key: c.key, width: c.width }));
            filasProcesadas.forEach(f => ws.addRow(f));

            ws.spliceRows(1, 0, [], [], [], []);
            const nCols = columnas.length;

            ws.getRow(1).height = 34;
            ws.getRow(2).height = 16;
            ws.getRow(3).height = 15;
            ws.getRow(4).height = 15;

            for (let r = 1; r <= 4; r++) ws.mergeCells(r, 2, r, nCols);

            const cTitulo = ws.getCell(1, 2);
            cTitulo.value = 'SALVUCCI GESTIÓN — BALANCE FÍSICO DE STOCK Y RECEPCIÓN';
            cTitulo.font = { bold: true, size: 14, color: { argb: confTema.argbDark } };
            cTitulo.alignment = { vertical: 'middle', horizontal: 'left' };

            const cSub = ws.getCell(2, 2);
            cSub.value = 'Inventario consolidado de silos y galpones, control de mermas y auditoría de báscula';
            cSub.font = { italic: true, size: 9.5, color: { argb: 'FF556358' } };
            cSub.alignment = { vertical: 'middle', horizontal: 'left' };

            const cEmpresa = ws.getCell(3, 2);
            cEmpresa.value = `${confTema.empresaRazon} — ${confTema.empresaDomicilio}`;
            cEmpresa.font = { size: 8.5, color: { argb: 'FF556358' } };
            cEmpresa.alignment = { vertical: 'middle', horizontal: 'left' };

            const cMeta = ws.getCell(4, 2);
            cMeta.value = `Folio: ${folio}   ·   Emitido: ${emitido}   ·   Operador: ${operario}   ·   Celdas Relevadas: ${filasProcesadas.length}`;
            cMeta.font = { bold: true, size: 8.5, color: { argb: confTema.argbTema } };
            cMeta.alignment = { vertical: 'middle', horizontal: 'left' };

            // Inserción de Logo
            if (typeof cargarLogoBase64 === 'function') {
                const logoBase64 = cargarLogoBase64();
                if (logoBase64) {
                    try {
                        const idLogo = wb.addImage({ base64: 'data:image/png;base64,' + logoBase64, extension: 'png' });
                        ws.addImage(idLogo, { tl: { col: 0.1, row: 0.1 }, ext: { width: 70, height: 70 }, editAs: 'oneCell' });
                    } catch (e) { console.warn('Logo no incrustado:', e.message); }
                }
            }

            // Inserción de Código de Barras
            if (typeof codigoBarrasPngBase64 === 'function') {
                const cbBase64 = codigoBarrasPngBase64(folio, 420, 62);
                if (cbBase64) {
                    try {
                        const idCb = wb.addImage({ base64: cbBase64, extension: 'png' });
                        ws.addImage(idCb, { tl: { col: Math.max(nCols - 3, 2), row: 0.12 }, ext: { width: 220, height: 44 }, editAs: 'oneCell' });
                    } catch (e) { console.warn('Código de barras no incrustado:', e.message); }
                }
            }

            // Cabecera de la tabla (Fila 5)
            const filaHead = ws.getRow(5);
            filaHead.height = 24;
            filaHead.eachCell({ includeEmpty: true }, cell => {
                cell.font = { bold: true, size: 9.2, color: { argb: 'FFFFFFFF' } };
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
                    cell.alignment = { vertical: 'middle', horizontal: c.halign || 'left' };
                    cell.font = { size: 9, bold: !!c.destacada };
                    cell.border = {
                        top: { style: 'hair', color: { argb: 'FFD2D7D3' } },
                        bottom: { style: 'hair', color: { argb: 'FFD2D7D3' } }
                    };

                    if (c.numero) {
                        cell.numFmt = '#,##0.00';
                    }

                    if (c.key === 'kg_despachados') cell.font = { size: 9, color: { argb: 'FFC62828' } };
                    if (c.key === 'kg_recepcionados') cell.font = { size: 9, color: { argb: 'FF2E7D32' } };
                    if (c.key === 'merma_kilos') {
                        const v = Number(cell.value || 0);
                        cell.font = { size: 8.5, bold: true, color: { argb: v < 0 ? 'FFC62828' : (v > 0 ? 'FF2E7D32' : 'FF556358') } };
                    }
                    if (c.key === 'stock_neto') {
                        const v = Number(cell.value || 0);
                        cell.font = { size: 9.5, bold: true, color: { argb: v > 0 ? confTema.argbDark : 'FFC62828' } };
                    }
                });

                if ((r - primeraFila) % 2 === 1) {
                    fila.eachCell({ includeEmpty: true }, cell => {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FBF9' } };
                    });
                }
            }

            // Fila de Totales con fórmula nativa SUM()
            if (filasProcesadas.length > 0) {
                const filaTot = ws.getRow(ultimaFila + 2);
                filaTot.height = 22;
                columnas.forEach((c, i) => {
                    const cell = filaTot.getCell(i + 1);
                    if (i === 0) {
                        cell.value = 'TOTALES GENERALES →';
                    } else if (['kg_originales', 'kg_despachados', 'kg_recepcionados', 'merma_kilos', 'stock_neto'].includes(c.key)) {
                        const colLetra = cell.address.replace(/\d+$/, '');
                        cell.value = { formula: `SUM(${colLetra}${primeraFila}:${colLetra}${ultimaFila})` };
                        cell.numFmt = '#,##0.00';
                    }
                    cell.font = { bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: confTema.argbDark } };
                    cell.alignment = { vertical: 'middle', horizontal: c.halign || 'left' };
                });
            }

            ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: Math.max(ultimaFila, 5), column: nCols } };
            const pieXls = `&L&"Arial,Bold"&8${confTema.pieInstitucional}&R&8Folio ${folio} · Página &P de &N`;
            ws.headerFooter = { oddFooter: pieXls, evenFooter: pieXls };
            ws.pageSetup.printTitlesRow = '5:5';

            // -------------------------------------------------------------
            // HOJA 2: RESUMEN EJECUTIVO Y AUDITORÍA DE RECEPCIÓN
            // -------------------------------------------------------------
            const wsRes = wb.addWorksheet('Resumen de Existencias');
            wsRes.columns = [
                { header: 'INDICADOR DE GESTIÓN', key: 'label', width: 36 },
                { header: 'VALOR AUDITADO', key: 'valor', width: 24 }
            ];

            wsRes.getRow(1).height = 22;
            wsRes.getRow(1).eachCell(cell => {
                cell.font = { bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: confTema.argbTema } };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            });

            const totOriginal = filasProcesadas.reduce((a, b) => a + b.kg_originales, 0);
            const totDesp = filasProcesadas.reduce((a, b) => a + b.kg_despachados, 0);
            const totRec = filasProcesadas.reduce((a, b) => a + b.kg_recepcionados, 0);
            const totNeto = filasProcesadas.reduce((a, b) => a + b.stock_neto, 0);
            const totMerma = totRec - totDesp;
            const pctEntrega = totDesp > 0 ? ((totRec / totDesp) * 100).toFixed(2) + '%' : '100.00%';

            const resumenKpis = [
                { label: 'Total Infraestructuras Relevadas', valor: String(filasProcesadas.length) },
                { label: 'Volumen Histórico Ingresado', valor: `${totOriginal.toLocaleString('es-AR')} KG` },
                { label: 'Kilos Egresados en Báscula (Campo)', valor: `${totDesp.toLocaleString('es-AR')} KG` },
                { label: 'Kilos Confirmados en Recepción', valor: `${totRec.toLocaleString('es-AR')} KG` },
                { label: 'Diferencia Acumulada / Merma', valor: `${totMerma.toLocaleString('es-AR')} KG` },
                { label: 'Eficiencia / Índice de Entrega', valor: pctEntrega },
                { label: 'Stock Físico Neto Disponible', valor: `${totNeto.toLocaleString('es-AR')} KG` },
                { label: 'Folio de Auditoría', valor: folio },
                { label: 'Fecha y Hora de Emisión', valor: emitido },
                { label: 'Operador Responsable', valor: operario },
                { label: 'Sistema', valor: 'Salvucci Gestión · AgroSoft J&L' }
            ];

            resumenKpis.forEach(r => wsRes.addRow(r));
            wsRes.headerFooter = { oddFooter: pieXls, evenFooter: pieXls };

            // -------------------------------------------------------------
            // DESCARGA HÍBRIDA
            // -------------------------------------------------------------
            const nombreArchivo = `Salvucci_Stock_Inventario_${hoyStr}.xlsx`;
            const buffer = await wb.xlsx.writeBuffer();

            if (esElectron && typeof guardarEnDescargas === 'function') {
                guardarEnDescargas(nombreArchivo, Buffer.from(buffer));
                if (typeof lanzarToast === 'function') lanzarToast(`Excel guardado en Descargas: ${nombreArchivo}`);
                else if (window.ComponentesUI?.notificar) window.ComponentesUI.notificar('exito', `Excel guardado: ${nombreArchivo}`);
                else ModuloStock.m_notificar(`Excel generado en Descargas: ${nombreArchivo}`, "exito");
            } else if (typeof descargarNativoBlob === 'function') {
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                descargarNativoBlob(blob, nombreArchivo);
            } else {
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.setAttribute("download", nombreArchivo);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }

        } catch (err) {
            console.error("❌ Error generando Excel de stock:", err);
            this.m_exportarCsvStockFallback(datos);
        }
    },

    m_exportarCsvStockFallback: function(datos) {
        const headers = [
            "REGISTRO ACOPIO", "INFRAESTRUCTURA", "ESTABLECIMIENTO", "CAMPO", "LOTE", 
            "CULTIVO", "VARIEDAD", "CAMPAÑA", "COORDENADAS GPS", "KG ORIGINALES", 
            "KG DESPACHADOS", "KG RECEPCIONADOS", "MERMA BÁSCULA", "STOCK NETO (KG)", 
            "DENSIDAD (KG/M)", "METROS LINEALES"
        ];
        
        let csvContent = "\uFEFF" + headers.join(";") + "\n";
        datos.forEach(s => {
            const orig = Number(s.kg_originales || s.kg_en_silo || 0);
            const neto = Number(s.kg_disponibles_reales !== undefined ? s.kg_disponibles_reales : orig);
            const desp = Number(s.kg_despachados_totales !== undefined ? s.kg_despachados_totales : Math.max(0, orig - neto));
            const rec = Number(s.kg_recepcionados_totales !== undefined ? s.kg_recepcionados_totales : desp);
            const merma = Number(s.merma_acumulada_kg !== undefined ? s.merma_acumulada_kg : (rec - desp));

            const esSilo = s.silo_n && String(s.silo_n).trim() !== "" && s.silo_n !== '0';
            const infra = esSilo ? `SILO N° ${s.silo_n}` : `DEPÓSITO: ${s.deposito || 'TRANSITORIO'}`;
            const variedadTexto = String(s.variedad != null && s.variedad !== '' ? s.variedad : 'GENERAL');

            const fila = [
                s.registro_aco || s.id,
                `"${infra}"`,
                `"${s.establecimiento || ''}"`,
                `"${s.campo || ''}"`,
                s.lote || 0,
                `"${s.cultivo || ''}"`,
                `"${variedadTexto}"`,
                `"${s.campaña || ''}"`,
                `"${s.ubicacion || ''}"`,
                orig,
                desp,
                rec,
                merma,
                neto,
                s.kg_mtr_silo || 0,
                s.mtrs_silo || 0
            ];
            csvContent += fila.join(";") + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.setAttribute("download", `Salvucci_Stock_Inventario_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },
    m_abrirMenuAccionesConsolidado: function(idAco) {
        this.m_asegurarModalBase();
        const silo = this.listaAcopioCalculado.find(s => s.registro_aco == idAco);
        if (!silo) return;

        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        const modalContent = document.querySelector('.modal-apple-content');
        
        if (modalContent) modalContent.style.maxWidth = '520px';
        if (modal) modal.style.display = 'flex';
        
        const labelInfra = silo.silo_n ? 'SILO ' + silo.silo_n : 'DEPÓSITO ' + (silo.deposito || 'TRANSITORIO');
        document.getElementById('modal-titulo').innerText = `GESTIÓN: ${labelInfra}`;

        const desgloseCultivosTxt = Object.entries(silo.resumen_cultivos || {})
            .map(([c, k]) => `<b>${c}:</b> ${k.toLocaleString('es-AR')} KG`)
            .join(' &bull; ');

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:10px; font-family:'Roboto', sans-serif;">
                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 12px 14px; border-radius: 10px; font-size: 0.8rem; line-height: 1.5;">
                    <span>Infraestructura: <b style="color:#1D1D1F;">${labelInfra}</b></span><br>
                    <span>Establecimiento: <b style="color:#1D1D1F;">${silo.establecimiento}</b></span><br>
                    <span>Stock Disponible: <b style="color:#1FA958; font-size:0.95rem;">${silo.kg_disponibles_reales.toLocaleString('es-AR')} KG</b></span><br>
                    <div style="margin-top:4px; padding-top:4px; border-top:1px dashed #D1D5DB; font-size:0.75rem; color:#123F2C;">
                        ${desgloseCultivosTxt || 'Sin stock cargado'}
                    </div>
                </div>

                <button onclick="ModuloStock.m_verHistorialDeposito('${silo.registro_aco}');" style="display:flex; align-items:center; gap:12px; background:#FFFFFF; border:1px solid #E0DCD4; padding:12px; border-radius:10px; cursor:pointer; text-align:left;">
                    <div style="background:rgba(0,113,227,0.1); color:#0071E3; width:34px; height:34px; border-radius:8px; display:flex; align-items:center; justify-content:center;">
                        <i data-lucide="history" style="width:18px; height:18px;"></i>
                    </div>
                    <div>
                        <strong style="font-size:0.85rem; color:#1D1D1F; display:block;">Historial de Trazabilidad y Báscula</strong>
                        <span style="font-size:0.7rem; color:#6B6255;">Ver traslados de entrada, despachos y mermas</span>
                    </div>
                </button>

                ${silo.kg_disponibles_reales > 0 ? `
                    <button onclick="document.getElementById('modal-agrosoft').style.display='none'; ModuloStock.m_abrirModalTrasladoGalpon('${silo.registro_aco}');" style="display:flex; align-items:center; gap:12px; background:#FFFFFF; border:1px solid #E0DCD4; padding:12px; border-radius:10px; cursor:pointer; text-align:left;">
                        <div style="background:rgba(224,134,0,0.1); color:#E08600; width:34px; height:34px; border-radius:8px; display:flex; align-items:center; justify-content:center;">
                            <i data-lucide="arrow-right-left" style="width:18px; height:18px;"></i>
                        </div>
                        <div>
                            <strong style="font-size:0.85rem; color:#1D1D1F; display:block;">Mover / Trasladar Kilos</strong>
                            <span style="font-size:0.7rem; color:#6B6255;">Transferir cereal hacia otro galpón o silo</span>
                        </div>
                    </button>

                    <button onclick="document.getElementById('modal-agrosoft').style.display='none'; ModuloStock.m_abrirModalEgreso(null, '${silo.registro_aco}');" style="display:flex; align-items:center; gap:12px; background:#FFFFFF; border:1px solid #E0DCD4; padding:12px; border-radius:10px; cursor:pointer; text-align:left;">
                        <div style="background:rgba(30,107,76,0.1); color:#1E6B4C; width:34px; height:34px; border-radius:8px; display:flex; align-items:center; justify-content:center;">
                            <i data-lucide="badge-dollar-sign" style="width:18px; height:18px;"></i>
                        </div>
                        <div>
                            <strong style="font-size:0.85rem; color:#1D1D1F; display:block;">Despacho de Venta (Valorizado)</strong>
                            <span style="font-size:0.7rem; color:#6B6255;">Registrar egreso con remito y doble pesaje</span>
                        </div>
                    </button>
                ` : ''}
            </div>
        `;
        if (window.lucide) lucide.createIcons();
    },

    m_verHistorialDeposito: function(idAco) {
        const silo = this.listaAcopioCalculado.find(s => s.registro_aco == idAco);
        if (!silo) return;

        const container = document.getElementById('modal-formulario');
        const modalContent = document.querySelector('.modal-apple-content');
        if (modalContent) modalContent.style.maxWidth = '900px';

        document.getElementById('modal-titulo').innerText = `TRAZABILIDAD Y BÁSCULA: ${silo.deposito || 'DEPÓSITO'}`;

        const partidasIds = silo.partidas_incluidas ? silo.partidas_incluidas.map(p => String(p.registro_aco)) : [String(idAco)];
        const egresosAsociados = this.datosEgresos.filter(e => partidasIds.includes(String(e.deposito)));

        const totalDespachado = egresosAsociados.reduce((a, b) => a + (Number(b.kilos) || 0), 0);
        const totalRecibido = egresosAsociados.reduce((a, b) => a + (Number(b.cant_recepcionada) || Number(b.kilos) || 0), 0);
        const balanceDiferencia = totalRecibido - totalDespachado;

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                <button onclick="ModuloStock.m_abrirMenuAccionesConsolidado('${idAco}')" style="align-self:flex-start; background:#F0F2F5; border:1px solid #E0DCD4; border-radius:8px; padding:5px 12px; font-size:0.75rem; font-weight:bold; cursor:pointer;">
                    &larr; Volver al Menú
                </button>

                <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px;">
                    <div style="background:#FFFDFD; border:1px solid #FCA5A5; padding:8px 12px; border-radius:8px;">
                        <span style="font-size:0.62rem; color:#DC2626; font-weight:bold; text-transform:uppercase;">Total Despachado (Salida Balanza)</span>
                        <h3 style="margin:2px 0 0 0; color:#DC2626; font-family:monospace;">${totalDespachado.toLocaleString('es-AR')} KG</h3>
                    </div>
                    <div style="background:#F0FDF4; border:1px solid #86EFAC; padding:8px 12px; border-radius:8px;">
                        <span style="font-size:0.62rem; color:#16A34A; font-weight:bold; text-transform:uppercase;">Total Recepcionado (Destino Real)</span>
                        <h3 style="margin:2px 0 0 0; color:#16A34A; font-family:monospace;">${totalRecibido.toLocaleString('es-AR')} KG</h3>
                    </div>
                    <div style="background:#F8FAFC; border:1px solid #CBD5E1; padding:8px 12px; border-radius:8px;">
                        <span style="font-size:0.62rem; color:#475569; font-weight:bold; text-transform:uppercase;">Merma / Diferencia Acumulada</span>
                        <h3 style="margin:2px 0 0 0; color:${balanceDiferencia < 0 ? '#DC2626' : '#16A34A'}; font-family:monospace;">
                            ${(balanceDiferencia > 0 ? '+' : '') + balanceDiferencia.toLocaleString('es-AR')} KG
                        </h3>
                    </div>
                </div>

                <div style="background:#FFFFFF; border:1.5px solid #E0DCD4; border-radius:10px; padding:10px;">
                    <strong style="font-size:0.75rem; color:#1E6B4C; display:block; margin-bottom:6px;">📥 PARTIDAS INGRESADAS</strong>
                    <table style="width:100%; border-collapse:collapse; font-size:0.75rem;">
                        <thead>
                            <tr style="background:#F8FAFC; border-bottom:1px solid #E0DCD4; text-align:left; color:#6B6255;">
                                <th style="padding:6px;">Partida</th><th style="padding:6px;">Fecha</th><th style="padding:6px;">Cultivo</th><th style="padding:6px;">Detalle</th><th style="padding:6px; text-align:right;">Ingreso Inicial</th><th style="padding:6px; text-align:right;">Stock Real</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${silo.partidas_incluidas.map(p => `
                                <tr style="border-bottom:1px solid #F1F5F9;">
                                    <td style="padding:6px; font-weight:bold;">#${p.registro_aco}</td>
                                    <td style="padding:6px;">${p.fecha_mov || '-'}</td>
                                    <td style="padding:6px; font-weight:bold; color:${ModuloStock.m_colorCultivo(p.cultivo)};">${(p.cultivo || '-').toUpperCase()}</td>
                                    <td style="padding:6px; font-size:0.7rem; color:#6B6255;">${p.origen_traslado || 'Carga Inicial'}</td>
                                    <td style="padding:6px; text-align:right;">${Number(p.kg_originales).toLocaleString('es-AR')} KG</td>
                                    <td style="padding:6px; text-align:right; font-weight:bold; color:#1FA958;">${Number(p.kg_disponibles_reales).toLocaleString('es-AR')} KG</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>

                <div style="background:#FFFFFF; border:1.5px solid #E0DCD4; border-radius:10px; padding:10px;">
                    <strong style="font-size:0.75rem; color:#DC2626; display:block; margin-bottom:6px;">📤 DESPACHOS Y REGISTRO DE RECEPCIÓN</strong>
                    ${egresosAsociados.length === 0 ? `<div style="text-align:center; padding:12px; color:#8E8E93; font-size:0.75rem;">Sin egresos registrados desde este depósito.</div>` : `
                        <table style="width:100%; border-collapse:collapse; font-size:0.75rem;">
                            <thead>
                                <tr style="background:#F8FAFC; border-bottom:1px solid #E0DCD4; text-align:left; color:#6B6255;">
                                    <th style="padding:6px;">Remito</th><th style="padding:6px;">Condición</th><th style="padding:6px;">Cliente</th><th style="padding:6px; text-align:right;">Despachado</th><th style="padding:6px; text-align:right;">Recepcionado</th><th style="padding:6px; text-align:right;">Índice / Merma</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${egresosAsociados.map(e => {
                                    const desp = Number(e.kilos || 0);
                                    const rec = Number(e.cant_recepcionada !== null && e.cant_recepcionada !== undefined ? e.cant_recepcionada : e.kilos);
                                    const difKg = rec - desp;
                                    const pct = desp > 0 ? (rec / desp) * 100 : 100;
                                    return `
                                        <tr style="border-bottom:1px solid #F1F5F9;">
                                            <td style="padding:6px; font-weight:bold;">#${e.remito || e.id}</td>
                                            <td style="padding:6px;">${e.despacho || 'DECLARADO'}</td>
                                            <td style="padding:6px; font-weight:bold;">${e.cliente || '-'}</td>
                                            <td style="padding:6px; text-align:right; font-weight:bold; color:#DC2626;">-${desp.toLocaleString('es-AR')} KG</td>
                                            <td style="padding:6px; text-align:right; font-weight:bold; color:#16A34A;">${rec.toLocaleString('es-AR')} KG</td>
                                            <td style="padding:6px; text-align:right; font-weight:bold; color:${difKg < 0 ? '#DC2626' : (difKg > 0 ? '#16A34A' : '#6B6255')};">
                                                ${pct.toFixed(2)}% (${difKg !== 0 ? (difKg > 0 ? '+' : '') + difKg.toLocaleString('es-AR') + ' KG' : '0 KG'})
                                            </td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    `}
                </div>
            </div>
        `;
    },

    m_abrirModalTrasladoGalpon: function(idAco) {
        this.m_asegurarModalBase();
        const silo = this.listaAcopioCalculado.find(s => s.registro_aco == idAco);
        if (!silo) return;
        const e = this.m_esc, kg = n => this.m_kg(n);

        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        const modalContent = document.querySelector('#modal-agrosoft .modal-apple-content') || document.querySelector('.modal-apple-content');
        if (modalContent) modalContent.style.maxWidth = '720px';
        if (modal) modal.style.display = 'flex';
        document.getElementById('modal-titulo').innerText = "TRASLADO INTERNO DE CEREAL";

        const infraOrigen = this.m_esSilo(silo) ? `Silo N° ${silo.silo_n}` : `Galpón ${silo.deposito || 'General'}`;
        const cultivos = Object.entries(silo.resumen_cultivos || {}).filter(([, k]) => k > 0);
        const depositosDisponibles = [...new Set([
            ...this.listaDepositosMaestros.map(d => (d.deposito || '').trim().toUpperCase()),
            ...this.datosSilos.map(s => (s.deposito || '').trim().toUpperCase())
        ].filter(Boolean))].sort();
        const inp = 'width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;';
        const lbl = 'font-size:0.65rem; color:#6B6255; font-weight:800; text-transform:uppercase; display:block; margin-bottom:4px;';

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                <div style="display:grid; grid-template-columns:1fr auto 1fr; gap:10px; align-items:center;">
                    <div style="background:#F0FDF4; border:1px solid #BBF7D0; padding:10px 12px; border-radius:10px;">
                        <span style="font-size:0.62rem; color:#15803D; font-weight:800; text-transform:uppercase;">Sale de</span>
                        <div style="font-weight:800; color:#14532D;">${e(silo.establecimiento)} · ${e(infraOrigen)}</div>
                        <small style="color:#6B6255;">Stock: <b>${kg(silo.kg_disponibles_reales)}</b></small>
                    </div>
                    <div style="font-size:1.6rem; color:#E08600; font-weight:900;">→</div>
                    <div style="background:#EFF6FF; border:1px solid #BFDBFE; padding:10px 12px; border-radius:10px;">
                        <span style="font-size:0.62rem; color:#1D4ED8; font-weight:800; text-transform:uppercase;">Entra a</span>
                        <input type="text" id="tr_destino_depo" list="dl_depositos_stock" placeholder="Galpón / depósito destino…" style="${inp} border:1.5px solid #3B82F6; font-weight:800; text-transform:uppercase; margin-top:3px;">
                        <datalist id="dl_depositos_stock">${depositosDisponibles.map(dep => `<option value="${e(dep)}">`).join('')}</datalist>
                    </div>
                </div>

                <div style="background:#FFFFFF; border:1.5px solid #E0DCD4; border-radius:12px; padding:14px; display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    ${cultivos.length > 1 ? `
                    <div style="grid-column:1 / -1;">
                        <label style="${lbl}">Cultivo a trasladar</label>
                        <select id="tr_cultivo" style="${inp} font-weight:700;" onchange="ModuloStock.m_actualizarMaxTraslado()">
                            ${cultivos.map(([c, k]) => `<option value="${e(c)}" data-max="${k}">${e(c)} — ${kg(k)}</option>`).join('')}
                        </select>
                    </div>` : `<input type="hidden" id="tr_cultivo" value="${e(cultivos[0] ? cultivos[0][0] : (silo.cultivo || ''))}">`}
                    <div><label style="${lbl}">Fecha traslado</label><input type="date" id="tr_fecha" value="${this.m_hoyLocal()}" style="${inp}"></div>
                    <div><label style="${lbl}">Remito interno N°</label><input type="number" id="tr_remito" placeholder="Ej: 50412" style="${inp}"></div>
                    <div><label style="${lbl}">Chofer / transportista</label><input type="text" id="tr_chofer" placeholder="Nombre completo" style="${inp} text-transform:uppercase;"></div>
                    <div><label style="${lbl}">Razón social destino</label><input type="text" id="tr_razon_social" value="PROPIO" style="${inp} text-transform:uppercase; font-weight:bold; color:#0071E3;"></div>
                    <div style="grid-column:1 / -1;">
                        <label style="${lbl} color:#E08600;" id="tr_lbl_max">Kilos a mover (máx: ${kg(cultivos.length ? cultivos[0][1] : silo.kg_disponibles_reales)})</label>
                        <input type="number" id="tr_kilos" placeholder="0" style="${inp} border:2px solid #E08600; font-size:1.1rem; font-weight:900;">
                    </div>
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid #E0DCD4; padding-top:12px;">
                    <button type="button" onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:8px 16px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer;">CANCELAR</button>
                    <button type="button" id="btn-ejecutar-traslado-galpon" style="background:#1E6B4C; color:#FFFFFF; border:none; padding:8px 22px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer;">CONFIRMAR TRASLADO</button>
                </div>
            </div>
        `;
        document.getElementById('btn-ejecutar-traslado-galpon').onclick = () => this.m_ejecutarTrasladoAGalpon(idAco);
    },

    m_filtrarEstablecimiento: function(val) {
        this.filtroEstablecimiento = val || 'TODOS';
        this.m_dibujarStock();
    },

    m_filtrarInfraestructura: function(val) {
        this.filtroInfraestructura = val || 'TODOS';
        this.m_dibujarStock();
    },

    m_filtrarCultivo: function(val) {
        this.filtroCultivo = val || 'TODOS';
        this.m_dibujarStock();
    },


    m_ejecutarTrasladoAGalpon: async function(idAco) {
        const item = this.listaAcopioCalculado.find(s => s.registro_aco == idAco);
        if (!item) return;

        const fecha = document.getElementById('tr_fecha')?.value || this.m_hoyLocal();
        const remito = (document.getElementById('tr_remito')?.value || '').trim();
        const chofer = (document.getElementById('tr_chofer')?.value || 'LOGÍSTICA INTERNA').trim().toUpperCase() || 'LOGÍSTICA INTERNA';
        const depositoDestino = (document.getElementById('tr_destino_depo')?.value || '').trim().toUpperCase();
        const cultivo = (document.getElementById('tr_cultivo')?.value || item.cultivo || '').trim().toUpperCase();
        const kilos = parseFloat(document.getElementById('tr_kilos')?.value) || 0;

        // Partidas de ese cultivo con stock (un galpón puede tener varias)
        const partidas = (item.partidas_incluidas || [item])
            .filter(p => (p.cultivo || '').trim().toUpperCase() === cultivo && (Number(p.kg_en_silo) || 0) > 0)
            .sort((a, b) => (Number(a.registro_aco) || 0) - (Number(b.registro_aco) || 0));
        const disponible = partidas.reduce((a, p) => a + (Number(p.kg_en_silo) || 0), 0);

        if (!depositoDestino) return this.m_notificar('Indicá el galpón o depósito destino.', 'alerta');
        if (!this.m_esSilo(item) && depositoDestino === String(item.deposito || '').trim().toUpperCase()) {
            return this.m_notificar('El destino es el mismo galpón de origen.', 'alerta');
        }
        if (kilos <= 0 || kilos > disponible + 0.001) return this.m_notificar(`Kilos no válidos: hay ${this.m_kg(disponible)} de ${cultivo} para mover.`, 'alerta');

        const btn = document.getElementById('btn-ejecutar-traslado-galpon');
        if (btn) { btn.disabled = true; btn.innerText = "PROCESANDO..."; }

        try {
            // Descontar de las partidas de origen (la más vieja primero) sin dejar ninguna negativa
            let resta = kilos;
            for (const p of partidas) {
                if (resta <= 0) break;
                const res = await this.m_ejecutarSqlLocal(`SELECT kg_en_silo, kg_mtr_silo FROM acopio_produccion WHERE registro_aco = ?`, [p.registro_aco]);
                const fila = res.data?.[0] || res[0];
                if (!fila) continue;
                const tiene = Number(fila.kg_en_silo) || 0;
                const saca = Math.min(tiene, resta);
                const queda = tiene - saca;
                const dens = Number(fila.kg_mtr_silo) || 0;
                await this.m_ejecutarSqlLocal(
                    `UPDATE acopio_produccion SET kg_en_silo = ?, mtrs_silo = ?, fecha_mov = ?, sincronizado = 0 WHERE registro_aco = ?`,
                    [queda, dens > 0 ? parseFloat((queda / dens).toFixed(2)) : 0, fecha, p.registro_aco]
                );
                resta -= saca;
            }

            const ref = partidas[0] || item;
            const resMax = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(registro_aco AS INTEGER)) as max_aco FROM acopio_produccion`);
            const nuevoRegistroAco = Number(resMax.data?.[0]?.max_aco ?? resMax[0]?.max_aco ?? 0) + 1;
            const detalleOrigen = this.m_esSilo(item) ? `Silo N° ${item.silo_n}` : `Galpón ${item.deposito || ''}`.trim();

            await this.m_ejecutarSqlLocal(`
                INSERT INTO acopio_produccion (
                    registro_aco, establecimiento, campo, lote, cultivo, variedad,
                    silo_n, mtrs_silo, kg_en_silo, kg_mtr_silo, campaña, deposito,
                    ubicacion, remito, chofer, fecha_mov, origen_traslado, sincronizado
                ) VALUES (?, ?, ?, ?, ?, ?, '', 0, ?, 0, ?, ?, ?, ?, ?, ?, ?, 0)`, [
                nuevoRegistroAco, ref.establecimiento || 'CENTRAL', ref.campo || 'GALPON',
                ref.lote || 0, cultivo, ref.variedad || null,
                kilos, ref.campaña || '', depositoDestino, ref.ubicacion || '',
                remito, chofer, fecha, `Traslado de ${kilos.toLocaleString('es-AR')} KG desde ${detalleOrigen}`
            ]);

            document.getElementById('modal-agrosoft').style.display = 'none';
            await this.m_inicializar();
            this.m_notificar(`Traslado registrado: ${this.m_kg(kilos)} de ${cultivo} a ${depositoDestino}.`, 'exito');
        } catch (err) {
            console.error(err);
            this.m_notificar("Error en traslado: " + err.message, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerText = "CONFIRMAR TRASLADO"; }
        }
    },

    m_colorCultivo: function(cultivo) {
        const n = (cultivo || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
        const colors = {
            'MAIZ': '#E08600', 'SORGO': '#8B4FD9', 'SOJA': '#1FA958', 'CEBADA': '#0071E3', 'TRIGO': '#C99700',
            'GIRASOL': '#E3B505', 'AVENA': '#8D6E63', 'ALFALFA': '#2E7D32', 'CENTENO': '#6D4C41', 'MIJO': '#00897B'
        };
        if (colors[n]) return colors[n];
        const clave = Object.keys(colors).find(k => n.startsWith(k));
        if (clave) return colors[clave];
        if (window.AgroUI && AgroUI.colorDe && n) return AgroUI.colorDe(n);
        return '#9AA0A6';
    },

    m_htmlVisual: function(lista) {
        const e = this.m_esc, kg = n => this.m_kg(n);
        if (!lista.length) return `<div class="stk-vacio">No hay acopios para los filtros elegidos.</div>`;
        const grupos = {};
        lista.forEach(s => { const est = (s.establecimiento || 'CENTRAL').trim().toUpperCase(); (grupos[est] = grupos[est] || []).push(s); });
        const maxDepo = Math.max(1, ...lista.filter(s => !this.m_esSilo(s)).map(s => Number(s.kg_disponibles_reales) || 0));

        return Object.keys(grupos).sort().map(est => {
            const celdas = grupos[est];
            const silos = celdas.filter(s => this.m_esSilo(s)).sort((a, b) => String(a.silo_n).localeCompare(String(b.silo_n), 'es', { numeric: true }));
            const depos = celdas.filter(s => !this.m_esSilo(s)).sort((a, b) => (b.kg_disponibles_reales || 0) - (a.kg_disponibles_reales || 0));
            const total = celdas.reduce((a, s) => a + (Number(s.kg_disponibles_reales) || 0), 0);
            const porCult = {};
            celdas.forEach(s => Object.entries(s.resumen_cultivos || {}).forEach(([c, k]) => porCult[c] = (porCult[c] || 0) + k));
            const kgSilos = silos.reduce((a, s) => a + (Number(s.kg_disponibles_reales) || 0), 0);
            const kgDepos = depos.reduce((a, s) => a + (Number(s.kg_disponibles_reales) || 0), 0);

            return `
                <section class="stk-est">
                    <header>
                        <div class="t"><b>${e(est)}</b><span>${kg(total)}</span></div>
                        <div class="stk-barra-mix" title="Composición por cultivo">
                            ${Object.entries(porCult).filter(([, k]) => k > 0).map(([c, k]) => `<i style="width:${(k / Math.max(1, total)) * 100}%; background:${this.m_colorCultivo(c)}" title="${e(c)}: ${kg(k)}"></i>`).join('')}
                        </div>
                    </header>
                    <div class="stk-carriles ${silos.length && depos.length ? 'dos' : ''}">
                        ${silos.length ? `
                        <div class="stk-carril">
                            <div class="stk-carril-t"><i class="ico-bolsa"></i>En el campo · silos bolsa <span>${silos.length} · ${kg(kgSilos)}</span></div>
                            ${silos.map(s => this.m_htmlSiloBolsa(s)).join('')}
                        </div>` : ''}
                        ${depos.length ? `
                        <div class="stk-carril">
                            <div class="stk-carril-t"><i class="ico-galpon"></i>Guardado en galpones / depósitos <span>${depos.length} · ${kg(kgDepos)}</span></div>
                            <div class="stk-galpones">${depos.map(s => this.m_htmlGalpon(s, maxDepo)).join('')}</div>
                        </div>` : ''}
                    </div>
                </section>`;
        }).join('');
    },

    // Silo bolsa dibujado: largo según metros (o kilos), relleno = lo que queda respecto de lo que se embolsó
    m_htmlSiloBolsa: function(s) {
        const e = this.m_esc, kg = n => this.m_kg(n);
        const actual = Number(s.kg_disponibles_reales) || 0;
        const original = Math.max(actual, Number(s.kg_originales) || 0, 1);
        const pct = Math.max(0, Math.min(100, (actual / original) * 100));
        const dens = Number(s.kg_mtr_silo) || 0;
        const metrosTot = dens > 0 ? original / dens : 0;
        const largo = Math.round(metrosTot > 0 ? 70 + 120 * Math.min(1, metrosTot / 75) : 70 + 120 * Math.min(1, original / 250000));
        const cult = Object.keys(s.resumen_cultivos || {})[0] || s.cultivo || 'GENERAL';
        const color = actual > 0 ? this.m_colorCultivo(cult) : '#CBD5E1';
        const id = `cb${s.registro_aco}`;
        const W = largo + 12, H = 26, r = 11;
        const relleno = (largo * pct) / 100;
        const desp = Number(s.kg_despachados_totales) || 0;
        const idx = Number(s.indice_recepcion) || 100;

        return `
            <div class="stk-silo ${actual <= 0 ? 'vacio' : ''}" onclick="ModuloStock.m_abrirMenuAccionesConsolidado(${this.m_jsStr(s.registro_aco)})" title="Silo ${e(s.silo_n)} · ${e(cult)} · ${kg(actual)} de ${kg(original)} embolsados">
                <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="stk-silo-svg">
                    <defs><clipPath id="${id}"><rect x="6" y="2" width="${largo}" height="${H - 4}" rx="${r}"/></clipPath></defs>
                    <rect x="6" y="2" width="${largo}" height="${H - 4}" rx="${r}" fill="#F1F3F1" stroke="${actual > 0 ? color : '#CBD5E1'}" stroke-width="1.4" ${actual <= 0 ? 'stroke-dasharray="4 3"' : ''}/>
                    <rect x="6" y="2" width="${relleno}" height="${H - 4}" fill="${color}" opacity="0.88" clip-path="url(#${id})"/>
                    <path d="M6 ${H / 2} l-5 -5 v10 z M${6 + largo} ${H / 2} l5 -5 v10 z" fill="${actual > 0 ? color : '#CBD5E1'}"/>
                    ${[0.25, 0.5, 0.75].map(f => `<line x1="${6 + largo * f}" y1="4" x2="${6 + largo * f}" y2="${H - 4}" stroke="#FFFFFF" stroke-opacity="0.35"/>`).join('')}
                </svg>
                <div class="stk-silo-info">
                    <b>Silo ${e(s.silo_n)}</b>
                    <span class="stk-cult" style="--c:${this.m_colorCultivo(cult)}">${e(cult)}</span>
                    <small>${e(s.campo || '')}${s.lote ? ' · L' + e(s.lote) : ''}${s.campaña ? ' · ' + e(s.campaña) : ''}${metrosTot > 0 ? ` · ${this.m_num(dens > 0 ? actual / dens : 0, 1)}/${this.m_num(metrosTot, 0)} m` : ''}</small>
                </div>
                <div class="stk-silo-kg">
                    <b>${kg(actual)}</b>
                    <small>${actual > 0 ? `${pct.toFixed(0)}% lleno` : 'vacío'}${desp > 0 ? ` · <span class="${idx < 98 ? 'rojo' : idx < 99.5 ? 'ambar' : 'verde'}">rec. ${idx.toFixed(1)}%</span>` : ''}</small>
                </div>
            </div>`;
    },

    // Galpón dibujado con una pila por cultivo; la altura de la pila es proporcional a los kilos
    m_htmlGalpon: function(s, maxDepo) {
        const e = this.m_esc, kg = n => this.m_kg(n);
        const actual = Number(s.kg_disponibles_reales) || 0;
        const cult = Object.entries(s.resumen_cultivos || {}).filter(([, k]) => k > 0).sort((a, b) => b[1] - a[1]);
        const partidas = s.partidas_incluidas || [s];
        const trasladadas = partidas.filter(p => p.origen_traslado && (Number(p.kg_disponibles_reales) || 0) > 0);
        const origenes = [...new Set(trasladadas.map(p => this.m_origenTraslado(p.origen_traslado)))];
        const W = 230, H = 92, base = 84, x0 = 14, x1 = W - 14;
        const ancho = x1 - x0;
        let x = x0 + 4;
        const pilas = cult.map(([c, k]) => {
            const w = Math.max(26, (ancho - 8) * (k / Math.max(1, actual)));
            const h = 10 + 46 * Math.sqrt(k / maxDepo);
            const p = `<path d="M${x} ${base} Q${x + w / 2} ${base - 2 * h} ${x + w} ${base} Z" fill="${this.m_colorCultivo(c)}" opacity="0.9"><title>${e(c)}: ${kg(k)}</title></path>`;
            x += w;
            return p;
        }).join('');
        const desp = Number(s.kg_despachados_totales) || 0;
        const idx = Number(s.indice_recepcion) || 100;

        return `
            <div class="stk-galpon ${trasladadas.length ? 'trasl' : ''} ${actual <= 0 ? 'vacio' : ''}" onclick="ModuloStock.m_abrirMenuAccionesConsolidado(${this.m_jsStr(s.registro_aco)})">
                <div class="stk-galpon-t">
                    <b>${e(s.deposito || 'DEPÓSITO')}</b>
                    ${trasladadas.length ? `<span class="stk-tag azul" title="${e(origenes.join(' · '))}">↘ ${trasladadas.length} traslado(s)</span>` : ''}
                </div>
                <svg width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax meet" class="stk-galpon-svg">
                    <path d="M${x0} ${base} V34 L${W / 2} 8 L${x1} 34 V${base}" fill="#FAFAF7" stroke="#A9B2AC" stroke-width="1.5" stroke-linejoin="round"/>
                    <line x1="${x0 - 6}" y1="${base}" x2="${x1 + 6}" y2="${base}" stroke="#8C958F" stroke-width="2"/>
                    ${pilas || `<text x="${W / 2}" y="${base - 18}" text-anchor="middle" font-size="11" fill="#9AA3A0">vacío</text>`}
                </svg>
                <div class="stk-galpon-cult">
                    ${cult.map(([c, k]) => `<div><i style="background:${this.m_colorCultivo(c)}"></i>${e(c)}<b>${kg(k)}</b></div>`).join('') || '<div class="sec">Sin grano</div>'}
                </div>
                <div class="stk-galpon-pie">
                    <span>${partidas.length} partida(s)</span>
                    <b>${kg(actual)}</b>
                </div>
                ${origenes.length ? `<div class="stk-origen">Vino de: ${e(origenes.slice(0, 2).join(' · '))}${origenes.length > 2 ? ` y ${origenes.length - 2} más` : ''}</div>` : ''}
                ${desp > 0 ? `<div class="stk-origen">Despachado ${kg(desp)} · <span class="${idx < 98 ? 'rojo' : idx < 99.5 ? 'ambar' : 'verde'}">recibido ${idx.toFixed(1)}%</span></div>` : ''}
            </div>`;
    },

    m_htmlTabla: function(lista) {
        const e = this.m_esc, kg = n => this.m_kg(n);
        if (!lista.length) return `<div class="stk-vacio">No hay acopios para los filtros elegidos.</div>`;
        const filas = lista.slice().sort((a, b) =>
            (a.establecimiento || '').localeCompare(b.establecimiento || '') || (this.m_esSilo(b) - this.m_esSilo(a)) || ((b.kg_disponibles_reales || 0) - (a.kg_disponibles_reales || 0)));
        const total = filas.reduce((a, s) => a + (Number(s.kg_disponibles_reales) || 0), 0);
        return `
            <table class="stk-tabla">
                <thead><tr>
                    <th>Establecimiento</th><th>Dónde</th><th>Campo / lote</th><th>Cultivos</th>
                    <th class="der">Stock actual</th><th style="width:110px;">Llenado</th><th class="der">Despachado</th><th class="der">Recepción</th><th>Origen</th>
                </tr></thead>
                <tbody>${filas.map(s => {
                    const silo = this.m_esSilo(s);
                    const actual = Number(s.kg_disponibles_reales) || 0;
                    const original = Math.max(actual, Number(s.kg_originales) || 0, 1);
                    const pct = Math.max(0, Math.min(100, actual / original * 100));
                    const partidas = s.partidas_incluidas || [s];
                    const origen = [...new Set(partidas.filter(p => p.origen_traslado).map(p => this.m_origenTraslado(p.origen_traslado)))];
                    const desp = Number(s.kg_despachados_totales) || 0;
                    const idx = Number(s.indice_recepcion) || 100;
                    const cultPrin = Object.keys(s.resumen_cultivos || {})[0] || 'GENERAL';
                    return `<tr onclick="ModuloStock.m_abrirMenuAccionesConsolidado(${this.m_jsStr(s.registro_aco)})" class="${actual <= 0 ? 'vacio' : ''}">
                        <td>${e(s.establecimiento || '-')}</td>
                        <td>${silo ? `<span class="stk-tag verde">Silo bolsa</span> <b>${e(s.silo_n)}</b>` : `<span class="stk-tag gris">Galpón</span> <b>${e(s.deposito || '-')}</b>`}</td>
                        <td class="sec">${silo ? `${e(s.campo || '-')}${s.lote ? ' · L' + e(s.lote) : ''}` : `${partidas.length} partida(s)`}</td>
                        <td>${Object.entries(s.resumen_cultivos || {}).map(([c, k]) => `<span class="stk-cult" style="--c:${this.m_colorCultivo(c)}">${e(c)}${Object.keys(s.resumen_cultivos).length > 1 ? ' ' + this.m_num(k / 1000, 1) + ' t' : ''}</span>`).join(' ')}</td>
                        <td class="der"><b>${kg(actual)}</b></td>
                        <td><div class="stk-mini"><i style="width:${pct}%; background:${this.m_colorCultivo(cultPrin)}"></i></div><small>${pct.toFixed(0)}%</small></td>
                        <td class="der sec">${desp ? kg(desp) : '—'}</td>
                        <td class="der">${desp ? `<span class="${idx < 98 ? 'rojo' : idx < 99.5 ? 'ambar' : 'verde'}">${idx.toFixed(1)}%</span>` : '—'}</td>
                        <td class="sec" title="${e(origen.join(' · '))}">${origen.length ? '↘ ' + e(origen[0]) + (origen.length > 1 ? ` +${origen.length - 1}` : '') : 'Carga inicial'}</td>
                    </tr>`;
                }).join('')}</tbody>
                <tfoot><tr><td colspan="4">${filas.length} acopio(s)</td><td class="der">${kg(total)}</td><td colspan="4"></td></tr></tfoot>
            </table>`;
    },

    // Panel derecho: por cultivo, cuánto hay en silos bolsa y cuánto en galpones, y en qué lugares
    m_htmlPanelCultivos: function(lista, totalGlobal) {
        const e = this.m_esc, kg = n => this.m_kg(n);
        const datos = {};
        lista.forEach(s => {
            const silo = this.m_esSilo(s);
            const lugar = silo ? `Silo ${s.silo_n}` : (s.deposito || 'Depósito');
            const est = (s.establecimiento || 'CENTRAL').toUpperCase();
            Object.entries(s.resumen_cultivos || {}).forEach(([c, k]) => {
                if (!(k > 0)) return;
                const d = datos[c] = datos[c] || { total: 0, silo: 0, galpon: 0, lugares: [] };
                d.total += k; if (silo) d.silo += k; else d.galpon += k;
                d.lugares.push({ lugar, est, k, silo });
            });
        });
        const orden = Object.entries(datos).sort((a, b) => b[1].total - a[1].total);
        const traslados = lista.flatMap(s => (s.partidas_incluidas || [s]).filter(p => p.origen_traslado).map(p => ({ ...p, destino: s.deposito || (s.silo_n ? 'Silo ' + s.silo_n : '-') })))
            .sort((a, b) => String(b.fecha_mov || '').localeCompare(String(a.fecha_mov || ''))).slice(0, 6);

        return `
            <div class="stk-der-t">Stock por cultivo</div>
            <div class="stk-leyenda"><span><i class="lleno"></i>Silo bolsa</span><span><i class="rayado"></i>Galpón</span></div>
            ${!orden.length ? '<div class="stk-vacio chico">Sin stock</div>' : orden.map(([c, d]) => {
                const col = this.m_colorCultivo(c);
                const pct = totalGlobal > 0 ? (d.total / totalGlobal) * 100 : 0;
                return `
                <div class="stk-cultivo">
                    <div class="stk-cultivo-t"><b style="color:${col}">${e(c)}</b><span>${kg(d.total)} <em>${pct.toFixed(0)}%</em></span></div>
                    <div class="stk-apilada" title="Silos bolsa ${kg(d.silo)} · Galpones ${kg(d.galpon)}">
                        <i style="width:${(d.silo / d.total) * 100}%; background:${col}"></i>
                        <i class="rayado" style="width:${(d.galpon / d.total) * 100}%; --c:${col}"></i>
                    </div>
                    <div class="stk-lugares">
                        ${d.lugares.sort((a, b) => b.k - a.k).slice(0, 4).map(l => `<div><span>${l.silo ? '▭' : '⌂'} ${e(l.lugar)} <small>${e(l.est)}</small></span><b>${kg(l.k)}</b></div>`).join('')}
                        ${d.lugares.length > 4 ? `<div class="sec">y ${d.lugares.length - 4} lugar(es) más</div>` : ''}
                    </div>
                </div>`;
            }).join('')}
            ${traslados.length ? `
            <div class="stk-der-t" style="margin-top:6px;">Últimos traslados</div>
            ${traslados.map(t => `
                <div class="stk-trasl">
                    <div><b>${e(this.m_origenTraslado(t.origen_traslado))}</b> → <b>${e(t.destino)}</b></div>
                    <small>${e(t.fecha_mov || '-')} · ${e(t.cultivo || '')} · hoy ${kg(t.kg_disponibles_reales)}</small>
                </div>`).join('')}` : ''}
        `;
    },

    // Lista con los filtros de pantalla (la usan también las exportaciones)
    m_obtenerDatosFiltrados: function() {
        const txt = (this.textoBusqueda || '').trim().toUpperCase();
        return (this.listaAcopioCalculado || []).filter(s => {
            if (this.filtroEstablecimiento !== 'TODOS' && (s.establecimiento || 'CENTRAL').trim().toUpperCase() !== this.filtroEstablecimiento.toUpperCase()) return false;
            const silo = this.m_esSilo(s);
            if (this.filtroInfraestructura === 'SILO' && !silo) return false;
            if (this.filtroInfraestructura === 'DEPOSITO' && silo) return false;
            if (this.filtroCultivo !== 'TODOS' && !Object.keys(s.resumen_cultivos || {}).some(c => c.toUpperCase() === this.filtroCultivo.toUpperCase())) return false;
            if (txt) {
                const partidas = s.partidas_incluidas || [s];
                const texto = [s.establecimiento, s.deposito, s.silo_n ? 'SILO ' + s.silo_n : '', ...partidas.map(p => `${p.campo || ''} ${p.lote || ''} ${p.cultivo || ''} ${p.campaña || ''} ${p.origen_traslado || ''}`)].join(' ').toUpperCase();
                if (!txt.split(/\s+/).every(p => texto.includes(p))) return false;
            }
            return true;
        });
    },

    m_cambiarVista: function(v) {
        this.vistaStock = v;
        this.m_dibujarStock();
    },

    m_toggleVacios: function() {
        this.mostrarVacios = !this.mostrarVacios;
        this.m_dibujarStock();
    },

    m_buscar: function(valor) {
        this.textoBusqueda = valor;
        clearTimeout(this._tBuscar);
        this._tBuscar = setTimeout(() => {
            const pos = document.getElementById('stk-buscar')?.selectionStart;
            this.m_dibujarStock();
            const inp = document.getElementById('stk-buscar');
            if (inp) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch (e) {} }
        }, 180);
    },

    m_esSilo: function(s) {
        return !!(s && s.silo_n && String(s.silo_n).trim() !== '' && String(s.silo_n).trim() !== '0');
    },

    // "Traslado de 50.000 KG desde Silo N° 3" -> "Silo N° 3"
    m_origenTraslado: function(txt) {
        const m = /desde\s+(.+)$/i.exec(txt || '');
        return m ? m[1].trim() : (txt || 'Traslado');
    },

    m_kg: function(n) {
        const v = Number(n) || 0;
        if (Math.abs(v) >= 1000000) return `${(v / 1000).toLocaleString('es-AR', { maximumFractionDigits: 0 })} t`;
        return `${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })} kg`;
    },

    m_num: function(n, d = 0) {
        return (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
    },

    m_esc: function(v) {
        return (v === null || v === undefined ? '' : String(v))
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    m_jsStr: function(v) {
        return this.m_esc(JSON.stringify(v === null || v === undefined ? '' : String(v)));
    },

    m_hoyLocal: function() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    m_notificar: function(msg, tipo = 'exito') {
        if (window.AgroUI && AgroUI.notificar) return AgroUI.notificar(msg, tipo);
        if (window.ComponentesUI && ComponentesUI.notificar) return ComponentesUI.notificar(msg, tipo);
        console.log(msg);
    },

    // El visor satelital vive en el módulo de Acopio: se le pasan los datos ya cargados
    m_abrirModalMapaGlobal: async function(idAco = null) {
        const A = window.ModuloAcopio;
        if (!A || typeof A.m_abrirModalMapaGlobal !== 'function') {
            return this.m_notificar('El visor satelital está en el módulo de Acopio, que no está cargado.', 'alerta');
        }
        if (!A.datosSilos || !A.datosSilos.length) A.datosSilos = this.datosSilos;
        if (!A.datosEgresos || !A.datosEgresos.length) A.datosEgresos = this.datosEgresos;
        return A.m_abrirModalMapaGlobal(idAco);
    },

    // Despacho desde el stock: abre el despacho del módulo de Egresos con el silo ya elegido
    m_abrirModalEgreso: async function(_id, idAco) {
        const E = window.ModuloEgresosProd;
        if (!E || typeof E.m_abrirModalEgreso !== 'function') {
            return this.m_notificar('El módulo de Egresos / Despachos no está cargado.', 'alerta');
        }
        const item = this.listaAcopioCalculado.find(s => String(s.registro_aco) === String(idAco));
        // En un galpón con varias partidas se elige la de más stock
        const partida = item && item.partidas_incluidas
            ? item.partidas_incluidas.slice().sort((a, b) => (b.kg_disponibles_reales || 0) - (a.kg_disponibles_reales || 0))[0]
            : item;
        await E.m_inicializar();
        E.m_abrirModalEgreso();
        const sel = document.getElementById('e_silo_sel');
        if (sel && partida) {
            sel.value = String(partida.registro_aco);
            if (typeof E.m_autoCompletarSilo === 'function') E.m_autoCompletarSilo(sel.value);
        }
    },

    m_actualizarMaxTraslado: function() {
        const sel = document.getElementById('tr_cultivo');
        const op = sel && sel.selectedOptions ? sel.selectedOptions[0] : null;
        const lbl = document.getElementById('tr_lbl_max');
        if (op && lbl) lbl.innerText = `Kilos a mover (máx: ${this.m_kg(op.getAttribute('data-max'))})`;
    },

    m_asegurarEstilosStock: function() {
        if (document.getElementById('stk-estilos')) return;
        const st = document.createElement('style');
        st.id = 'stk-estilos';
        st.textContent = `
            .stk { font-family:'Roboto',sans-serif; color:#1D2420; background:#F5F4F1; padding:6px 14px 10px; height:calc(100vh - 65px); box-sizing:border-box; display:flex; flex-direction:column; gap:7px; overflow:hidden; }
            .stk *, .stk *::before, .stk *::after { box-sizing:border-box; }
            .stk-top { display:flex; align-items:center; gap:12px; flex-shrink:0; min-height:36px; }
            .stk-top h2 { margin:0; font-size:1.08rem; font-weight:900; color:#123F2C; white-space:nowrap; }
            .stk-acc { margin-left:auto; display:flex; gap:6px; }
            .stk-btn { height:30px; padding:0 12px; border-radius:8px; border:1px solid #DCD8CF; background:#FFF; font:700 0.74rem 'Roboto',sans-serif; color:#1D2420; cursor:pointer; }
            .stk-btn:hover { border-color:#1E6B4C; }
            .stk-btn.azul { background:#0071E3; border-color:#0071E3; color:#FFF; }
            .stk-seg { display:inline-flex; background:#ECEAE4; border-radius:8px; padding:2px; gap:2px; }
            .stk-seg button { border:none; background:none; padding:5px 11px; border-radius:6px; font:700 0.74rem 'Roboto',sans-serif; color:#6B6255; cursor:pointer; white-space:nowrap; }
            .stk-seg button.on { background:#FFF; color:#123F2C; box-shadow:0 1px 3px rgba(0,0,0,0.12); }
            .stk-seg.chico button { padding:4px 9px; font-size:0.7rem; }

            .stk-kpis { display:grid; grid-template-columns:1.1fr 1.3fr 1.3fr 1.1fr 1.3fr; background:#FFF; border:1px solid #E0DCD4; border-radius:10px; flex-shrink:0; }
            .stk-kpi { padding:6px 12px; border-right:1px solid #EEECE6; min-width:0; }
            .stk-kpi:last-child { border-right:none; }
            .stk-kpi span { display:flex; align-items:center; gap:5px; font-size:0.6rem; font-weight:800; text-transform:uppercase; color:#6B6255; letter-spacing:.3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .stk-kpi b { display:block; font-size:1.02rem; font-weight:900; font-variant-numeric:tabular-nums; color:#1D2420; }
            .stk-kpi small { display:block; font-size:0.66rem; color:#8A8478; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .stk-kpi.fuerte b { color:#1E6B4C; font-size:1.18rem; }
            .stk-kpi.azul b { color:#0071E3; } .stk-kpi.rojo small { color:#C62828; font-weight:700; } .stk-kpi.ambar small { color:#B26A00; font-weight:700; } .stk-kpi.verde small { color:#1E6B4C; font-weight:700; }
            .ico-bolsa { display:inline-block; width:16px; height:7px; border-radius:4px; background:#9CC9AE; border:1px solid #1E6B4C; flex-shrink:0; }
            .ico-galpon { display:inline-block; width:12px; height:10px; background:#D9D4C7; clip-path:polygon(0 40%, 50% 0, 100% 40%, 100% 100%, 0 100%); flex-shrink:0; }

            .stk-filtros { display:flex; align-items:center; gap:8px; flex-wrap:wrap; flex-shrink:0; }
            .stk-chips { display:flex; gap:4px; flex-wrap:wrap; }
            .stk-chip { display:inline-flex; align-items:center; gap:5px; height:26px; padding:0 9px; border-radius:13px; border:1px solid #DCD8CF; background:#FFF; font:700 0.7rem 'Roboto',sans-serif; color:#4A443B; cursor:pointer; white-space:nowrap; }
            .stk-chip em { font-style:normal; font-weight:600; color:#8A8478; }
            .stk-chip i { width:8px; height:8px; border-radius:50%; }
            .stk-chip.on { background:#123F2C; border-color:#123F2C; color:#FFF; }
            .stk-chip.on em { color:#CFE6D7; }
            .stk-buscar { margin-left:auto; }
            .stk-buscar input { height:28px; width:230px; border:1px solid #DCD8CF; border-radius:8px; padding:0 10px; font:500 0.76rem 'Roboto',sans-serif; outline:none; background:#FFF; }
            .stk-buscar input:focus { border-color:#1E6B4C; box-shadow:0 0 0 3px rgba(30,107,76,0.12); }
            .stk-link { border:none; background:none; color:#1E6B4C; font:800 0.7rem 'Roboto',sans-serif; cursor:pointer; text-decoration:underline; }

            .stk-main { flex:1; min-height:0; display:grid; grid-template-columns:minmax(0,1fr) 290px; gap:10px; }
            .stk-izq { overflow-y:auto; display:flex; flex-direction:column; gap:8px; padding-right:2px; }
            .stk-der { overflow-y:auto; background:#FFF; border:1px solid #E0DCD4; border-radius:12px; padding:10px 12px; display:flex; flex-direction:column; gap:8px; }
            .stk-vacio { background:#FFF; border:1px dashed #D6D1C6; border-radius:10px; padding:26px; text-align:center; color:#8A8478; font-size:0.8rem; }
            .stk-vacio.chico { padding:10px; }

            .stk-est { background:#FFF; border:1px solid #E0DCD4; border-radius:12px; padding:8px 10px 10px; }
            .stk-est header { display:flex; align-items:center; gap:12px; margin-bottom:6px; }
            .stk-est header .t { display:flex; align-items:baseline; gap:8px; white-space:nowrap; }
            .stk-est header .t b { font-size:0.86rem; color:#123F2C; font-weight:900; }
            .stk-est header .t span { font-size:0.8rem; font-weight:800; color:#1E6B4C; font-variant-numeric:tabular-nums; }
            .stk-barra-mix { flex:1; height:6px; border-radius:4px; overflow:hidden; display:flex; background:#EEECE6; }
            .stk-barra-mix i { height:100%; }
            .stk-carriles { display:grid; grid-template-columns:1fr; gap:10px; }
            .stk-carriles.dos { grid-template-columns:minmax(0,1fr) minmax(0,1fr); }
            .stk-carril { min-width:0; background:#FAFAF8; border:1px solid #EEECE6; border-radius:10px; padding:6px 8px; }
            .stk-carril-t { display:flex; align-items:center; gap:6px; font-size:0.62rem; font-weight:900; text-transform:uppercase; color:#556358; letter-spacing:.3px; margin-bottom:4px; }
            .stk-carril-t span { margin-left:auto; text-transform:none; font-weight:700; color:#8A8478; letter-spacing:0; font-size:0.68rem; }

            .stk-silo { display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:10px; padding:4px 6px; border-radius:8px; cursor:pointer; border:1px solid transparent; }
            .stk-silo:hover { background:#FFF; border-color:#CFE6D7; }
            .stk-silo.vacio { opacity:0.55; }
            .stk-silo-svg { display:block; width:202px; }
            .stk-silo-info { min-width:0; display:flex; flex-wrap:wrap; align-items:center; gap:2px 6px; }
            .stk-silo-info b { font-size:0.78rem; color:#123F2C; }
            .stk-silo-info small { flex-basis:100%; font-size:0.64rem; color:#8A8478; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .stk-silo-kg { text-align:right; white-space:nowrap; }
            .stk-silo-kg b { display:block; font-size:0.84rem; font-weight:900; font-variant-numeric:tabular-nums; }
            .stk-silo-kg small { font-size:0.62rem; color:#8A8478; }
            .stk-cult { display:inline-flex; align-items:center; gap:4px; padding:0 6px; height:16px; border-radius:8px; font-size:0.6rem; font-weight:800; color:var(--c); background:color-mix(in srgb, var(--c) 12%, white); }
            .rojo { color:#C62828; font-weight:800; } .ambar { color:#B26A00; font-weight:800; } .verde { color:#1E6B4C; font-weight:800; }

            .stk-galpones { display:grid; grid-template-columns:repeat(auto-fill, minmax(190px, 1fr)); gap:8px; }
            .stk-galpon { background:#FFF; border:1px solid #E0DCD4; border-radius:10px; padding:6px 8px 7px; cursor:pointer; display:flex; flex-direction:column; gap:3px; }
            .stk-galpon:hover { border-color:#1E6B4C; box-shadow:0 3px 10px rgba(30,107,76,0.10); }
            .stk-galpon.trasl { border-color:#9CC3F5; background:linear-gradient(#F4F9FF, #FFF 40%); }
            .stk-galpon.vacio { opacity:0.55; }
            .stk-galpon-t { display:flex; align-items:center; justify-content:space-between; gap:6px; }
            .stk-galpon-t b { font-size:0.76rem; color:#123F2C; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .stk-galpon-svg { display:block; height:70px; }
            .stk-galpon-cult div { display:flex; align-items:center; gap:5px; font-size:0.66rem; font-weight:700; color:#4A443B; }
            .stk-galpon-cult div i { width:8px; height:8px; border-radius:2px; }
            .stk-galpon-cult div b { margin-left:auto; font-variant-numeric:tabular-nums; }
            .stk-galpon-pie { display:flex; justify-content:space-between; align-items:baseline; border-top:1px dashed #E6E2D9; padding-top:3px; font-size:0.64rem; color:#8A8478; }
            .stk-galpon-pie b { font-size:0.86rem; color:#1D2420; font-variant-numeric:tabular-nums; }
            .stk-origen { font-size:0.62rem; color:#1D4ED8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .stk-tag { display:inline-flex; align-items:center; height:16px; padding:0 6px; border-radius:8px; font-size:0.58rem; font-weight:800; white-space:nowrap; }
            .stk-tag.azul { background:#E3EEFF; color:#1D4ED8; } .stk-tag.verde { background:#E3F1E8; color:#1E6B4C; } .stk-tag.gris { background:#EEECE6; color:#6B6255; }

            .stk-tabla { width:100%; border-collapse:collapse; font-size:0.74rem; background:#FFF; border:1px solid #E0DCD4; border-radius:10px; overflow:hidden; }
            .stk-tabla th { position:sticky; top:0; background:#EEEBE4; color:#4A433A; font-size:0.6rem; font-weight:800; text-transform:uppercase; padding:6px 8px; text-align:left; z-index:1; }
            .stk-tabla td { padding:4px 8px; border-top:1px solid #F0EEE9; white-space:nowrap; height:28px; }
            .stk-tabla tbody tr { cursor:pointer; }
            .stk-tabla tbody tr:hover td { background:#EAF3EE; }
            .stk-tabla tr.vacio td { color:#A49E92; }
            .stk-tabla .der { text-align:right; font-variant-numeric:tabular-nums; }
            .stk-tabla .sec { color:#8A8478; }
            .stk-tabla tfoot td { background:#123F2C; color:#FFF; font-weight:800; }
            .stk-mini { display:inline-block; vertical-align:middle; width:70px; height:6px; background:#EEECE6; border-radius:3px; overflow:hidden; margin-right:5px; }
            .stk-mini i { display:block; height:100%; }

            .stk-der-t { font-size:0.64rem; font-weight:900; text-transform:uppercase; color:#123F2C; letter-spacing:.4px; }
            .stk-leyenda { display:flex; gap:12px; font-size:0.64rem; color:#6B6255; }
            .stk-leyenda span { display:flex; align-items:center; gap:4px; }
            .stk-leyenda i { width:14px; height:8px; border-radius:2px; background:#7A8A80; }
            .stk-leyenda i.rayado { background:repeating-linear-gradient(45deg, #7A8A80 0 2px, #DDE3DF 2px 4px); }
            .stk-cultivo { border-top:1px solid #F0EEE9; padding-top:6px; }
            .stk-cultivo-t { display:flex; justify-content:space-between; align-items:baseline; font-size:0.76rem; }
            .stk-cultivo-t span { font-weight:800; font-variant-numeric:tabular-nums; }
            .stk-cultivo-t em { font-style:normal; color:#8A8478; font-weight:600; margin-left:3px; }
            .stk-apilada { display:flex; height:9px; border-radius:5px; overflow:hidden; background:#EEECE6; margin:4px 0; }
            .stk-apilada i { height:100%; }
            .stk-apilada i.rayado { background:repeating-linear-gradient(45deg, var(--c) 0 3px, color-mix(in srgb, var(--c) 30%, white) 3px 6px); }
            .stk-lugares div { display:flex; justify-content:space-between; font-size:0.66rem; color:#4A443B; padding:1px 0; }
            .stk-lugares div small { color:#A49E92; font-size:0.58rem; margin-left:3px; }
            .stk-lugares div b { font-variant-numeric:tabular-nums; }
            .stk-lugares .sec { color:#A49E92; }
            .stk-trasl { border-left:3px solid #3B82F6; background:#F4F8FF; border-radius:6px; padding:4px 7px; font-size:0.68rem; }
            .stk-trasl small { color:#6B7C93; font-size:0.6rem; }
            @media (max-width: 1250px) { .stk-carriles.dos { grid-template-columns:1fr; } .stk-main { grid-template-columns:minmax(0,1fr) 250px; } }
        `;
        document.head.appendChild(st);
    },
};

window.ModuloStock = ModuloStock;