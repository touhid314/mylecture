/**
 * pdf2fig.ts
 *
 * TypeScript wrapper tool that invokes the python script `utils/pdf2fig.py`
 * to extract figures and tables from a PDF using DocLayout-YOLO.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolve_workspace_path } from '../workspace.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/**
 * Searches for a valid python executable in virtual environments.
 */
function resolvePythonExe(): string {
    const searchPaths = [
        // Repository root .venv
        path.resolve(__dirname, '../../../../.venv'),
        // Package local .venv
        path.resolve(__dirname, '../../.venv'),
    ];
    for (const venvDir of searchPaths) {
        const pythonExe = process.platform === 'win32'
            ? path.join(venvDir, 'Scripts', 'python.exe')
            : path.join(venvDir, 'bin', 'python');
        if (fs.existsSync(pythonExe)) {
            return pythonExe;
        }
    }
    return 'python';
}
/**
 * Executes the python script `pdf2fig.py` to extract figures and tables from the PDF.
 * @param pdfPath Workspace-relative or absolute path to the PDF file.
 * @param workspaceDir Workspace directory root.
 */
export function tool_pdf2fig(pdfPath: string, workspaceDir?: string, customOutputDir?: string, savePageImg: boolean = false): Promise<string> {
    return new Promise((resolve, reject) => {
        try {
            let absolutePdfPath = path.isAbsolute(pdfPath) ? pdfPath : path.resolve(pdfPath);
            if (!fs.existsSync(absolutePdfPath)) {
                try {
                    absolutePdfPath = resolve_workspace_path(pdfPath, workspaceDir);
                } catch (e) {
                    // Ignore and fallback to file existence check which will fail below
                }
            }
            if (!fs.existsSync(absolutePdfPath)) {
                return reject(`PDF file not found: ${pdfPath} (checked both cwd and workspace)`);
            }
            const pythonExe = resolvePythonExe();
            const scriptPath = path.resolve(__dirname, 'utils', 'pdf2fig.py');

            // Set output directory
            const pdfStem = path.basename(absolutePdfPath, path.extname(absolutePdfPath));
            const outputDir = customOutputDir 
                ? path.resolve(customOutputDir) 
                : (workspaceDir ? path.resolve(workspaceDir) : path.resolve(__dirname, 'outputs', 'img2fig', pdfStem));

            const argsList = [scriptPath, '--pdf', absolutePdfPath, '--output', outputDir];
            if (savePageImg) {
                argsList.push('--save-page-img');
            }

            console.log(`[pdf2fig] Running: ${pythonExe} ${argsList.map(a => `"${a}"`).join(' ')}`);
            const child = spawn(pythonExe, argsList);

            let stdoutAccumulator = '';
            let stderrAccumulator = '';

            child.stdout.on('data', (data) => {
                const chunk = data.toString();
                stdoutAccumulator += chunk;
                process.stdout.write(chunk);
            });

            child.stderr.on('data', (data) => {
                const chunk = data.toString();
                stderrAccumulator += chunk;
                process.stderr.write(chunk);
            });

            child.on('close', (code) => {
                if (code !== 0) {
                    return reject(`python execution failed with code ${code}: ${stderrAccumulator}`);
                }
                resolve(stdoutAccumulator.trim());
            });
        } catch (err: any) {
            reject(`Failed to launch pdf2fig: ${err.message || err}`);
        }
    });
}
/**
 * Compaction function for tool execution history.
 */
export function compact_pdf2fig(args: { pdfPath: string }, result: string): { compactedArgs: any; compactedResult: string } {
    return {
        compactedArgs: args,
        compactedResult: result.length > 500 ? result.substring(0, 500) + '\n... [Truncated for history compaction]' : result
    };
}
// ============================================================================
// CLI Entrypoint for standalone testing
// ============================================================================
const isMain = process.argv[1] && (
    fileURLToPath(import.meta.url) === process.argv[1] ||
    process.argv[1].endsWith('pdf2fig.ts') ||
    process.argv[1].endsWith('pdf2fig.js')
);
if (isMain) {
    const args = process.argv.slice(2);
    const pdfIndex = args.indexOf('--pdf');
    const pdfPath = pdfIndex !== -1 && args[pdfIndex + 1] ? args[pdfIndex + 1] : null;
    const outputIndex = args.indexOf('--output');
    const outputDir = outputIndex !== -1 && args[outputIndex + 1] ? args[outputIndex + 1] : undefined;
    const savePageImg = args.includes('--savepageimg') || args.includes('--save-page-img');

    if (!pdfPath) {
        console.error('Usage: node --import tsx packages/lecture-agent/src/tools/pdf2fig.ts --pdf <path_to_pdf> [--output <output_dir>] [--savepageimg]');
        process.exit(1);
    }
    console.log(`Testing tool_pdf2fig with PDF: ${pdfPath}`);
    tool_pdf2fig(pdfPath, undefined, outputDir, savePageImg)
        .then((result) => {
            console.log('\n--- SUCCESS ---');
            console.log(result);
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n--- ERROR ---');
            console.error(error);
            process.exit(1);
        });
}
