# UI and UX Setup


## Setup 

### Install Tailwind CSS
shadcn is built on Tailwind utility classes, so Tailwind must exist in frontend/ first. For Vite: npm install tailwindcss @tailwindcss/vite, then add the Tailwind plugin to vite.config.js and import "tailwindcss" in your main CSS file.

## Configure TypeScript path
shadcn components import each other using an alias like @/components/ui/button. Add "paths": { "@/*": ["./src/*"] } to frontend/tsconfig.json (and a matching resolve.alias entry in vite.config.js), or the CLI init will fail.

## Run the shadcn init command
From frontend/, run npx shadcn@latest init. It detects Vite + React + TS, asks the style/CSS-variable questions (this is likely what your screenshot shows), and creates components.json plus a src/lib/utils.ts helper.

## Add components one at a time
Run npx shadcn@latest add button input label form card etc. Each command copies the component's source into src/components/ui/. You own that code — no black-box npm package to upgrade later, just files you can edit.

## Wire components into existing pages
Swap your plain <input>/<button> tags for the copied shadcn versions inside pages like SignInPage.tsx, keeping your react-hook-form logic untouched — shadcn's Input/Button are just styled wrappers around native elements.

## Configuration 
link to define preset(appeareance):
https://ui.shadcn.com/create?preset=b1zfPaHfOq 


chosen preset value:
    --preset b1zfPaHfOq

command to set preset
    npx shadcn@rc init [preset value from generator]


## Setting UI with agents
    1.
    npx skills add shadcn-ui/ui //check what this command does
    2.  
    initialize a new shadcn app with this [preset code]
    3. 
    react bits landing page