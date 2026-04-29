import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const SAMPLE_DASHBOARD = readFileSync(join(__dirname, 'sample_dashboard.ndjson'), 'utf-8');
export const SAMPLE_WITH_DATASOURCE = readFileSync(join(__dirname, 'sample_with_datasource.ndjson'), 'utf-8');
export const SAMPLE_AOSS_EXPORT = readFileSync(join(__dirname, 'sample_aoss_export.ndjson'), 'utf-8');
export const SAMPLE_EMPTY = readFileSync(join(__dirname, 'sample_empty.ndjson'), 'utf-8');
