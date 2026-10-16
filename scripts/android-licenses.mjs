import { createRequire } from 'node:module';
import { readFile, readdir, mkdir, copyFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

// Ship license/notice texts for the production dependency tree with the APK.
export async function bundleAndroidLicenses(destination) {
  const visited = new Set();
  const packages = [];
  async function collect(name, parent) {
    const require = createRequire(join(parent, 'package.json'));
    let directory;
    try {
      directory = dirname(require.resolve(`${name}/package.json`));
    } catch {
      directory = dirname(require.resolve(name));
      while (true) {
        try {
          const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
          if (metadata.name === name) break;
        } catch { /* Entry may be nested below the package root. */ }
        const next = dirname(directory);
        if (next === directory) throw new Error(`Cannot locate license package: ${name}`);
        directory = next;
      }
    }
    if (visited.has(directory)) return;
    visited.add(directory);
    const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    const target = join(destination, `${name.replaceAll('/', '_')}@${metadata.version}`);
    await mkdir(target, { recursive: true });
    const notices = [];
    for (const filename of await readdir(directory)) {
      if (!/^(licen[cs]e|notice|copying)(?:[.-].*)?$/i.test(filename)) continue;
      if (!(await stat(join(directory, filename))).isFile()) continue;
      await copyFile(join(directory, filename), join(target, filename));
      notices.push(filename);
    }
    if (!notices.length) throw new Error(`Missing license text: ${name}`);
    packages.push({ name, version: metadata.version, license: metadata.license, notices });
    for (const dependency of Object.keys(metadata.dependencies || {})) await collect(dependency, directory);
  }
  const project = JSON.parse(await readFile('package.json', 'utf8'));
  for (const name of Object.keys(project.dependencies)) await collect(name, resolve('.'));
  await writeIndex();
  async function writeIndex() {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(destination, 'index.json'), JSON.stringify(packages, null, 2));
  }
}
