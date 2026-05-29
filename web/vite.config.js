import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { transformSync } from "esbuild";

// Custom plugin: treat all .js files as JSX (donixrouter uses .js for React components)
function jsxInJs() {
  return {
    name: "jsx-in-js",
    enforce: "pre",
    transform(code, id) {
      if (id.includes("node_modules")) return null;
      if (!id.endsWith(".js")) return null;
      if (!code.includes("<") && !code.includes("jsx")) return null;
      const result = transformSync(code, {
        loader: "jsx",
        jsx: "automatic",
        sourcefile: id,
        sourcemap: true,
      });
      return { code: result.code, map: result.map };
    },
  };
}

export default defineConfig({
  plugins: [
    jsxInJs(),
    react({ include: /\.(jsx|tsx)$/ }),
    tailwindcss(),
  ],
  optimizeDeps: {
    esbuildOptions: {
      loader: { ".js": "jsx" },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "../shared"),
      "next/link": path.resolve(__dirname, "src/compat/next-link.js"),
      "next/navigation": path.resolve(__dirname, "src/compat/next-navigation.js"),
      "next/image": path.resolve(__dirname, "src/compat/next-image.js"),
      "next/dynamic": path.resolve(__dirname, "src/compat/next-dynamic.js"),
      "open-sse/config/providerModels.js": path.resolve(__dirname, "src/compat/open-sse-models.js"),
      "open-sse/config/ttsModels.js": path.resolve(__dirname, "../server/open-sse/config/ttsModels.js"),
      "open-sse/config/googleTtsLanguages.js": path.resolve(__dirname, "../server/open-sse/config/googleTtsLanguages.js"),
      "open-sse": path.resolve(__dirname, "../server/open-sse"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:20128",
      "/v1": "http://localhost:20128",
    },
  },
  publicDir: path.resolve(__dirname, "../public"),
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
