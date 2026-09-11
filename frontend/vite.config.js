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
})
