import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
    compatibilityDate: '2026-08-27',
    devtools: { enabled: false },
    css: ['~/assets/app.css'],
    vite: { plugins: [tailwindcss()] },
    runtimeConfig: {
        // Adresse INTERNE du serveur, employée par le rendu côté serveur seulement. Jamais
        // exposée au navigateur : elle n'a de sens que dans le réseau Docker.
        serverBaseUrlInternal: process.env.NUXT_SERVER_BASE_URL_INTERNAL || '',
        public: {
            // L'interface ne connaît qu'une adresse : celle du serveur. Tout le reste —
            // libellés, bornes, descriptions des réglages — lui vient de l'API.
            serverBaseUrl: process.env.NUXT_PUBLIC_SERVER_BASE_URL || 'http://localhost:3000',
        },
    },
    app: {
        head: {
            htmlAttrs: { lang: 'fr' },
            title: 'Assistants',
            meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
        },
    },
})
