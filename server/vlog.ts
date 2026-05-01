export const VERBOSE = process.argv.includes('-v') || process.argv.includes('--verbose');
export const vlog = (...args: any[]) => { if (VERBOSE) console.log(...args); };
