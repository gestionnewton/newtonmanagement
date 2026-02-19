// js/seguridad.js
document.addEventListener('alpine:init', () => {
    Alpine.data('gestionSeguridad', () => ({
        roles: [],
        permisos: [],
        matriz: [], // Relación id_rol -> [ids_permisos]
        cargando: false,

        async init() {
            await this.cargarDatosSeguridad();
        },

        async cargarDatosSeguridad() {
            this.cargando = true;
            try {
                // Cargamos todo en paralelo para máxima velocidad
                const [resRoles, resPermisos, resRelaciones] = await Promise.all([
                    client.from('roles').select('*').order('id_rol'),
                    client.from('permisos').select('*').order('modulo, slug'),
                    client.from('rol_permisos').select('*')
                ]);

                this.roles = resRoles.data || [];
                this.permisos = resPermisos.data || [];
                
                // Organizamos la matriz para que sea fácil de consultar en el HTML
                // Formato: { id_rol: [id_p1, id_p2... ] }
                const mapa = {};
                this.roles.forEach(r => mapa[r.id_rol] = []);
                resRelaciones.data.forEach(rel => {
                    if (mapa[rel.id_rol]) mapa[rel.id_rol].push(rel.id_permiso);
                });
                this.matriz = mapa;

            } catch (error) {
                window.Notificar.error("Error", "No se pudo cargar la configuración de seguridad.");
            } finally {
                this.cargando = false;
            }
        },

        // Función core: Activa o desactiva el permiso en la DB
        async togglePermiso(id_rol, id_permiso) {
            const index = this.matriz[id_rol].indexOf(id_permiso);
            const estaAsignado = index !== -1;

            try {
                if (estaAsignado) {
                    // Quitar permiso
                    await client.from('rol_permisos')
                        .delete()
                        .eq('id_rol', id_rol)
                        .eq('id_permiso', id_permiso);
                    
                    this.matriz[id_rol].splice(index, 1);
                } else {
                    // Asignar permiso
                    await client.from('rol_permisos')
                        .insert({ id_rol, id_permiso });
                    
                    this.matriz[id_rol].push(id_permiso);
                }
                
                window.Notificar.exito("Actualizado", "Permiso modificado correctamente.");
            } catch (error) {
                window.Notificar.error("Error", "No se pudo actualizar el permiso.");
                // Si falla, recargamos para no mostrar datos falsos
                await this.cargarDatosSeguridad();
            }
        }
    }));
});