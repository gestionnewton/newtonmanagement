// js/dispositivos.js
document.addEventListener('alpine:init', () => {
    Alpine.data('gestionDispositivos', () => ({
        dispositivos: [],
        cargando: false,

        async init() {
            await this.cargarDispositivos();
        },

        async cargarDispositivos() {
            this.cargando = true;
            try {
                // Traemos dispositivos y el nombre del usuario dueño
                const { data, error } = await client
                    .from('dispositivos')
                    .select('*, usuarios(usuario, nombre_completo)')
                    .order('created_at', { ascending: false });

                if (error) throw error;
                this.dispositivos = data || [];
            } catch (error) {
                window.Notificar.error("Error", "No se pudieron cargar los dispositivos.");
            } finally {
                this.cargando = false;
            }
        },

        async cambiarEstado(id, nuevoEstado) {
            try {
                const { error } = await client
                    .from('dispositivos')
                    .update({ estado: nuevoEstado })
                    .eq('id_dispositivo', id);

                if (error) throw error;
                
                // Actualización local rápida
                const d = this.dispositivos.find(dis => dis.id_dispositivo === id);
                if (d) d.estado = nuevoEstado;

                window.Notificar.exito("Seguridad", `Dispositivo marcado como ${nuevoEstado}`);
            } catch (error) {
                window.Notificar.error("Error", "No se pudo actualizar el estado.");
            }
        },

        async eliminarDispositivo(id) {
            if (!confirm("¿Eliminar este dispositivo? El usuario deberá solicitar acceso nuevamente.")) return;
            
            try {
                await client.from('dispositivos').delete().eq('id_dispositivo', id);
                this.dispositivos = this.dispositivos.filter(d => d.id_dispositivo !== id);
                window.Notificar.exito("Eliminado", "Dispositivo removido del sistema.");
            } catch (error) {
                window.Notificar.error("Error", "No se pudo eliminar.");
            }
        }
    }));
});