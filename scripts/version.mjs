import { readFile, writeFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const write = (path, text) => writeFile(new URL(`../${path}`, import.meta.url), text);
const pkg = JSON.parse(await read('package.json'));
const input = process.argv[2];
const check = input === '--check';
const version = check ? pkg.version : input;
if (!version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)
  || version.split('+')[0].split('-').slice(1).join('-').split('.').some(part => /^0\d+$/.test(part))) {
  throw new Error('Usage: node scripts/version.mjs <SemVer> | --check');
}
const lock = JSON.parse(await read('package-lock.json'));
const cargo = await read('src-tauri/Cargo.toml');
const cargoLock = await read('src-tauri/Cargo.lock');
const cargoVersion = /^(\[package\][\s\S]*?\nversion = ")([^"]+)(")/m;
const cargoLockVersion = /(\[\[package\]\]\r?\nname = "pixel-record"\r?\nversion = ")([^"]+)(")/;
if (!cargoVersion.test(cargo) || !cargoLockVersion.test(cargoLock)) throw new Error('Cargo package version entry missing');
if (check) {
  const config = JSON.parse(await read('src-tauri/tauri.conf.json'));
  const versions = [lock.version, lock.packages[''].version, cargo.match(cargoVersion)[2], cargoLock.match(cargoLockVersion)[2]];
  if (config.version !== '../package.json' || versions.some(value => value !== version)) throw new Error('Build versions do not match package.json');
} else {
  pkg.version = version;
  lock.version = version;
  lock.packages[''].version = version;
  await write('package.json', JSON.stringify(pkg, null, 2) + '\n');
  await write('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
  const replaceVersion = (_, prefix, _previous, suffix) => prefix + version + suffix;
  await write('src-tauri/Cargo.toml', cargo.replace(cargoVersion, replaceVersion));
  await write('src-tauri/Cargo.lock', cargoLock.replace(cargoLockVersion, replaceVersion));
}
console.log(`Version ${version}: ${check ? 'consistent' : 'synchronized'}`);
