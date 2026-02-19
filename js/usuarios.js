// js/usuarios.js
document.addEventListener('alpine:init', () => {
    Alpine.data('gestionUsuarios', () => ({
        usuarios: [],
        roles: [],
        cargando: false,

        async init() {
            // Cargamos usuarios y roles al iniciar
            await this.cargarUsuarios();
            const { data } = await client.from('roles').select('*').order('nombre_rol');
            this.roles = data || [];
        },

        async cargarUsuarios() {
            this.cargando = true;
            try {
                const { data, error } = await client
                    .from('usuarios')
                    .select('*, roles(nombre_rol)')
                    .order('nombre_completo');
                
                if (error) throw error;
                this.usuarios = data || [];
            } catch (error) {
                window.Notificar.error("Error", "No se pudieron cargar los usuarios.");
            } finally {
                this.cargando = false;
            }
        },

        async actualizarRol(u, nuevoIdRol) {
            try {
                const { error } = await client
                    .from('usuarios')
                    .update({ id_rol: nuevoIdRol })
                    .eq('id_usu', u.id_usu);

                if (error) throw error;
                window.Notificar.exito("Actualizado", `Rol de ${u.usuario} actualizado.`);
            } catch (error) {
                window.Notificar.error("Error", "No se pudo cambiar el rol.");
                await this.cargarUsuarios(); // Revertir visualmente
            }
        },

        async alternarEstado(u) {
            const nuevoEstado = !u.activo;
            try {
                const { error } = await client
                    .from('usuarios')
                    .update({ activo: nuevoEstado })
                    .eq('id_usu', u.id_usu);

                if (error) throw error;
                u.activo = nuevoEstado;
                window.Notificar.exito("Estado", `Usuario ${u.usuario} ${nuevoEstado ? 'activado' : 'desactivado'}.`);
            } catch (error) {
                window.Notificar.error("Error", "No se pudo cambiar el estado.");
            }
        }
    }));
});