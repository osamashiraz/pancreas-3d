/** Writes data/human-pancreas-inventory.json, the inventory as plain data for the Python builders.
 * Run: npx tsx scripts/human/export_inventory.ts. tests/human-pancreas.test.ts fails if the file is stale. */
import { writeFileSync } from 'node:fs';
import { inventoryAsData } from '../../src/domain/human-pancreas-structures';

writeFileSync(new URL('../../data/human-pancreas-inventory.json', import.meta.url), JSON.stringify(inventoryAsData(), null, 1) + '\n');
