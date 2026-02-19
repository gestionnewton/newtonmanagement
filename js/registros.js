// js/registros.js

document.addEventListener('alpine:init', () => {
    Alpine.data('registroEstudiante', () => ({
        // --- VARIABLES DEL SISTEMA ---
        enviando: false,
        modoEdicion: false,
        idEstudianteEditar: null,
        
        // --- VARIABLES TABLA PRINCIPAL ---
        listaEstudiantes: [],
        busquedaTabla: '',
        estudianteSeleccionado: null,

        // --- VARIABLES MODAL ESTUDIANTE ---
        modalEstudiante: false,
        busquedaRes: '',
        resultadosRes: [],
        nuevoResponsable: false,
        listaResponsables: [],
        
        estudiante: { dni: '', nombres: '', apellido_paterno: '', apellido_materno: '', nacimiento: '', sexo: 'M', direccion: '', observaciones: '' },
        tempRes: { dni: '', nombres: '', apellido_paterno: '', apellido_materno: '', celular_1: '', email: '' },

        // --- VARIABLES MODAL RESPONSABLE INDIVIDUAL ---
        modalRespIndividual: false,
        busquedaRespInd: '',
        resultadosRespInd: [],
        respIndividual: null,

        init() {
            this.cargarEstudiantes();
        },

        // ------------------------------------------------------------------
        // 1. LÓGICA DE CARGA Y TABLA
        // ------------------------------------------------------------------
        async cargarEstudiantes() {
            try {
                const { data, error } = await client
                    .from('estudiantes')
                    .select(`
                        *,
                        estudiantes_responsables (
                            parentesco,
                            es_apoderado_principal,
                            responsables (*)
                        )
                    `)
                    .order('apellido_paterno', { ascending: true });

                if (error) throw error;
                this.listaEstudiantes = data || [];
                
                // Si había uno seleccionado, actualizamos sus datos en tiempo real
                if (this.estudianteSeleccionado) {
                    const actualizado = this.listaEstudiantes.find(e => e.id_est === this.estudianteSeleccionado.id_est);
                    this.estudianteSeleccionado = actualizado || null;
                }
            } catch (err) {
                console.error("Error cargando estudiantes:", err);
            }
        },

        // FILTRADO SEGURO: Evita errores si responsables es null o undefined
        get estudiantesFiltrados() {
            if (!this.busquedaTabla) return this.listaEstudiantes;
            const term = this.busquedaTabla.toLowerCase().trim();
            
            return this.listaEstudiantes.filter(est => {
                const matchAlumno = (est.dni || '').includes(term) || 
                                   (est.apellido_paterno || '').toLowerCase().includes(term) ||
                                   (est.apellido_materno || '').toLowerCase().includes(term) ||
                                   (est.nombres || '').toLowerCase().includes(term);
                
                // Usamos (est.estudiantes_responsables || []) para que no falle si la lista está vacía
                const matchResponsable = (est.estudiantes_responsables || []).some(rel => 
                    (rel.responsables?.dni || '').includes(term) || 
                    (rel.responsables?.apellido_paterno || '').toLowerCase().includes(term) ||
                    (rel.responsables?.nombres || '').toLowerCase().includes(term)
                );

                return matchAlumno || matchResponsable;
            });
        },

        verFicha(est) {
            this.estudianteSeleccionado = est;
            this.busquedaTabla = '';
            
            // Usamos $nextTick para esperar a que el HTML se dibuje antes de hacer scroll
            this.$nextTick(() => {
                const ficha = document.getElementById('ficha-datos');
                if(ficha) ficha.scrollIntoView({ behavior: 'smooth' });
            });
        },

        // ------------------------------------------------------------------
        // 2. LÓGICA DE FORMULARIO (MODAL)
        // ------------------------------------------------------------------
        limpiarFormulario() {
            this.modoEdicion = false;
            this.idEstudianteEditar = null;
            this.estudianteSeleccionado = null; // Cerramos la ficha al crear uno nuevo
            this.estudiante = { dni: '', nombres: '', apellido_paterno: '', apellido_materno: '', nacimiento: '', sexo: 'M', direccion: '', observaciones: '' };
            this.tempRes = { dni: '', nombres: '', apellido_paterno: '', apellido_materno: '', celular_1: '', email: '' };
            this.listaResponsables = [];
            this.busquedaRes = '';
            this.resultadosRes = [];
            this.nuevoResponsable = false;
        },

        cargarDatosParaEditar() {
            if (!this.estudianteSeleccionado) return;
            const e = this.estudianteSeleccionado;
            
            this.modoEdicion = true;
            this.idEstudianteEditar = e.id_est;
            
            this.estudiante = {
                dni: e.dni,
                nombres: e.nombres,
                apellido_paterno: e.apellido_paterno,
                apellido_materno: e.apellido_materno,
                nacimiento: e.nacimiento,
                sexo: e.sexo,
                direccion: e.direccion,
                observaciones: e.observaciones || ''
            };

            // Mapeamos los responsables a la lista del modal
            this.listaResponsables = (e.estudiantes_responsables || []).map(rel => ({
                ...rel.responsables,
                parentesco: rel.parentesco,
                es_apoderado_principal: rel.es_apoderado_principal
            }));

            this.modalEstudiante = true;
        },

        // --- BÚSQUEDA Y ASIGNACIÓN DE RESPONSABLES ---
        async buscarResponsable() {
            if (this.busquedaRes.length < 1) {
                this.resultadosRes = [];
                return;
            }
            
            const term = this.busquedaRes.trim();
            const { data, error } = await client
                .from('responsables')
                .select('*')
                .or(`dni.ilike.${term}%,apellido_paterno.ilike.${term}%,apellido_materno.ilike.${term}%,nombres.ilike.${term}%`)
                .limit(10);

            if (error) console.error("Error buscarResponsable:", error);
            this.resultadosRes = data || [];
        },

        seleccionarResponsable(res) {
            // Verificar si ya está en la lista para no duplicar
            if(this.listaResponsables.find(r => r.dni === res.dni)) {
                window.Notificar.advertencia("Duplicado", "Este responsable ya está asignado.");
                return;
            }

            this.listaResponsables.push({ 
                ...res, 
                parentesco: 'Padre/Madre', 
                es_apoderado_principal: this.listaResponsables.length === 0 
            });
            this.busquedaRes = '';
            this.resultadosRes = [];
        },

        agregarNuevoResponsableALista() {
            const r = this.tempRes;
            if (!r.dni || !r.apellido_paterno || !r.nombres || !r.celular_1) {
                window.Notificar.advertencia("Campos requeridos", "DNI, Apellidos, Nombres y Celular son obligatorios.");
                return;
            }

            this.listaResponsables.push({ 
                ...r, 
                parentesco: 'Padre/Madre', 
                es_apoderado_principal: this.listaResponsables.length === 0,
                es_nuevo: true 
            });

            this.tempRes = { dni: '', nombres: '', apellido_paterno: '', apellido_materno: '', celular_1: '', email: '' };
            this.nuevoResponsable = false;
        },

        setPrincipal(index) {
            this.listaResponsables.forEach((r, i) => {
                r.es_apoderado_principal = (i === index);
            });
        },

        quitarResponsable(index) {
            this.listaResponsables.splice(index, 1);
        },

        // ------------------------------------------------------------------
        // 3. GUARDADO FINAL
        // ------------------------------------------------------------------
        async guardarTodo() {
            if (!this.estudiante.dni || !this.estudiante.apellido_paterno || this.listaResponsables.length === 0) {
                window.Notificar.advertencia("Datos Incompletos", "Debe completar los datos del alumno y asignar al menos un responsable.");
                return;
            }

            this.enviando = true;

            try {
                const id_usu = Alpine.store('auth').id_usu;
                let id_est_final = this.idEstudianteEditar;

                // A. GUARDAR / ACTUALIZAR ESTUDIANTE
                if (this.modoEdicion) {
                    const { error } = await client
                        .from('estudiantes')
                        .update(this.estudiante)
                        .eq('id_est', this.idEstudianteEditar);
                    if (error) throw error;
                } else {
                    const { data, error } = await client
                        .from('estudiantes')
                        .insert([{ ...this.estudiante, id_usu_registro: id_usu }])
                        .select()
                        .single();
                    if (error) throw error;
                    id_est_final = data.id_est;
                }

                // B. GESTIONAR RESPONSABLES Y RELACIONES
                // Si es edición, borramos las relaciones anteriores para reinsertarlas
                if (this.modoEdicion) {
                    await client.from('estudiantes_responsables').delete().eq('id_est', id_est_final);
                }

                for (let res of this.listaResponsables) {
                    // Upsert del responsable (si no existe lo crea, si existe lo actualiza por DNI)
                    const { data: rData, error: rError } = await client
                        .from('responsables')
                        .upsert({
                            dni: res.dni,
                            nombres: res.nombres,
                            apellido_paterno: res.apellido_paterno,
                            apellido_materno: res.apellido_materno,
                            celular_1: res.celular_1,
                            email: res.email || null,
                            id_usu_registro: id_usu
                        }, { onConflict: 'dni' })
                        .select()
                        .single();
                        
                    if (rError) throw rError;

                    // Insertar la relación
                    await client.from('estudiantes_responsables').insert([{
                        id_est: id_est_final,
                        id_res: rData.id_res,
                        parentesco: res.parentesco,
                        es_apoderado_principal: res.es_apoderado_principal
                    }]);
                }

                window.Notificar.exito("Operación Exitosa", this.modoEdicion ? "Información actualizada." : "Estudiante registrado correctamente.");
                
                this.modalEstudiante = false;
                this.limpiarFormulario();
                await this.cargarEstudiantes(); 

            } catch (err) {
                window.Notificar.error("Error al guardar", err.message);
            } finally {
                this.enviando = false;
            }
        },

        // ------------------------------------------------------------------
        // 4. EDICIÓN RÁPIDA DE RESPONSABLE (MODAL INDIVIDUAL)
        // ------------------------------------------------------------------
        async buscarResponsableInd() {
            if (this.busquedaRespInd.length < 1) { this.resultadosRespInd = []; return; }
            const term = this.busquedaRespInd.trim();
            const { data, error } = await client
                .from('responsables')
                .select('*')
                .or(`dni.ilike.${term}%,apellido_paterno.ilike.${term}%,apellido_materno.ilike.${term}%,nombres.ilike.${term}%`)
                .limit(10);
            
            if (!error) this.resultadosRespInd = data || [];
        },

        cargarResponsableInd(res) {
            this.respIndividual = { ...res };
            this.busquedaRespInd = ''; 
            this.resultadosRespInd = [];
        },

        async guardarResponsableInd() {
            if (!this.respIndividual.dni || !this.respIndividual.nombres || !this.respIndividual.apellido_paterno) {
                window.Notificar.advertencia("Campos Obligatorios", "DNI, Nombres y Apellido Paterno son indispensables.");
                return;
            }
            
            this.enviando = true;
            try {
                const { error } = await client
                    .from('responsables')
                    .update({
                        nombres: this.respIndividual.nombres,
                        apellido_paterno: this.respIndividual.apellido_paterno,
                        apellido_materno: this.respIndividual.apellido_materno,
                        celular_1: this.respIndividual.celular_1,
                        email: this.respIndividual.email
                    })
                    .eq('id_res', this.respIndividual.id_res);

                if (error) throw error;
                
                await window.Notificar.exito("Cambios Guardados", "Información actualizada con éxito.");
                
                this.modalRespIndividual = false;
                this.respIndividual = null;
                await this.cargarEstudiantes(); 

            } catch (err) {
                window.Notificar.error("Error", err.message);
            } finally {
                this.enviando = false;
            }
        }
    }));
});