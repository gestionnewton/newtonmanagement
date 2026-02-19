// js/notificaciones.js

// js/notificaciones.js

document.addEventListener('alpine:init', () => {
    Alpine.store('notificaciones', {
        items: [],

        add(tipo, titulo, mensaje) {
            return new Promise((resolve) => {
                const id = Date.now();
                const iconos = {
                    exito: '<svg class="w-16 h-16 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
                    error: '<svg class="w-16 h-16 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>',
                    advertencia: '<svg class="w-16 h-16 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>',
                    info: '<svg class="w-16 h-16 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
                };

                this.items.push({ 
                    id, tipo, titulo, mensaje, 
                    esConfirmacion: false,
                    esMenu: false,
                    botones: [],
                    icono: iconos[tipo] || iconos.info,
                    resolve 
                });
            });
        },

        // --- ESTA ES LA FUNCIÓN QUE FALTABA ---
        confirmar(titulo, mensaje) {
            return new Promise((resolve) => {
                const id = Date.now();
                this.items.push({ 
                    id, 
                    tipo: 'confirmar', 
                    titulo, 
                    mensaje, 
                    esConfirmacion: true, // Esto activa los botones SI/NO en tu HTML
                    esMenu: false,
                    botones: [],
                    icono: '<svg class="w-16 h-16 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
                    resolve 
                });
            });
        },

        menu(titulo, mensaje, botones) {
            return new Promise((resolve) => {
                const id = Date.now();
                this.items.push({ 
                    id, tipo: 'menu', titulo, mensaje, 
                    esConfirmacion: false, 
                    esMenu: true,
                    botones: botones,
                    icono: '<svg class="w-16 h-16 text-[#112464]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
                    resolve 
                });
            });
        },


        pregunta(titulo, mensaje) {
            return new Promise((resolve) => {
                const id = Date.now();
                this.items.push({
                    id,
                    tipo: 'pregunta',
                    titulo,
                    mensaje,
                    esConfirmacion: true, // Debe coincidir con tu x-if="notif.esConfirmacion"
                    esMenu: false,
                    icono: `<div class="w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center mx-auto">
                                <svg class="w-12 h-12 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                                </svg>
                            </div>`,
                    resolve 
                });
            });
        },

        cerrar(id) {
            const index = this.items.findIndex(i => i.id === id);
            if (index !== -1) this.items.splice(index, 1);
        },

        responder(id, respuesta) {
            const index = this.items.findIndex(i => i.id === id);
            if (index !== -1) {
                const item = this.items[index];
                this.items.splice(index, 1);
                item.resolve(respuesta); // Retorna true o false al 'await'
            }
        }
    });

    window.Notificar = {
        exito: (t, m) => Alpine.store('notificaciones').add('exito', t, m),
        error: (t, m) => Alpine.store('notificaciones').add('error', t, m),
        advertencia: (t, m) => Alpine.store('notificaciones').add('advertencia', t, m),
        pregunta: (t, m) => Alpine.store('notificaciones').pregunta(t, m),
        info: (t, m) => Alpine.store('notificaciones').add('info', t, m),
        confirmar: (t, m) => Alpine.store('notificaciones').confirmar(t, m), // Ahora sí encontrará la función
        menu: (t, m, b) => Alpine.store('notificaciones').menu(t, m, b),
        cerrar: (id) => Alpine.store('notificaciones').cerrar(id)
    };
});