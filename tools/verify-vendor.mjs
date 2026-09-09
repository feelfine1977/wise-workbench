import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../vendor/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('wise-flow.provenance.json', root), 'utf8'));
if (!/^wise-flow-[a-zA-Z0-9.+-]+\.tgz$/.test(manifest.tarball)) throw new Error('Invalid flow artifact filename');
const bytes = readFileSync(new URL(manifest.tarball, root));
const actual = createHash('sha256').update(bytes).digest('hex');
if (actual !== manifest.sha256) throw new Error('Flow artifact checksum differs from provenance');
const frontend = JSON.parse(readFileSync(new URL('../apps/frontend/package.json', import.meta.url), 'utf8'));
if (frontend.dependencies['@wise/flow'] !== `file:../../vendor/${manifest.tarball}`) throw new Error('Frontend dependency differs from flow provenance');
console.log(`Verified ${manifest.package} ${manifest.version}: ${fileURLToPath(new URL(manifest.tarball, root))}`);
