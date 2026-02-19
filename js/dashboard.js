document.addEventListener('alpine:init', () => {
    Alpine.data('dashboardLogic', () => ({
        totalAlumnado: 0,
        totalPrimaria: 0,
        totalSecundaria: 0,
        estadisticasPrimaria: [],
        estadisticasSecundaria: [],
        detalleAulas: [], 

        init() {
            // Reaccionar al cambio de sección o de año
            this.$watch('seccionActual', (val) => { if(val === 'dashboard') this.cargarDashboard(); });
            this.$watch('anioSel', () => { if(this.seccionActual === 'dashboard') this.cargarDashboard(); });
            
            if (this.seccionActual === 'dashboard') this.cargarDashboard();
            // Dentro del init() de tu controlador principal (ej: gestionPagos o dashboard)
            this.$watch('seccionActual', (valor) => {
                if (valor === 'sistema' && this.$store.auth.id_rol !== 1) {
                    // Si no es admin y trata de entrar a sistema, lo expulsamos a otra sección
                    this.seccionActual = 'dashboard'; 
                    window.Notificar.error("Acceso Denegado", "No tienes permisos de administrador.");
                    console.error("Intento de acceso no autorizado detectado.");
                }
            });
        },

        async cargarDashboard() {
            // Accedemos al anioSel del componente padre (layout)
            const anioId = this.anioSel;
            if (!anioId) return;

            try {
                // 1. Obtener Secciones del año
                const { data: secciones, error: errSec } = await client
                    .from('secciones')
                    .select('id_sec, nivel, grado, nombre_sec, vacantes')
                    .eq('id_anio', anioId);

                if (errSec) throw errSec;
                if (!secciones || secciones.length === 0) {
                    this.limpiarDatos();
                    return;
                }

                const idsSec = secciones.map(s => s.id_sec);

                // 2. Obtener Matrículas
                const { data: matriculas, error: errMat } = await client
                    .from('matriculas')
                    .select('id_sec')
                    .in('id_sec', idsSec)
                    .eq('estado', 'ACTIVO');

                if (errMat) throw errMat;

                this.totalAlumnado = matriculas ? matriculas.length : 0;

                // 3. Procesar Estadísticas
                let prim = 0;
                let secu = 0;
                const gruposGrado = {};

                secciones.forEach(sec => {
                    const ocupados = (matriculas || []).filter(m => m.id_sec === sec.id_sec).length;
                    
                    // Normalizamos a MAYÚSCULAS para evitar errores de comparación
                    const nivelNorm = sec.nivel.toUpperCase(); 
                    if (nivelNorm === 'PRIMARIA') prim += ocupados;
                    if (nivelNorm === 'SECUNDARIA') secu += ocupados;

                    const key = `${nivelNorm}-${sec.grado}`;
                    if (!gruposGrado[key]) {
                        gruposGrado[key] = {
                            grado: sec.grado,
                            nivel: nivelNorm,
                            totalAlumnos: 0,
                            totalVacantes: 0,
                            secciones: []
                        };
                    }
                    gruposGrado[key].totalAlumnos += ocupados;
                    gruposGrado[key].totalVacantes += (sec.vacantes || 0); // <--- Sumamos la capacidad real
                    gruposGrado[key].secciones.push({
                        nombre: sec.nombre_sec,
                        ocupados: ocupados,
                        vacantes: sec.vacantes || 0
                    });
                });

                this.totalPrimaria = prim;
                this.totalSecundaria = secu;

                const listaGrados = Object.values(gruposGrado);
                // Usamos parseInt para extraer solo el número (ej: de "1°" extrae 1) y comparar
                listaGrados.sort((a, b) => {
                    return parseInt(a.grado) - parseInt(b.grado);
                });

                // Filtramos usando la normalización
                this.estadisticasPrimaria = listaGrados.filter(g => g.nivel === 'PRIMARIA');
                this.estadisticasSecundaria = listaGrados.filter(g => g.nivel === 'SECUNDARIA');
                this.detalleAulas = listaGrados;

            } catch (err) {
                console.error("Error Dashboard:", err);
                this.limpiarDatos();
            }
        },

        limpiarDatos() {
            this.totalAlumnado = 0;
            this.totalPrimaria = 0;
            this.totalSecundaria = 0;
            this.estadisticasPrimaria = [];
            this.estadisticasSecundaria = [];
            this.detalleAulas = [];
        },

        calcularPorcentaje(ocupados) {
            const maxRef = 150; // Base visual
            let porc = (ocupados / maxRef) * 100;
            return (porc > 100 ? 100 : (porc < 5 ? 5 : porc)) + '%';
        },
        
    }));

    

});