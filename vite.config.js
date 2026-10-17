import { defineConfig } from 'vite';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// Re-runs the image pipeline when anything in /pages changes during `npm run dev`,
// then reloads the browser. No need to restart the server after swapping pages.
function watchPages() {
  const dir = resolve(__dirname, 'pages');
  let timer = null;
  let running = false;
  let again = false;

  return {
    name: 'watch-pages',
    apply: 'serve',
    configureServer(server) {
      server.watcher.add(dir);
      const run = () => {
        if (running) return (again = true);
        running = true;
        server.config.logger.info('[images] /pages changed — rebuilding…', { timestamp: true });
        const p = spawn(process.execPath, ['scripts/build-images.mjs'], { cwd: __dirname, stdio: 'inherit' });
        p.on('close', () => {
          running = false;
          if (again) {
            again = false;
            return run();
          }
          server.ws.send({ type: 'full-reload' });
        });
      };
      const onChange = (file) => {
        if (!file.startsWith(dir) || !/\.(png|pdf)$/i.test(file)) return;
        clearTimeout(timer);
        timer = setTimeout(run, 600); // wait for Finder to finish copying a batch
      };
      server.watcher.on('add', onChange);
      server.watcher.on('change', onChange);
      server.watcher.on('unlink', onChange);
    },
  };
}

export default defineConfig({
  plugins: [watchPages()],
  build: { target: 'es2022', assetsInlineLimit: 0 },
  server: { port: 5173 },
});
