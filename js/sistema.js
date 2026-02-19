// js/sistema.js

document.addEventListener('alpine:init', () => {
    Alpine.data('gestionSistema', () => ({
        subTab: 'academico', // Pestaña por defecto
        // --- VARIABLES GENERALES ---
        enviando: false,
        
        // --- VARIABLES DE AÑOS ---
        listaAnios: [],
        modalAnio: false,
        modoEdicionAnio: false,
        anio: { id_anio: null, nombre: '', estado: 'ACTIVO' },

        // --- VARIABLES DE SECCIONES ---
        modalSecciones: false,
        anioSeleccionado: null, // El año que estamos editando
        listaSecciones: [],
        seccion: { id_sec: null, nivel: 'Primaria', grado: '1°', nombre_sec: 'A', vacantes: 30 },
        modoEdicionSeccion: false,

        // LISTAS DE AYUDA
        niveles: ['Primaria', 'Secundaria'],
        gradosPorNivel: {
            'Primaria': ['1°', '2°', '3°', '4°', '5°', '6°'],
            'Secundaria': ['1°', '2°', '3°', '4°', '5°']
        },

        init() {
            this.cargarAnios();
        },

        // ============================================================
        // LÓGICA DE AÑOS ACADÉMICOS
        // ============================================================
        async cargarAnios() {
            try {
                const { data, error } = await client
                    .from('anio_academico')
                    .select('*')
                    .order('nombre', { ascending: false });
                if (error) throw error;
                this.listaAnios = data || [];
            } catch (err) { console.error(err); }
        },

        abrirModalCrear() {
            this.modoEdicionAnio = false;
            this.anio = { id_anio: null, nombre: '', estado: 'ACTIVO' };
            this.modalAnio = true;
        },

        abrirModalEditar(item) {
            this.modoEdicionAnio = true;
            this.anio = { ...item };
            this.modalAnio = true;
        },

        async guardarAnio() {
            if (!this.anio.nombre) {
                window.Notificar.advertencia("Dato Faltante", "Por favor, ingrese el nombre del año (Ej: 2026).");
                return;
            }
            this.enviando = true;
            try {
                const datos = { nombre: this.anio.nombre, estado: this.anio.estado };
                
                let errorGuardar;
                if (this.modoEdicionAnio) {
                    const { error } = await client.from('anio_academico').update(datos).eq('id_anio', this.anio.id_anio);
                    errorGuardar = error;
                } else {
                    const { error } = await client.from('anio_academico').insert([datos]);
                    errorGuardar = error;
                }

                if (errorGuardar) {
                    if (errorGuardar.code === '23505') throw new Error("Ya existe un año académico registrado con ese nombre.");
                    throw errorGuardar;
                }

                await window.Notificar.exito(
                    this.modoEdicionAnio ? "¡Año Actualizado!" : "¡Año Aperturado!",
                    `El periodo lectivo ${this.anio.nombre} se guardó correctamente.`
                );

                this.modalAnio = false;
                await this.cargarAnios();
            } catch (err) { 
                window.Notificar.error("Error al Guardar", err.message);
            } finally { 
                this.enviando = false; 
            }
        },

        async alternarEstado(item) {
            if (item.estado === 'ACTIVO') {
                const ok = await window.Notificar.confirmar(
                    "¿Cerrar Año Académico?",
                    `Si cierras el año ${item.nombre}, no se podrán realizar nuevas matrículas ni procesos en él.`
                );
                if (!ok) return;
            }

            const nuevo = item.estado === 'ACTIVO' ? 'CERRADO' : 'ACTIVO';
            
            try {
                const { error } = await client.from('anio_academico').update({ estado: nuevo }).eq('id_anio', item.id_anio);
                if (error) throw error;
                
                window.Notificar.exito("Estado Cambiado", `El año ${item.nombre} ahora está ${nuevo}.`);
                await this.cargarAnios();
            } catch (err) {
                window.Notificar.error("Error", "No se pudo cambiar el estado.");
            }
        },

        async eliminarAnio(id) {
            const ok = await window.Notificar.confirmar(
                "¿Eliminar Año Académico?",
                "Esta acción es irreversible. Se eliminarán todas las secciones y configuraciones vinculadas a este año."
            );
            
            if (!ok) return;

            try {
                const { error } = await client.from('anio_academico').delete().eq('id_anio', id);
                if (error) throw error;
                
                await window.Notificar.exito("Registro Eliminado", "El año académico ha sido borrado del sistema.");
                await this.cargarAnios();
            } catch (e) { 
                window.Notificar.error("No se puede eliminar", "Existen datos (matrículas o secciones) vinculados a este año.");
            }
        },

        // ============================================================
        // LÓGICA DE SECCIONES (AULAS)
        // ============================================================
        
        async abrirGestionSecciones(anioItem) {
            this.anioSeleccionado = anioItem;
            this.modalSecciones = true;
            this.limpiarFormSeccion();
            await this.cargarSecciones();
        },

        async cargarSecciones() {
            if (!this.anioSeleccionado) return;
            const { data } = await client
                .from('secciones')
                .select('*')
                .eq('id_anio', this.anioSeleccionado.id_anio)
                .order('nivel', { ascending: false })
                .order('grado', { ascending: true })
                .order('nombre_sec', { ascending: true });
            
            this.listaSecciones = data || [];
        },

        limpiarFormSeccion() {
            this.modoEdicionSeccion = false;
            this.seccion = { 
                id_sec: null, 
                nivel: 'Primaria', 
                grado: '1°', 
                nombre_sec: 'A', 
                vacantes: 30 
            };
        },

        editarSeccion(item) {
            this.modoEdicionSeccion = true;
            this.seccion = { ...item };
        },

        async guardarSeccion() {
            if (!this.seccion.nombre_sec || !this.seccion.vacantes) {
                window.Notificar.advertencia("Campos Incompletos", "Debe asignar un nombre a la sección y definir el número de vacantes.");
                return;
            }
            
            this.enviando = true;
            try {
                const datos = {
                    id_anio: this.anioSeleccionado.id_anio,
                    nivel: this.seccion.nivel,
                    grado: this.seccion.grado,
                    nombre_sec: this.seccion.nombre_sec,
                    vacantes: this.seccion.vacantes
                };

                if (this.modoEdicionSeccion) {
                    const { error } = await client.from('secciones').update(datos).eq('id_sec', this.seccion.id_sec);
                    if (error) throw error;
                } else {
                    const { error } = await client.from('secciones').insert([datos]);
                    if (error) throw error;
                }

                window.Notificar.exito("Aula Guardada", `La sección ${this.seccion.grado} "${this.seccion.nombre_sec}" ha sido registrada.`);
                this.limpiarFormSeccion();
                await this.cargarSecciones();
            } catch (err) { 
                window.Notificar.error("Error", "No se pudo guardar la sección.");
            } finally { 
                this.enviando = false; 
            }
        },

        async eliminarSeccion(item) {
            const ok = await window.Notificar.confirmar(
                "¿Eliminar Sección?",
                `¿Está seguro de eliminar el aula ${item.grado} "${item.nombre_sec}" del nivel ${item.nivel}?`
            );

            if (!ok) return;

            try {
                const { error } = await client.from('secciones').delete().eq('id_sec', item.id_sec);
                if (error) throw error;
                
                window.Notificar.exito("Sección Eliminada", "El aula ha sido retirada de la lista.");
                await this.cargarSecciones();
            } catch (error) { 
                window.Notificar.error("Acción Denegada", "No se puede eliminar la sección porque ya cuenta con alumnos matriculados.");
            }
        },

        get gradosDisponibles() {
            return this.gradosPorNivel[this.seccion.nivel] || [];
        }
    }));
});