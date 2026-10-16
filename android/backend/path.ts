export function basename(value: string, extension = '') { const name = value.split('/').pop() || ''; return extension ? name.slice(0, -extension.length) : name; }
export function extname(value: string) { return /\.[^/.]+$/.exec(value)?.[0] || ''; }
export function join(...values: string[]) { return values.join('/'); }
