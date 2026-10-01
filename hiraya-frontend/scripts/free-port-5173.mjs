import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const PORT = 5173;
const SYS = process.env.SystemRoot || 'C:\\Windows';
const NETSTAT = join(SYS, 'System32', 'netstat.exe');
const TASKKILL = join(SYS, 'System32', 'taskkill.exe');
const WMIC = join(SYS, 'System32', 'wbem', 'wmic.exe');
const PS = join(SYS, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

function run(cmd) {
    try {
        return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
        return e.stdout || '';
    }
}

const victims = new Set();

// 1) Anything currently LISTENING on PORT
for (const line of run(`"${NETSTAT}" -ano -p TCP`).split(/\r?\n/)) {
    if (!new RegExp(`:${PORT}\\s`).test(line) || !/LISTENING/i.test(line)) continue;
    const pid = line.trim().split(/\s+/).pop();
    if (pid && Number(pid) !== process.pid) victims.add(pid);
}

// 2) Any leftover Vite dev server (may sit on another port after a strictPort failure)
let procs = existsSync(WMIC)
    ? run(`"${WMIC}" process where "name='node.exe'" get ProcessId,CommandLine /format:list`)
    : '';
if (!procs.trim()) {
    procs = run(
        `"${PS}" -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | ForEach-Object { 'PID=' + $_.ProcessId + ' ' + $_.CommandLine }"`
    );
}
for (const line of procs.split(/\r?\n/)) {
    if (!/vite/i.test(line)) continue;
    const pid = /PID=(\d+)/.exec(line)?.[1] || /ProcessId=(\d+)/.exec(line)?.[1];
    if (pid && Number(pid) !== process.pid) victims.add(pid);
}

for (const pid of victims) {
    console.log(`  killing PID ${pid}`);
    run(`"${TASKKILL}" /F /PID ${pid}`);
}

await new Promise((r) => setTimeout(r, 500));
console.log(victims.size ? `Port ${PORT} freed.` : `Port ${PORT} already free.`);
