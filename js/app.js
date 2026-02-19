// Configuración de Supabase
const supabaseUrl = 'https://icmhzqxzzmvsamxtrqtg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljbWh6cXh6em12c2FteHRycXRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2NDU3NTQsImV4cCI6MjA4NjIyMTc1NH0.YeWt96NOObnmpM6ca5AflThP95JUROx5yXXJkw3GTaY';

// Inicializar el cliente de Supabase de forma global
const client = supabase.createClient(supabaseUrl, supabaseKey);

// Store Global Actualizado
// Store Global de Alpine.js para mantener la sesión
document.addEventListener('alpine:init', () => {
    Alpine.store('auth', {
        user: null,
        rol: null,
        id_rol: null,
        id_usu: null,
        permisos: [],
        isAuthenticated: false,
        
        init() {
            const session = JSON.parse(localStorage.getItem('newton_session'));
            if (session) {
                this.user = session.user;
                this.rol = session.rol;
                this.id_rol = session.id_rol;
                this.id_usu = session.id_usu;
                this.permisos = session.permisos || [];
                this.isAuthenticated = true;
            }


            window.addEventListener('pageshow', (event) => {
                // Si la página se carga desde el caché (botón atrás)
                // o si detectamos que no hay sesión activa
                if (event.persisted || !localStorage.getItem('newton_session')) {
                    if (!window.location.pathname.includes('index.html')) {
                        window.location.replace('index.html');
                    }
                }
            });

            // --- TRUCO MAESTRO: ESCUCHAR CIERRE DE SESIÓN EN OTRAS PESTAÑAS ---
            window.addEventListener('storage', (event) => {
                // Si la llave de sesión se eliminó en otra pestaña
                if (event.key === 'newton_session' && !event.newValue) {
                    // Redirigimos al login de inmediato
                    window.location.href = 'index.html';
                }
            });
        },

        puede(slug) {
            return this.permisos.includes(slug);
        },

        logout() {
            localStorage.removeItem('newton_session');
            // Reemplazamos el historial para que 'atrás' no funcione
            window.location.replace('index.html');
        }
    });
});