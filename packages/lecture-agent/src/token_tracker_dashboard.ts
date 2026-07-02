import { fileURLToPath } from 'url';
import { startTokenTrackerDashboard } from './token_tracker.js';

function parseArgs() {
    const args = process.argv.slice(2);
    const result: { port?: number; host?: string } = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--port' && i + 1 < args.length) {
            result.port = Number(args[++i]);
        } else if (arg === '--host' && i + 1 < args.length) {
            result.host = args[++i];
        } else {
            throw new Error(`Unknown or incomplete argument: ${arg}`);
        }
    }
    return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    startTokenTrackerDashboard(parseArgs());
}
