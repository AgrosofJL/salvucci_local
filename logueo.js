/**
 * logueo.js - Módulo de Autenticación y Control de Sesión
 * Sistema: SALVUCCI / AgroSoft J&L
 * Compatibilidad: Híbrido Electron (SQLite Offline) + Safari / Web (Supabase + Storage)
 * Lenguaje Visual: Apple Soft Studio / Roboto Font
 */

/* =======================================================================
   0. ADAPTADOR DE COMPATIBILIDAD WEB / SAFARI (FALLBACK API LOCAL)
   ======================================================================= */
if (!window.apiLocal) {
    console.log("🌐 [Entorno Web / Safari detectado] Inicializando adaptador cliente...");
    window.apiLocal = {
        isWeb: true,
        // Simulación de persistencia en localStorage para Safari
        query: async function({ sql, params = [] }) {
            const sqlUpper = sql.trim().toUpperCase();

            // Consulta de sesión activa
            if (sqlUpper.includes('FROM SESION_ACTIVA')) {
                const sesionStr = localStorage.getItem('sesion_activa_salvucci');
                if (sesionStr) {
                    try {
                        const sesionObj = JSON.parse(sesionStr);
                        return { data: [sesionObj], error: null };
                    } catch (e) {
                        return { data: [], error: null };
                    }
                }
                return { data: [], error: null };
            }

            // Guardado de sesión activa
            if (sqlUpper.includes('INSERT INTO SESION_ACTIVA')) {
                const sesionGuardar = {
                    id: 1,
                    usuario_id: params[0] || 0,
                    nombre_usuario: params[1] || 'Operario',
                    token: params[2] || 'TOKEN_WEB',
                    fecha_inicio: params[3] || new Date().toISOString(),
                    rol: params[4] || 'OPERADOR',
                    correo: params[5] || ''
                };
                localStorage.setItem('sesion_activa_salvucci', JSON.stringify(sesionGuardar));
                return { data: { changes: 1 }, error: null };
            }

            // Cierre de sesión activa
            if (sqlUpper.includes('DELETE FROM SESION_ACTIVA')) {
                localStorage.removeItem('sesion_activa_salvucci');
                return { data: { changes: 1 }, error: null };
            }

            // Fallback para usuarios en Safari directo desde Supabase
            if (sqlUpper.includes('FROM USUARIOS') && window.supabase) {
                try {
                    const { data, error } = await window.supabase
                        .from('usuarios')
                        .select('*')
                        .or(`usuario.ilike.${params[0]},correo.ilike.${params[0]}`)
                        .eq('clave', params[2])
                        .limit(1);

                    return { data: data || [], error: error ? error.message : null };
                } catch (err) {
                    return { data: [], error: err.message };
                }
            }

            return { data: [], error: null };
        },

        supabaseLogin: async function({ email, pass }) {
            if (!window.supabase) return { data: null, error: 'Cliente Supabase no disponible' };
            try {
                const { data, error } = await window.supabase
                    .from('usuarios')
                    .select('*')
                    .or(`correo.eq.${email},usuario.eq.${email}`)
                    .eq('clave', pass)
                    .single();

                if (error) return { data: null, error: error.message };
                return { data, error: null };
            } catch (err) {
                return { data: null, error: err.message };
            }
        }
    };
}

/* Declaración segura de constantes globales de roles */
window.ROL_LABELS_HEADER = window.ROL_LABELS_HEADER || {
    ADMIN: 'Administrador', ADMINISTRADOR: 'Administrador',
    SUPERVISOR: 'Supervisor',
    OPERADOR: 'Operario', OPERARIO: 'Operario'
};

/* =======================================================================
   1. MÓDULO DE INTERFAZ Y NOTIFICACIONES (UI HELPERS)
   ======================================================================= */

window.m_mostrarMensajeLogin = function(mensaje, tipo = 'error') {
    const box = document.getElementById('login-msg-box');
    const texto = document.getElementById('login-msg');
    const icono = document.getElementById('login-msg-icon');
    
    if (!box || !texto) return;

    if (!mensaje) {
        box.style.display = 'none';
        return;
    }

    texto.innerText = mensaje;
    box.classList.remove('login-msg-error', 'login-msg-exito');
    box.classList.add(tipo === 'exito' ? 'login-msg-exito' : 'login-msg-error');
    
    if (icono) {
        icono.setAttribute('data-lucide', tipo === 'exito' ? 'check-circle' : 'alert-circle');
    }
    
    box.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons();
};

window.m_toggleVerPassword = function() {
    const input = document.getElementById('txt-pass');
    const icono = document.getElementById('icon-toggle-pass');
    if (!input) return;

    const esOculto = input.type === 'password';
    input.type = esOculto ? 'text' : 'password';

    if (icono) {
        icono.setAttribute('data-lucide', esOculto ? 'eye-off' : 'eye');
    }
    if (window.lucide) window.lucide.createIcons();
};

/* =======================================================================
   2. MÓDULO DE AUTENTICACIÓN HÍBRIDA (ONLINE / OFFLINE)
   ======================================================================= */

window.m_iniciarSesion = async function() {
    const emailInput = document.getElementById('email');
    const passInput = document.getElementById('txt-pass');
    const btnTexto = document.getElementById('btn-login-text');

    const email = emailInput ? emailInput.value.trim() : '';
    const pass = passInput ? passInput.value : '';

    window.m_mostrarMensajeLogin('');

    if (!email || !pass) {
        window.m_mostrarMensajeLogin("Complete el usuario y la contraseña para continuar.", "error");
        return;
    }

    const textoOriginalBtn = btnTexto ? btnTexto.innerText : "INGRESAR AL SISTEMA";
    window.m_setEstadoBotonLogin(true, "VERIFICANDO CREDENCIALES...");

    let usuarioValido = null;
    let esOffline = false;

    /* Paso 1 - Intento de Login Online con Supabase */
    try {
        if (window.apiLocal && typeof window.apiLocal.supabaseLogin === 'function') {
            const resOnline = await window.apiLocal.supabaseLogin({ email, pass });
            if (!resOnline.error && resOnline.data) {
                usuarioValido = resOnline.data;
            }
        }
    } catch (errOnline) {
        console.warn("⚠️ Sin conexión con Supabase. Pasando a verificación local...", errOnline);
        esOffline = true;
    }

    /* Paso 2 - Fallback Offline (Consulta a SQLite Local / Adaptador Web) */
    if (!usuarioValido && window.apiLocal) {
        try {
            const resLocal = await window.apiLocal.query({
                sql: `SELECT * FROM usuarios WHERE (LOWER(TRIM(usuario)) = ? OR LOWER(TRIM(correo)) = ?) AND clave = ?`,
                params: [email.toLowerCase(), email.toLowerCase(), pass]
            });

            if (resLocal.data && resLocal.data.length > 0) {
                const userLocal = resLocal.data[0];
                usuarioValido = {
                    id: userLocal.id,
                    operario: userLocal.nombre || userLocal.usuario,
                    correo: userLocal.correo || userLocal.usuario,
                    rol: userLocal.rol || 'OPERADOR'
                };
                esOffline = true;
            }
        } catch (errLocal) {
            console.error("❌ Error al consultar la base de datos local:", errLocal);
        }
    }

    if (!usuarioValido) {
        window.m_mostrarMensajeLogin("Credenciales incorrectas o usuario no registrado.", "error");
        window.m_setEstadoBotonLogin(false, textoOriginalBtn);
        return;
    }

    /* Paso 3 - Persistencia de Sesión Activa */
    if (window.apiLocal) {
        try {
            const fechaAhora = new Date().toISOString();
            const nombreOperario = usuarioValido.operario || usuarioValido.nombre || email;
            const rolUsuario = (usuarioValido.rol || 'OPERADOR').toString().toUpperCase();

            await window.apiLocal.query({
                sql: `
                    INSERT INTO sesion_activa (id, usuario_id, nombre_usuario, token, fecha_inicio, rol, correo)
                    VALUES (1, ?, ?, ?, ?, ?, ?)
                `,
                params: [usuarioValido.id || 0, nombreOperario, 'SESSION_TOKEN_LOCAL', fechaAhora, rolUsuario, email]
            });
        } catch (errPersist) {
            console.error("❌ Error al guardar el registro de sesión:", errPersist);
        }
    }

    const mensajeExito = esOffline 
        ? "Acceso offline concedido. Cargando sistema..." 
        : "Acceso concedido. Cargando sistema...";
    
    window.m_mostrarMensajeLogin(mensajeExito, "exito");
    window.m_transicionAInterfazPrincipal(usuarioValido, esOffline);
};

/* =======================================================================
   3. GESTIÓN DE VISTAS Y TRANSICIONES DE INTERFAZ
   ======================================================================= */

function m_calcularIniciales(nombre) {
    return (
        (nombre || '')
            .split(' ')
            .filter(Boolean)
            .slice(0, 2)
            .map((p) => p[0].toUpperCase())
            .join('') || '—'
    );
}

window.m_pintarHeaderUsuario = function(nombre, rol, estadoRed) {
    window.__sesionActual = { nombre_completo: nombre, nombre_usuario: nombre, rol, estadoRed };

    const elNombre = document.getElementById('hdr-nombre');
    const elRol = document.getElementById('hdr-rol');
    const elAvatar = document.getElementById('hdr-avatar');

    const rolNormalizado = (rol || 'OPERADOR').toString().toUpperCase();

    if (elNombre) elNombre.textContent = nombre || 'Operario';
    if (elRol) elRol.textContent = window.ROL_LABELS_HEADER[rolNormalizado] || rolNormalizado;
    if (elAvatar) elAvatar.textContent = m_calcularIniciales(nombre);
};

window.m_setEstadoBotonLogin = function(cargando, texto) {
    const btnLogin = document.getElementById('btn-login');
    const btnTexto = document.getElementById('btn-login-text');

    if (btnLogin) {
        btnLogin.disabled = cargando;
        if (cargando) btnLogin.classList.add('apple-btn-blue--cargando');
        else btnLogin.classList.remove('apple-btn-blue--cargando');
    }
    if (btnTexto) {
        btnTexto.innerText = texto;
    }
};

window.m_transicionAInterfazPrincipal = function(usuario, esOffline = false) {
    const loginView = document.getElementById('login-view');
    const viewContent = document.getElementById('view-content');
    const headerSistema = document.getElementById('header-sistema');

    if (loginView) {
        loginView.style.transition = 'opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
        loginView.style.opacity = '0';
    }

    setTimeout(() => {
        if (loginView) loginView.style.display = 'none';
        if (viewContent) viewContent.style.display = 'flex';
        if (headerSistema) headerSistema.style.display = 'flex';

        const estadoRed = esOffline ? 'OFFLINE' : 'ONLINE';
        const nombreMostrar = usuario.operario || usuario.nombre || usuario.nombre_usuario || 'Operario';
        window.m_pintarHeaderUsuario(nombreMostrar, usuario.rol, estadoRed);

        if (typeof m_dibujarInterfazPrincipal === 'function') {
            m_dibujarInterfazPrincipal();
        }

        if (window.lucide) window.lucide.createIcons();

        if (typeof router !== 'undefined' && typeof m_mostrarSubmenu === 'function') {
            m_mostrarSubmenu('GESTION');
        }
    }, 280);
};

/* =======================================================================
   4. CONTROL DE PERSISTENCIA Y AUTO-LOGIN
   ======================================================================= */

window.m_verificarSesionGuardada = async function() {
    if (!window.apiLocal) return false;

    try {
        const res = await window.apiLocal.query({
            sql: `SELECT * FROM sesion_activa WHERE id = 1`
        });

        if (!res.data || res.data.length === 0) return false;

        const sesion = res.data[0];
        if (!sesion || !sesion.nombre_usuario) return false;

        console.log("⚡ [Auto-Login] Sesión activa recuperada:", sesion.nombre_usuario);

        const loginView = document.getElementById('login-view');
        const viewContent = document.getElementById('view-content');
        const headerSistema = document.getElementById('header-sistema');

        if (loginView) loginView.style.display = 'none';
        if (viewContent) viewContent.style.display = 'flex';
        if (headerSistema) headerSistema.style.display = 'flex';

        window.m_pintarHeaderUsuario(sesion.nombre_usuario, sesion.rol, 'LOCAL');

        if (typeof m_dibujarInterfazPrincipal === 'function') {
            m_dibujarInterfazPrincipal();
        }

        if (window.lucide) window.lucide.createIcons();

        if (typeof router !== 'undefined' && typeof m_mostrarSubmenu === 'function') {
            m_mostrarSubmenu('GESTION');
        }

        return true;
    } catch (err) {
        console.error("❌ Error verificando sesión guardada:", err);
        return false;
    }
};

window.m_cerrarSesion = async function() {
    try {
        if (window.apiLocal) {
            await window.apiLocal.query({ sql: `DELETE FROM sesion_activa WHERE id = 1` });
        }
        window.location.reload();
    } catch (err) {
        console.error("❌ Error al cerrar sesión:", err);
    }
};

/* =======================================================================
   5. RENDERIZADO VISUAL DEL LOGIN (APPLE SOFT STUDIO)
   ======================================================================= */

window.m_renderizarVistaLogin = function() {
    const loginView = document.getElementById('login-view');
    if (!loginView) return;

    loginView.innerHTML = `
        <div class="full-center animated fadeIn">
            <div class="glass-card">
                <div class="login-header">
                    <div class="logo-central" style="width: 70px; height: 70px; margin: 0 auto 12px auto; display: flex; align-items: center; justify-content: center; overflow: hidden; border-radius: 14px; background: #FFFFFF; border: 1.5px solid #E0DCD4; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
                        <img src="./logo.png" class="img-3x3" alt="Logo Salvucci" onerror="this.onerror=null; this.src='logo_Agrosoft.png';">
                    </div>
                    <h2 class="neon-text">SALVUCCI</h2>
                    <p>Gestión de Operaciones Agropecuarias</p>
                    <span class="login-badge"><i data-lucide="shield-check"></i> ACCESO SEGURO LOCAL-FIRST</span>
                </div>

                <div class="form-group">
                    <div class="input-container">
                        <i data-lucide="user"></i>
                        <input type="text" id="email" placeholder="Usuario o Email" autocomplete="username">
                    </div>

                    <div class="input-container">
                        <i data-lucide="lock"></i>
                        <input type="password" id="txt-pass" placeholder="Contraseña de Acceso" autocomplete="current-password">
                        <button type="button" class="btn-toggle-pass" onclick="window.m_toggleVerPassword()" title="Mostrar/Ocultar contraseña">
                            <i data-lucide="eye" id="icon-toggle-pass"></i>
                        </button>
                    </div>
                </div>

                <button type="button" class="apple-btn-blue" id="btn-login" onclick="window.m_iniciarSesion()">
                    <span id="btn-login-text">INGRESAR AL SISTEMA</span>
                </button>

                <div id="login-msg-box" class="login-msg-box" style="display: none;">
                    <i id="login-msg-icon" data-lucide="alert-circle"></i>
                    <span id="login-msg"></span>
                </div>
            </div>
        </div>
    `;

    if (window.lucide) window.lucide.createIcons();
};

/* =======================================================================
   6. EVENTOS E INICIALIZACIÓN AUTOMÁTICA
   ======================================================================= */

document.addEventListener('DOMContentLoaded', async () => {
    const sesionIniciada = await window.m_verificarSesionGuardada();

    if (!sesionIniciada) {
        window.m_renderizarVistaLogin();

        const txtPass = document.getElementById('txt-pass');
        const emailInput = document.getElementById('email');

        if (emailInput) emailInput.focus();

        const ejecutarEnter = (e) => {
            if (e.key === 'Enter') {
                window.m_iniciarSesion();
            }
        };

        if (emailInput) emailInput.addEventListener('keypress', ejecutarEnter);
        if (txtPass) txtPass.addEventListener('keypress', ejecutarEnter);
    }
});