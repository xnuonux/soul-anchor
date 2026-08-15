// cloud-key.mjs ... where the supabase service key lives now: data/cloud-key.json
// (gitignored, machine-local) or the SOUL_ANCHOR_SUPA_KEY env var. the key is
// a root credential for the mirror project; it does not belong in tracked
// files. a fresh clone provisions it by copying scripts/cloud-key.example.json
// to data/cloud-key.json and filling in the value.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY_PATH = path.join(REPO, 'data', 'cloud-key.json');

export function cloudKey() {
  if (process.env.SOUL_ANCHOR_SUPA_KEY) return process.env.SOUL_ANCHOR_SUPA_KEY;
  if (fs.existsSync(KEY_PATH)) {
    const parsed = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
    if (parsed.service_role_key) return parsed.service_role_key;
  }
  console.error('no cloud key: set SOUL_ANCHOR_SUPA_KEY or fill data/cloud-key.json (see scripts/cloud-key.example.json)');
  process.exitCode = 2;
  return null;
}

export const SUPA_URL = 'https://fpposmirumtbocqtxued.supabase.co';
