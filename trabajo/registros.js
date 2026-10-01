/**
 * registros.js — Panel de Registración (enrutador del módulo LABORES › Órdenes de Trabajo)
 * SALVUCCI GESTIÓN · AgroSoft J&L
 *
 * Estructura:
 *   1. Configuración de acciones (tarjetas) y rutas
 *   2. Infraestructura (SQL local, modal base, carga diferida de scripts, avisos)
 *   3. Vista del panel (KPIs, tarjetas, últimos movimientos)
 *   4. Enrutador m_rutear
 *
 * API pública que se mantiene: parametros, m_ejecutarSqlLocal, m_asegurarModalBase,
 * m_cerrarModal, m_inicializar, m_dibujarSelectorInicial, m_cargarHistorialResumen, m_rutear
 */

const ModuloRegistracion = {
    parametros: {
        depositos: [],
        insumos: [],
        contratistas: [],
        labores: [],
        gastos: []
    },

    // =================================================================
    // 1. CONFIGURACIÓN
    // =================================================================
    // Tarjetas del panel. `tipo` es la clave que recibe m_rutear (no cambiar: se guarda en egresos_insumos.tipo_labor).
    ACCIONES: [
        { tipo: 'ORDEN TRABAJO',    titulo: 'Orden de trabajo', descripcion: 'Registrar nuevas tareas de campo y equipos.',    icono: 'tractor',       color: '#0A66C2', atajo: '1' },
        { tipo: 'LABORES',          titulo: 'Labores',          descripcion: 'Control de cosecha, siembra y movimientos.',     icono: 'settings',      color: '#C77700', atajo: '2' },
        { tipo: 'OTROS GASTOS ADM', titulo: 'Gastos adm.',      descripcion: 'Administración de facturas, viáticos y fijos.',  icono: 'receipt',       color: '#1E8E4E', atajo: '3' },
        { tipo: 'BAJA CONSUMO',     titulo: 'Baja de consumo',  descripcion: 'Salida directa de stock y ajustes de depósito.', icono: 'trending-down', color: '#C62828', atajo: '4' }
    ],

    // Scripts que se pueden cargar bajo demanda si no están en index.html
    SCRIPTS_DIFERIDOS: {
        ModuloOrdenes: 'trabajo/registracion_ordesnTra.js'
    },

    _scriptsEnCurso: {},
    _atajosHandler: null,

    // =================================================================
    // 2. INFRAESTRUCTURA
    // =================================================================
    m_ejecutarSqlLocal: async function(sql, params = []) {
        if (window.apiLocal && window.apiLocal.query) {
            return await window.apiLocal.query({ sql, params });
        }
        if (window.electronAPI && window.electronAPI.invoke) {
            return await window.electronAPI.invoke('local-db-query', { sql, params });
        }
        if (typeof window.q === 'function') {
            return await window.q(sql, ...params);
        }
        throw new Error("No se encontró el puente IPC con la base de datos local.");
    },

    // Devuelve siempre un array, venga el resultado como {data} o como array directo
    m_filas: function(res) {
        if (!res) return [];
        if (Array.isArray(res)) return res;
        return Array.isArray(res.data) ? res.data : [];
    },

    m_esc: function(v) {
        return (v === null || v === undefined ? '' : String(v))
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    m_avisar: function(tipo, mensaje) {
        const UI = window.ComponentesUI;
        if (UI && typeof UI.notificar === 'function') return UI.notificar(tipo, mensaje);
        if (UI && typeof UI.notifica === 'function') return UI.notifica((tipo === 'error' ? '⚠️ ' : '✓ ') + mensaje);
        alert(mensaje);
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
        if (m) m.style.display = 'none';
    },

    // Carga un script una sola vez (si dos clics llegan juntos, comparten la misma promesa)
    m_cargarScript: function(src) {
        if (document.querySelector(`script[data-diferido="${src}"]`) && !this._scriptsEnCurso[src]) {
            return Promise.resolve();
        }
        if (this._scriptsEnCurso[src]) return this._scriptsEnCurso[src];

        this._scriptsEnCurso[src] = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.dataset.diferido = src;
            s.onload = () => { delete this._scriptsEnCurso[src]; resolve(); };
            s.onerror = () => {
                delete this._scriptsEnCurso[src];
                s.remove();
                reject(new Error(`No se encontró ${src}`));
            };
            document.body.appendChild(s);
        });
        return this._scriptsEnCurso[src];
    },

    // Devuelve el módulo global; si no existe y tiene script diferido, lo carga primero
    m_obtenerModulo: async function(nombre, obtener) {
        let mod = obtener();
        if (!mod && this.SCRIPTS_DIFERIDOS[nombre]) {
            await this.m_cargarScript(this.SCRIPTS_DIFERIDOS[nombre]);
            mod = obtener();
        }
        return mod || null;
    },

    // =================================================================
    // 3. VISTA DEL PANEL
    // =================================================================
    m_inicializar: async function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;
        visor.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:50vh; gap:16px;">
                <div class="loader-apple"></div>
                <span style="font-family:'Roboto',sans-serif; font-weight:700; font-size:0.8rem; letter-spacing:1px; text-transform:uppercase; color:#6E6E73;">Cargando tablas maestras…</span>
            </div>`;

        try {
            const [resDep, resIns, resCon, resLab, resGas] = await Promise.all([
                this.m_ejecutarSqlLocal(`SELECT * FROM depositos ORDER BY deposito ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM insumos ORDER BY articulo ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM contratistas ORDER BY contratista ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM tipos_labores ORDER BY labor ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM tipos_gastos ORDER BY nombre_gasto ASC`)
            ]);

            this.parametros = {
                depositos: this.m_filas(resDep),
                insumos: this.m_filas(resIns),
                contratistas: this.m_filas(resCon),
                labores: this.m_filas(resLab),
                gastos: this.m_filas(resGas)
            };

            this.m_dibujarSelectorInicial();
        } catch (err) {
            console.error("Error al inicializar ModuloRegistracion Local:", err);
            visor.innerHTML = `
                <div style="max-width:560px; margin:60px auto; text-align:center; font-family:'Roboto',sans-serif;">
                    <div style="width:56px; height:56px; margin:0 auto 12px; border-radius:16px; background:rgba(224,52,42,0.08); color:#E0342A; display:flex; align-items:center; justify-content:center;"><i data-lucide="alert-triangle"></i></div>
                    <h3 style="margin:0 0 6px; color:#1D1D1F;">No se pudieron leer los maestros locales</h3>
                    <p style="margin:0 0 16px; color:#6E6E73; font-size:0.88rem;">${this.m_esc(err.message)}</p>
                    <button onclick="ModuloRegistracion.m_inicializar()" style="background:#1D1D1F; color:#FFF; border:none; padding:9px 18px; border-radius:9px; font-weight:600; cursor:pointer;">Reintentar</button>
                </div>`;
            if (window.lucide) lucide.createIcons();
        }
    },

    m_estilosPanel: function() {
        return `
            <style>
                .reg-panel { font-family: 'Roboto', sans-serif; color: #1D1D1F; }
                .reg-header { display:flex; justify-content:space-between; align-items:flex-end; gap:12px; flex-wrap:wrap; margin:6px 0 16px; }
                .reg-header h2 { margin:0; font-weight:800; font-size:1.45rem; letter-spacing:-0.4px; }
                .reg-header p { margin:4px 0 0; font-size:0.8rem; color:#6E6E73; }
                .reg-atajos-hint { font-size:0.72rem; color:#9AA0A6; }
                .reg-atajos-hint kbd { background:#F0F2F5; border:1px solid #E4E7EC; border-bottom-width:2px; border-radius:5px; padding:1px 6px; font:600 0.7rem 'Roboto',sans-serif; color:#1D1D1F; }

                .reg-kpis { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:12px; margin-bottom:16px; }
                .reg-kpi { background:#FFFFFF; border:1px solid #E4E7EC; border-radius:12px; padding:12px 14px; display:flex; align-items:center; gap:12px; }
                .reg-kpi-icono { width:36px; height:36px; border-radius:10px; display:flex; align-items:center; justify-content:center; background:#F0F2F5; color:#1D1D1F; flex-shrink:0; }
                .reg-kpi-icono svg { width:18px; height:18px; }
                .reg-kpi-label { font-size:0.64rem; font-weight:800; letter-spacing:0.4px; text-transform:uppercase; color:#6E6E73; }
                .reg-kpi-valor { font-size:1.2rem; font-weight:800; font-variant-numeric:tabular-nums; }
                .reg-kpi-valor.alerta { color:#C77700; }

                .reg-grid { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:14px; margin-bottom:16px; }
                @media (max-width: 1100px) { .reg-grid { grid-template-columns:repeat(2, minmax(0,1fr)); } }

                .reg-card {
                    background:#FFFFFF; border:1px solid #E4E7EC; border-radius:14px; padding:18px;
                    display:flex; flex-direction:column; align-items:flex-start; gap:10px; text-align:left;
                    cursor:pointer; position:relative; font:inherit; color:inherit;
                    transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease;
                    box-shadow:0 1px 3px rgba(20,26,36,0.05);
                }
                .reg-card::before { content:''; position:absolute; left:0; top:14px; bottom:14px; width:3px; border-radius:0 3px 3px 0; background:var(--acento); opacity:0; transition:opacity .2s; }
                .reg-card:hover { transform:translateY(-3px); border-color:#D6DAE1; box-shadow:0 8px 18px rgba(20,26,36,0.10); }
                .reg-card:hover::before { opacity:1; }
                .reg-card:active { transform:scale(0.98); }
                .reg-card:focus-visible { outline:3px solid rgba(0,113,227,0.4); outline-offset:2px; }
                .reg-card.cargando { opacity:.6; pointer-events:none; }
                .reg-card-icono { width:44px; height:44px; border-radius:12px; display:flex; align-items:center; justify-content:center; background:var(--acento-suave); color:var(--acento); }
                .reg-card-icono svg { width:22px; height:22px; }
                .reg-card h4 { margin:0; font-size:1rem; font-weight:800; }
                .reg-card p { margin:0; font-size:0.8rem; color:#6E6E73; line-height:1.35; }
                .reg-card-pie { display:flex; justify-content:space-between; align-items:center; width:100%; margin-top:auto; padding-top:6px; }
                .reg-card-pie kbd { background:#F6F7F9; border:1px solid #E4E7EC; border-radius:5px; padding:1px 6px; font:600 0.68rem 'Roboto',sans-serif; color:#6E6E73; }
                .reg-card-pie .flecha { color:#9AA0A6; transition:transform .2s, color .2s; display:inline-flex; }
                .reg-card-pie .flecha svg { width:16px; height:16px; }
                .reg-card:hover .flecha { color:var(--acento); transform:translateX(3px); }

                .reg-bloque { background:#FFFFFF; border:1px solid #E4E7EC; border-radius:14px; padding:16px 18px; box-shadow:0 1px 3px rgba(20,26,36,0.04); }
                .reg-bloque-cab { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
                .reg-bloque-cab span:first-child { font-size:0.78rem; font-weight:800; letter-spacing:0.3px; text-transform:uppercase; }
                .reg-bloque-cab span:last-child { font-size:0.7rem; color:#6E6E73; }

                .tabla-resumen-apple { width:100%; border-collapse:collapse; font-size:0.8rem; text-align:left; }
                .tabla-resumen-apple th { padding:9px 12px; color:#6E6E73; font-weight:700; font-size:0.66rem; text-transform:uppercase; border-bottom:1px solid #E4E7EC; background:#F6F7F9; }
                .tabla-resumen-apple td { padding:9px 12px; border-bottom:1px solid #EEF0F3; vertical-align:middle; }
                .tabla-resumen-apple tbody tr:hover { background:#F9FAFB; }
                .tabla-resumen-apple .vacio { text-align:center; padding:22px; color:#9AA0A6; }
                .badge-soft { padding:3px 8px; border-radius:10px; font-size:0.65rem; font-weight:800; display:inline-block; background:var(--acento-suave, rgba(0,0,0,0.05)); color:var(--acento, #6E6E73); }
                .btn-mini-soft { background:#F0F2F5; border:1px solid #E4E7EC; padding:4px 8px; border-radius:6px; cursor:pointer; color:#1D1D1F; display:inline-flex; align-items:center; justify-content:center; transition:all .2s; }
                .btn-mini-soft:hover { background:#FFFFFF; border-color:#9AA0A6; }
                .btn-mini-soft svg { width:13px; height:13px; }
            </style>`;
    },

    m_colorSuave: function(hex) {
        const n = parseInt(hex.replace('#', ''), 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.10)`;
    },

    m_varsAcento: function(tipo) {
        const acc = this.ACCIONES.find(a => a.tipo === tipo);
        if (!acc) return '';
        return `--acento:${acc.color}; --acento-suave:${this.m_colorSuave(acc.color)};`;
    },

    m_dibujarSelectorInicial: function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;

        const volver = (window.ComponentesUI && typeof ComponentesUI.botonVolverHTML === 'function')
            ? ComponentesUI.botonVolverHTML('LABORES') : '';

        visor.innerHTML = this.m_estilosPanel() + `
            ${volver}
            <div class="reg-panel animated fadeIn" id="reg-panel">
                <div class="reg-header">
                    <div>
                        <h2>Panel de registración</h2>
                        <p>Elegí qué querés registrar. Todo se guarda primero en la base local.</p>
                    </div>
                    <span class="reg-atajos-hint">Atajos: <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd></span>
                </div>

                <div class="reg-kpis" id="reg-kpis">
                    ${this.m_htmlKpi('calendar-days', 'Movimientos del mes', '…', 'kpi-mes-cant')}
                    ${this.m_htmlKpi('dollar-sign', 'Total del mes (U$S)', '…', 'kpi-mes-usd')}
                    ${this.m_htmlKpi('cloud-off', 'Pendientes de sincronizar', '…', 'kpi-pendientes')}
                </div>

                <div class="reg-grid">
                    ${this.ACCIONES.map(a => `
                        <button type="button" class="reg-card" data-tipo="${this.m_esc(a.tipo)}" style="${this.m_varsAcento(a.tipo)}" title="${this.m_esc(a.titulo)} (tecla ${a.atajo})">
                            <div class="reg-card-icono"><i data-lucide="${a.icono}"></i></div>
                            <h4>${this.m_esc(a.titulo)}</h4>
                            <p>${this.m_esc(a.descripcion)}</p>
                            <div class="reg-card-pie">
                                <kbd>${a.atajo}</kbd>
                                <span class="flecha"><i data-lucide="arrow-right"></i></span>
                            </div>
                        </button>
                    `).join('')}
                </div>

                <div class="reg-bloque">
                    <div class="reg-bloque-cab">
                        <span>Últimos movimientos registrados</span>
                        <span>Historial local</span>
                    </div>
                    <div style="overflow-x:auto;">
                        <table class="tabla-resumen-apple">
                            <thead>
                                <tr>
                                    <th>Fecha</th>
                                    <th>Tipo de operación</th>
                                    <th>Concepto / Insumo</th>
                                    <th style="text-align:right;">Monto total</th>
                                    <th style="text-align:center; width:60px;">Ir</th>
                                </tr>
                            </thead>
                            <tbody id="tbody-resumen-registros">
                                <tr><td colspan="5" class="vacio">Cargando movimientos recientes…</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;

        visor.querySelectorAll('.reg-card').forEach(card => {
            card.addEventListener('click', () => this.m_rutear(card.dataset.tipo, card));
        });

        this.m_activarAtajos();
        if (window.lucide) lucide.createIcons();
        this.m_cargarHistorialResumen();
        this.m_cargarKpis();
    },

    m_htmlKpi: function(icono, label, valor, id) {
        return `
            <div class="reg-kpi">
                <div class="reg-kpi-icono"><i data-lucide="${icono}"></i></div>
                <div>
                    <div class="reg-kpi-label">${label}</div>
                    <div class="reg-kpi-valor" id="${id}">${valor}</div>
                </div>
            </div>`;
    },

    // Teclas 1–4 abren las tarjetas, solo mientras el panel está en pantalla
    m_activarAtajos: function() {
        if (this._atajosHandler) document.removeEventListener('keydown', this._atajosHandler);
        this._atajosHandler = (ev) => {
            if (!document.getElementById('reg-panel')) {
                document.removeEventListener('keydown', this._atajosHandler);
                this._atajosHandler = null;
                return;
            }
            const t = ev.target;
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
            const modal = document.getElementById('modal-agrosoft');
            if (modal && modal.style.display !== 'none') return;
            const acc = this.ACCIONES.find(a => a.atajo === ev.key);
            if (acc) {
                ev.preventDefault();
                const card = document.querySelector(`.reg-card[data-tipo="${acc.tipo}"]`);
                this.m_rutear(acc.tipo, card);
            }
        };
        document.addEventListener('keydown', this._atajosHandler);
    },

    m_cargarKpis: async function() {
        const set = (id, txt, alerta = false) => {
            const el = document.getElementById(id);
            if (el) { el.textContent = txt; el.classList.toggle('alerta', alerta); }
        };
        const hoy = new Date();
        const mes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;

        try {
            const res = await this.m_ejecutarSqlLocal(
                `SELECT COUNT(*) AS cant, IFNULL(SUM(total_dolar), 0) AS usd FROM egresos_insumos WHERE substr(fecha, 1, 7) = ?`, [mes]
            );
            const f = this.m_filas(res)[0] || {};
            set('kpi-mes-cant', Number(f.cant || 0).toLocaleString('es-AR'));
            set('kpi-mes-usd', Number(f.usd || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        } catch (e) {
            set('kpi-mes-cant', '—'); set('kpi-mes-usd', '—');
        }

        try {
            const res = await this.m_ejecutarSqlLocal(`SELECT COUNT(*) AS cant FROM egresos_insumos WHERE IFNULL(sincronizado, 0) = 0`);
            const n = Number((this.m_filas(res)[0] || {}).cant || 0);
            set('kpi-pendientes', n.toLocaleString('es-AR'), n > 0);
        } catch (e) {
            set('kpi-pendientes', '—');
        }
    },

    m_cargarHistorialResumen: async function() {
        const tbody = document.getElementById('tbody-resumen-registros');
        if (!tbody) return;

        try {
            const res = await this.m_ejecutarSqlLocal(
                `SELECT fecha, tipo_labor, insumo, total_dolar, establecimiento FROM egresos_insumos ORDER BY fecha DESC LIMIT 8`
            );
            const data = this.m_filas(res);

            if (data.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="vacio">Todavía no hay registros en la base local.</td></tr>`;
                return;
            }

            tbody.innerHTML = data.map(reg => {
                const tipo = reg.tipo_labor || 'GENERAL';
                const ruteable = !!this.m_rutaDe(tipo);
                return `
                    <tr style="${this.m_varsAcento(tipo)}">
                        <td><b>${this.m_esc(reg.fecha || '-')}</b></td>
                        <td><span class="badge-soft">${this.m_esc(tipo)}</span></td>
                        <td>
                            <div style="display:flex; flex-direction:column;">
                                <strong>${this.m_esc(reg.insumo || 'Sin detalle')}</strong>
                                <small style="color:#6E6E73; font-size:0.7rem;">${this.m_esc(reg.establecimiento || 'General')}</small>
                            </div>
                        </td>
                        <td style="text-align:right; font-weight:800; color:#1E8E4E; font-variant-numeric:tabular-nums;">U$S ${Number(reg.total_dolar || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td style="text-align:center;">
                            ${ruteable ? `
                                <button class="btn-mini-soft" data-ir="${this.m_esc(tipo)}" title="Ir a ${this.m_esc(tipo)}">
                                    <i data-lucide="arrow-up-right"></i>
                                </button>` : '<span style="color:#C4C8CE;">—</span>'}
                        </td>
                    </tr>`;
            }).join('');

            tbody.querySelectorAll('[data-ir]').forEach(b => {
                b.addEventListener('click', () => this.m_rutear(b.dataset.ir));
            });

            if (window.lucide) lucide.createIcons();
        } catch (err) {
            console.error("Error historial local:", err);
            tbody.innerHTML = `<tr><td colspan="5" class="vacio" style="color:#E0342A;">Error al consultar la base local: ${this.m_esc(err.message)}</td></tr>`;
        }
    },

    // =================================================================
    // 4. ENRUTADOR
    // =================================================================
    // Cada ruta resuelve su módulo y lo inicia. Mismo comportamiento que antes, en forma de tabla.
    m_rutaDe: function(tipo) {
        const self = this;
        const RUTAS = {
            'OTROS GASTOS ADM': async () => {
                const mod = typeof ModuloGastosAdm !== 'undefined' ? ModuloGastosAdm : window.ModuloGastosAdm;
                if (!mod) throw new Error('El módulo de Gastos Administrativos no está cargado.');
                mod.parametros = mod.parametros || {};
                mod.parametros.gastos = self.parametros.gastos;
                mod.parametros.campos = self.parametros.depositos; // se mantiene el mapeo original
                await mod.m_inicializar();
            },

            'LABORES': async () => {
                const mod = typeof ModuloLabores !== 'undefined' ? ModuloLabores : window.ModuloLabores;
                if (!mod) throw new Error('El módulo de Labores no está cargado.');
                mod.parametros = mod.parametros || {};
                mod.parametros.insumos = self.parametros.insumos;
                mod.parametros.labores = self.parametros.labores;
                await mod.m_inicializar();
            },

            'ORDEN TRABAJO': async () => {
                const mod = await self.m_obtenerModulo('ModuloOrdenes',
                    () => (typeof ModuloOrdenes !== 'undefined' ? ModuloOrdenes : window.ModuloOrdenes));
                if (!mod || typeof mod.m_inicializar !== 'function') {
                    throw new Error('No se pudo iniciar Órdenes de Trabajo (trabajo/registracion_ordesnTra.js).');
                }
                await mod.m_inicializar();
            },

            'BAJA CONSUMO': async () => {
                if (typeof PaginaBajaInsumos !== 'undefined' && PaginaBajaInsumos.m_inicializar) {
                    return await PaginaBajaInsumos.m_inicializar();
                }
                if (typeof ModuloEgresos !== 'undefined' && ModuloEgresos.m_inicializar) {
                    return await ModuloEgresos.m_inicializar();
                }
                throw new Error('El módulo de Bajas no está disponible.');
            }
        };
        return RUTAS[tipo] || null;
    },

    m_rutear: async function(tipo, tarjeta = null) {
        const ruta = this.m_rutaDe(tipo);
        if (!ruta) {
            console.log("Módulo en desarrollo:", tipo);
            return this.m_avisar('error', `"${tipo}" todavía no tiene una pantalla asignada.`);
        }
        if (this._ruteando) return; // evita doble apertura por doble clic
        this._ruteando = true;

        document.querySelectorAll('[id^="modal-agrosoft"]').forEach(el => el.remove());
        if (tarjeta) tarjeta.classList.add('cargando');
        if (this._atajosHandler) {
            document.removeEventListener('keydown', this._atajosHandler);
            this._atajosHandler = null;
        }

        try {
            await ruta();
        } catch (e) {
            console.error(`Error al abrir ${tipo}:`, e);
            this.m_avisar('error', e.message || String(e));
            if (tarjeta && document.body.contains(tarjeta)) tarjeta.classList.remove('cargando');
            if (document.getElementById('reg-panel')) this.m_activarAtajos();
        } finally {
            this._ruteando = false;
        }
    }
};

window.ModuloRegistracion = ModuloRegistracion;
