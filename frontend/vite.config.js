import { defineConfig } from 'vite'
// needed to resolve the "@" alias to an absolute path
import path from 'path' 
// ESM has no __dirname, this recreates it
import { fileURLToPath } from 'url' 
// Tailwind's Vite plugin, does the CSS scanning/build
import tailwindcss from '@tailwindcss/vite' 


const backenUrl = process.env.BACKEND_URL;

// recreate __dirname in ESM context
const __dirname = path.dirname(fileURLToPath(import.meta.url)); 

export default defineConfig({
	// registers Tailwind so it processes your CSS on build/dev
	plugins: [tailwindcss()], 
	resolve: {
		alias: {
			// makes "@/components/ui/button" resolve to src/components/ui/button
			'@': path.resolve(__dirname, './src'), 
		},
	},	
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


