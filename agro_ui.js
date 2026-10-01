/**
 * agro_ui.js — Capa visual compartida de los módulos de Insumos
 * SALVUCCI GESTIÓN · AgroSoft J&L
 *
 * Cargar en index.html ANTES de insumos.js, insumos_egresos.js, insumos_stock.js,
 * insumos_combustibles.js y baja_consumos.js.
 *
 * Ofrece:
 *   - Estilos unificados (página a pantalla completa, KPIs, solapas, tablas, modal, formularios)
 *   - Avisos (notificar) y confirmaciones (confirmar) en lugar de alert()/confirm()
 *   - Modal único #modal-agrosoft con los mismos IDs que ya usan los módulos
 *   - Sub-formularios que no pisan el formulario principal
 *   - Helpers: esc, filas, num, sql, conservarFoco
 */
(function () {
    if (window.AgroUI) return;

    const AgroUI = {};

    // -----------------------------------------------------------------
    // Texto y números
    // -----------------------------------------------------------------
    AgroUI.esc = function (v) {
        return (v === null || v === undefined ? '' : String(v))
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };

    // Argumento JS seguro dentro de onclick="..."
    AgroUI.js = function (v) {
        return AgroUI.esc(JSON.stringify(v === null || v === undefined ? '' : v));
    };

    AgroUI.num = function (v, dec = 0) {
        const n = Number(v) || 0;
        return n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: Math.max(dec, 2) });
    };

    AgroUI.norm = function (txt) {
        return (txt || '').toString().replace(/\s+/g, ' ').trim().toUpperCase();
    };

    AgroUI.hoy = function () {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    // Resultado de SQL como array, venga como {data} o como array
    AgroUI.filas = function (res) {
        if (!res) return [];
        if (Array.isArray(res)) return res;
        return Array.isArray(res.data) ? res.data : [];
    };

    AgroUI.sql = async function (sql, params = []) {
        if (window.apiLocal && window.apiLocal.query) return await window.apiLocal.query({ sql, params });
        if (window.electronAPI && window.electronAPI.invoke) return await window.electronAPI.invoke('local-db-query', { sql, params });
        if (typeof window.q === 'function') return await window.q(sql, ...params);
        throw new Error('No se encontró la conexión con la base local.');
    };

    // Max(columna)+1 de una tabla
    AgroUI.siguiente = async function (tabla, columna) {
        try {
            const f = AgroUI.filas(await AgroUI.sql(`SELECT MAX(CAST(${columna} AS INTEGER)) AS m FROM ${tabla}`))[0];
            return (parseInt(f && f.m, 10) || 0) + 1;
        } catch (e) {
            return 1;
        }
    };

    // Color estable por nombre (depósitos, orígenes, rubros)
    const PALETA = ['#1E6B4C', '#0A66C2', '#8B4FD9', '#C77700', '#00838F', '#B23A48'];
    AgroUI.colorDe = function (nombre) {
        const t = AgroUI.norm(nombre || 'X');
        let h = 0;
        for (let i = 0; i < t.length; i++) h = t.charCodeAt(i) + ((h << 5) - h);
        return PALETA[Math.abs(h) % PALETA.length];
    };

    // Re-dibuja conservando foco y cursor del input indicado (buscadores)
    AgroUI.conservarFoco = function (idInput, fnRender) {
        const el = document.getElementById(idInput);
        const tenia = el && document.activeElement === el;
        const ini = tenia ? el.selectionStart : null;
        const fin = tenia ? el.selectionEnd : null;
        fnRender();
        if (tenia) {
            const nuevo = document.getElementById(idInput);
            if (nuevo) {
                nuevo.focus();
                try { nuevo.setSelectionRange(ini, fin); } catch (e) { /* input sin selección */ }
            }
        }
    };

    AgroUI.debounce = function (fn, ms = 180) {
        let t = null;
        return function (...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), ms);
        };
    };

    AgroUI.iconos = function () {
        if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
    };

    // -----------------------------------------------------------------
    // Estilos
    // -----------------------------------------------------------------
    AgroUI.asegurarEstilos = function () {
        if (document.getElementById('agro-ui-estilos')) return;
        const st = document.createElement('style');
        st.id = 'agro-ui-estilos';
        st.textContent = `
            :root {
                --ag-bg: #F5F4F1;
                --ag-surface: #FFFFFF;
                --ag-text: #211C16;
                --ag-text-2: #6B6255;
                --ag-text-3: #9A928A;
                --ag-border: #E0DCD4;
                --ag-border-soft: #ECE9E3;
                --ag-verde: #1E6B4C;
                --ag-verde-dark: #123F2C;
                --ag-verde-soft: rgba(30,107,76,0.09);
                --ag-azul: #0A66C2;
                --ag-azul-soft: rgba(10,102,194,0.09);
                --ag-ambar: #C77700;
                --ag-ambar-soft: rgba(199,119,0,0.10);
                --ag-rojo: #C62828;
                --ag-rojo-soft: rgba(198,40,40,0.08);
                --ag-radius: 12px;
            }

            .agro-page {
                font-family: 'Roboto', -apple-system, sans-serif;
                color: var(--ag-text);
                background: var(--ag-bg);
                padding: 8px 18px 14px;
                box-sizing: border-box;
                height: calc(100vh - 65px);
                display: flex;
                flex-direction: column;
                gap: 10px;
                overflow: hidden;
            }
            .agro-page * { box-sizing: border-box; }

            /* Cabecera */
            .agro-header { display:flex; justify-content:space-between; align-items:flex-end; gap:12px; flex-wrap:wrap; flex-shrink:0; }
            .agro-header h2 { margin:0; font-size:1.3rem; font-weight:800; letter-spacing:-0.3px; color:var(--ag-verde-dark); }
            .agro-header p { margin:3px 0 0; font-size:0.78rem; color:var(--ag-text-2); }
            .agro-acciones { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }

            /* Botones */
            .agro-btn {
                display:inline-flex; align-items:center; gap:6px; border-radius:9px; padding:8px 14px;
                font:700 0.78rem 'Roboto',sans-serif; cursor:pointer; border:1px solid var(--ag-border);
                background:#FFFFFF; color:var(--ag-text); transition:background .15s, border-color .15s, transform .1s;
                white-space:nowrap;
            }
            .agro-btn:hover { border-color:#C9C3B8; background:#FBFAF8; }
            .agro-btn:active { transform:scale(0.98); }
            .agro-btn:disabled { opacity:.55; cursor:not-allowed; }
            .agro-btn svg { width:15px; height:15px; }
            .agro-btn.primario { background:var(--ag-verde); border-color:var(--ag-verde); color:#FFFFFF; }
            .agro-btn.primario:hover { background:var(--ag-verde-dark); }
            .agro-btn.peligro { color:var(--ag-rojo); border-color:rgba(198,40,40,0.3); }
            .agro-btn.peligro:hover { background:var(--ag-rojo-soft); }
            .agro-btn.peligro-lleno { background:var(--ag-rojo); border-color:var(--ag-rojo); color:#FFF; }
            .agro-btn.azul { background:var(--ag-azul); border-color:var(--ag-azul); color:#FFF; }
            .agro-btn.chico { padding:5px 10px; font-size:0.72rem; border-radius:7px; }

            .agro-icon-btn {
                width:30px; height:30px; display:inline-flex; align-items:center; justify-content:center;
                border-radius:8px; border:1px solid transparent; background:transparent; color:var(--ag-text-2);
                cursor:pointer; transition:background .15s, color .15s, border-color .15s;
            }
            .agro-icon-btn:hover { background:#FFFFFF; border-color:var(--ag-border); color:var(--ag-text); }
            .agro-icon-btn.peligro:hover { color:var(--ag-rojo); border-color:rgba(198,40,40,0.3); background:var(--ag-rojo-soft); }
            .agro-icon-btn svg { width:15px; height:15px; }

            /* KPIs */
            .agro-kpis { display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:10px; flex-shrink:0; }
            .agro-kpi { background:#FFFFFF; border:1px solid var(--ag-border); border-radius:var(--ag-radius); padding:11px 14px; display:flex; align-items:center; gap:12px; min-width:0; }
            .agro-kpi-icono { width:36px; height:36px; border-radius:10px; display:flex; align-items:center; justify-content:center; flex-shrink:0; background:var(--ag-verde-soft); color:var(--ag-verde); }
            .agro-kpi-icono svg { width:18px; height:18px; }
            .agro-kpi.azul .agro-kpi-icono { background:var(--ag-azul-soft); color:var(--ag-azul); }
            .agro-kpi.ambar .agro-kpi-icono { background:var(--ag-ambar-soft); color:var(--ag-ambar); }
            .agro-kpi.rojo .agro-kpi-icono { background:var(--ag-rojo-soft); color:var(--ag-rojo); }
            .agro-kpi.gris .agro-kpi-icono { background:#F0EEEA; color:var(--ag-text-2); }
            .agro-kpi-label { font-size:0.63rem; font-weight:800; letter-spacing:0.4px; text-transform:uppercase; color:var(--ag-text-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .agro-kpi-valor { font-size:1.18rem; font-weight:800; font-variant-numeric:tabular-nums; line-height:1.25; color:var(--ag-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .agro-kpi-valor small { font-size:0.68rem; font-weight:700; color:var(--ag-text-2); margin-left:3px; }
            .agro-kpi-sub { font-size:0.66rem; color:var(--ag-text-3); }
            .agro-kpi.rojo .agro-kpi-valor { color:var(--ag-rojo); }
            .agro-kpi.ambar .agro-kpi-valor { color:var(--ag-ambar); }

            /* Solapas */
            .agro-tabs { display:flex; gap:4px; border-bottom:1px solid var(--ag-border); flex-shrink:0; overflow-x:auto; }
            .agro-tab {
                display:inline-flex; align-items:center; gap:7px; padding:9px 14px 10px; border:none; background:none;
                font:700 0.8rem 'Roboto',sans-serif; color:var(--ag-text-2); cursor:pointer; white-space:nowrap;
                border-bottom:2px solid transparent; margin-bottom:-1px; transition:color .15s, border-color .15s;
            }
            .agro-tab:hover { color:var(--ag-text); }
            .agro-tab.activa { color:var(--ag-verde-dark); border-bottom-color:var(--ag-verde); }
            .agro-tab svg { width:15px; height:15px; }
            .agro-tab-badge { font-size:0.66rem; font-weight:800; padding:2px 7px; border-radius:10px; background:#EFEDE8; color:var(--ag-text-2); }
            .agro-tab.activa .agro-tab-badge { background:var(--ag-verde-soft); color:var(--ag-verde); }
            .agro-tab-badge.rojo { background:var(--ag-rojo-soft); color:var(--ag-rojo); }
            .agro-tab-badge.ambar { background:var(--ag-ambar-soft); color:var(--ag-ambar); }

            /* Barra de filtros */
            .agro-toolbar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; flex-shrink:0; }
            .agro-search { position:relative; flex:1; min-width:240px; max-width:420px; }
            .agro-search svg { position:absolute; left:10px; top:50%; transform:translateY(-50%); width:15px; height:15px; color:var(--ag-text-3); pointer-events:none; }
            .agro-search input { width:100%; padding:8px 10px 8px 32px; }
            .agro-toolbar input[type=text], .agro-toolbar select {
                border:1px solid var(--ag-border); border-radius:9px; padding:8px 10px; font:500 0.8rem 'Roboto',sans-serif;
                background:#FFFFFF; color:var(--ag-text); outline:none;
            }
            .agro-toolbar input:focus, .agro-toolbar select:focus { border-color:var(--ag-verde); box-shadow:0 0 0 3px var(--ag-verde-soft); }
            .agro-toolbar .agro-spacer { flex:1; }
            .agro-limpiar { background:none; border:none; color:var(--ag-rojo); font:700 0.75rem 'Roboto',sans-serif; cursor:pointer; padding:6px 8px; border-radius:7px; }
            .agro-limpiar:hover { background:var(--ag-rojo-soft); }

            /* Chips de depósito / grupo */
            .agro-chips { display:flex; gap:6px; overflow-x:auto; flex-shrink:0; padding-bottom:2px; }
            .agro-chip {
                display:inline-flex; align-items:center; gap:7px; padding:6px 11px; border-radius:20px;
                border:1px solid var(--ag-border); background:#FFFFFF; font:600 0.76rem 'Roboto',sans-serif; color:var(--ag-text);
                cursor:pointer; white-space:nowrap; transition:border-color .15s, background .15s;
            }
            .agro-chip:hover { border-color:#C9C3B8; }
            .agro-chip.activa { border-color:var(--ag-verde); background:var(--ag-verde-soft); color:var(--ag-verde-dark); }
            .agro-chip .punto { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
            .agro-chip .cuenta { font-size:0.68rem; color:var(--ag-text-2); font-weight:700; }

            /* Panel + tabla */
            .agro-panel { background:#FFFFFF; border:1px solid var(--ag-border); border-radius:var(--ag-radius); flex:1; min-height:0; display:flex; flex-direction:column; overflow:hidden; }
            .agro-panel-cab { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 14px; border-bottom:1px solid var(--ag-border-soft); flex-shrink:0; }
            .agro-panel-cab .titulo { font-size:0.74rem; font-weight:800; letter-spacing:0.4px; text-transform:uppercase; color:var(--ag-text); }
            .agro-panel-cab .meta { font-size:0.72rem; color:var(--ag-text-2); }
            .agro-scroll { flex:1; overflow:auto; min-height:0; }

            .agro-tabla { width:100%; border-collapse:separate; border-spacing:0; font-size:0.8rem; }
            .agro-tabla th {
                position:sticky; top:0; z-index:2; background:#F8F7F4; color:var(--ag-text-2);
                font-size:0.64rem; font-weight:800; letter-spacing:0.5px; text-transform:uppercase; text-align:left;
                padding:9px 10px; border-bottom:1px solid var(--ag-border); white-space:nowrap;
            }
            .agro-tabla td { padding:9px 10px; border-bottom:1px solid var(--ag-border-soft); vertical-align:middle; color:var(--ag-text); }
            .agro-tabla tbody tr:hover td { background:#FAFAF7; }
            .agro-tabla .der { text-align:right; }
            .agro-tabla .cen { text-align:center; }
            .agro-tabla .num { font-variant-numeric:tabular-nums; white-space:nowrap; }
            .agro-tabla .fuerte { font-weight:800; }
            .agro-tabla .sec { color:var(--ag-text-2); }
            .agro-tabla .sub { display:block; font-size:0.7rem; color:var(--ag-text-2); margin-top:2px; }
            .agro-tabla .acciones { white-space:nowrap; text-align:right; width:1%; }
            .agro-tabla tfoot td { position:sticky; bottom:0; background:#F8F7F4; font-weight:800; border-top:1px solid var(--ag-border); }
            .agro-vacio { text-align:center; padding:44px 20px !important; color:var(--ag-text-3) !important; font-size:0.84rem; }
            .agro-vacio svg { width:30px; height:30px; display:block; margin:0 auto 8px; opacity:.6; }

            .agro-positivo { color:var(--ag-verde); }
            .agro-negativo { color:var(--ag-rojo); }
            .agro-azul { color:var(--ag-azul); }
            .agro-ambar { color:var(--ag-ambar); }

            /* Badges */
            .agro-badge { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:6px; font-size:0.68rem; font-weight:800; white-space:nowrap; background:#EFEDE8; color:var(--ag-text-2); }
            .agro-badge.verde { background:var(--ag-verde-soft); color:var(--ag-verde); }
            .agro-badge.azul { background:var(--ag-azul-soft); color:var(--ag-azul); }
            .agro-badge.ambar { background:var(--ag-ambar-soft); color:var(--ag-ambar); }
            .agro-badge.rojo { background:var(--ag-rojo-soft); color:var(--ag-rojo); }
            .agro-badge svg { width:11px; height:11px; }
            .agro-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; vertical-align:middle; }
            .agro-sync { display:inline-flex; width:18px; height:18px; border-radius:50%; align-items:center; justify-content:center; vertical-align:middle; margin-right:5px; }
            .agro-sync svg { width:11px; height:11px; }
            .agro-sync.ok { background:var(--ag-verde-soft); color:var(--ag-verde); }
            .agro-sync.pend { background:var(--ag-ambar-soft); color:var(--ag-ambar); }

            .agro-barra { height:5px; border-radius:4px; background:#EFEDE8; overflow:hidden; min-width:60px; }
            .agro-barra span { display:block; height:100%; background:var(--ag-verde); border-radius:4px; }
            .agro-barra.rojo span { background:var(--ag-rojo); }
            .agro-barra.ambar span { background:var(--ag-ambar); }

            /* Modal único (#modal-agrosoft) */
            #modal-agrosoft {
                position:fixed !important; inset:0 !important; width:100vw !important; height:100vh !important;
                background:rgba(20,24,20,0.42) !important; backdrop-filter:blur(6px) !important; -webkit-backdrop-filter:blur(6px) !important;
                z-index:99999 !important; justify-content:center; align-items:center; padding:20px !important; box-sizing:border-box;
            }
            #modal-agrosoft .modal-apple-content {
                background:#FFFFFF !important; border:1px solid var(--ag-border) !important; border-radius:16px !important;
                padding:0 !important; width:95%; max-height:90vh !important; display:flex !important; flex-direction:column !important;
                box-shadow:0 24px 60px rgba(0,0,0,0.20) !important; overflow:hidden !important; font-family:'Roboto',sans-serif !important;
                animation: agroModalIn .18s ease-out;
            }
            @keyframes agroModalIn { from { transform:translateY(8px); opacity:0; } to { transform:none; opacity:1; } }
            #modal-agrosoft .modal-header-apple {
                display:flex !important; justify-content:space-between !important; align-items:center !important;
                padding:16px 22px !important; margin:0 !important; border-bottom:1px solid var(--ag-border-soft) !important;
                border-top:4px solid var(--ag-verde); flex-shrink:0;
            }
            #modal-agrosoft #modal-titulo { font:800 1.02rem 'Roboto',sans-serif !important; color:var(--ag-verde-dark) !important; letter-spacing:0.2px !important; margin:0 !important; }
            #modal-agrosoft .agro-modal-cerrar { width:32px; height:32px; border-radius:8px; border:none; background:#F3F1ED; color:var(--ag-text-2); cursor:pointer; font-size:1.2rem; line-height:1; display:flex; align-items:center; justify-content:center; }
            #modal-agrosoft .agro-modal-cerrar:hover { background:#E9E6E0; color:var(--ag-text); }
            #modal-agrosoft #modal-formulario { padding:18px 22px 20px !important; overflow-y:auto !important; max-height:none !important; flex:1; }
            #modal-agrosoft .modal-footer-apple { padding:12px 22px 16px !important; margin:0 !important; border-top:1px solid var(--ag-border-soft) !important; }

            /* Formularios dentro del modal: tamaños y estados uniformes */
            #modal-formulario, #modal-formulario * { font-family:'Roboto',sans-serif !important; }
            #modal-formulario *, .agro-confirm * { box-sizing:border-box; }
            #modal-formulario label { font-size:0.66rem !important; letter-spacing:0.3px; }
            #modal-formulario input:not([type=hidden]):not([type=checkbox]):not([type=radio]),
            #modal-formulario select, #modal-formulario textarea {
                font-size:0.86rem !important; min-height:36px; border-radius:8px !important;
                border-color:var(--ag-border); transition:border-color .15s, box-shadow .15s;
            }
            #modal-formulario input:focus, #modal-formulario select:focus, #modal-formulario textarea:focus {
                outline:none !important; border-color:var(--ag-verde) !important; box-shadow:0 0 0 3px var(--ag-verde-soft) !important;
            }
            #modal-formulario input[readonly] { cursor:default; }
            #modal-formulario button { font-weight:700; }

            .agro-form-seccion { background:#FAFAF8; border:1px solid var(--ag-border-soft); border-radius:12px; padding:14px; }
            .agro-form-titulo { font-size:0.66rem; font-weight:900; letter-spacing:0.5px; text-transform:uppercase; color:var(--ag-verde); margin:0 0 10px; }
            .agro-form-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
            .agro-form-grid .full { grid-column:1 / -1; }
            .agro-campo label { display:block; font-size:0.66rem; font-weight:800; text-transform:uppercase; color:var(--ag-text-2); margin-bottom:4px; }
            .agro-campo input, .agro-campo select, .agro-campo textarea { width:100%; padding:8px 10px; border:1px solid var(--ag-border); border-radius:8px; background:#FFFFFF; }
            .agro-aviso { border-left:4px solid var(--ag-verde); background:var(--ag-verde-soft); padding:10px 12px; border-radius:8px; font-size:0.8rem; line-height:1.45; color:var(--ag-text); }
            .agro-aviso.rojo { border-left-color:var(--ag-rojo); background:var(--ag-rojo-soft); }
            .agro-aviso.azul { border-left-color:var(--ag-azul); background:var(--ag-azul-soft); }
            .agro-aviso.ambar { border-left-color:var(--ag-ambar); background:var(--ag-ambar-soft); }
            .agro-pie { display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--ag-border-soft); padding-top:14px; margin-top:4px; }
            .agro-dato { background:#F8F7F4; border:1px solid var(--ag-border-soft); border-radius:10px; padding:10px 12px; text-align:center; }
            .agro-dato span { display:block; font-size:0.62rem; font-weight:800; text-transform:uppercase; color:var(--ag-text-2); letter-spacing:0.3px; }
            .agro-dato strong { display:block; font-size:1.05rem; font-weight:900; font-variant-numeric:tabular-nums; margin-top:2px; }

            /* Avisos flotantes */
            .agro-toast-zona { position:fixed; top:22px; left:50%; transform:translateX(-50%); z-index:1000001; display:flex; flex-direction:column; gap:8px; align-items:center; pointer-events:none; }
            .agro-toast {
                pointer-events:auto; display:flex; align-items:center; gap:10px; min-width:280px; max-width:560px;
                background:#FFFFFF; border:1px solid var(--ag-border); border-left:4px solid var(--ag-verde); border-radius:12px;
                padding:11px 16px; box-shadow:0 10px 26px rgba(20,26,36,0.14); font:600 0.84rem 'Roboto',sans-serif; color:var(--ag-text);
                animation: agroToastIn .2s ease-out;
            }
            .agro-toast.error { border-left-color:var(--ag-rojo); }
            .agro-toast.alerta { border-left-color:var(--ag-ambar); }
            .agro-toast .ic { width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:0.8rem; flex-shrink:0; background:var(--ag-verde-soft); color:var(--ag-verde); }
            .agro-toast.error .ic { background:var(--ag-rojo-soft); color:var(--ag-rojo); }
            .agro-toast.alerta .ic { background:var(--ag-ambar-soft); color:var(--ag-ambar); }
            .agro-toast.saliendo { opacity:0; transform:translateY(-8px); transition:all .3s ease; }
            @keyframes agroToastIn { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:none; } }

            /* Confirmación */
            .agro-confirm-fondo { position:fixed; inset:0; background:rgba(20,24,20,0.45); backdrop-filter:blur(4px); z-index:1000000; display:flex; align-items:center; justify-content:center; padding:20px; }
            .agro-confirm { background:#FFFFFF; border-radius:16px; width:100%; max-width:420px; padding:22px; box-shadow:0 24px 60px rgba(0,0,0,0.22); font-family:'Roboto',sans-serif; text-align:center; animation: agroModalIn .18s ease-out; }
            .agro-confirm .ic { width:48px; height:48px; border-radius:50%; margin:0 auto 10px; display:flex; align-items:center; justify-content:center; font-size:1.3rem; font-weight:900; background:var(--ag-verde-soft); color:var(--ag-verde); }
            .agro-confirm.peligro .ic { background:var(--ag-rojo-soft); color:var(--ag-rojo); }
            .agro-confirm h3 { margin:0 0 6px; font-size:1.05rem; color:var(--ag-text); }
            .agro-confirm p { margin:0; font-size:0.84rem; color:var(--ag-text-2); line-height:1.45; }
            .agro-confirm .detalle { display:block; margin-top:8px; font-weight:800; color:var(--ag-text); }
            .agro-confirm.peligro .detalle { color:var(--ag-rojo); }
            .agro-confirm .botones { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:18px; }
            .agro-confirm input { width:100%; margin-top:12px; padding:9px 11px; border:1px solid var(--ag-border); border-radius:9px; font:500 0.9rem 'Roboto',sans-serif; outline:none; text-transform:uppercase; }
            .agro-confirm input:focus { border-color:var(--ag-verde); box-shadow:0 0 0 3px var(--ag-verde-soft); }

            @media (max-width: 1100px) { .agro-form-grid { grid-template-columns:1fr; } }
        `;
        document.head.appendChild(st);
    };

    // -----------------------------------------------------------------
    // Avisos
    // -----------------------------------------------------------------
    AgroUI.notificar = function (mensaje, tipo = 'exito') {
        AgroUI.asegurarEstilos();
        let zona = document.querySelector('.agro-toast-zona');
        if (!zona) {
            zona = document.createElement('div');
            zona.className = 'agro-toast-zona';
            document.body.appendChild(zona);
        }
        const t = tipo === 'error' ? 'error' : (tipo === 'exito' ? 'exito' : 'alerta');
        const icono = t === 'error' ? '!' : (t === 'exito' ? '✓' : 'i');
        const el = document.createElement('div');
        el.className = `agro-toast ${t}`;
        el.innerHTML = `<span class="ic">${icono}</span><div>${AgroUI.esc(mensaje)}</div>`;
        zona.appendChild(el);
        while (zona.children.length > 3) zona.firstChild.remove();
        setTimeout(() => {
            el.classList.add('saliendo');
            setTimeout(() => el.remove(), 320);
        }, t === 'error' ? 5200 : 3400);
    };

    // Confirmación con promesa: const ok = await AgroUI.confirmar({...})
    AgroUI.confirmar = function ({ titulo = '¿Confirmar?', mensaje = '', detalle = '', textoOk = 'Confirmar', textoCancelar = 'Cancelar', peligro = false, pedirTexto = null } = {}) {
        AgroUI.asegurarEstilos();
        return new Promise(resolve => {
            const fondo = document.createElement('div');
            fondo.className = 'agro-confirm-fondo';
            fondo.innerHTML = `
                <div class="agro-confirm ${peligro ? 'peligro' : ''}" role="dialog" aria-modal="true">
                    <div class="ic">${peligro ? '!' : '?'}</div>
                    <h3>${AgroUI.esc(titulo)}</h3>
                    <p>${AgroUI.esc(mensaje)}${detalle ? `<span class="detalle">${AgroUI.esc(detalle)}</span>` : ''}</p>
                    ${pedirTexto ? `<input type="text" placeholder="${AgroUI.esc(pedirTexto)}" autocomplete="off">` : ''}
                    <div class="botones">
                        <button type="button" class="agro-btn" data-r="no">${AgroUI.esc(textoCancelar)}</button>
                        <button type="button" class="agro-btn ${peligro ? 'peligro-lleno' : 'primario'}" data-r="si">${AgroUI.esc(textoOk)}</button>
                    </div>
                </div>`;
            const cerrar = (valor) => {
                document.removeEventListener('keydown', teclas, true);
                fondo.remove();
                resolve(valor);
            };
            const valorOk = () => {
                if (!pedirTexto) return true;
                const v = (fondo.querySelector('input').value || '').trim();
                return v ? v : null;
            };
            const teclas = (ev) => {
                if (ev.key === 'Escape') { ev.stopPropagation(); cerrar(pedirTexto ? null : false); }
                if (ev.key === 'Enter') { ev.stopPropagation(); ev.preventDefault(); cerrar(valorOk()); }
            };
            fondo.addEventListener('click', ev => { if (ev.target === fondo) cerrar(pedirTexto ? null : false); });
            fondo.querySelector('[data-r=no]').onclick = () => cerrar(pedirTexto ? null : false);
            fondo.querySelector('[data-r=si]').onclick = () => cerrar(valorOk());
            document.addEventListener('keydown', teclas, true);
            document.body.appendChild(fondo);
            setTimeout(() => (fondo.querySelector('input') || fondo.querySelector('[data-r=si]')).focus(), 30);
        });
    };

    // Reemplazo de prompt(): devuelve el texto o null
    AgroUI.pedirTexto = function (titulo, mensaje = '', placeholder = 'Escribí acá…') {
        return AgroUI.confirmar({ titulo, mensaje, pedirTexto: placeholder, textoOk: 'Agregar' });
    };

    // -----------------------------------------------------------------
    // Modal único
    // -----------------------------------------------------------------
    AgroUI.asegurarModal = function (onCerrar) {
        AgroUI.asegurarEstilos();
        let modal = document.getElementById('modal-agrosoft');
        if (modal && document.getElementById('modal-titulo') && document.getElementById('modal-formulario')) {
            modal._agroCerrar = onCerrar || modal._agroCerrar;
            return modal;
        }
        if (modal) modal.remove();
        document.body.insertAdjacentHTML('beforeend', `
            <div id="modal-agrosoft" class="modal-overlay" style="display:none;">
                <div class="modal-apple-content" style="max-width:820px;">
                    <div class="modal-header-apple">
                        <h3 id="modal-titulo">GESTIÓN</h3>
                        <button type="button" class="agro-modal-cerrar" aria-label="Cerrar">&times;</button>
                    </div>
                    <div id="modal-formulario" class="scroll-apple"></div>
                </div>
            </div>`);
        modal = document.getElementById('modal-agrosoft');
        modal._agroCerrar = onCerrar;
        const cerrar = () => (modal._agroCerrar ? modal._agroCerrar() : AgroUI.cerrarModal());
        modal.querySelector('.agro-modal-cerrar').onclick = cerrar;
        modal.addEventListener('mousedown', ev => { modal._clicFondo = ev.target === modal; });
        modal.addEventListener('click', ev => { if (ev.target === modal && modal._clicFondo) cerrar(); });
        if (!AgroUI._escModal) {
            AgroUI._escModal = (ev) => {
                const m = document.getElementById('modal-agrosoft');
                if (ev.key === 'Escape' && m && m.style.display !== 'none' && !document.querySelector('.agro-confirm-fondo')) {
                    m._agroCerrar ? m._agroCerrar() : AgroUI.cerrarModal();
                }
            };
            document.addEventListener('keydown', AgroUI._escModal);
        }
        return modal;
    };

    // Abre el modal con título, ancho y contenido
    AgroUI.abrirModal = function ({ titulo = '', ancho = 820, html = null, onCerrar = null } = {}) {
        const modal = AgroUI.asegurarModal(onCerrar);
        const caja = modal.querySelector('.modal-apple-content');
        if (caja) caja.style.maxWidth = `${ancho}px`;
        if (titulo) document.getElementById('modal-titulo').innerText = titulo;
        if (html !== null) document.getElementById('modal-formulario').innerHTML = html;
        modal.style.display = 'flex';
        return document.getElementById('modal-formulario');
    };

    AgroUI.cerrarModal = function () {
        const m = document.getElementById('modal-agrosoft');
        if (m) m.style.display = 'none';
    };

    AgroUI.anchoModal = function (px) {
        const caja = document.querySelector('#modal-agrosoft .modal-apple-content');
        if (caja) caja.style.maxWidth = `${px}px`;
    };

    /**
     * Sub-formulario sobre el formulario abierto, SIN destruirlo:
     * el principal se oculta y vuelve intacto (valores escritos y eventos incluidos).
     * Uso: const sub = AgroUI.subFormulario({ titulo, html }); ... sub.cerrar();
     */
    AgroUI.subFormulario = function ({ titulo = '', html = '', ancho = null } = {}) {
        const cont = document.getElementById('modal-formulario');
        const tituloEl = document.getElementById('modal-titulo');
        if (!cont) return { nodo: null, cerrar: () => {} };

        const tituloAnterior = tituloEl ? tituloEl.innerText : '';
        const caja = document.querySelector('#modal-agrosoft .modal-apple-content');
        const anchoAnterior = caja ? caja.style.maxWidth : '';
        const ocultos = Array.from(cont.children).filter(n => !n.classList.contains('agro-subform'));
        ocultos.forEach(n => { n.dataset.agroDisplay = n.style.display || ''; n.style.display = 'none'; });

        const nodo = document.createElement('div');
        nodo.className = 'agro-subform';
        nodo.innerHTML = html;
        cont.appendChild(nodo);
        if (tituloEl && titulo) tituloEl.innerText = titulo;
        if (caja && ancho) caja.style.maxWidth = `${ancho}px`;
        cont.scrollTop = 0;
        setTimeout(() => { const f = nodo.querySelector('input:not([type=hidden]), select, textarea'); if (f) f.focus(); }, 30);

        return {
            nodo,
            cerrar: () => {
                nodo.remove();
                ocultos.forEach(n => { n.style.display = n.dataset.agroDisplay || ''; delete n.dataset.agroDisplay; });
                if (tituloEl) tituloEl.innerText = tituloAnterior;
                if (caja) caja.style.maxWidth = anchoAnterior;
            }
        };
    };

    // -----------------------------------------------------------------
    // Componentes HTML
    // -----------------------------------------------------------------
    AgroUI.volverHTML = function (categoria) {
        const UI = window.ComponentesUI;
        return UI && typeof UI.botonVolverHTML === 'function' ? UI.botonVolverHTML(categoria) : '';
    };

    AgroUI.boton = function ({ texto = '', icono = '', onclick = '', variante = '', titulo = '', id = '' } = {}) {
        return `<button type="button" class="agro-btn ${variante}" ${id ? `id="${id}"` : ''} ${titulo ? `title="${AgroUI.esc(titulo)}"` : ''} onclick="${onclick}">
            ${icono ? `<i data-lucide="${icono}"></i>` : ''}${AgroUI.esc(texto)}
        </button>`;
    };

    AgroUI.iconBtn = function ({ icono, onclick, titulo = '', peligro = false }) {
        return `<button type="button" class="agro-icon-btn ${peligro ? 'peligro' : ''}" title="${AgroUI.esc(titulo)}" onclick="${onclick}"><i data-lucide="${icono}"></i></button>`;
    };

    AgroUI.cabecera = function ({ titulo, subtitulo = '', acciones = [] }) {
        return `
            <div class="agro-header">
                <div>
                    <h2>${AgroUI.esc(titulo)}</h2>
                    ${subtitulo ? `<p>${AgroUI.esc(subtitulo)}</p>` : ''}
                </div>
                <div class="agro-acciones">${acciones.map(a => AgroUI.boton(a)).join('')}</div>
            </div>`;
    };

    // kpis: [{ label, valor, unidad, sub, icono, tono }]
    AgroUI.kpis = function (lista) {
        return `<div class="agro-kpis">${lista.map(k => `
            <div class="agro-kpi ${k.tono || ''}">
                <div class="agro-kpi-icono"><i data-lucide="${k.icono || 'circle'}"></i></div>
                <div style="min-width:0;">
                    <div class="agro-kpi-label">${AgroUI.esc(k.label)}</div>
                    <div class="agro-kpi-valor" ${k.id ? `id="${k.id}"` : ''}>${k.valor}${k.unidad ? `<small>${AgroUI.esc(k.unidad)}</small>` : ''}</div>
                    ${k.sub ? `<div class="agro-kpi-sub">${k.sub}</div>` : ''}
                </div>
            </div>`).join('')}</div>`;
    };

    // tabs: [{ clave, texto, icono, badge, tonoBadge }], activa, onclick(clave) -> string JS
    AgroUI.tabs = function (lista, activa, fnOnclick) {
        return `<div class="agro-tabs" role="tablist">${lista.map(t => `
            <button type="button" role="tab" class="agro-tab ${t.clave === activa ? 'activa' : ''}" onclick="${fnOnclick(t.clave)}">
                ${t.icono ? `<i data-lucide="${t.icono}"></i>` : ''}${AgroUI.esc(t.texto)}
                ${t.badge !== undefined ? `<span class="agro-tab-badge ${t.tonoBadge || ''}">${t.badge}</span>` : ''}
            </button>`).join('')}</div>`;
    };

    // chips: [{ clave, texto, cuenta, color }]
    AgroUI.chips = function (lista, activa, fnOnclick) {
        return `<div class="agro-chips scroll-apple">${lista.map(c => `
            <button type="button" class="agro-chip ${c.clave === activa ? 'activa' : ''}" onclick="${fnOnclick(c.clave)}">
                ${c.color ? `<span class="punto" style="background:${c.color};"></span>` : ''}${AgroUI.esc(c.texto)}
                ${c.cuenta !== undefined ? `<span class="cuenta">${c.cuenta}</span>` : ''}
            </button>`).join('')}</div>`;
    };

    AgroUI.buscador = function ({ id, valor = '', placeholder = 'Buscar…', oninput }) {
        return `<div class="agro-search"><i data-lucide="search"></i>
            <input type="text" id="${id}" value="${AgroUI.esc(valor)}" placeholder="${AgroUI.esc(placeholder)}" oninput="${oninput}" autocomplete="off"></div>`;
    };

    AgroUI.badge = function (texto, tono = '') {
        return `<span class="agro-badge ${tono}">${AgroUI.esc(texto)}</span>`;
    };

    AgroUI.badgeColor = function (texto, color) {
        return `<span class="agro-badge" style="background:${color}14; color:${color};">${AgroUI.esc(texto)}</span>`;
    };

    AgroUI.sync = function (sincronizado) {
        return Number(sincronizado) === 1
            ? `<span class="agro-sync ok" title="Sincronizado con la nube"><i data-lucide="cloud"></i></span>`
            : `<span class="agro-sync pend" title="Pendiente de sincronizar"><i data-lucide="cloud-off"></i></span>`;
    };

    AgroUI.filaVacia = function (colspan, mensaje, icono = 'inbox') {
        return `<tr><td colspan="${colspan}" class="agro-vacio"><i data-lucide="${icono}"></i>${AgroUI.esc(mensaje)}</td></tr>`;
    };

    AgroUI.cargando = function (texto) {
        return `<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:55vh; gap:16px; font-family:'Roboto',sans-serif;">
            <div class="loader-apple"></div>
            <span style="font-weight:700; font-size:0.78rem; letter-spacing:1px; text-transform:uppercase; color:#6B6255;">${AgroUI.esc(texto)}</span>
        </div>`;
    };

    AgroUI.errorPantalla = function (titulo, err, fnReintentar) {
        return `<div style="max-width:560px; margin:70px auto; text-align:center; font-family:'Roboto',sans-serif;">
            <div style="width:56px; height:56px; margin:0 auto 12px; border-radius:16px; background:rgba(198,40,40,0.08); color:#C62828; display:flex; align-items:center; justify-content:center; font-size:1.4rem; font-weight:900;">!</div>
            <h3 style="margin:0 0 6px; color:#211C16;">${AgroUI.esc(titulo)}</h3>
            <p style="margin:0 0 16px; color:#6B6255; font-size:0.86rem;">${AgroUI.esc(err && err.message ? err.message : err)}</p>
            ${fnReintentar ? `<button class="agro-btn primario" onclick="${fnReintentar}">Reintentar</button>` : ''}
        </div>`;
    };

    // Destinos para despachos: cuadros (tabla nueva) + campos (formato anterior), sin repetir
    AgroUI.destinosCuadros = function (cuadros = [], campos = []) {
        const lista = [];
        const vistos = new Set();
        cuadros.forEach(c => {
            const k = `${AgroUI.norm(c.establecimiento)}|${AgroUI.norm(c.campo)}|${AgroUI.norm(c.lote)}`;
            if (vistos.has(k)) return;
            vistos.add(k);
            lista.push({
                clave: `CU-${c.reg_local}`,
                establecimiento: c.establecimiento || '',
                campo: c.campo || '',
                lote: c.lote || '',
                nombre: c.nombre_lote || (c.lote ? `Lote ${c.lote}` : ''),
                sup: parseFloat(c.sup) || 0
            });
        });
        campos.forEach(c => {
            const k = `${AgroUI.norm(c.establecimiento)}|${AgroUI.norm(c.campo)}|${AgroUI.norm(c.lote)}`;
            if (vistos.has(k)) return;
            vistos.add(k);
            lista.push({
                clave: `CA-${c.reg_local || c.id}`,
                establecimiento: c.establecimiento || '',
                campo: c.campo || '',
                lote: c.lote || '',
                nombre: c.lote ? `Lote ${c.lote}` : 'Campo completo',
                sup: parseFloat(c.sup_total || c.sup) || 0
            });
        });
        return lista;
    };

    window.AgroUI = AgroUI;
    AgroUI.asegurarEstilos();
})();
