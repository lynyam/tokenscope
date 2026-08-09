import { defineConfig } from 'vite'
const backenUrl = process.env.BACKEND_URL;
console.log(backenUrl);

export default defineConfig({
	server: {
		proxy: {
			'/api': {
				target: backenUrl,
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/api/, ''),
			},
		},
	},
})
