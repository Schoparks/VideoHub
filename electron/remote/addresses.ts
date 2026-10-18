import { networkInterfaces } from 'node:os';

export function controllerHosts() {
  return [...new Set(Object.values(networkInterfaces()).flatMap(entries => (entries || [])
    .filter(entry => entry.family === 'IPv4' && !entry.internal && privateAddress(entry.address))
    .map(entry => entry.address)))];
}

export function privateAddress(address: string) {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);
}
