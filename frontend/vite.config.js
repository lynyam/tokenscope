// import { defineConfig } from 'vite'

// const backenUrl = process.env.BACKEND_URL;

// export default defineConfig({
// 	server: {
// 		proxy: {
// 			'/api': {
// 				target: backenUrl,
// 				changeOrigin: true,
// 			},
// 		},
// 	},
// })
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'

const backenUrl = process.env.BACKEND_URL;

export default defineConfig({
        server: {
                proxy: {
                        '/api': {
                                target: backenUrl,
                                changeOrigin: true,
                        },
                },
        },
        test: {
                environment: 'jsdom',
                globals: true,
                setupFiles: './src/test/setup.ts',
        },
})